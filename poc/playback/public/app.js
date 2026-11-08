const IDS = ["a", "b", "c"];
const CACHE_NAME = "audio-v1";
const LOG_KEY = "poc-log";
const BYTES_PER_SECOND = 64000 / 8;

const $ = (id) => document.getElementById(id);
const audio = $("audio");
const mixUrl = (extra = "") => `/audio/mix.mp3?ids=${IDS.join(",")}${extra}`;
const itemUrl = (id) => `/audio/items/${id}.mp3`;

let mode = null;
let swapIndex = 0;
let sizes = null;
let blobUrl = null;
let lastItem = -1;
let lastLoggedSecond = -1;

function readLog() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function log(message) {
  const entries = readLog();
  const hidden = document.visibilityState === "hidden" ? " [hidden]" : "";
  entries.push(`${new Date().toISOString().slice(11, 19)} ${mode ?? "-"} ${message}${hidden}`);
  const kept = entries.slice(-400);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(kept));
  } catch {}
  $("log").textContent = kept.slice().reverse().join("\n");
}

function currentItem(seconds) {
  if (mode === "swap") return swapIndex;
  if (!sizes) return 0;
  let cumulative = 0;
  for (let index = 0; index < sizes.length; index++) {
    cumulative += sizes[index] / BYTES_PER_SECOND;
    if (seconds < cumulative) return index;
  }
  return sizes.length - 1;
}

function start(nextMode, src) {
  mode = nextMode;
  swapIndex = 0;
  lastItem = -1;
  lastLoggedSecond = -1;
  audio.src = src;
  log(`tap src=${src.slice(0, 40)}`);
  // 再生開始がユーザー操作と見なされるよう、タップの処理の中で await せずに呼ぶ。
  audio.play().then(
    () => log("play() resolved"),
    (error) => log(`play() rejected: ${error.name}`),
  );
}

document.querySelectorAll("button[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const selected = button.dataset.mode;
    if (selected === "net") start("net", mixUrl("&net=1"));
    if (selected === "swap") start("swap", itemUrl(IDS[0]));
    if (selected === "sw") start("sw", mixUrl());
    if (selected === "blob" && blobUrl) start("blob", blobUrl);
  });
});

$("stop").addEventListener("click", () => {
  audio.pause();
  log(`stopped at ${audio.currentTime.toFixed(1)}s`);
});

audio.addEventListener("ended", () => {
  log("ended");
  if (mode !== "swap" || swapIndex >= IDS.length - 1) return;
  swapIndex += 1;
  audio.src = itemUrl(IDS[swapIndex]);
  audio.play().then(
    () => log(`swap to ${IDS[swapIndex]} resolved`),
    (error) => log(`swap to ${IDS[swapIndex]} rejected: ${error.name}`),
  );
});

for (const name of ["pause", "playing", "waiting", "stalled", "error"]) {
  audio.addEventListener(name, () => {
    const detail = name === "error" ? ` code=${audio.error?.code}` : "";
    log(`${name} t=${audio.currentTime.toFixed(1)}s${detail}`);
  });
}

audio.addEventListener("timeupdate", () => {
  const item = currentItem(audio.currentTime);
  const second = Math.floor(audio.currentTime);
  $("status").textContent = `項目 ${IDS[item]} ・ ${second}s / ${Number.isFinite(audio.duration) ? Math.floor(audio.duration) : "?"}s`;
  if (item !== lastItem) {
    lastItem = item;
    log(`item=${IDS[item]} t=${audio.currentTime.toFixed(1)}s`);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: `項目 ${IDS[item]}`, artist: "zero-cast PoC" });
    }
  }
  if (second % 10 === 0 && second !== lastLoggedSecond) {
    lastLoggedSecond = second;
    log(`t=${second}s`);
  }
});

document.addEventListener("visibilitychange", () => log(`visibility=${document.visibilityState} t=${audio.currentTime.toFixed(1)}s`));
window.addEventListener("pagehide", () => log("pagehide"));

async function loadSizes() {
  const response = await fetch(`/audio/manifest?ids=${IDS.join(",")}`);
  sizes = (await response.json()).map((item) => item.size);
}

async function refreshDownloadState() {
  const cache = await caches.open(CACHE_NAME);
  const stored = await Promise.all(IDS.map((id) => cache.match(itemUrl(id))));
  const ready = stored.every(Boolean);
  document.querySelector('[data-mode="sw"]').disabled = !ready;
  $("download-status").textContent = `保存済み ${stored.filter(Boolean).length}/${IDS.length}`;
  if (ready && !blobUrl) {
    const parts = await Promise.all(stored.map((response) => response.clone().blob()));
    blobUrl = URL.createObjectURL(new Blob(parts, { type: "audio/mpeg" }));
    document.querySelector('[data-mode="blob"]').disabled = false;
  }
}

$("download").addEventListener("click", async () => {
  const cache = await caches.open(CACHE_NAME);
  try {
    await Promise.all(IDS.map((id) => cache.add(itemUrl(id))));
    log("download complete");
  } catch (error) {
    log(`download failed: ${error.name}`);
  }
  await refreshDownloadState();
});

async function refreshCookie() {
  try {
    const { issuedAt } = await (await fetch("/poc/cookie")).json();
    $("cookie").textContent = issuedAt
      ? `Cookie 維持: ${((Date.now() - issuedAt) / 86400000).toFixed(2)} 日（${new Date(issuedAt).toLocaleString()} 発行）`
      : "Cookie なし";
    return issuedAt;
  } catch {
    $("cookie").textContent = "Cookie 確認不可（オフライン）";
    return null;
  }
}

$("set-cookie").addEventListener("click", async () => {
  await fetch("/poc/cookie", { method: "POST" });
  log("cookie issued");
  await refreshCookie();
});

$("send-log").addEventListener("click", async () => {
  const body = JSON.stringify({
    userAgent: navigator.userAgent,
    standalone: navigator.standalone === true || matchMedia("(display-mode: standalone)").matches,
    cookieIssuedAt: await refreshCookie(),
    log: readLog(),
  });
  const response = await fetch("/poc/log", { method: "POST", body });
  $("download-status").textContent = response.ok ? "結果を送信しました" : `送信失敗 ${response.status}`;
});

$("clear-log").addEventListener("click", () => {
  localStorage.removeItem(LOG_KEY);
  $("log").textContent = "";
});

async function init() {
  const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  let persisted = "未対応";
  if (navigator.storage?.persist) persisted = String(await navigator.storage.persist());
  $("env").textContent = `ホーム画面アプリ: ${standalone ? "はい" : "いいえ"} / persist: ${persisted}`;
  $("log").textContent = readLog().slice().reverse().join("\n");
  if ("serviceWorker" in navigator) await navigator.serviceWorker.register("/sw.js");
  await Promise.all([loadSizes().catch(() => undefined), refreshCookie(), refreshDownloadState()]);
}

init();
