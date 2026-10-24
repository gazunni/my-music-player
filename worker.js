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

const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/png":  "png",
  "image/webp": "webp",
  "image/gif":  "gif"
};

// ── ID3v2 embedded cover-art extraction ─────────────────────
// Suno (and most AI/streaming MP3 exports) embed a front-cover image
// directly in the file's ID3v2 tags. When an admin doesn't upload a
// separate cover, we pull it from here instead of leaving the album
// with no artwork. Hand-rolled (no npm deps) since this worker has none.
function readSyncSafeInt(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) |
         ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
}

function parseApicFrame(bytes, start, end) {
  const encoding = bytes[start];
  let pos = start + 1;
  let mimeEnd = pos;
  while (mimeEnd < end && bytes[mimeEnd] !== 0) mimeEnd++;
  const mime = String.fromCharCode(...bytes.slice(pos, mimeEnd)).toLowerCase();
  pos = mimeEnd + 1;
  const pictureType = bytes[pos];
  pos += 1;
  if (encoding === 1 || encoding === 2) {
    while (pos < end - 1 && !(bytes[pos] === 0 && bytes[pos + 1] === 0)) pos += 2;
    pos += 2;
  } else {
    while (pos < end && bytes[pos] !== 0) pos++;
    pos += 1;
  }
  const data = bytes.slice(pos, end);
  if (!mime || !data.length) return null;
  return { mime, data, pictureType };
}

function parsePicFrameV22(bytes, start, end) {
  const encoding = bytes[start];
  const format = String.fromCharCode(bytes[start + 1], bytes[start + 2], bytes[start + 3]).toUpperCase();
  let pos = start + 4;
  const pictureType = bytes[pos];
  pos += 1;
  if (encoding === 1) {
    while (pos < end - 1 && !(bytes[pos] === 0 && bytes[pos + 1] === 0)) pos += 2;
    pos += 2;
  } else {
    while (pos < end && bytes[pos] !== 0) pos++;
    pos += 1;
  }
  const data = bytes.slice(pos, end);
  const mime = format === "PNG" ? "image/png" : "image/jpeg";
  if (!data.length) return null;
  return { mime, data, pictureType };
}

function extractId3CoverArt(arrayBuffer) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
      return null; // no "ID3" header at the start of the file
    }
    const majorVersion = bytes[3];
    const flags = bytes[5];
    const tagSize = readSyncSafeInt(bytes, 6);
    const tagEnd = Math.min(10 + tagSize, bytes.length);
    let pos = 10;

    if (flags & 0x40) { // extended header present — skip it
      const extSize = majorVersion >= 4
        ? readSyncSafeInt(bytes, pos)
        : (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
      pos += extSize + (majorVersion >= 4 ? 0 : 4);
    }

    let bestFrame = null;

    if (majorVersion === 2) {
      // ID3v2.2 — 3-char frame IDs, 3-byte sizes, "PIC" frame for artwork
      while (pos + 6 <= tagEnd) {
        const frameId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2]);
        const frameSize = (bytes[pos + 3] << 16) | (bytes[pos + 4] << 8) | bytes[pos + 5];
        pos += 6;
        if (frameId === "\0\0\0" || frameSize <= 0 || pos + frameSize > tagEnd) break;
        if (frameId === "PIC") {
          const frame = parsePicFrameV22(bytes, pos, pos + frameSize);
          if (frame && (!bestFrame || frame.pictureType === 3)) bestFrame = frame;
        }
        pos += frameSize;
      }
    } else {
      // ID3v2.3 / v2.4 — 4-char frame IDs, "APIC" frame for artwork
      while (pos + 10 <= tagEnd) {
        const frameId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
        if (frameId === "\0\0\0\0") break;
        const frameSize = majorVersion >= 4
          ? readSyncSafeInt(bytes, pos + 4)
          : (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
        pos += 10;
        if (frameSize <= 0 || pos + frameSize > tagEnd) break;
        if (frameId === "APIC") {
          const frame = parseApicFrame(bytes, pos, pos + frameSize);
          if (frame && (!bestFrame || frame.pictureType === 3)) bestFrame = frame;
        }
        pos += frameSize;
      }
    }
    return bestFrame; // { mime, data: Uint8Array, pictureType } or null
  } catch (err) {
    return null; // malformed/unsupported tag — just skip auto-cover
  }
}


