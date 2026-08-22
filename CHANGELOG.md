# CHANGELOG

## v2.10.2 — Cover/Track Revisions Were Cached Stale + Duplicated On Edit

### Fixed
- Replacing a cover or track file through the admin panel wrote the new file to the same R2 key, but `/covers/*` and `/music/*` are served with `Cache-Control: public, max-age=86400` and no version marker — so the CDN/browser kept serving the old cached file for up to 24 hours even though the new one was live. Both `POST /api/upload/album` and `PUT /api/upload/album/:id` now append `?v=<timestamp>` to the stored `cover` and track `url` whenever a file is (re)written, forcing a fresh fetch immediately.
- Re-uploading a track with the same filename through "edit album" previously appended a duplicate track entry instead of replacing the existing one. `PUT /api/upload/album/:id` now matches the incoming file's storage path against existing tracks and updates that track in place (title + URL), preserving any other data on it (e.g. a synced `.lrc` path), instead of creating a second entry pointing at the same audio.

## v2.10.1 — Admin Auth Hardening

### Security
- Removed `?key=` query-string admin authentication entirely (worker.js `isAdmin()` and the `/gx9k-panel.html` gate). The admin secret no longer appears in any URL, browser history, bookmark, or Cloudflare request log.
- Added `POST /api/admin/login` — exchanges the admin key once for a short-lived `HttpOnly; Secure; SameSite=Strict` session cookie (8-hour expiry). Added matching `GET /api/admin/check` and `POST /api/admin/logout`.
- `gx9k-panel.html` now shows a login screen when no valid session cookie is present; the panel shell itself carries no data, so serving it unauthenticated is safe — every mutating and check route is still gated by `isAdmin()`.
- Existing `X-Admin-Key` header auth is unchanged, so no other API behavior changed.

## v2.10.0 — Next/Prev Now Works From a Direct Single-Track Tap

### Fixed
- `⏭` doing nothing when a track was picked directly (as opposed to via Shuffle or Play-All) was a real, pre-existing gap, not a regression from the drag/swipe fixes — confirmed by inspection that `card.onclick`, `skipNext()`, `buildQueue()`, and `playQueueItem()` were untouched by any prior change in this series.
- Root cause: `card.onclick` explicitly cleared `queue` and fell back to `currentTracks = album.tracks`. Since each album in this catalog is a single-track release, `currentTracks.length` was always 1, so `skipNext()`'s own `// Single track, no queue — next does nothing` branch fired every time.
- Fix: tapping a track directly now calls `buildQueue(lensEntries, false)` + `playQueueItem(idx)` — the same mechanism Shuffle/Play-All already use, just unshuffled — so Next/Prev walk sequentially through the current lens. Shuffle behavior (`shuffleAll()`) is untouched and remains a separate, explicit action.
- Verified end-to-end by loading the real page in a DOM, rendering real lens cards from a 3-track fixture, tapping a card, and confirming `skipNext()`/`skipPrev()` walk the lens in order via the visible track title and active-card state (not a hand-copied reimplementation). Re-ran all prior drag/swipe regression tests — no regressions.

## v2.9.1 — Landscape Progress Bar Was Never Wired Up (Root Cause of "Rewind to Start")

### Fixed
- Found the actual bug behind all the earlier drag reports: on the landscape ≥600px layout (which is what both screenshots showed), the visible progress bar is `.np-progress-panel` — a completely separate DOM element from `#np-progress-wrap` (the portrait/cover version, which is `display:none` in landscape). The seek IIFE only ever attached listeners to `#np-progress-wrap`, so `.np-progress-panel` had **zero** click/touch/drag handling. Its visual track is also only 3px tall, so most touches aimed at it actually landed on the surrounding `.np-top-group` padding.
- With no local handler to consume the touch, and `.np-top-group` not excluded from the modal's swipe-to-skip gesture, a rightward drag (the natural "seek forward" motion) was read as a swipe and released into `skipPrev()` — which restarts the current track from 0 whenever `audio.currentTime > 3`. That's the "often rewinds to start" symptom.
- Refactored the seek IIFE so both `#np-progress-wrap` and `#np-progress-panel` share the same drag logic and stay in sync. Added a 24px-tall invisible hit area over the panel bar's 3px visual track, and added `.np-top-group` to the swipe-to-skip exclusion list as a safety net.
- Verified with jsdom: dragging either bar now correctly sets `audio.currentTime`, and pointerdown on the panel bar, its padding, or its track no longer arms swipe-to-skip. Re-ran the prior swipe-exclusion regression test — no regressions.

