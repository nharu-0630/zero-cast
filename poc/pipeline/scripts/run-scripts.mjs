// 検証用の記事から台本を生成し、out/ に保存して集計を表示する。
import { mkdir, writeFile } from "node:fs/promises";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:8798/";
const OUT_DIR = new URL("../out/", import.meta.url);

const URLS = [
  ["wiki-podcast", "https://ja.wikipedia.org/wiki/ポッドキャスト"],
  ["wiki-tts", "https://ja.wikipedia.org/wiki/音声合成"],
  ["cf-markdown", "https://blog.cloudflare.com/markdown-for-agents/"],
  ["webkit-storage", "https://webkit.org/blog/14403/updates-to-storage-policy/"],
  ["aozora-melos", "https://www.aozora.gr.jp/cards/000035/files/1567_14913.html"],
];

await mkdir(OUT_DIR, { recursive: true });
for (const [name, url] of URLS) {
  const response = await fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ url }) });
  const result = await response.json();
  await writeFile(new URL(`${name}.json`, OUT_DIR), JSON.stringify(result, null, 2));
  console.log(
    name,
    result.error
      ? `ERROR ${result.error}`
      : `source=${result.sourceChars} target=${result.targetChars} chars=${result.chars} turns=${result.turns} ` +
          `tokens=${result.usage.prompt_tokens}/${result.usage.completion_tokens} neurons=${result.neurons} ${result.elapsedMs}ms`,
  );
}
