# CHANGELOG

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