const DEFAULT_LENSES = [
  "Quiet House",
  "Bittersweet",
  "Campfire",
  "A Night Out",
  "Rainy Window",
  "Healing",
  "Road Trip",
  "Dreamscape",
  "Late Night",
  "Funny Bone",
  "Soft Sleep",
  "Reflection"
];

function cleanLensName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 48);
}

function uniqueLenses(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const name = cleanLensName(value);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

async function readLenses(env) {
  const obj = await env.MUSIC_BUCKET.get("lenses.json");
  if (!obj) return DEFAULT_LENSES;
  try {
    const data = JSON.parse(await obj.text());
    return uniqueLenses(Array.isArray(data) ? data : data.lenses).length
      ? uniqueLenses(Array.isArray(data) ? data : data.lenses)
      : DEFAULT_LENSES;
  } catch {
    return DEFAULT_LENSES;
  }
}

async function writeLenses(env, lenses) {
  const clean = uniqueLenses(lenses);
  await env.MUSIC_BUCKET.put("lenses.json", JSON.stringify(clean, null, 2), {
    httpMetadata: { contentType: "application/json" }
  });
  return clean;
}

function normalizeTrackLenses(track, lenses = DEFAULT_LENSES) {
  const valid = new Set(lenses.map(l => l.toLowerCase()));
  const primary = cleanLensName(track.primaryLens || track.feeling || track.mood || "");
  const secondary = uniqueLenses(track.secondaryLenses || track.lenses || []);
  return {
    ...track,
    primaryLens: primary && valid.has(primary.toLowerCase()) ? primary : "",
    secondaryLenses: secondary.filter(l => valid.has(l.toLowerCase()) && l.toLowerCase() !== primary.toLowerCase())
  };
}

function normalizeAlbums(albums, lenses = DEFAULT_LENSES) {
  return (albums || []).map(album => ({
    ...album,
    tracks: (album.tracks || []).map(track => normalizeTrackLenses(track, lenses))
  }));
}

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

// Serves an R2 object honouring Range requests (required for audio seeking,
// background playback resumption, and reliable mobile streaming).
async function r2RangeResponse(bucket, key, request, path) {
  const ext = path.split(".").pop().toLowerCase();
  const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
  const rangeHeader = request.headers.get("Range");

  if (!rangeHeader) {
    // No range requested — serve full file, but still declare range support
    const obj = await bucket.get(key);
    if (!obj) return null;
    const headers = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes"
    };
    if (obj.size) headers["Content-Length"] = String(obj.size);
    return new Response(obj.body, { headers });
  }

  // Parse "bytes=START-END"
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    const obj = await bucket.get(key);
    if (!obj) return null;
    return new Response(obj.body, {
      status: 416,
      headers: { "Content-Range": `bytes */${obj.size || 0}`, "Access-Control-Allow-Origin": "*" }
    });
  }

  // First fetch metadata to know total size
  const head = await bucket.head(key);
  if (!head) return null;
  const totalSize = head.size;

  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end   = match[2] ? parseInt(match[2], 10) : totalSize - 1;
  if (isNaN(start) || start < 0) start = 0;
  if (isNaN(end) || end >= totalSize) end = totalSize - 1;
  if (start > end) start = end;

  const obj = await bucket.get(key, { range: { offset: start, length: end - start + 1 } });
  if (!obj) return null;

  return new Response(obj.body, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
    }
  });
}

async function readAlbums(env) {
  const obj = await env.MUSIC_BUCKET.get("albums.json");
  if (!obj) return [];
  const text = await obj.text();
  try { return JSON.parse(text); } catch { return []; }
}

const ALBUMS_CACHE_KEY = "https://music.generify.ca/api/albums";

