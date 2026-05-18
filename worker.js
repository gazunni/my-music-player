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

    // ── GET /api/albums ──
    if (path === "/api/albums" && method === "GET") {
      const albums = await readAlbums(env);
      return json(albums);
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
          const trackName = track.name.replace(/\.[^/.]+$/, "");
          const trackKey  = `${genreSlug}/${sanitise(track.name)}`;
          await env.MUSIC_BUCKET.put(trackKey, await track.arrayBuffer(), {
            httpMetadata: { contentType: CONTENT_TYPES[trackExt] || "audio/mpeg" }
          });
          trackList.push({ title: trackName, url: `/music/${trackKey}` });
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
            const trackName = track.name.replace(/\.[^/.]+$/, "");
            const trackKey  = `${genreSlug}/${sanitise(track.name)}`;
            await env.MUSIC_BUCKET.put(trackKey, await track.arrayBuffer(), {
              httpMetadata: { contentType: CONTENT_TYPES[trackExt] || "audio/mpeg" }
            });
            album.tracks.push({ title: trackName, url: `/music/${trackKey}` });
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
        album.tracks[trackIndex].lrc = `/lyrics/${lrcKey.split('/').slice(1).join('/')}`;
        await writeAlbums(env, albums);

        return json({ success: true, lrcPath: `/lyrics/${lrcKey}` });
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