## v2.9.0 — Progress Bar Drag Fix (Selection Lockdown Was Missing Prefixes)

### Fixed
- `.now-playing-card` only declared unprefixed `user-select: none`, which iOS Safari does not reliably honor. Every descendant that didn't have its own explicit `-webkit-user-select`/`-webkit-touch-callout` lockdown (lyrics window, controls row, bottom bar, BACK button) remained selectable, so a drag starting on the seek bar could still expand into a large native text selection across the rest of the modal. Added `-webkit-user-select: none` and `-webkit-touch-callout: none` directly to `.now-playing-card` so the entire modal is locked down at the source instead of element-by-element. Verified statically that no rule in the stylesheet re-enables selection anywhere in the card.

## v2.8.9 — Progress Bar Drag Fix (Swipe-to-Skip Conflict)

### Fixed
- Dragging the Now Playing progress bar was bubbling `pointerdown`/`pointermove`/`pointerup` up to `#np-card`'s swipe-to-skip handler (pointer events on iOS fire before the wrap's own touch handlers, so `preventDefault()` in the seek code couldn't stop it). This made the card fight the seek drag visually and, on release, sometimes fired `skipNext()`/`skipPrev()` instead of seeking — the "fast forward broken / thumb drag doesn't work" symptom. Fixed by having the swipe handler ignore any `pointerdown` whose target is inside the progress bar, time labels, or controls. Verified with a jsdom event-bubbling test confirming the swipe still fires from the cover art but not from the seek bar or buttons.

## v2.8.8 — Progress Bar Drag Fix (iOS Text Selection)

### Fixed
- Dragging the Now Playing progress bar on iOS was triggering native Safari text-selection (blue selection handles), because `-webkit-user-select`/`-webkit-touch-callout` were never disabled on `.np-progress-wrap` and `.np-time`. Added `user-select: none`, `-webkit-user-select: none`, and `-webkit-touch-callout: none` to `.np-progress-wrap`, `.np-time`, and `.player-seek-wrap` (mini bottom-bar strip) so drag gestures can no longer select the time labels.

## v2.8.6 — Admin API Auth Hardening

### Fixed
- All admin-mutating API routes (`/api/upload/album`, `/api/upload/album/:id`, `/api/remove/album/:id`, `/api/remove/track/...`, `/api/track/lens`, `/api/lenses`, `/api/lyrics/autosync`, `/api/lyrics/autosync-poll`, `/api/upload/lyrics`) now require the admin key via `X-Admin-Key` header. Previously only the `gx9k-panel.html` page itself was gated — the API routes behind it were open to anyone.
- Fixed `ReferenceError` (`newTracks` → `tracks`) in album-edit route that would throw when editing an existing album and adding new track files.
- Removed dead/unreachable code left over from the pre-browser-polling autosync implementation.
- Escaped album/track title and description text before injecting into Open Graph / Twitter meta tags (prevents stored XSS in social share previews).

## v2.0.0 – v2.8.5 — Emotional Lenses Platform Buildout

### Added
- Admin key moved to Cloudflare env secret; range-request audio streaming fix (v2.0.0)
- New Pulse lens with hummingbird hero, computed from highest album IDs (v2.2.0)
- Share URL system (`navigator.share()`) and Open Graph meta tag injection (v2.3.x)
- Header visible behind Now Playing modal; mobile layout restructure (v2.4.x)
- Fixed bottom bar and Z Fold side-by-side layout at ≥600px (v2.5.x)
- Teleprompter-style scrolling lyrics engine; AirDrop share fix (v2.6.x)
- Smooth lyric glow transitions; AssemblyAI browser-polling auto-sync, avoiding Worker timeouts (v2.7.x)
- Admin panel lens dropdown replacing genre field; space-between Now Playing layout (v2.8.x)

### Notes
See `generify-music-handoff.md` for full session-by-session detail and `my-music-player/README.md` for current architecture.

## v1.0.0 — Emotional Lenses Foundation

### Added
- Emotional Lens browsing system
- Lens hero artwork
- Dynamic lens cards
- Hidden empty lenses
- Library escape view
- Emotional-first UX direction

### Changed
- Replaced genre-first homepage
- Reworked masthead structure
- Removed old Music Library header layout
- Added cinematic emotional card rendering

### Notes
This marks the transition from a music player into an emotionally curated listening platform.
