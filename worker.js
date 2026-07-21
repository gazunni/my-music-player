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

async function writeAlbums(env, albums) {
  await env.MUSIC_BUCKET.put("albums.json", JSON.stringify(albums, null, 2), {
    httpMetadata: { contentType: "application/json" }
  });
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

function isAdmin(request, url, env) {
  const headerKey = request.headers.get("X-Admin-Key");
  const queryKey  = url.searchParams.get("key");
  const key       = headerKey || queryKey;
  return Boolean(env.ADMIN_KEY) && key === env.ADMIN_KEY;
}

export default {
  async fetch(request, env) {
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
    // Gate the real admin file
    if (path === "/gx9k-panel.html") {
      const key = url.searchParams.get("key");
      if (key !== env.ADMIN_KEY) {
        // TEMP DIAGNOSTIC — remove after debugging
        const diag = `Not Found\n\n[diag] key received: ${key ? 'yes' : 'no'}` +
                     (key ? ` | length: ${key.length} | expected length: ${env.ADMIN_KEY ? env.ADMIN_KEY.length : '(ADMIN_KEY not set!)'}` : '');
        return new Response(diag, { status: 404 });
      }
    }

    // ── GET /api/albums ──
    if (path === "/api/albums" && method === "GET") {
      const lenses = await readLenses(env);
      const albums = normalizeAlbums(await readAlbums(env), lenses);
      return json(albums);
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
        await writeAlbums(env, albums);
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
        const genre  = form.get("genre")?.trim() || "Other";
        const cover  = form.get("cover");
        const tracks = form.getAll("tracks");

        if (!title || !artist || !cover || !tracks.length) {
          return json({ error: "Missing required fields" }, 400);
        }

        const coverExt = cover.name.split(".").pop().toLowerCase();
        const coverKey = sanitise(`${title}-cover.${coverExt}`);
        await env.COVERS_BUCKET.put(coverKey, await cover.arrayBuffer(), {
          httpMetadata: { contentType: CONTENT_TYPES[coverExt] || "image/jpeg" }
        });

        const genreSlug = sanitise(genre);
        const trackList = [];
        for (const track of tracks) {
          const trackExt  = track.name.split(".").pop().toLowerCase();
          const trackName = tracks.length === 1 ? title : track.name.replace(/\.[^/.]+$/, "");
          const trackKey  = `${genreSlug}/${sanitise(track.name)}`;
          await env.MUSIC_BUCKET.put(trackKey, await track.arrayBuffer(), {
            httpMetadata: { contentType: CONTENT_TYPES[trackExt] || "audio/mpeg" }
          });
          trackList.push({ title: trackName, url: `/music/${trackKey}`, primaryLens: "", secondaryLenses: [] });
        }

        const albums = await readAlbums(env);
        const newId  = albums.length ? Math.max(...albums.map(a => a.id)) + 1 : 1;
        const album  = { id: newId, title, artist, genre, cover: `/covers/${coverKey}`, tracks: trackList };
        albums.push(album);
        await writeAlbums(env, albums);
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
        const genre  = form.get("genre")?.trim() || "Other";
        const cover  = form.get("cover");
        const tracks = form.getAll("tracks");

        if (!title || !artist) {
          return json({ error: "Missing required fields" }, 400);
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
          album.cover = `/covers/${coverKey}`;
        }

        if (tracks.length > 0 && tracks[0].size > 0) {
          const genreSlug = sanitise(genre);
          for (const track of tracks) {
            const trackExt  = track.name.split(".").pop().toLowerCase();
            const trackName = tracks.length === 1 ? album.title : track.name.replace(/\.[^/.]+$/, "");
            const trackKey  = `${genreSlug}/${sanitise(track.name)}`;
            await env.MUSIC_BUCKET.put(trackKey, await track.arrayBuffer(), {
              httpMetadata: { contentType: CONTENT_TYPES[trackExt] || "audio/mpeg" }
            });
            album.tracks.push({ title: trackName, url: `/music/${trackKey}`, primaryLens: "", secondaryLenses: [] });
          }
        }

        albums[idx] = album;
        await writeAlbums(env, albums);
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
      await writeAlbums(env, filtered);
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
      await writeAlbums(env, albums);
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
        await writeAlbums(env, albums);

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
