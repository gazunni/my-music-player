# CHANGELOG

## v2.16.0 — Lyrics-less Tracks Get a Waveform + Mood Fallback

### Added
- When a track has no `.lrc` file (or its lyrics fail to load — mostly the Soft Sleep lens today), the lyrics panel now shows a live waveform visualizer (Web Audio `AnalyserNode`, driven by whatever's actually playing) with the current lens's mood description centered over it, and a small "No lyrics available" label above that — instead of an empty gap between the time readout and the transport controls.
- The visualizer's audio graph is built lazily on first use and persists for the session (`createMediaElementSource` can only be called once per `<audio>` element); tracks that do have lyrics are unaffected either way.
- Visualizer animation stops when the Now Playing modal closes or a track with real lyrics loads, so it's not burning CPU/battery in the background.
- Reuses the existing lens description data — no new admin fields or content required.

## v2.15.4 — Single-Track Uploads Only + Cleaner Panel Layout

### Changed
- Confirmed the front-end has no album-level browsing view at all — it flattens every album's tracks into individual cards, one per track, grouped into lens sections by each track's own tag. A multi-song "album" was never a real concept in the display, just a data-model possibility, so removed it as an upload option.
- Track picker (`#tracks-input`) no longer accepts multiple files — the same input drives both native click-to-choose and drag-and-drop (it's an invisible overlay on the drop zone), so this restricts both paths identically.
- "Add New Album" form reordered: Track picker and Lens selector now share the first row (the only two things you truly choose manually), followed by a visual divider, then Album Title/Artist/Cover — all of which auto-populate from the track's tags.

## v2.15.3 — Live Cover Art Preview From Track Selection

### Added
- Selecting a track now also extracts its embedded ID3 cover art client-side and shows it immediately in the Album Cover preview — same parser logic as `worker.js`'s server-side fallback, duplicated here since the panel has no shared module system.
- Non-destructive: if you've manually chosen your own cover, selecting a track will never override it. Only a cover that was itself auto-extracted gets replaced (or cleared) when you pick a different track.
- The extracted image becomes the actual `cover` file sent on upload — the preview shows exactly what will be used, not just a placeholder.
- Verified against both real Suno files: extracted image sizes matched exactly (12267 and 18663 bytes) what mutagen reported earlier.

## v2.15.2 — Auto-Fill Title/Artist From Track Tags in Admin Panel

### Changed
- Reordered the "Add New Album" form: Tracks is now first, followed by Album Title, Artist, Lens, then Album Cover — matching the intended workflow of picking the track first.

### Added
- Selecting a track (new-album mode only, not while editing) now reads its ID3 `TIT2`/`TPE1` tags client-side and auto-fills Album Title and Artist.
- Title auto-correction: strips stray leading/trailing quote characters (straight or curly) — fixes the trailing-curly-quote artifact seen on some Suno exports.
- Artist auto-correction: underscores/hyphens become spaces, each word capitalized — `vegetarian_aardvark` becomes `Vegetarian Aardvark`.
- If a track has no ID3 title/artist at all, the fields are left blank for manual entry rather than guessing from the filename.
- Verified against two real Suno-exported files: correctly stripped a stray curly quote from one title, and correctly title-cased both `gazunni` and `vegetarian_aardvark` artist tags.

## v2.15.1 — Admin Panel Was Still Blocking Cover-less Uploads Client-Side

### Fixed
- v2.15.0 made the cover optional on the server (`worker.js`), but never touched `gx9k-panel.html` — its own client-side validation still required a cover before the request ever reached the worker, so nothing changed from the admin's perspective. Removed that client-side requirement (still requires title, artist, and at least one track); the worker's own validation is now the source of truth, including its "no cover and no embedded artwork found" error message.
- Updated the "Album Cover" label and drop-zone hint on the new-album form to say it's optional and that embedded track artwork is used as a fallback.

## v2.15.0 — Auto Cover Art From Embedded ID3 Artwork

### Added
- Confirmed: Suno (and most AI/streaming MP3 exports) embed a front-cover image directly in the file's ID3v2 tags (the standard `APIC` frame). Added a small hand-written ID3v2 parser to `worker.js` (no npm dependency — this worker has none) that pulls that embedded artwork out.
- `POST /api/upload/album`: the cover field is no longer required. If no cover is uploaded, the first track with embedded artwork provides the album cover automatically. If neither a cover nor embedded artwork is found, the upload now fails with a clear message instead of silently succeeding with no art.
- `PUT /api/upload/album/:id`: same fallback, but only fires when the album doesn't already have a cover — an explicitly-uploaded cover or a previously-set one is never overwritten by auto-extraction.
- Supports both ID3v2.2 (`PIC`) and ID3v2.3/2.4 (`APIC`) frames, and prefers a frame explicitly marked "front cover" when a file has more than one embedded image.

## v2.14.4 — Room-Entry Scroll Was Asymmetric With Return-to-Gallery

### Fixed
- `returnToLensGallery()` always used a plain `window.scrollTo({top:0})`, which is why leaving a room reliably showed the full hero + gallery. `enterLens()`/`enterFullLibrary()` instead used a dynamic offset calculation against the room badge — which broke once that badge became `position: sticky` in v2.14.3: if the page was already scrolled down when a room was entered, the badge could read as already "stuck" at the top the instant its class changed, so the computed offset was ~0 and no scroll happened at all. `scrollToRoomStart()` now just scrolls to the literal page top, matching `returnToLensGallery()`, so both directions behave identically and the sticky header takes over correctly from there as you scroll down.

## v2.14.3 — Sticky Room/Library View Header

### Changed
- The room header (lens badge or "Viewing — Library View") and its "Back to Emotional Lenses"/Play/Shuffle controls are now `position: sticky` at the top of the viewport, with a solid blurred background and bottom border, instead of scrolling away with the page. Track sections now scroll up underneath it, matching how the header stays reachable in the individual lens rooms.

## v2.14.2 — Room Header Was Obscured By Native Fullscreen Chrome

### Fixed
- The lingering overlap wasn't a scroll math problem — iPadOS Safari's own fullscreen exit control ("X" + "swipe down to exit" toast) is native browser chrome fixed to the screen corner, unaffected by page scroll position. Added top clearance (`padding-top`, safe-area aware) to the room/Library View header so it renders below that native control instead of underneath it.

## v2.14.1 — Room-Entry Scroll Was Anchoring Below the Header, Not To It

### Fixed
- `scrollToRoomStart()` was scrolling to the top of the track list (`#main-content`), not the room header/badge above it, and measured position synchronously right after the DOM rebuild + fullscreen request — before the browser's layout (and iOS's fullscreen viewport shift) had settled. Net effect: entering Library View (and any lens room) under-scrolled, leaving a sliver of the hero section visible above the header. Now anchors to `#filter-bar` (the header/badge itself) and measures after two animation frames so layout is settled first.

## v2.14.0 — Library View Cleanup + Scroll Position Fix

### Changed
- Library View no longer shows the Emotional Lens card grid above it — it now uses the same "room" treatment as an individual lens, with a persistent top badge ("Viewing — Library View") and a pinned "← Back to Emotional Lenses" button, instead of a bottom-of-page button competing for attention with the full lens grid.

### Fixed
- Root cause of the Now Playing modal resetting scroll position on close: opening a track set `body { position: fixed }` with no `top` offset and no restore on close, which silently dropped the page back to the top. Now the scroll position is captured before locking the body and restored via `window.scrollTo()` on close — fixes it in Library View, individual lens rooms, and everywhere else in the app, not just one screen.

## v2.13.0 — Shuffle All (Whole Library, Bypassing Lens Filtering)

### Added
- New "Shuffle All" button on the landing gallery, next to "Library View" — starts a shuffled queue across every track in every lens in one tap, with no need to enter Library View or any individual lens room.
- Library View intentionally left untouched (no Play/Shuffle controls added there) — the lens-first browsing model stays the primary path; this only adds a fast way to hear everything without leaving the lens gallery.

## v2.12.0 — Media Session (Lock Screen / Bluetooth / Hardware Controls)

### Added
- Lock-screen and Bluetooth/car media controls via the Media Session API — track title, artist, album, and cover art now show on the iPad/phone lock screen and control center whenever a track is playing.
- Hardware/remote play, pause, previous, and next now route through the existing `togglePlay`/`skipPrev`/`skipNext` logic, so they behave identically to the on-screen buttons.
- Scrubbing from the lock screen (where supported) is wired to `seekto`, with `seekbackward`/`seekforward` as a 10s fallback.
- `navigator.mediaSession.playbackState` is kept in sync via the existing `setPlayState()` so OS-level play/pause indicators stay accurate.
- Metadata updates automatically on every track change via the existing `updateBarMeta()` — no new call sites needed elsewhere.

## v2.11.0 — Screen Wake Lock

### Added
- Screen Wake Lock API keeps the display from dimming/locking while a track is playing. Requested on `play`, released on `pause`/`ended`, and re-acquired on `visibilitychange` if the tab regains focus mid-playback. Only holds while the tab is in the foreground — cannot keep the screen on in the background.

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
