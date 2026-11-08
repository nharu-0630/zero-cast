const AUDIO_CACHE = "audio-v1";
const SHELL_CACHE = "shell-v1";
const SHELL = ["/", "/app.js", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function parseRange(header, total) {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") return { start: Math.max(total - Number(match[2]), 0), end: total - 1 };
  // iOS で文字列連結による範囲計算の誤りが報告されているため、必ず数値にする。
  const start = Number(match[1]);
  const end = match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1);
  return { start, end };
}

async function serveMix(request, url) {
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  const cache = await caches.open(AUDIO_CACHE);
  const responses = await Promise.all(ids.map((id) => cache.match(`/audio/items/${id}.mp3`)));
  if (ids.length === 0 || responses.some((response) => !response)) return fetch(request);

  const parts = await Promise.all(responses.map((response) => response.blob()));
  const whole = new Blob(parts, { type: "audio/mpeg" });
  const headers = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes" };
  const range = parseRange(request.headers.get("Range"), whole.size);
  if (!range) return new Response(whole, { status: 200, headers: { ...headers, "Content-Length": String(whole.size) } });
  if (range.start >= whole.size || range.start > range.end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${whole.size}` } });
  }
  const body = whole.slice(range.start, range.end + 1, "audio/mpeg");
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(body.size),
      "Content-Range": `bytes ${range.start}-${range.end}/${whole.size}`,
    },
  });
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || event.request.method !== "GET") return;
  if (url.pathname === "/audio/mix.mp3") {
    if (!url.searchParams.has("net")) event.respondWith(serveMix(event.request, url));
    return;
  }
  if (SHELL.includes(url.pathname)) event.respondWith(networkFirst(event.request));
});
