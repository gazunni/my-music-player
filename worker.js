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
  } catch {
    return null; // malformed/unsupported tag — just skip auto-cover
  }
}


// ── M4A/MP4 embedded metadata extraction ─────────────────────
// M4A uses a completely different container (MP4/QuickTime "atoms/boxes"),
// not ID3v2 — so it needs its own reader. Metadata lives nested under
// moov > udta > meta > ilst, with children like "©nam" (title), "©ART"
// (artist), and "covr" (cover art), each wrapping a nested "data" box.
function m4aReadU32(bytes, offset) {
  // Avoids 32-bit signed overflow from bitwise ops on values >= 0x80000000
  return (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function m4aFindBoxes(bytes, start, end) {
  const boxes = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = m4aReadU32(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      size = m4aReadU32(bytes, pos + 8) * 0x100000000 + m4aReadU32(bytes, pos + 12);
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < headerSize || pos + size > end) break;
    boxes.push({ type, start: pos, end: pos + size, dataStart: pos + headerSize });
    pos += size;
  }
  return boxes;
}

function m4aFindBox(boxes, type) {
  return boxes.find(b => b.type === type);
}

function m4aReadDataPayload(bytes, parentBox) {
  const children = m4aFindBoxes(bytes, parentBox.dataStart, parentBox.end);
  const dataBox = m4aFindBox(children, "data");
  if (!dataBox || dataBox.dataStart + 8 > dataBox.end) return null;
  const typeIndicator = m4aReadU32(bytes, dataBox.dataStart); // 1=UTF-8 text, 13=JPEG, 14=PNG (for covr)
  const payload = bytes.slice(dataBox.dataStart + 8, dataBox.end);
  return { typeIndicator, payload };
}

function extractM4ATags(arrayBuffer) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    const top = m4aFindBoxes(bytes, 0, bytes.length);
    const moov = m4aFindBox(top, "moov");
    if (!moov) return null;
    const udta = m4aFindBox(m4aFindBoxes(bytes, moov.dataStart, moov.end), "udta");
    if (!udta) return null;
    const meta = m4aFindBox(m4aFindBoxes(bytes, udta.dataStart, udta.end), "meta");
    if (!meta) return null;
    // "meta" is a full box — 4 bytes of version/flags before its own children
    const ilst = m4aFindBox(m4aFindBoxes(bytes, meta.dataStart + 4, meta.end), "ilst");
    if (!ilst) return null;
    const ilstChildren = m4aFindBoxes(bytes, ilst.dataStart, ilst.end);

    const result = {};
    const titleBox  = m4aFindBox(ilstChildren, "\u00a9nam");
    const artistBox = m4aFindBox(ilstChildren, "\u00a9ART");
    const coverBox  = m4aFindBox(ilstChildren, "covr");

    if (titleBox) {
      const d = m4aReadDataPayload(bytes, titleBox);
      if (d && d.payload.length) result.title = new TextDecoder("utf-8").decode(d.payload).replace(/\u0000+$/, "").trim();
    }
    if (artistBox) {
      const d = m4aReadDataPayload(bytes, artistBox);
      if (d && d.payload.length) result.artist = new TextDecoder("utf-8").decode(d.payload).replace(/\u0000+$/, "").trim();
    }
    if (coverBox) {
      const d = m4aReadDataPayload(bytes, coverBox);
      if (d && d.payload.length) {
        const mime = d.typeIndicator === 14 ? "image/png" : "image/jpeg"; // 13=JPEG, 14=PNG
        result.cover = { mime, data: d.payload };
      }
    }
    return result;
  } catch {
    return null; // malformed/unsupported atoms — just skip
  }
}

