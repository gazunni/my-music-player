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

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // ── Admin gate ──
    // Block /admin and /admin.html entirely
    if (path === "/admin" || path === "/admin.html") {
      return new Response("Not Found", { status: 404 });
    }
    // Gate the real admin file
    if (path === "/gx9k-panel.html") {
      const key = url.searchParams.get("key");
      if (key !== env.ADMIN_KEY) {
        return new Response("Not Found", { status: 404 });
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
            const trackName = newTracks.length === 1 ? album.title : track.name.replace(/\.[^/.]+$/, "");
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
      const id       = parseInt(path.split("/").pop());
      const albums   = await readAlbums(env);
      const filtered = albums.filter(a => a.id !== id);
      if (filtered.length === albums.length) return json({ error: "Album not found" }, 404);
      await writeAlbums(env, filtered);
      return json({ success: true });
    }

    // ── DELETE /api/remove/track/:albumId/:trackIndex ──
    if (path.startsWith("/api/remove/track/") && method === "DELETE") {
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

    // ── POST /api/lyrics/autosync ── AssemblyAI forced alignment
    // Accepts: { audioUrl, lyrics }  (audioUrl is the public /music/... path)
    // Returns: { lrc } on success, or { error } on failure
    if (path === "/api/lyrics/autosync" && method === "POST") {
      try {
        if (!env.ASSEMBLYAI_KEY) return json({ error: "ASSEMBLYAI_KEY not configured in Worker env" }, 500);

        const body      = await request.json();
        const audioUrl  = body.audioUrl;   // e.g. "/music/funny/my-song.mp3"
        const lyrics    = body.lyrics;     // plain text, one line per line

        if (!audioUrl || !lyrics) return json({ error: "Missing audioUrl or lyrics" }, 400);

        // Build absolute audio URL — AssemblyAI needs a public URL
        const reqUrl    = new URL(request.url);
        const absAudio  = `${reqUrl.protocol}//${reqUrl.host}${audioUrl}`;

        // ── Step 1: Submit transcription job with word_boost + custom_spelling ──
        // We pass the lyrics as `word_boost` so the model biases toward our known words.
        // Setting `language_code` and `speech_model` optimises for music.
        const lines     = lyrics.split('\n').map(l => l.trim()).filter(Boolean);
        const words     = [...new Set(lyrics.toLowerCase().replace(/[^a-z0-9'\s]/g,'').split(/\s+/).filter(Boolean))];

        const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
          method: 'POST',
          headers: { 'Authorization': env.ASSEMBLYAI_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audio_url:      absAudio,
            speech_models:  ["universal-3-pro", "universal-2"],
            word_boost:     words.slice(0, 1000),  // max 1000 words
            boost_param:    'high',
            punctuate:      false,
            format_text:    false,
            language_code:  'en'
          })
        });

        if (!submitRes.ok) {
          const t = await submitRes.text();
          return json({ error: `AssemblyAI submit failed: ${t}` }, 502);
        }

        const { id: jobId } = await submitRes.json();

        // ── Step 2: Poll until complete (max ~90s with 3s intervals) ──
        let transcript = null;
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise(r => setTimeout(r, 3000));
          const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${jobId}`, {
            headers: { 'Authorization': env.ASSEMBLYAI_KEY }
          });
          const data = await pollRes.json();
          if (data.status === 'completed') { transcript = data; break; }
          if (data.status === 'error')     return json({ error: `AssemblyAI error: ${data.error}` }, 502);
          // status === 'processing' or 'queued' — keep polling
        }

        if (!transcript) return json({ error: 'AssemblyAI timed out after 90s — try again' }, 504);

        // ── Step 3: Forced alignment — match each lyric line to word timestamps ──
        // words[] from AssemblyAI: { text, start, end, confidence } (start/end in ms)
        const aaiWords = transcript.words || [];

        if (!aaiWords.length) return json({ error: 'No words detected in audio — check audio has vocals' }, 422);

        // Flatten the lyric lines into word tokens with line membership
        const lineTokens = lines.map(line => ({
          line,
          tokens: line.toLowerCase().replace(/[^a-z0-9'\s]/g,'').split(/\s+/).filter(Boolean)
        }));

        // For each lyric line, find the best matching window of AAI words
        // using a greedy sliding-window token match
        const lrcLines  = [];
        let searchFrom  = 0;

        for (const { line, tokens } of lineTokens) {
          if (!tokens.length) { lrcLines.push({ line, timeMs: null }); continue; }

          let bestScore = -1, bestPos = searchFrom;

          // Scan forward from searchFrom, try each starting position
          const limit = Math.min(aaiWords.length - tokens.length + 1, searchFrom + 80);
          for (let i = searchFrom; i < limit; i++) {
            let score = 0;
            for (let j = 0; j < tokens.length && (i + j) < aaiWords.length; j++) {
              const aw = aaiWords[i + j].text.toLowerCase().replace(/[^a-z0-9']/g,'');
              const lw = tokens[j];
              if (aw === lw) score += 2;
              else if (aw.startsWith(lw) || lw.startsWith(aw)) score += 1;
            }
            if (score > bestScore) { bestScore = score; bestPos = i; }
          }

          const timeMs = aaiWords[bestPos]?.start ?? null;
          lrcLines.push({ line, timeMs });
          // Advance search position past matched tokens (allow overlap for slurred words)
          searchFrom = Math.max(searchFrom, bestPos + Math.max(1, tokens.length - 2));
        }

        // ── Step 4: Format as LRC ──
        const lrc = lrcLines.map(({ line, timeMs }) => {
          const t     = timeMs != null ? timeMs / 1000 : 0;
          const mins  = Math.floor(t / 60).toString().padStart(2, '0');
          const secs  = Math.floor(t % 60).toString().padStart(2, '0');
          const cents = Math.round((t % 1) * 100).toString().padStart(2, '0');
          return `[${mins}:${secs}.${cents}] ${line}`;
        }).join('\n');

        return json({ lrc, wordCount: aaiWords.length, lineCount: lrcLines.length });

      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── PUT /api/upload/lyrics ── write .lrc file to R2 and update albums.json
    if (path === "/api/upload/lyrics" && method === "PUT") {
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

    // ── GET /music/* → MUSIC_BUCKET ──
    if (path.startsWith("/music/")) {
      const key = path.slice("/music/".length);
      const obj = await env.MUSIC_BUCKET.get(key);
      if (!obj) return new Response(`Track not found: ${key}`, { status: 404 });
      return r2Response(obj, path);
    }

    // ── Everything else → static assets ──
    return env.ASSETS.fetch(request);
  }
};