async function writeAlbums(env, albums, ctx) {
  await env.MUSIC_BUCKET.put("albums.json", JSON.stringify(albums, null, 2), {
    httpMetadata: { contentType: "application/json" }
  });
  // Invalidate the edge-cached GET /api/albums response so admin changes
  // (new uploads, edits) show up immediately instead of waiting out the
  // cache's max-age — same "no stale caches after a write" principle as
  // the cover/track version-stamping fix.
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(caches.default.delete(new Request(ALBUMS_CACHE_KEY)));
  }
}

function sanitise(name) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-_.]/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ADMIN_COOKIE = "gm_admin";
const ADMIN_COOKIE_MAX_AGE = 8 * 60 * 60; // 8 hours

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function isAdmin(request, url, env) {
  const headerKey = request.headers.get("X-Admin-Key");
  const cookieKey = getCookie(request, ADMIN_COOKIE);
  const key       = headerKey || cookieKey;
  return Boolean(env.ADMIN_KEY) && key === env.ADMIN_KEY;
}

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // ── Social share OG tags ──
    if (method === 'GET' && (path === '/' || path === '/index.html') && url.searchParams.has('play')) {
      const albumId    = parseInt(url.searchParams.get('play'));
      const trackIndex = parseInt(url.searchParams.get('track') || '0');
      try {
        const albums = await readAlbums(env);
        const album  = albums.find(a => a.id === albumId);
        if (album) {
          const track    = album.tracks[Math.min(trackIndex, album.tracks.length - 1)] || album.tracks[0];
          const title    = escapeHtml(`${track.title} — ${album.artist}`);
          const desc     = escapeHtml(`Listen to "${track.title}" on Generify Music. Physics is Wrong. New Energy is Created Here.`);
          const coverUrl = `https://music.generify.ca${album.cover}`;
          const shareUrl = `https://music.generify.ca/?play=${albumId}&track=${trackIndex}`;
          const indexReq = new Request(new URL('/index.html', request.url).toString(), { method: 'GET', headers: request.headers });
          const assetRes = await env.ASSETS.fetch(indexReq);
          let   html     = await assetRes.text();
          const ogTags   = `
    <meta property="og:type"             content="music.song">
    <meta property="og:url"              content="${shareUrl}">
    <meta property="og:title"            content="${title}">
    <meta property="og:description"      content="${desc}">
    <meta property="og:image"            content="${coverUrl}">
    <meta property="og:image:secure_url" content="${coverUrl}">
    <meta property="og:image:width"      content="600">
    <meta property="og:image:height"     content="600">
    <meta property="og:image:alt"        content="${title}">
    <meta property="og:site_name"        content="Generify Music">
    <meta name="twitter:card"            content="summary_large_image">
    <meta name="twitter:title"           content="${title}">
    <meta name="twitter:description"     content="${desc}">
    <meta name="twitter:image"           content="${coverUrl}">`;
          html = html.replace('</head>', ogTags + '\n  </head>');
          return new Response(html, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'X-Robots-Tag': 'noindex'
            }
          });
        }
      } catch (e) { /* fall through to normal asset serving */ }
    }

    // ── Admin gate ──
    // Block /admin and /admin.html entirely
    if (path === "/admin" || path === "/admin.html") {
      return new Response("Not Found", { status: 404 });
    }
    // The panel shell itself carries no data — it's gated by the /api/admin/*
    // routes below (cookie-based), so it no longer requires a key in the URL.

    // ── POST /api/admin/login ── exchange the admin key for an HttpOnly cookie
    if (path === "/api/admin/login" && method === "POST") {
      try {
        const body = await request.json();
        const key  = String(body.key || "");
        if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
          return json({ error: "Unauthorized" }, 401);
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": `${ADMIN_COOKIE}=${encodeURIComponent(key)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_COOKIE_MAX_AGE}`
          }
        });
      } catch (err) {
        return json({ error: err.message }, 400);
      }
    }

    // ── POST /api/admin/logout ── clear the admin cookie ──
    if (path === "/api/admin/logout" && method === "POST") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
        }
      });
    }

    // ── GET /api/admin/check ── does the current request carry a valid admin session? ──
    if (path === "/api/admin/check" && method === "GET") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      return json({ admin: true });
    }

    // ── GET /api/albums ── ETag + short edge cache, so not every visitor
    // triggers a fresh R2 read. Invalidated immediately on any write (see
    // writeAlbums), so admin changes still show up right away.
    if (path === "/api/albums" && method === "GET") {
      const cache = caches.default;
      const cacheKey = new Request(ALBUMS_CACHE_KEY);
      const cached = await cache.match(cacheKey);
      if (cached) {
        const etag = cached.headers.get("ETag");
        const inm  = request.headers.get("If-None-Match");
        if (etag && inm === etag) {
          return new Response(null, { status: 304, headers: { "ETag": etag, "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" } });
        }
        return cached;
      }

      const lenses = await readLenses(env);
      const albums = normalizeAlbums(await readAlbums(env), lenses);
      const bodyText = JSON.stringify(albums);
      const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(bodyText));
      const etag = '"' + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("") + '"';

      const inm = request.headers.get("If-None-Match");
      if (inm === etag) {
        return new Response(null, { status: 304, headers: { "ETag": etag, "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" } });
      }

      const response = new Response(bodyText, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=60",
          "ETag": etag
        }
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // ── GET /api/lenses ── approved Emotional Lenses list
    if (path === "/api/lenses" && method === "GET") {
      const lenses = await readLenses(env);
      return json({ lenses, defaults: DEFAULT_LENSES });
    }

    // ── PUT /api/lenses ── replace approved Emotional Lenses list
    if (path === "/api/lenses" && method === "PUT") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const body = await request.json();
        const merged = uniqueLenses([...(body.lenses || []), ...DEFAULT_LENSES]);
        const lenses = await writeLenses(env, merged);
        return json({ success: true, lenses });
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── PUT /api/track/lens ── update one track's Emotional Lens metadata only
    if (path === "/api/track/lens" && method === "PUT") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const body = await request.json();
        const albumId = Number(body.albumId);
        const trackIndex = Number(body.trackIndex);
        const lenses = await readLenses(env);
        const valid = new Set(lenses.map(l => l.toLowerCase()));
        const primaryLens = cleanLensName(body.primaryLens || "");
        const secondaryLenses = uniqueLenses(body.secondaryLenses || []);

        if (!albumId || Number.isNaN(trackIndex)) return json({ error: "Missing albumId or trackIndex" }, 400);
        if (primaryLens && !valid.has(primaryLens.toLowerCase())) return json({ error: "Primary lens is not in approved list" }, 400);
        const badSecondary = secondaryLenses.find(l => !valid.has(l.toLowerCase()));
        if (badSecondary) return json({ error: `Secondary lens is not approved: ${badSecondary}` }, 400);

        const albums = await readAlbums(env);
        const album = albums.find(a => a.id === albumId);
        if (!album) return json({ error: "Album not found" }, 404);
        if (!album.tracks || !album.tracks[trackIndex]) return json({ error: "Track not found" }, 404);

        album.tracks[trackIndex].primaryLens = primaryLens;
        album.tracks[trackIndex].secondaryLenses = secondaryLenses.filter(l => l.toLowerCase() !== primaryLens.toLowerCase());
        await writeAlbums(env, albums, ctx);
        return json({ success: true, track: album.tracks[trackIndex] });
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── POST /api/upload/album ── add new album
    if (path === "/api/upload/album" && method === "POST") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const form   = await request.formData();
        const title  = form.get("title")?.trim();
        const artist = form.get("artist")?.trim();
        const genre  = cleanLensName(form.get("genre"));
        const cover  = form.get("cover");
        const tracks = form.getAll("tracks");

        if (!title || !artist || !tracks.length) {
          return json({ error: "Missing required fields" }, 400);
        }
        if (!genre) {
          return json({ error: "A Lens is required — please select one before saving." }, 400);
        }
        const lenses = await readLenses(env);
        const validLenses = new Set(lenses.map(l => l.toLowerCase()));
        if (!validLenses.has(genre.toLowerCase())) {
          return json({ error: "Selected Lens is not in the approved list." }, 400);
        }

        let coverKey = null;
        if (cover && cover.size > 0) {
          const coverExt = cover.name.split(".").pop().toLowerCase();
          coverKey = sanitise(`${title}-cover.${coverExt}`);
          await env.COVERS_BUCKET.put(coverKey, await cover.arrayBuffer(), {
            httpMetadata: { contentType: CONTENT_TYPES[coverExt] || "image/jpeg" }
          });
        }

        const genreSlug = sanitise(genre);
        const trackList = [];
        for (const track of tracks) {
          const trackExt   = track.name.split(".").pop().toLowerCase();
          const trackName  = tracks.length === 1 ? title : track.name.replace(/\.[^/.]+$/, "");
          const trackKey   = `${genreSlug}/${sanitise(track.name)}`;
          const trackBytes = await track.arrayBuffer();
          await env.MUSIC_BUCKET.put(trackKey, trackBytes, {
            httpMetadata: { contentType: CONTENT_TYPES[trackExt] || "audio/mpeg" }
          });
          trackList.push({ title: trackName, url: `/music/${trackKey}?v=${Date.now()}`, primaryLens: genre, secondaryLenses: [] });

          // No cover uploaded? Fall back to embedded ID3 artwork (Suno and
          // most AI/streaming exports embed a front-cover image in the file).
          if (!coverKey) {
            const art = extractId3CoverArt(trackBytes);
            if (art) {
              const ext = MIME_TO_EXT[art.mime] || "jpg";
              coverKey = sanitise(`${title}-cover.${ext}`);
              await env.COVERS_BUCKET.put(coverKey, art.data, {
                httpMetadata: { contentType: art.mime }
              });
            }
          }
        }

        if (!coverKey) {
          return json({ error: "No cover provided, and no embedded artwork was found in the uploaded track(s) — please add a cover image." }, 400);
        }

        const albums = await readAlbums(env);
        const newId  = albums.length ? Math.max(...albums.map(a => a.id)) + 1 : 1;
        const album  = { id: newId, title, artist, genre, cover: `/covers/${coverKey}?v=${Date.now()}`, tracks: trackList };
        albums.push(album);
        await writeAlbums(env, albums, ctx);
        return json({ success: true, album });

      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── PUT /api/upload/album/:id ── edit existing album
    if (path.startsWith("/api/upload/album/") && method === "PUT") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const id     = parseInt(path.split("/").pop());
        const form   = await request.formData();
        const title  = form.get("title")?.trim();
        const artist = form.get("artist")?.trim();
        const genre  = cleanLensName(form.get("genre"));
        const cover  = form.get("cover");
        const tracks = form.getAll("tracks");

        if (!title || !artist) {
          return json({ error: "Missing required fields" }, 400);
        }
        if (!genre) {
          return json({ error: "A Lens is required — please select one before saving." }, 400);
        }
        const lenses = await readLenses(env);
        const validLenses = new Set(lenses.map(l => l.toLowerCase()));
        if (!validLenses.has(genre.toLowerCase())) {
          return json({ error: "Selected Lens is not in the approved list." }, 400);
        }

        const albums = await readAlbums(env);
        const idx    = albums.findIndex(a => a.id === id);
        if (idx === -1) return json({ error: "Album not found" }, 404);

        const album = { ...albums[idx], title, artist, genre };

        if (cover && cover.size > 0) {
          const coverExt = cover.name.split(".").pop().toLowerCase();
          const coverKey = sanitise(`${title}-cover.${coverExt}`);
          await env.COVERS_BUCKET.put(coverKey, await cover.arrayBuffer(), {
            httpMetadata: { contentType: CONTENT_TYPES[coverExt] || "image/jpeg" }
          });
          album.cover = `/covers/${coverKey}?v=${Date.now()}`;
        }

        if (tracks.length > 0 && tracks[0].size > 0) {
          const genreSlug = sanitise(genre);
          for (const track of tracks) {
            const trackExt   = track.name.split(".").pop().toLowerCase();
            const trackName  = tracks.length === 1 ? album.title : track.name.replace(/\.[^/.]+$/, "");
            const trackKey   = `${genreSlug}/${sanitise(track.name)}`;
            const trackBytes = await track.arrayBuffer();
            await env.MUSIC_BUCKET.put(trackKey, trackBytes, {
              httpMetadata: { contentType: CONTENT_TYPES[trackExt] || "audio/mpeg" }
            });
            const newUrl = `/music/${trackKey}?v=${Date.now()}`;
            // Same storage path (genre + filename) means this is a revision of an
            // existing track, not a new one — update it in place instead of
            // appending a duplicate entry.
            const existingIdx = album.tracks.findIndex(t => (t.url || "").split("?")[0] === `/music/${trackKey}`);
            if (existingIdx !== -1) {
              album.tracks[existingIdx] = { ...album.tracks[existingIdx], title: trackName, url: newUrl };
            } else {
              album.tracks.push({ title: trackName, url: newUrl, primaryLens: genre, secondaryLenses: [] });
            }

            // No explicit cover in this edit, and the album still doesn't have
            // one — fall back to embedded ID3 artwork on the newly uploaded track.
            if (!(cover && cover.size > 0) && !album.cover) {
              const art = extractId3CoverArt(trackBytes);
              if (art) {
                const ext = MIME_TO_EXT[art.mime] || "jpg";
                const coverKey = sanitise(`${title}-cover.${ext}`);
                await env.COVERS_BUCKET.put(coverKey, art.data, {
                  httpMetadata: { contentType: art.mime }
                });
                album.cover = `/covers/${coverKey}?v=${Date.now()}`;
              }
            }
          }
        }

        albums[idx] = album;
        await writeAlbums(env, albums, ctx);
        return json({ success: true, album });

      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── DELETE /api/remove/album/:id ──
    if (path.startsWith("/api/remove/album/") && method === "DELETE") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      const id       = parseInt(path.split("/").pop());
      const albums   = await readAlbums(env);
      const filtered = albums.filter(a => a.id !== id);
      if (filtered.length === albums.length) return json({ error: "Album not found" }, 404);
      await writeAlbums(env, filtered, ctx);
      return json({ success: true });
    }

    // ── DELETE /api/remove/track/:albumId/:trackIndex ──
    if (path.startsWith("/api/remove/track/") && method === "DELETE") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      const parts      = path.split("/");
      const albumId    = parseInt(parts[4]);
      const trackIndex = parseInt(parts[5]);
      const albums     = await readAlbums(env);
      const idx        = albums.findIndex(a => a.id === albumId);
      if (idx === -1) return json({ error: "Album not found" }, 404);
      if (trackIndex < 0 || trackIndex >= albums[idx].tracks.length) {
        return json({ error: "Track index out of range" }, 400);
      }
      albums[idx].tracks.splice(trackIndex, 1);
      await writeAlbums(env, albums, ctx);
      return json({ success: true });
    }

    // ── GET /covers/* → COVERS_BUCKET ──
    if (path.startsWith("/covers/")) {
      const key = path.slice("/covers/".length);
      const obj = await env.COVERS_BUCKET.get(key);
      if (!obj) return new Response(`Cover not found: ${key}`, { status: 404 });
      return r2Response(obj, path);
    }

    // ── POST /api/lyrics/autosync ── Submit job to AssemblyAI, return jobId immediately
    if (path === "/api/lyrics/autosync" && method === "POST") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      try {
        if (!env.ASSEMBLYAI_KEY) return json({ error: "ASSEMBLYAI_KEY not configured in Worker env" }, 500);

        const body     = await request.json();
        const audioUrl = body.audioUrl;
        const lyrics   = body.lyrics;

        if (!audioUrl || !lyrics) return json({ error: "Missing audioUrl or lyrics" }, 400);

        const reqUrl   = new URL(request.url);
        const absAudio = `${reqUrl.protocol}//${reqUrl.host}${audioUrl}`;
        const lines    = lyrics.split('\n').map(l => l.trim()).filter(Boolean);
        const words    = [...new Set(lyrics.toLowerCase().replace(/[^a-z0-9'\s]/g,'').split(/\s+/).filter(Boolean))];

        const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
          method: 'POST',
          headers: { 'Authorization': env.ASSEMBLYAI_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audio_url:     absAudio,
            speech_models: ['universal-3-5-pro', 'universal-2'],
            word_boost:    words.slice(0, 1000),
            boost_param:   'high',
            punctuate:     false,
            format_text:   false,
            language_code: 'en'
          })
        });

        if (!submitRes.ok) {
          const t = await submitRes.text();
          return json({ error: `AssemblyAI submit failed: ${t}` }, 502);
        }

        const { id: jobId } = await submitRes.json();
        // Return jobId immediately — browser will poll
        return json({ jobId, lines });

      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── GET /api/lyrics/autosync-poll?jobId=xxx ── Poll AssemblyAI status
    if (path === "/api/lyrics/autosync-poll" && method === "GET") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      try {
        if (!env.ASSEMBLYAI_KEY) return json({ error: "ASSEMBLYAI_KEY not configured" }, 500);
        const jobId = url.searchParams.get("jobId");
        if (!jobId) return json({ error: "Missing jobId" }, 400);

        const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${jobId}`, {
          headers: { 'Authorization': env.ASSEMBLYAI_KEY }
        });
        const data = await pollRes.json();

        if (data.status === 'error') return json({ error: `AssemblyAI error: ${data.error}` }, 502);
        if (data.status !== 'completed') return json({ status: data.status });

        // Completed — return words for alignment in browser
        return json({ status: 'completed', words: data.words || [] });

      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── PUT /api/upload/lyrics ── write .lrc file to R2 and update albums.json
    if (path === "/api/upload/lyrics" && method === "PUT") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const body      = await request.json();
        const { albumId, trackIndex, genre, filename, lrcContent } = body;

        if (!albumId || trackIndex === undefined || !genre || !filename || !lrcContent) {
          return json({ error: "Missing required fields" }, 400);
        }

        // Write .lrc file to R2
        const lrcKey = `lyrics/${sanitise(genre)}/${sanitise(filename)}`;
        await env.MUSIC_BUCKET.put(lrcKey, lrcContent, {
          httpMetadata: { contentType: "text/plain; charset=utf-8" }
        });

        // Update albums.json with lrc path
        const albums = await readAlbums(env);
        const album  = albums.find(a => a.id === albumId);
        if (!album) return json({ error: "Album not found" }, 404);
        if (!album.tracks[trackIndex]) return json({ error: "Track not found" }, 404);
        const lrcPath = `/lyrics/${lrcKey.split('/').slice(1).join('/')}`;
        album.tracks[trackIndex].lrc = lrcPath;
        await writeAlbums(env, albums, ctx);

        return json({ success: true, lrcPath });
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── GET /lyrics/* → MUSIC_BUCKET ──
    if (path.startsWith("/lyrics/")) {
      const key = path.slice(1); // keep full path as R2 key e.g. lyrics/introspective/file.lrc
      const obj = await env.MUSIC_BUCKET.get(key);
      if (!obj) return new Response(`Lyrics not found: ${key}`, { status: 404 });
      return new Response(await obj.text(), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // ── GET /music/* → MUSIC_BUCKET (range-aware for audio streaming) ──
    if (path.startsWith("/music/")) {
      const key = path.slice("/music/".length);
      const res = await r2RangeResponse(env.MUSIC_BUCKET, key, request, path);
      if (!res) return new Response(`Track not found: ${key}`, { status: 404 });
      return res;
    }

    // ── Everything else → static assets ──
    return env.ASSETS.fetch(request);
  }
};
