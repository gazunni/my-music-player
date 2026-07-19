# Generify Music — Session Handoff
**Date:** 2026-07-19
**Version at handoff:** v2.8.5
**Repo:** gazunni/my-music-player (public)
**Live URL:** https://music.generify.ca
**Admin URL:** https://music.generify.ca/gx9k-panel.html?key=YOUR_SECRET

---

## Working Files (Claude's copy)
All current files are in `/home/claude/my-music-player/`:
- `index.html` — v2.8.5, full teleprompter lyrics, side-by-side layout at ≥600px
- `worker.js` — AssemblyAI browser-poll auto-sync, OG tags, range requests
- `gx9k-panel.html` — lens dropdown replacing genre, secondary lenses removed
- `_headers` — no-cache on `/`, `/index.html`, `/gx9k-panel.html`

---

## What Was Done This Session

### Layout fixes (index.html)
- Side-by-side modal (`≥600px`) — cover left, lyrics+controls right panel
- `justify-content: space-between` + `position: relative !important` on `np-content` to override base `position: absolute` overlay style
- `np-top-group` wraps time+progress so they stay at top under space-between
- `np-bottom-bar` `flex-shrink: 0` pins controls+share to bottom of right panel
- Z Fold fix — side-by-side triggers at `min-width: 600px` not `1024px landscape`
- Mobile (`≤480px`) — `np-bottom-bar` absolutely pinned, lyrics absolutely positioned between time and bar
- Subtitle hidden when modal open (`body.modal-open .lens-copy { display: none }`)

### Teleprompter lyrics engine (index.html)
- All lines rendered in `np-lyrics-scroll` container
- `translateY` scroll to centre active line
- Distance-based styling via `data-dist` attributes
- Styles applied, then `requestAnimationFrame` measures, then scroll (prevents jitter)
- `closeNowPlaying()` fully resets lyrics state
- `restoreLastPlayed()` disabled — fresh start on every page load
- `localStorage` cleared on load
- Player bar hides when song ends

### Admin panel (gx9k-panel.html)
- Genre text field replaced with Lens dropdown (populated from `approvedLenses`)
- Secondary lens UI removed from track rows
- Album badge shows primary lens instead of genre
- JS syntax error fixed (literal newline in `.join('\n')` from autosync rewrite)

### Auto-sync (worker.js + gx9k-panel.html)
- Worker now submits AssemblyAI job and returns `jobId` immediately
- Browser polls `/api/lyrics/autosync-poll?jobId=xxx` every 3s (no Worker timeout)
- Forced alignment done in browser JS
- Fixed `speech_models: ['universal-3-5-pro', 'universal-2']` (was deprecated singular)

### Share system
- `navigator.share({ title, text, url })` — `url` field separate so AirDrop sends clickable link
- OG tags injected by Worker for social preview cards

---

## Known Issues / Next Steps

### Still outstanding
1. **WhatsApp OG image** — covers are 2-3MB PNGs, WhatsApp has ~300KB limit. Preview text works but image may not show. Fix requires resizing covers on upload (not yet built).
2. **Auto-sync testing** — AssemblyAI speech_models fix just deployed. Needs real-world test to confirm alignment quality.
3. **Gabe (Z Fold)** — confirmed working at v2.7.6+ in Samsung Browser. Must use Samsung Browser directly, NOT Google search bar (Chrome Custom Tab has isolated cache).

### Pending backlog
- Songs in `/music/other/` (ids 31, 35) — file lives in wrong folder, cosmetic only, playback works
- `folk-rock/` and `folkrock/` duplicate folders in R2 — cosmetic only
- OG preview image sizing for WhatsApp

---

## Critical Architecture Rules

### Always before zipping
1. `node --check worker.js`
2. Extract JS from HTML and syntax check: `python3 -c "import re; scripts=re.findall(r'<script[^>]*>(.*?)</script>', open('file.html').read(), re.DOTALL); open('/tmp/check.js','w').write('\n'.join(scripts))"` then `node --check /tmp/check.js`
3. Update version tag in `index.html` with `re.sub(r'>v\d+\.\d+\.\d+</div>', '>vX.Y.Z</div>', content)`
4. Use a NEW version number if previous version was deployed

### CSS editing rule
Read the FULL media query or CSS block before editing. Duplicate rules accumulate silently and later rules override earlier ones. The base `.np-content` is `position: absolute` (overlay style) — mobile/tablet buckets must use `position: relative !important` to override it.

### albums.json
- Lives in R2 `my-hits-list` root — NOT served from GitHub
- GitHub copy is intentionally minimal (placeholder)
- Upload directly to R2 after any data changes

### Worker secrets
- `ADMIN_KEY` — admin panel access key (Cloudflare env secret)
- `ASSEMBLYAI_KEY` — AssemblyAI API key (Cloudflare env secret)
- Never in code or GitHub

### ZipToGit deploy
- ZIP must include folder path: `zip vX.Y.Z.zip my-music-player/file.html`
- No periods in ZIP filename except before `.zip`
- If ZipToGit shows no change detected, upload files directly to GitHub via web UI

---

## Breakpoints Reference

```
≤480px          → mobile stacked (phone portrait)
481–599px       → portrait stacked (narrow tablet)
≥600px          → side-by-side (iPad, Z Fold unfolded, desktop)
```

## Version Tag Location
```html
<!-- Bottom of index.html, before </body> -->
<div id="build-tag" style="position:fixed;bottom:6px;right:10px;...">v2.8.5</div>
```