// Tries ID3 (MP3) first, falls back to M4A atoms — used wherever we need
// "whatever embedded cover art this track has, regardless of format."
function extractEmbeddedCoverArt(arrayBuffer) {
  const id3Art = extractId3CoverArt(arrayBuffer);
  if (id3Art) return id3Art;
  const m4aTags = extractM4ATags(arrayBuffer);
  return (m4aTags && m4aTags.cover) ? m4aTags.cover : null;
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

  // Parse "bytes=START-END", "bytes=START-", or the suffix form "bytes=-N"
  // (the last N bytes). iOS's media pipeline specifically uses the suffix
  // form to fetch the tail of an MP4/M4A container looking for its "moov"
  // metadata atom when it isn't at the front of the file — the previous
  // parsing here didn't distinguish that case from a normal "start-end"
  // range, so bytes=-N was silently served as bytes=0-N (the head of the
  // file) instead of the actual last N bytes. iOS would then fail to find
  // valid MP4 structure there and refuse to play the file — MP3 has no
  // equivalent metadata-atom lookup, so it was never affected.
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

  let start, end;
  if (match[1] === "" && match[2] !== "") {
    // Suffix range: bytes=-N → the last N bytes of the file
    const suffixLength = parseInt(match[2], 10);
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    start = match[1] ? parseInt(match[1], 10) : 0;
    end   = match[2] ? parseInt(match[2], 10) : totalSize - 1;
  }
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

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      ...extraHeaders
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

// ── Subscriber email encryption ──
// Addresses are stored AES-256-GCM encrypted (key: env.EMAIL_ENCRYPTION_KEY,
// a Cloudflare Secret, never in plain config) so casually browsing the D1
// console shows ciphertext, not a plain address. The address is only ever
// decrypted briefly, in memory, at the moment a notification is sent — this
// is real protection against casual exposure, not a claim that no one
// operating the system can ever see it; actually delivering email requires
// knowing the real address at send time.
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function getEmailAesKey(env) {
  return crypto.subtle.importKey("raw", hexToBytes(env.EMAIL_ENCRYPTION_KEY), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptEmail(email, env) {
  const key = await getEmailAesKey(env);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(email));
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}
async function decryptEmail(stored, env) {
  const [ivHex, ctHex] = stored.split(":");
  const key = await getEmailAesKey(env);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(ivHex) }, key, hexToBytes(ctHex));
  return new TextDecoder().decode(plaintext);
}
// One-way (HMAC-SHA256) — used only to detect "has this email already
// subscribed" without ever storing or needing the plain address for that
// check. Same key as encryption; this direction can't be reversed.
async function hashEmail(email, env) {
  const key = await crypto.subtle.importKey("raw", hexToBytes(env.EMAIL_ENCRYPTION_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.trim().toLowerCase()));
  return bytesToHex(new Uint8Array(signature));
}

// ── New-album email notifications ──
// TODO: replace with your verified Resend sending address before this part
// goes live (e.g. "music@generify.ca") — everything else in this feature
// (signup, storage, unsubscribe) works independently of this constant.
const NOTIFY_FROM_ADDRESS = "music@mail.generify.ca";

// Shared send — one Resend API call, one recipient. Never throws; a failed
// send should never take down whatever caller triggered it.
async function sendResendEmail(to, subject, html, env) {
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from: NOTIFY_FROM_ADDRESS, to, subject, html })
    });
  } catch { /* best-effort — caller continues regardless */ }
}

