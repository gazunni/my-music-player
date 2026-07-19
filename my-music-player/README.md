# Generify Music — Emotional Lenses

**Version: v2.8.5**
**URL:** https://music.generify.ca
**Artist:** Vegetarian Aardvark

---

## What It Is

Generify Music is an emotionally curated music platform built for a single artist. Instead of browsing by genre, listeners enter through emotional "lenses" — moods and feelings that match where they are tonight.

---

## Architecture

| Layer | Technology |
|---|---|
| Hosting | Cloudflare Workers + R2 Object Storage |
| Deploy pipeline | ZipToGit → GitHub → Cloudflare auto-deploy |
| Audio/covers storage | Cloudflare R2 (`my-hits-list`, `my-album-covers`) |
| Lyrics storage | Cloudflare R2 (`my-hits-list/lyrics/`) |
| No framework | Vanilla HTML/CSS/JS + Cloudflare Worker |

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Main SPA — lens gallery, Now Playing modal, teleprompter lyrics |
| `worker.js` | API routes, R2 serving, OG tag injection, AssemblyAI auto-sync |
| `gx9k-panel.html` | Admin panel (key-gated) |
| `_headers` | Cloudflare cache-control rules |
| `wrangler.jsonc` | Cloudflare Worker config |
| `albums.json` | Live library data (stored in R2 root, NOT served from GitHub) |
| `lenses.json` | Approved lens list (stored in R2 root) |
| `assets/lenses/` | Lens hero images (.webp, 755×310px) |

---

## R2 Bucket Structure

**my-hits-list/**
```
albums.json
lenses.json
<lensname>/          ← MP3 files organised by lens
lyrics/<lensname>/   ← .lrc lyric files
```

**my-album-covers/**
```
<album-name>-cover.png
wolf-logo.png
```

---

## Emotional Lenses

Each song is assigned a primary lens. The lens grid on the homepage shows only lenses that have at least one song. Lenses are managed from the admin panel.

**Current lenses:** New Pulse, Bittersweet, Campfire, A Night Out, Healing, Dreamscape, Late Night, Funny Bone, Soft Sleep, Reflection, Human Connections, Rainy Window, Road Trip, Quiet House

**New Pulse** is a special computed lens — always shows the 3 most recently added albums (highest IDs) automatically. No manual assignment needed.

---

## Admin Panel

**URL:** `https://music.generify.ca/gx9k-panel.html?key=YOUR_SECRET`

The key is stored as a Cloudflare Worker secret `ADMIN_KEY` — never in code.

**Admin capabilities:**
- Upload new albums (cover + MP3, lens assigned from dropdown)
- Edit album title, artist, genre/lens
- Delete albums or individual tracks
- Assign/change primary lens per track
- Sync lyrics via manual tap tool or AssemblyAI auto-sync
- Manage approved lens list

---

## Lyrics System

Lyrics are stored as `.lrc` files in R2 at `lyrics/<lensname>/filename.lrc`.

The `albums.json` entry references the path: `"lrc": "/lyrics/funnybone/song.lrc"`

**Sync methods:**
1. **Manual tap tool** — paste lyrics, song plays, tap at start of each line
2. **Auto-sync** — AssemblyAI transcribes audio and aligns to pasted lyrics automatically (browser polls, no Worker timeout)

---

## Sharing

Each song has a share button in the Now Playing modal. Generates URL:
`https://music.generify.ca/?play=<albumId>&track=<trackIndex>`

When opened, the site auto-enters the song's lens and opens the Now Playing modal.

Worker injects Open Graph meta tags for social preview cards (album cover, title, description).

---

## Responsive Layouts

| Screen | Layout |
|---|---|
| ≤480px (phones) | Stacked: cover top 45%, controls/lyrics below, bottom bar pinned |
| 481–599px | Portrait stacked with more cover height |
| ≥600px (tablets, Z Fold unfolded) | Side-by-side: cover left, lyrics+controls right panel |
| Desktop | Same side-by-side, wider card |

---

## Deployment

1. Make changes to files
2. Zip with folder path: `zip my-music-player-vX.Y.Z.zip my-music-player/file.html`
3. Upload to ZipToGit → deploys to GitHub → Cloudflare auto-deploys
4. For `albums.json` / `lenses.json` changes: upload directly to R2

**Never deploy without:**
- Running `node --check worker.js`
- Extracting and checking JS from HTML files
- Updating the version tag in `index.html`
- Using a new version number if previous was deployed

---

## Version History Summary

| Version | Key changes |
|---|---|
| v1.0.0 | Emotional Lenses foundation |
| v2.0.0 | Admin key moved to env secret, range request audio fix |
| v2.2.0 | New Pulse lens with hummingbird hero |
| v2.3.x | Share URL system, OG meta tags |
| v2.4.x | Header visible behind modal, mobile layout restructure |
| v2.5.x | Fixed bottom bar, Z Fold side-by-side layout |
| v2.6.x | Teleprompter lyrics engine, AirDrop share fix |
| v2.7.x | Smooth lyric glow, AssemblyAI browser-polling auto-sync |
| v2.8.x | Admin lens dropdown, JS syntax fix, space-between layout |
