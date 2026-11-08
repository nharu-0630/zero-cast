// PoC: 複数の R2 オブジェクトを1つの MP3 として Range 対応で配信する。
// 検証対象は docs/SPEC.md 6.5 節の方式。本実装では項目サイズを D1 から取得する。

interface Part {
  key: string;
  offset: number;
  length: number;
}

const MAX_ITEMS = 50;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const audioKey = (id: string) => `items/${id}.mp3`;

function parseIds(url: URL): string[] | null {
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_ITEMS) return null;
  return ids.every((id) => ID_PATTERN.test(id)) ? ids : null;
}

/** "bytes=a-b" 形式を解釈する。範囲外は "invalid"、複数範囲や未指定は null（全体を返す）。 */
export function parseRange(header: string | null, total: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix === 0) return "invalid";
    start = Math.max(total - suffix, 0);
    end = total - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? total - 1 : Math.min(Number(rawEnd), total - 1);
  }
  return start >= total || start > end ? "invalid" : { start, end };
}

/** 連結後のバイト範囲を、各オブジェクト内の範囲に変換する。 */
export function mapRange(items: { key: string; size: number }[], start: number, end: number): Part[] {
  const parts: Part[] = [];
  let cursor = 0;
  for (const { key, size } of items) {
    const itemStart = cursor;
    const itemEnd = cursor + size - 1;
    cursor += size;
    if (itemEnd < start || itemStart > end) continue;
    const from = Math.max(start, itemStart);
    const to = Math.min(end, itemEnd);
    parts.push({ key, offset: from - itemStart, length: to - from + 1 });
  }
  return parts;
}

async function pump(bucket: R2Bucket, parts: Part[], writable: WritableStream<Uint8Array>): Promise<void> {
  try {
    for (const { key, offset, length } of parts) {
      const object = await bucket.get(key, { range: { offset, length } });
      if (!object) throw new Error(`missing object: ${key}`);
      await object.body.pipeTo(writable, { preventClose: true });
    }
    await writable.close();
  } catch (error) {
    // クライアントの切断は通常動作のため、ストリームを中断するだけにする。
    await writable.abort(error).catch(() => undefined);
  }
}

async function loadItems(bucket: R2Bucket, ids: string[]) {
  const heads = await Promise.all(ids.map((id) => bucket.head(audioKey(id))));
  if (heads.some((head) => head === null)) return null;
  return heads.map((head, index) => ({ id: ids[index], key: audioKey(ids[index]), size: head!.size }));
}

async function serveAudio(request: Request, env: Env, ctx: ExecutionContext, ids: string[]): Promise<Response> {
  const items = await loadItems(env.BUCKET, ids);
  if (!items) return new Response("not found", { status: 404 });

  const total = items.reduce((sum, item) => sum + item.size, 0);
  const headers = new Headers({
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  });

  const range = parseRange(request.headers.get("Range"), total);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${total}`);
    return new Response(null, { status: 416, headers });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? total - 1;
  const length = end - start + 1;
  headers.set("Content-Length", String(length));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });

  const { readable, writable } = new FixedLengthStream(length);
  ctx.waitUntil(pump(env.BUCKET, mapRange(items, start, end), writable));
  return new Response(readable, { status, headers });
}

const COOKIE_NAME = "__Host-poc-session";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function handleCookie(request: Request): Response {
  if (request.method === "POST") {
    const issuedAt = Date.now();
    return Response.json(
      { issuedAt },
      {
        headers: {
          "Set-Cookie": `${COOKIE_NAME}=${issuedAt}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
        },
      },
    );
  }
  const match = new RegExp(`${COOKIE_NAME}=(\\d+)`).exec(request.headers.get("Cookie") ?? "");
  return Response.json({ issuedAt: match ? Number(match[1]) : null });
}

async function handleLog(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (body.length > 256 * 1024) return new Response("too large", { status: 413 });
  const key = `logs/${new Date().toISOString()}.json`;
  await env.BUCKET.put(key, body, { httpMetadata: { contentType: "application/json" } });
  return Response.json({ key });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/poc/cookie") return handleCookie(request);
    if (url.pathname === "/poc/log" && request.method === "POST") return handleLog(request, env);

    if (url.pathname === "/audio/manifest") {
      const ids = parseIds(url);
      const items = ids && (await loadItems(env.BUCKET, ids));
      if (!items) return new Response("not found", { status: 404 });
      return Response.json(items.map(({ id, size }) => ({ id, size })));
    }

    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname === "/audio/mix.mp3") {
        const ids = parseIds(url);
        if (!ids) return new Response("bad ids", { status: 400 });
        return serveAudio(request, env, ctx, ids);
      }
      const item = /^\/audio\/items\/([A-Za-z0-9_-]{1,64})\.mp3$/.exec(url.pathname);
      if (item) return serveAudio(request, env, ctx, [item[1]]);
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