function unsubscribeFooterHtml(unsubscribeToken) {
  const unsubscribeUrl = `https://music.generify.ca/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  return `
    <p style="margin-top:32px;font-size:12px;color:#888;">
      You're receiving this because you subscribed for new-release alerts on Generify Music.
      <a href="${unsubscribeUrl}" style="color:#888;">Unsubscribe</a>
    </p>`;
}

// Sent immediately at signup — not just a courtesy, but the only way a new
// subscriber has an unsubscribe link in hand before the first real
// new-release notification, which could be a long wait away.
async function sendWelcomeEmail(email, unsubscribeToken, env) {
  if (!env.RESEND_API_KEY) return; // not configured yet — skip quietly
  const html = `
    <div style="font-family:-apple-system,sans-serif;background:#0a0a0a;color:#f0f0f0;padding:24px;">
      <h2 style="color:#e8000f;">You're subscribed to Generify Music</h2>
      <p>We'll email you whenever a new song goes up — nothing else. Your email is never used or sold for anything beyond that.</p>
      <p>Didn't sign up for this? You can remove yourself below, no questions asked.</p>
      ${unsubscribeFooterHtml(unsubscribeToken)}
    </div>`;
  await sendResendEmail(email, "You're subscribed to Generify Music", html, env);
}

async function notifySubscribersOfNewAlbum(album, env) {
  if (!env.RESEND_API_KEY || !env.EMAIL_ENCRYPTION_KEY) return; // not configured yet — skip quietly
  try {
    const subs = await env.STATS_DB.prepare(
      "SELECT email_encrypted, unsubscribe_token FROM subscribers"
    ).all();
    for (const row of (subs.results || [])) {
      let email;
      try { email = await decryptEmail(row.email_encrypted, env); } catch { continue; } // skip a row that fails to decrypt rather than aborting everyone else
      const html = `
        <div style="font-family:-apple-system,sans-serif;background:#0a0a0a;color:#f0f0f0;padding:24px;">
          <h2 style="color:#e8000f;">New on Generify Music</h2>
          <p><strong>${escapeHtml(album.title)}</strong> by ${escapeHtml(album.artist)} just went up.</p>
          <p><a href="https://music.generify.ca/?play=${album.id}&track=0" style="color:#e8000f;">Listen now →</a></p>
          ${unsubscribeFooterHtml(row.unsubscribe_token)}
        </div>`;
      await sendResendEmail(email, `New on Generify Music: ${album.title}`, html, env);
    }
  } catch { /* subscriber notifications are best-effort — never break the upload over this */ }
}

// Swaps the live NEW_PULSE_COUNT value (from the Cloudflare env var of the
// same name, set in the dashboard under Settings → Variables) into index.html
// as it's served. If the env var is unset, non-numeric, or outside a sane
// range, the file's own baked-in default is left untouched — this never
// throws and never blocks serving the page.
function injectNewPulseCount(html, env) {
  const count = parseInt(env.NEW_PULSE_COUNT, 10);
  if (!Number.isFinite(count) || count < 1 || count > 50) return html;
  return html.replace(/const NEW_PULSE_COUNT = \d+;/, `const NEW_PULSE_COUNT = ${count};`);
}

const ADMIN_COOKIE = "gm_admin";
const ADMIN_COOKIE_MAX_AGE = 8 * 60 * 60; // 8 hours

// Anonymous visitor cookie — used only to count unique visitors and stop a
// single visitor from stacking repeated votes on the same track. Holds a
// random ID, no personal information. HttpOnly since the front-end never
// needs to read its value directly; the browser sends it automatically.
const VISITOR_COOKIE = "gm_visitor";
const VISITOR_COOKIE_MAX_AGE = 2 * 365 * 24 * 60 * 60; // 2 years

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Returns { id, isNew } — the visitor's existing ID from their cookie, or a
// freshly generated one if they don't have one yet. Callers that need to
// set the cookie on a new visitor should add the returned Set-Cookie header
// (see setVisitorCookieHeader below) to their response.
function getOrCreateVisitorId(request) {
  const existing = getCookie(request, VISITOR_COOKIE);
  if (existing) return { id: existing, isNew: false };
  return { id: crypto.randomUUID(), isNew: true };
}

function setVisitorCookieHeader(id) {
  return `${VISITOR_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${VISITOR_COOKIE_MAX_AGE}`;
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
          const desc     = escapeHtml(`Listen on Generify Music`);
          // Falls back to the site's own logo only when this track genuinely
          // has no cover stored (album.cover is unset) — not a stand-in for
          // every song. Previously an unset cover produced a broken image
          // URL, which is why messaging apps were showing their own generic
          // fallback instead of anything we actually intended.
          const coverUrl = album.cover
            ? `https://music.generify.ca${album.cover}`
            : `https://music.generify.ca/covers/wolf-logo.png`;
          const shareUrl = `https://music.generify.ca/?play=${albumId}&track=${trackIndex}`;
          const indexReq = new Request(new URL('/index.html', request.url).toString(), { method: 'GET', headers: request.headers });
          const assetRes = await env.ASSETS.fetch(indexReq);
          let   html     = await assetRes.text();
          const ogTags   = `
    <meta property="og:type"             content="website">
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
          html = injectNewPulseCount(html, env);
          return new Response(html, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'X-Robots-Tag': 'noindex'
            }
          });
        }
      } catch { /* fall through to normal asset serving */ }
    }

    // ── Serve index.html with the live NEW_PULSE_COUNT swapped in ──
    // (the share-link branch above already handles this when ?play= is set
    // and resolves to a real album; this covers every other page load.)
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      const indexReq = new Request(new URL('/index.html', request.url).toString(), { method: 'GET', headers: request.headers });
      const assetRes = await env.ASSETS.fetch(indexReq);
      if (assetRes.ok) {
        const html = injectNewPulseCount(await assetRes.text(), env);
        const headers = new Headers(assetRes.headers);
        return new Response(html, { status: assetRes.status, headers });
      }
      return assetRes;
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
          return new Response(null, { status: 304, headers: { "ETag": etag, "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" } });
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
        return new Response(null, { status: 304, headers: { "ETag": etag, "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" } });
      }

      const response = new Response(bodyText, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
          "ETag": etag
        }
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // ── POST /api/stats/visit ── log one page visit for the stats panel.
    // Fire-and-forget from the front-end on page load. Country/region/city
    // come straight from Cloudflare's own edge metadata (request.cf) — no
    // IP address is ever read, stored, or needed.
    if (path === "/api/stats/visit" && method === "POST") {
      const { id: visitorId, isNew } = getOrCreateVisitorId(request);
      const cf = request.cf || {};
      const today = new Date().toISOString().slice(0, 10);
      try {
        await env.STATS_DB.prepare(
          "INSERT INTO visits (visitor_id, country, region, city, visit_date) VALUES (?, ?, ?, ?, ?)"
        ).bind(visitorId, cf.country || null, cf.region || null, cf.city || null, today).run();
      } catch { /* stats are best-effort — never break the page over this */ }

      const headers = { "Access-Control-Allow-Origin": "*" };
      if (isNew) headers["Set-Cookie"] = setVisitorCookieHeader(visitorId);
      return json({ ok: true }, 200, headers);
    }

    // ── POST /api/stats/play ── increment a track's play count.
    // Body: { albumId }. Fired once when playback actually starts, not on
    // every seek/resume.
    if (path === "/api/stats/play" && method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const albumId = parseInt(body.albumId, 10);
      if (!Number.isFinite(albumId)) return json({ error: "albumId required" }, 400);
      try {
        await env.STATS_DB.prepare(
          "INSERT INTO track_stats (album_id, plays) VALUES (?, 1) ON CONFLICT(album_id) DO UPDATE SET plays = plays + 1"
        ).bind(albumId).run();
      } catch { /* best-effort */ }
      return json({ ok: true }, 200, { "Access-Control-Allow-Origin": "*" });
    }

    // ── POST /api/stats/vote ── thumbs up/down, one per visitor per track.
    // Body: { albumId, vote } where vote is 1 (up), -1 (down), or 0 (remove
    // my existing vote — e.g. tapping the same thumb again).
    if (path === "/api/stats/vote" && method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const albumId = parseInt(body.albumId, 10);
      const newVote = parseInt(body.vote, 10);
      if (!Number.isFinite(albumId) || ![1, -1, 0].includes(newVote)) {
        return json({ error: "albumId and vote (1, -1, or 0) required" }, 400);
      }
      const { id: visitorId, isNew } = getOrCreateVisitorId(request);

      try {
        const existingRow = await env.STATS_DB.prepare(
          "SELECT vote FROM track_votes WHERE album_id = ? AND visitor_id = ?"
        ).bind(albumId, visitorId).first();
        const oldVote = existingRow ? existingRow.vote : 0;

        if (oldVote !== newVote) {
          // Make sure a track_stats row exists before adjusting it — a
          // track can be voted on before it's ever been played.
          await env.STATS_DB.prepare(
            "INSERT INTO track_stats (album_id) VALUES (?) ON CONFLICT(album_id) DO NOTHING"
          ).bind(albumId).run();

          if (newVote === 0) {
            await env.STATS_DB.prepare(
              "DELETE FROM track_votes WHERE album_id = ? AND visitor_id = ?"
            ).bind(albumId, visitorId).run();
          } else {
            await env.STATS_DB.prepare(
              "INSERT INTO track_votes (album_id, visitor_id, vote) VALUES (?, ?, ?) " +
              "ON CONFLICT(album_id, visitor_id) DO UPDATE SET vote = ?, voted_at = datetime('now')"
            ).bind(albumId, visitorId, newVote, newVote).run();
          }

          const upDelta   = (newVote === 1 ? 1 : 0) - (oldVote === 1 ? 1 : 0);
          const downDelta = (newVote === -1 ? 1 : 0) - (oldVote === -1 ? 1 : 0);
          await env.STATS_DB.prepare(
            "UPDATE track_stats SET thumbs_up = thumbs_up + ?, thumbs_down = thumbs_down + ? WHERE album_id = ?"
          ).bind(upDelta, downDelta, albumId).run();
        }

        const row = await env.STATS_DB.prepare(
          "SELECT thumbs_up, thumbs_down FROM track_stats WHERE album_id = ?"
        ).bind(albumId).first();

        const headers = { "Access-Control-Allow-Origin": "*" };
        if (isNew) headers["Set-Cookie"] = setVisitorCookieHeader(visitorId);
        return json({
          ok: true,
          vote: newVote,
          thumbsUp: row ? row.thumbs_up : 0,
          thumbsDown: row ? row.thumbs_down : 0
        }, 200, headers);
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── GET /api/admin/stats ── everything the admin Statistics panel shows.
    if (path === "/api/admin/stats" && method === "GET") {
      if (!isAdmin(request, url, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const [tracksResult, todayResult, weekResult, monthResult, allTimeResult, countryResult] = await Promise.all([
          env.STATS_DB.prepare("SELECT album_id, plays, thumbs_up, thumbs_down FROM track_stats").all(),
          env.STATS_DB.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT visitor_id) AS unique_visitors FROM visits WHERE visit_date = date('now')").first(),
          env.STATS_DB.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT visitor_id) AS unique_visitors FROM visits WHERE visit_date >= date('now', '-6 days')").first(),
          env.STATS_DB.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT visitor_id) AS unique_visitors FROM visits WHERE visit_date >= date('now', '-29 days')").first(),
          env.STATS_DB.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT visitor_id) AS unique_visitors FROM visits").first(),
          env.STATS_DB.prepare("SELECT country, COUNT(DISTINCT visitor_id) AS unique_visitors, COUNT(*) AS total_visits FROM visits GROUP BY country ORDER BY unique_visitors DESC").all()
        ]);

        // Merge in each track's title/artist from albums.json — D1 only
        // knows album IDs and numbers, not song names.
        const albums = await readAlbums(env);
        const albumsById = new Map(albums.map(a => [a.id, a]));
        const tracks = (tracksResult.results || []).map(row => {
          const album = albumsById.get(row.album_id);
          return {
            albumId: row.album_id,
            title: album ? album.title : "(deleted track)",
            artist: album ? album.artist : "",
            plays: row.plays,
            thumbsUp: row.thumbs_up,
            thumbsDown: row.thumbs_down
          };
        }).sort((a, b) => b.plays - a.plays);

        return json({
          tracks,
          visits: {
            today:   { total: todayResult.total,   uniqueVisitors: todayResult.unique_visitors },
            week:    { total: weekResult.total,    uniqueVisitors: weekResult.unique_visitors },
            month:   { total: monthResult.total,   uniqueVisitors: monthResult.unique_visitors },
            allTime: { total: allTimeResult.total, uniqueVisitors: allTimeResult.unique_visitors }
          },
          byCountry: (countryResult.results || []).map(row => ({
            country: row.country || "Unknown",
            uniqueVisitors: row.unique_visitors,
            totalVisits: row.total_visits
          }))
        });
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── POST /api/subscribe ── join the new-release email list
    if (path === "/api/subscribe" && method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "Please enter a valid email address." }, 400);
      }
      if (!env.EMAIL_ENCRYPTION_KEY) {
        return json({ error: "Subscriptions aren't set up yet — please try again later." }, 500);
      }
      try {
        const emailHash = await hashEmail(email, env);
        const existing = await env.STATS_DB.prepare(
          "SELECT id FROM subscribers WHERE email_hash = ?"
        ).bind(emailHash).first();
        if (existing) return json({ ok: true, alreadySubscribed: true });

        const encrypted = await encryptEmail(email, env);
        const token = crypto.randomUUID();
        await env.STATS_DB.prepare(
          "INSERT INTO subscribers (email_encrypted, email_hash, unsubscribe_token) VALUES (?, ?, ?)"
        ).bind(encrypted, emailHash, token).run();

        // Send the welcome email in the background — the person shouldn't
        // wait on it to see "you're subscribed" in the modal, but they
        // need their unsubscribe link in hand from the very start, not
        // only once the first real new-release notification goes out.
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(sendWelcomeEmail(email, token, env));
        }

        return json({ ok: true, alreadySubscribed: false });
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── GET /unsubscribe?token=... ── remove a subscriber outright (not
    // just marked inactive — the row is deleted entirely).
    if (path === "/unsubscribe" && method === "GET") {
      const token = url.searchParams.get("token");
      let message = "That unsubscribe link looks invalid or has already been used.";
      if (token) {
        try {
          const result = await env.STATS_DB.prepare(
            "DELETE FROM subscribers WHERE unsubscribe_token = ?"
          ).bind(token).run();
          if (result.meta && result.meta.changes > 0) {
            message = "You've been unsubscribed — you won't receive any more new-release emails from Generify Music.";
          }
        } catch { /* fall through to the generic message below */ }
      }
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribed — Generify Music</title>
<style>
  body { background:#0a0a0a; color:#f0f0f0; font-family:-apple-system,system-ui,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; text-align:center; padding:24px; }
  .card { max-width:440px; }
  h1 { font-family:'Bebas Neue',Arial,sans-serif; letter-spacing:0.08em; color:#e8000f; font-size:1.8rem; margin-bottom:16px; }
  a { color:#e8000f; }
</style></head>
<body><div class="card"><h1>Generify Music</h1><p>${escapeHtml(message)}</p><p><a href="https://music.generify.ca/">Return to the site</a></p></div></body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
            const art = extractEmbeddedCoverArt(trackBytes);
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

        // Notify subscribers in the background — runs after the response
        // goes back to the admin panel, so a new upload doesn't sit waiting
        // on however many emails there are to send.
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(notifySubscribersOfNewAlbum(album, env));
        }

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

        // Keep the track's own stored title in sync with the album title.
        // This app's standard model is one track per album, but the track's
        // title was previously only re-synced when a new track FILE was also
        // uploaded in the same edit — a plain text correction to just the
        // Album Title field left the track's own stored title silently
        // stale/mismatched, which is exactly what surfaced as a title
        // appearing "truncated" on the main site (it wasn't a display bug —
        // the track's stored title genuinely differed from the album's).
        if (album.tracks && album.tracks.length === 1) {
          album.tracks[0] = { ...album.tracks[0], title };
        }

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
          // This app's standard model is one track per album (confirmed — no
          // multi-song "album" concept). When that's the case, a newly
          // uploaded track always replaces the existing one's audio by
          // position, regardless of filename or format — covers "swap this
          // MP3 for an M4A/remix" cleanly. Multi-track albums (legacy/rare)
          // keep the old filename-match-or-append behavior for safety.
          const singleTrackReplace = album.tracks.length === 1 && tracks.length === 1;

          for (const track of tracks) {
            const trackExt   = track.name.split(".").pop().toLowerCase();
            const trackName  = tracks.length === 1 ? album.title : track.name.replace(/\.[^/.]+$/, "");
            const trackKey   = `${genreSlug}/${sanitise(track.name)}`;
            const trackBytes = await track.arrayBuffer();
            await env.MUSIC_BUCKET.put(trackKey, trackBytes, {
              httpMetadata: { contentType: CONTENT_TYPES[trackExt] || "audio/mpeg" }
            });
            const newUrl = `/music/${trackKey}?v=${Date.now()}`;

            if (singleTrackReplace) {
              album.tracks[0] = { ...album.tracks[0], title: trackName, url: newUrl };
            } else {
              // Same storage path (genre + filename) means this is a revision of an
              // existing track, not a new one — update it in place instead of
              // appending a duplicate entry.
              const existingIdx = album.tracks.findIndex(t => (t.url || "").split("?")[0] === `/music/${trackKey}`);
              if (existingIdx !== -1) {
                album.tracks[existingIdx] = { ...album.tracks[existingIdx], title: trackName, url: newUrl };
              } else {
                album.tracks.push({ title: trackName, url: newUrl, primaryLens: genre, secondaryLenses: [] });
              }
            }

            // No explicit cover in this edit, and the album still doesn't have
            // one — fall back to embedded ID3/M4A artwork on the newly uploaded track.
            if (!(cover && cover.size > 0) && !album.cover) {
              const art = extractEmbeddedCoverArt(trackBytes);
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
        const lrcPath = `/lyrics/${lrcKey.split('/').slice(1).join('/')}?v=${Date.now()}`;
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
