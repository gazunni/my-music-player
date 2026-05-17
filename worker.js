const CONTENT_TYPES = {
  mp3:  "audio/mpeg",
  m4a:  "audio/mp4",
  flac: "audio/flac",
  wav:  "audio/wav",
  ogg:  "audio/ogg",
  aac:  "audio/aac",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  png:  "image/png",
  webp: "image/webp",
  gif:  "image/gif"
};

function r2Response(obj, path) {
  const ext = path.split(".").pop().toLowerCase();
  const headers = {
    "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "bytes"
  };
  if (obj.size) headers["Content-Length"] = String(obj.size);
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // --- /api/albums → albums.json from static assets (repo) ---
    if (path === "/api/albums") {
      const assetReq = new Request(new URL("/albums.json", url));
      const res = await env.ASSETS.fetch(assetReq);
      if (!res.ok) {
        return new Response(JSON.stringify({ error: "albums.json not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(res.body, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // --- /covers/* → my-album-covers R2 bucket ---
    if (path.startsWith("/covers/")) {
      const key = path.slice("/covers/".length); // e.g. "mango.png"
      const obj = await env.COVERS_BUCKET.get(key);
      if (!obj) return new Response(`Cover not found: ${key}`, { status: 404 });
      return r2Response(obj, path);
    }

    // --- /music/* → my-hits-list R2 bucket ---
    // URL:  /music/funny/dontaskthemango.mp3
    // Key:  funny/dontaskthemango.mp3
    if (path.startsWith("/music/")) {
      const key = path.slice("/music/".length);
      const obj = await env.MUSIC_BUCKET.get(key);
      if (!obj) return new Response(`Track not found: ${key}`, { status: 404 });
      return r2Response(obj, path);
    }

    // --- Everything else → static assets (index.html, etc.) ---
    return env.ASSETS.fetch(request);
  }
};
