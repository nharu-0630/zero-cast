// 台本 JSON を Chirp 3 HD で合成し、バイト連結して計測する。
// 使い方: GCP_TOKEN=... GCP_PROJECT=... node synthesize.mjs <台本名>...
// 発話ごとの MP3 は out/chunks に保存し、再実行で文字数を二重に消費しない。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { GCP_TOKEN, GCP_PROJECT } = process.env;
if (!GCP_TOKEN || !GCP_PROJECT) throw new Error("GCP_TOKEN and GCP_PROJECT are required");

const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const CHUNKS = `${OUT}chunks/`;
const VOICES = { A: "ja-JP-Chirp3-HD-Kore", B: "ja-JP-Chirp3-HD-Charon" };
const SILENCE_MS = 300;
const CONCURRENCY = 4;

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const toHalfWidth = (text) => text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const normalize = (text) => toHalfWidth(text.trim().replace(/^「(.*)」$/s, "$1"));

let requests = 0;
let billedChars = 0;

async function synthesize(voice, text) {
  const key = createHash("sha256").update(`${voice}\n${text}`).digest("hex");
  const path = `${CHUNKS}${key}.mp3`;
  if (existsSync(path)) return path;
  const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GCP_TOKEN}`,
      "x-goog-user-project": GCP_PROJECT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "ja-JP", name: voice },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });
  if (!response.ok) throw new Error(`tts ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const { audioContent } = await response.json();
  await writeFile(path, Buffer.from(audioContent, "base64"));
  requests += 1;
  billedChars += text.length;
  return path;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

function probe(path) {
  const stream = JSON.parse(
    run("ffprobe", ["-v", "error", "-show_entries", "stream=sample_rate,channels,bit_rate:format=duration", "-of", "json", path]),
  );
  return {
    sampleRate: Number(stream.streams[0].sample_rate),
    channels: Number(stream.streams[0].channels),
    bitRate: Number(stream.streams[0].bit_rate),
    duration: Number(stream.format.duration),
  };
}

function inspectContainer(path, bytes) {
  const sizes = run("ffprobe", ["-v", "error", "-show_entries", "packet=size", "-of", "csv=p=0", path]).trim().split("\n");
  return {
    id3: bytes.subarray(0, 3).toString("latin1") === "ID3",
    xing: /Xing|Info/.test(bytes.subarray(0, 300).toString("latin1")),
    packetSizes: [...new Set(sizes.map((size) => size.replace(/,.*/, "")))].slice(0, 8),
  };
}

function silenceFor(format) {
  const path = `${CHUNKS}silence-${format.sampleRate}-${format.bitRate}-${format.channels}.mp3`;
  if (existsSync(path)) return path;
  run("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", `anullsrc=r=${format.sampleRate}:cl=${format.channels === 1 ? "mono" : "stereo"}`,
    "-t", String(SILENCE_MS / 1000), "-c:a", "libmp3lame", "-b:a", String(format.bitRate),
    "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", path,
  ]);
  return path;
}

await mkdir(CHUNKS, { recursive: true });

// 英語表記をそのまま読ませた場合とカタカナにした場合の比較用。
const samples = {
  "ab-raw": "AIとHTMLとAPIの話です。CloudflareのWorkersでMarkdownに変換します。料金は月5ドルです。",
  "ab-kana": "エーアイとエイチティーエムエルとエーピーアイの話です。クラウドフレアのワーカーズでマークダウンに変換します。料金は月5ドルです。",
};
for (const [name, text] of Object.entries(samples)) {
  await writeFile(`${OUT}${name}.mp3`, await readFile(await synthesize(VOICES.B, text)));
}

for (const name of process.argv.slice(2)) {
  const { script } = JSON.parse(await readFile(`${OUT}${name}.json`, "utf8"));
  const turns = script.turns.map((turn) => ({ voice: VOICES[turn.speaker], text: normalize(turn.text) }));
  const startedAt = Date.now();
  const paths = await mapLimit(turns, CONCURRENCY, (turn) => synthesize(turn.voice, turn.text));
  const elapsedMs = Date.now() - startedAt;

  const first = await readFile(paths[0]);
  const format = probe(paths[0]);
  const silence = await readFile(silenceFor(format));
  const buffers = [];
  for (const path of paths) buffers.push(await readFile(path), silence);
  const output = `${OUT}${name}.mp3`;
  await writeFile(output, Buffer.concat(buffers));

  const chars = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  const speechSeconds = paths.reduce((sum, path) => sum + probe(path).duration, 0);
  const total = probe(output);
  const decode = execFileSync("sh", ["-c", `ffmpeg -v error -i "${output}" -f null - 2>&1 | wc -l`], { encoding: "utf8" }).trim();
  console.log(
    JSON.stringify({
      name,
      turns: turns.length,
      chars,
      elapsedMs,
      format,
      container: inspectContainer(paths[0], first),
      speechSeconds: Math.round(speechSeconds),
      totalSeconds: Math.round(total.duration),
      expectedSeconds: Math.round(speechSeconds + (paths.length * SILENCE_MS) / 1000),
      charsPerMinute: Math.round(chars / (speechSeconds / 60)),
      bytes: Buffer.concat(buffers).length,
      decodeErrorLines: Number(decode),
    }),
  );
}
console.log(JSON.stringify({ newRequests: requests, newBilledChars: billedChars }));
