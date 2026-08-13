# CHANGELOG

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
