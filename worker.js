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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

// Read albums.json from MUSIC_BUCKET; return [] if missing
async function readAlbums(env) {
  const obj = await env.MUSIC_BUCKET.get("albums.json");
  if (!obj) return [];
  const text = await obj.text();
  try { return JSON.parse(text); } catch { return []; }
}

// Write albums array back to MUSIC_BUCKET
async function writeAlbums(env, albums) {
  await env.MUSIC_BUCKET.put("albums.json", JSON.stringify(albums, null, 2), {
    httpMetadata: { contentType: "application/json" }
  });
}

// Sanitise a filename: lowercase, spaces→hyphens, keep alphanumeric/hyphens/dots
function sanitise(name) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-_.]/g, "");
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // ── GET /api/albums ── serve from MUSIC_BUCKET
    if (path === "/api/albums" && method === "GET") {
      const albums = await readAlbums(env);
      return json(albums);
    }

    // ── POST /api/admin/album ── upload new album
    if (path === "/api/upload/album" && method === "POST") {
      try {
        const form = await request.formData();

        const title  = form.get("title")?.trim();
        const artist = form.get("artist")?.trim();
        const genre  = form.get("genre")?.trim() || "Other";
        const cover  = form.get("cover");   // File
        const tracks = form.getAll("tracks"); // File[]

        if (!title || !artist || !cover || !tracks.length) {
          return json({ error: "Missing required fields: title, artist, cover, tracks" }, 400);
        }

        // Upload cover → COVERS_BUCKET
        const coverExt  = cover.name.split(".").pop().toLowerCase();
        const coverKey  = sanitise(`${title}-cover.${coverExt}`);
        const coverBuf  = await cover.arrayBuffer();
        await env.COVERS_BUCKET.put(coverKey, coverBuf, {
          httpMetadata: { contentType: CONTENT_TYPES[coverExt] || "image/jpeg" }
        });

        // Upload tracks → MUSIC_BUCKET under genre subfolder
        const genreSlug = sanitise(genre);
        const trackList = [];

        for (const track of tracks) {
          const trackExt  = track.name.split(".").pop().toLowerCase();
          // Use original filename (sanitised) as track title
          const trackName = track.name.replace(/\.[^/.]+$/, ""); // strip extension
          const trackKey  = `${genreSlug}/${sanitise(track.name)}`;
          const trackBuf  = await track.arrayBuffer();
          await env.MUSIC_BUCKET.put(trackKey, trackBuf, {
            httpMetadata: { contentType: CONTENT_TYPES[trackExt] || "audio/mpeg" }
          });
          trackList.push({
            title: trackName,
            url:   `/music/${trackKey}`
          });
        }

        // Append to albums.json in MUSIC_BUCKET
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

    // ── DELETE /api/admin/album/:id ── remove album
    if (path.startsWith("/api/remove/album/") && method === "DELETE") {
      const id = parseInt(path.split("/").pop());
      const albums = await readAlbums(env);
      const filtered = albums.filter(a => a.id !== id);
      if (filtered.length === albums.length) return json({ error: "Album not found" }, 404);
      await writeAlbums(env, filtered);
      return json({ success: true });
    }

    // ── GET /covers/* → COVERS_BUCKET ──
    if (path.startsWith("/covers/")) {
      const key = path.slice("/covers/".length);
      const obj = await env.COVERS_BUCKET.get(key);
      if (!obj) return new Response(`Cover not found: ${key}`, { status: 404 });
      return r2Response(obj, path);
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
