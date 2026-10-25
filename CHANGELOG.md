# CHANGELOG

## v2.25.2 — Collapsible Library Section in Admin Panel

### Added
- The "Library" section (now ~90 tracks) is collapsible — click the section title to toggle, with a disclosure arrow (right-pointing when collapsed, down when expanded) matching the standard convention. Defaults to collapsed on first use, so opening the admin panel no longer means scrolling past the entire track list just to reach Statistics below it. Your choice is remembered (via localStorage) after that.
- Verified full play-logging coverage across every scenario raised (New Pulse, a track's own tagged lens, Library View, shuffle play, direct card taps, and "Play All" for an entire lens): traced every path in the code and confirmed there's only one track-card click handler in the whole file, shared identically by all of those contexts, and it — along with both the shuffle/play-all queue builder and the next/prev/auto-advance function — already has play-logging wired in as of v2.25.1. No code change needed there; this was a verification pass. Also noted a harmless piece of dead code (`loadAndPlay()`, defined but never called) found while tracing — no risk, flagged for visibility only.

## v2.25.1 — Play Count Missing a Third Track-Start Path (playQueueItem)

### Fixed
- Confirmed via first real-world test: a vote recorded correctly, but the same track's play count stayed at 0 — meaning the voting pipeline was fine, and the gap was specifically in play logging. Found a third, previously-unhooked track-start function, `playQueueItem()` (used by "Play All"/"Shuffle All", and likely queue advancement in a lens room) — separate from both paths `logPlay()` was already wired into (`playTrack()` for individual card clicks, and the shared-link autoplay path). Added the same `logPlay(album.id)` call to its success callback. All three genuine track-start paths are now covered; the two remaining `audio.play()` call sites in the file are resume-only (toggling play/pause on an already-loaded track) and correctly don't log a second play for the same listen.

## v2.25.0 — Statistics Panel: Play Counts, Visitor Tracking, Song Voting

### Added
- New Cloudflare D1 database (`STATS_DB` binding) backing three tables: `track_stats` (plays/thumbs-up/thumbs-down per album), `track_votes` (one vote per visitor per track, enforced at the DB level), and `visits` (date + country/region/city per page load). D1 was the right fit here instead of the existing R2/JSON approach — atomic counters and per-day queries, no read-modify-write races between concurrent visitors.
- Visitor location comes straight from Cloudflare's own edge metadata (`request.cf.country/region/city`) — no IP address is ever read, stored, or processed. More reliable than raw-IP geolocation and a better privacy posture besides.
- "Unique visitor" counting uses a lightweight anonymous cookie (`gm_visitor`, random ID, HttpOnly, 2-year expiry, no personal data) rather than IP address — avoids the usual undercount (shared/NAT IPs) and overcount (dynamic IPs) problems IP-based counting has, VPNs aside. The same cookie enforces one vote per visitor per track.
- Four new `worker.js` endpoints: `POST /api/stats/visit` (logged once per page load), `POST /api/stats/play` (logged once per track start — wired into both track-start paths in `index.html`: normal playback via `playTrack()`, and the separate shared-link `?play=` autoplay path, which bypasses `playTrack()` entirely and needed its own hook), `POST /api/stats/vote` (thumbs up/down; sending the same vote again removes it — toggle off), and `GET /api/admin/stats` (admin-gated; returns per-track plays/votes joined with album titles from `albums.json`, plus today/week/month/all-time visitor totals and a country breakdown).
- Thumbs up/down buttons added to the Now Playing modal, wired to the vote endpoint with immediate UI feedback (updates counts and active-state from the server's response, no extra round-trip).
- New "Statistics" section in the admin panel: summary cards (unique + total visits for today/week/month/all-time), a visitors-by-country table, and a per-song performance table (plays, thumbs up, thumbs down) sorted by play count.

### Scope notes (what's NOT included, deliberately, to keep this shippable)
- Vote buttons show 0/blank until you actually vote — they don't fetch the live public tally when a track opens, to avoid a second round-trip per track open. Your own vote is remembered for the current page session (so re-opening a track you just voted on reflects it), but not persisted across a full page reload. A future `GET /api/stats/track/:id` endpoint could add this if wanted.
- No "plays over time" chart — `track_stats` stores a running total per track, not a timestamped log of every play event, since that wasn't asked for and keeps the schema simpler.

### Setup required before this can deploy (one-time, dashboard only — see accompanying instructions)
1. Create a D1 database in the Cloudflare dashboard, run the provided `stats-schema.sql` against it via the D1 Console, then paste its database ID into `wrangler.jsonc` in place of `REPLACE-WITH-YOUR-DATABASE-ID`.

## v2.24.10 — Reverted mask-image Test — Also Ruled Out

### Reverted
- Disabling `mask-image` did not stop the purple-line artifact. Restored the fade effect exactly as it was (both `mask-image` lines uncommented, nothing else changed). Three systematic, reasoned theories have now been tested and disproven in a row: compositing-layer promotion (v2.24.6, no effect), text-shadow structural mismatch (v2.24.7, made it worse), and the gradient fade mask (v2.24.9, no effect). Continuing to guess at individual CSS properties from screenshots alone has reached diminishing returns — the next step should be direct inspection of the actual DOM/CSS producing the artifact (e.g. Safari Web Inspector connected to a Mac, if available) rather than a fourth theory.

## v2.24.9 — Diagnostic Test: mask-image Disabled (TEMPORARY, Visible Change)

### Changed (temporary, for testing)
- New observation narrowed the suspect considerably: the purple-line artifact was reported to appear predominantly on lines entering/exiting the visible lyrics window, never on the fully-opaque active line in the middle — exactly matching the boundary of `.np-lyrics-window`'s gradient fade mask (`mask-image`/`-webkit-mask-image`), which fades lines in/out at the top and bottom edges of the window. WebKit has documented issues correctly applying a gradient mask to children with their own shadow/blur effects, which can leave a stray seam right at the mask's fade boundary.
- Disabled both `mask-image` lines (commented out, not deleted) as a direct test of this theory. **This is a real, visible change for the duration of the test** — lines will now hard-cut at the top/bottom edge of the lyrics window instead of fading smoothly, unlike the two previous attempts which were meant to be invisible either way.
- If this confirms the mask as the cause, the fade effect should be rebuilt via per-line opacity (the `data-dist` styling already handles per-line distance-based styling) rather than a global CSS mask, to recover the same visual effect without the bug.

### Backout / restore instructions
Uncomment the two `mask-image` / `-webkit-mask-image` lines inside the `.np-lyrics-window.visible` rule in `index.html` to restore the fade effect exactly as it was. Instructions are also in a comment directly above those lines in the code.

## v2.24.8 — Reverted Both Lyrics Panel Attempts (v2.24.6 and v2.24.7) — Made It Worse

### Reverted
- v2.24.7's fix (equalizing `text-shadow` structure across all `data-dist` values) was reported to make the artifact *worse* — it now stretches across multiple lines instead of appearing as isolated short bars. This disproves the "shadow-list structural mismatch" theory as stated, or at least shows the fix for it was wrong. Reverted `.lyric-line`'s `data-dist` rules back to the original `text-shadow: none;` on every non-active distance.
- Also reverted v2.24.6's compositing-layer change (`transform: translateZ(0)` / `backface-visibility: hidden` on `.np-lyrics-window`) back out at the same time, since it never demonstrated any benefit either. Back to the exact original baseline on both counts — confirmed via direct file inspection, no leftover changes from either attempt.
- New data point worth carrying forward: the artifact got *worse*, not better, after every line was given the same animated blur-radius shadow layers (even at zero alpha). That suggests the real trigger may be the animated blur-radius itself, independent of whether the shadow list is structurally consistent — pointing toward stopping the `text-shadow` property from animating at all as the next, more targeted thing to try, rather than trying to make its start/end states match.

## v2.24.7 — Purple Line Artifact: Real Root Cause Found (text-shadow Structural Mismatch)

### Fixed
- v2.24.6's compositing-layer fix didn't resolve the artifact, and testing on a song that predates the auto-sync feature entirely (pure manual tap-sync, no interpolation involved) still showed it — ruling out every data/timestamp-based theory tried, and confirming this is purely about how the lyrics panel renders, independent of any song's content.
- Confirmed root cause: `.lyric-line[data-dist="0"]` (the active line) declares a 3-layer `text-shadow`, while every other distance declared literally `text-shadow: none;` — and both participate in the same animated 0.45s `text-shadow` transition as a line's distance changes. Animating between a multi-layer shadow list and the keyword `none` has no well-defined interpolation path in CSS; WebKit specifically is documented to produce stray rendering artifacts during that kind of structurally-mismatched transition. This fully explains every observed symptom: WebKit-only (shared by all iOS browsers), confined to the lyrics panel (the only place in the app animating `text-shadow` this way), independent of song content (triggered by the transition itself, not any data), and appearing/reappearing at shifting positions with multiple at once (several lines can be transitioning their distance simultaneously during a scroll).
- Fix: every `data-dist` rule now declares the same 3-layer shadow structure as the active line, differing only in alpha (0 = fully transparent, instead of the structurally different `none`). Each layer's alpha now transitions smoothly instead of the browser having no defined path between "0 layers" and "3 layers."
- v2.24.6's compositing-layer fix (`transform: translateZ(0)` / `backface-visibility: hidden` on `.np-lyrics-window`) is left in place — unrelated mechanism, harmless, no reason to remove it.

### Backout instructions (if this causes a different problem)
In each of the 5 `data-dist` rules changed, revert the 3-line zero-alpha `text-shadow` block back to the single line `text-shadow: none;`. The same instructions are embedded as a comment directly above the changed rules in `index.html`.

## v2.24.6 — Safari Rendering-Artifact Fix for Lyrics Panel (High Confidence, Easily Reversible)

### Fixed
- A stray vertical line was reported appearing near lyric lines on iPad Safari. Ruled out a data/content cause (lyric text is inserted via `.textContent`, not `.innerHTML`, so a stray character in the LRC data can't produce a separately-positioned floating line). Likely cause, high confidence but not personally reproducible: `.np-lyrics-scroll` has `will-change: transform` with its own animated transition, while `.lyric-line` layers an animated multi-shadow glow on the active line plus an animated `filter: blur()` on nearby lines — that specific combination (animated blur + animated shadow + a GPU-accelerated transform layer) is a well-documented trigger for Safari/WebKit compositor "ghost edge" rendering glitches.
- Added the standard fix: forced a dedicated compositing layer on `.np-lyrics-window` via `transform: translateZ(0)` and `backface-visibility: hidden`. Applied to the outer wrapper specifically, not `.np-lyrics-scroll` itself — JS sets that inner element's `transform` via inline style on every scroll step, which would silently overwrite (and nullify) a CSS transform set there.

### Backout instructions (if this causes a different problem)
Delete exactly these two lines from the `.np-lyrics-window` CSS rule in `index.html`:
```
transform: translateZ(0);
backface-visibility: hidden;
```
Nothing else in that rule, or anywhere else in the file, depends on them — removing just those two lines fully reverts this change with no other side effects. The same instructions are also embedded directly in the code as a comment, right above the two lines.

## v2.24.5 — Diagnostic: og:type Changed From "music.song" to "website" (Best Guess, Not Confirmed)

### Changed
- Neither the og:description fix (v2.24.3) nor the client-side share-text fix (v2.24.4) changed anything visible, despite both being confirmed deployed and correctly running. Noted that the phrase still appearing — "Listen to "X" on Generify Music" — uses `og:site_name` (never touched) and exactly matches the shape of a template Android/RCS could be synthesizing on its own, specifically because `og:type` was set to the structured type `music.song`. Best guess, not confirmed: that structured type may cause the renderer to generate its own fixed template from `og:title`/`og:site_name` and ignore `og:description`/`og:image` entirely for that content type.
- Changed `og:type` from `music.song` to the generic `website` as a direct test of that theory. If the real description and real cover-art fallback (both already fixed and deployed) show up correctly after this change, it confirms the theory. If nothing changes, this is ruled out too and the real cause is still unknown.
- Explicitly not pursuing smaller font size or a forced smaller preview-image size for the fallback logo — confirmed with the user that neither is something our site can control; rendering size inside someone else's messaging app is entirely that app's own UI, with no tag or setting on our end that affects it.

## v2.24.4 — Actual Root Cause of the Long Share Message (Wrong File Was Fixed in v2.24.3)

### Fixed
- v2.24.3 shortened `worker.js`'s `og:description` and fixed its cover-art fallback — both real, correct fixes — but confirmed via Cloudflare's deployment log (correct version live, 100% traffic, 0% error rate) and GitHub's commit history (worker.js changes correctly committed) that the deploy was never the problem. The actual text shown in Messages was never `og:description` at all: on Android, "Share This Song" calls `navigator.share()`, and the message body comes from a separate, hardcoded `msgText` string in `index.html`'s own `shareTrack()` function — a different file, a different code path, never touched by the v2.24.3 fix. That's why nothing changed despite a confirmed-correct deploy and a confirmed brand-new test URL.
- Shortened `msgText` from `Listen to "X" on Generify Music` to `"X" — Generify Music`.
- Worth noting honestly: the URL itself (`https://music.generify.ca/?play=93&track=0`) still wraps across several lines in a narrow message bubble regardless of how short the accompanying text is — shortening the text helps, but the link's own length is a separate, inherent factor in how much vertical space the message takes up.
- The cover-art fix from v2.24.3 is confirmed live and deployed correctly; whether this specific test track genuinely has no stored cover (making the wolf-logo fallback the correct, intended behavior) or something else is going on is still unconfirmed — worth testing again with a track that definitely has real artwork uploaded.

## v2.24.3 — Share Preview: Real Cover Art (Not the Logo), Shorter Description

### Fixed
- Confirmed root cause of the wolf logo showing up in share-link previews instead of the song's own artwork: there was never any deliberate "default to the logo" behavior — if a track genuinely had no cover stored (`album.cover` unset), the share code built a broken image URL (`https://music.generify.ca` + `undefined`), and messaging apps were just falling back to their own generic favicon-style preview when that URL 404'd. The real artwork was already being used correctly for every album that actually has one.
- Added an explicit fallback: when `album.cover` is genuinely unset, the share preview now deliberately uses the site's own wolf logo (the same `/covers/wolf-logo.png` already used in the page header) as a real, working image URL — instead of silently producing a broken link and leaving the result up to whatever each messaging app happens to do with it.

### Changed
- The share description was unconditionally appending the New Pulse lens's own tagline ("Physics is Wrong. New Energy is Created Here.") to every shared song regardless of which lens it actually belongs to — a copy-paste leftover, and the main reason the preview card took up so much space in Messages. Shortened it to a plain "Listen on Generify Music."

## v2.24.2 — NEW_PULSE_COUNT Added to wrangler.jsonc

### Fixed
- Cloudflare flagged that the `NEW_PULSE_COUNT` variable, added directly through the dashboard, wasn't reflected in `wrangler.jsonc` — meaning a future deploy that redeploys the config file without it could silently wipe out the dashboard-only value, since Cloudflare treats the committed config as authoritative. Added a `"vars": { "NEW_PULSE_COUNT": "6" }` block to `wrangler.jsonc`, matching the value already set in the dashboard, so the setting now persists correctly across every future deploy rather than depending on the dashboard alone.

## v2.24.1 — NEW_PULSE_COUNT Now Configurable From the Cloudflare Dashboard

### Added
- `index.html`'s `NEW_PULSE_COUNT` can now be overridden without a redeploy, via a Cloudflare env var of the same name (Workers & Pages → the worker → Settings → Variables and Secrets).
- Extended the existing share-link OG-tag interception pattern (which already fetches and modifies `index.html` as text for `/` and `/index.html`) with a new `injectNewPulseCount()` helper: reads `env.NEW_PULSE_COUNT`, and if it's a valid number between 1 and 50, swaps it into the `const NEW_PULSE_COUNT = 6;` line as the page is served. If the env var is unset, non-numeric, or out of that sane range, the file's own baked-in default (6) is left completely untouched — never throws, never blocks serving the page.
- Added a second, unconditional interception block for plain page loads (no `?play=`), since the existing OG-tag branch only ran for share links; the new block covers every other visit. Applied the same injection to both paths so a share-link visitor and a normal visitor always see the same live count.
- Verified directly against the real `index.html`: a valid override substitutes cleanly with the trailing comment intact, and three failure cases (missing, non-numeric, out-of-range) all correctly leave the default alone — confirmed via file-length diff that nothing else in the page was touched.

## v2.24.0 — New Pulse Expanded to 6 Newest Songs

### Changed
- "New Pulse" now shows the 6 newest albums instead of 3. Introduced a single `NEW_PULSE_COUNT` constant used everywhere this number mattered — the track selection itself (`getNewPulseTracks`), the "does this album count as New Pulse" check (`lensMatches`), and the track-count badge shown on the New Pulse card on the landing page (`counts['New Pulse']`), which was previously a separate hardcoded `3` that would otherwise have kept showing the old number even after the actual room expanded.

## v2.23.4 — Lint Cleanup: Unused Catch-Block Variables

### Changed
- Cleaned up the three ZipToGit lint warnings ("'err'/'e' is defined but never used") by switching those three `catch` blocks to optional catch binding syntax (`catch { ... }` instead of `catch (err) { ... }`), since none of them ever referenced the caught error — each one deliberately swallows the error and falls back to something safe (skip auto-cover extraction, skip an unparseable M4A atom, fall through to normal asset serving). Purely cosmetic; no behavior change. The other 8 `catch (err)` blocks in the file were left untouched — confirmed each one legitimately uses `err.message` in its response, which is exactly why the linter never flagged them.

## v2.23.3 — M4A Wouldn't Play on iPhone: Range Parser Mishandled Suffix Requests

### Fixed
- Confirmed root cause (verified against public documentation of iOS's known media-pipeline behavior, including a real-world example matching this exact pattern): iOS specifically requests a byte-range *suffix* (`Range: bytes=-N`, meaning "the last N bytes of the file") to locate an MP4/M4A container's metadata ("moov atom") when it isn't positioned at the front of the file. `r2RangeResponse()`'s Range-header parser didn't recognize that suffix form at all — it silently served the *first* N bytes instead of the *last* N bytes, with no error or indication the range had been misinterpreted. iOS would then fail to find valid MP4 structure at that (wrong) location and simply refuse to play the file. MP3 has no equivalent metadata-atom lookup, so it was never affected by this — which is exactly why MP3 worked and M4A didn't.
- Fixed the parser to correctly distinguish `bytes=-N` (suffix — last N bytes) from `bytes=START-END`/`bytes=START-` (normal/open-ended ranges), per RFC 9110 §14.1.2.
- Verified against four cases in isolation: the suffix form (including the exact byte count from a real documented iOS request), a normal range, an open-ended range, and the edge case of a suffix length larger than the file itself (correctly clamps instead of going negative) — all four produced the expected `start`/`end` values.

## v2.23.2 — Duplicate Title Text (Marquee Rebuild Side Effect)

### Fixed
- The v2.23.0 marquee rebuild duplicates each title into two copies so the scroll animation has something seamless to loop through — but a title short enough to already fit its box never triggers the `overflows` class, so the animation never starts, and both copies just rendered side by side with nothing hiding the second one. Showed up as "The Quiet We Choose The Quiet We Choose" in the Now Playing modal and mini-player bar.
- The second copy (marked `aria-hidden="true"`, already there for accessibility) is now hidden by default and only shown once the parent actually has the `overflows` class — i.e., only while the loop is genuinely running. Applied consistently across all three spots (grid cards, modal title, mini-player bar).

## v2.23.1 — Real Root Cause Found: Track Title Was Never Re-synced From Album Title

### Fixed
- All three "marquee" fixes (v2.22.1 through v2.23.0) were solving a problem that didn't exist — confirmed by inspecting the raw R2 data directly: the album's `title` field correctly read "Another Cowboy Crying in the Dark," but the *track's own* nested `title` field was genuinely stored as "Another Cowboy Crying in the." The front-end was faithfully displaying exactly what was in the data; there was nothing to reveal.
- Root cause: `PUT /api/upload/album/:id` always updates the album-level `title` field from the form, but only updated the track's own `title` field inside the block that runs *when a new track file is also uploaded in that same edit*. A plain text correction to just the Album Title field (no re-upload) silently left the track's own stored title stale and mismatched — which is also why checking the Edit Album form didn't catch it earlier: that field edits the album's title, not the individual track's title, and the two had quietly drifted apart.
- Now syncs `album.tracks[0].title` to the album's title on every save when the album has exactly one track (this app's standard model), regardless of whether a track file was also uploaded. Re-saving "Another Cowboy Crying in the Dark" once (even with no other changes) will self-heal its stored track title.
- The marquee rebuild from v2.23.0 stays — it's a genuine robustness improvement (no more computed scroll distance to get wrong) even though it wasn't the fix this specific bug needed.

## v2.23.0 — Marquee Rebuilt: Constant -50% Scroll, No More Measured Distance

### Changed
- Three fixes in a row (v2.22.1's hover-gate removal, v2.22.2's double-rAF, v2.22.3's `document.fonts.ready`) all correctly diagnosed real problems, but the title still froze partway through revealing itself in production — confirmed live at v2.22.3, ruling out a stale deploy. Rather than attempt a fourth variation of "measure the exact pixel distance more precisely," replaced the underlying mechanism entirely: it no longer computes a scroll distance at all.
- Each title now renders as two identical copies back-to-back (the second `aria-hidden`), and the animation is a constant, unconditional `translateX(-50%)` — since the content is always exactly double the single title's width, 50% is mathematically guaranteed to be the exact right distance for a seamless loop, regardless of title length, font metrics, or measurement timing. The only thing still measured is a boolean "does a single copy overflow the visible box" check (still gated behind `document.fonts.ready`), which decides whether to animate at all — getting that check slightly wrong is now cosmetic at worst, not a source of a frozen, partially-revealed title.
- Applied to all three spots (grid cards, Now Playing modal, mini-player bar), plus fixed a related gap found along the way: the error-recovery path in `showPlayError()` was restoring the title via plain `.textContent`, which would have silently broken the marquee structure on the next track after a playback error.

## v2.22.3 — Root Cause Found: Web Font Loading, Not Layout Timing

### Fixed
- Confirmed via the admin panel (edit form + Library list both showed the full title correctly) that the stored data was never the problem — this was purely a front-end rendering bug, and the previous two fixes (v2.22.1's hover-gate removal, v2.22.2's double-`requestAnimationFrame`) were both addressing the wrong mechanism, which is why neither resolved it.
- Actual cause: `.np-track` uses `'Bebas Neue'`, and `.player-track`/`.album-title` inherit `'DM Sans'` from the body — both custom web fonts loaded asynchronously via the page's `@import`. Measuring scroll width even a couple of frames early (as both prior fixes did) can catch the fallback font (Arial/Arial Narrow) still in place, bake a too-short scroll distance into the marquee's `--marquee-offset`, and never recalculate once the real font finishes loading and the text visually widens — silently clipping a consistent few characters off the end, every time.
- Replaced the double-rAF wait in all three overflow checks (grid cards, modal title, mini-player bar) with `document.fonts.ready.then(...)` — the standard, correct way to know custom fonts have actually finished loading and applied — before measuring.

## v2.22.2 — Marquee Overflow Checks Measured Too Early (Modal + Bar Titles)

### Fixed
- Beyond the touch-only `:hover` bug (v2.22.1), the Now Playing modal title and the mini-player bar title were each measured for overflow with only a single `requestAnimationFrame` — one frame after the cover image loaded, or one frame after paint. If that single frame lands while layout is still settling (e.g. a fullscreen transition still resolving on iOS, something this app has hit before), the measured width can be stale or wrong, and the overflow class silently never gets added — leaving the title permanently cut off with no scroll animation at all, not even a paused one. Applied the same double-`requestAnimationFrame` fix already proven for `scrollToRoomStart()` to all three overflow checks (grid cards, modal title, mini-player bar), ensuring layout has actually settled before measuring.

## v2.22.1 — Card Titles Never Scrolled to Reveal Full Text on Touch Devices

### Fixed
- Card grid titles (`.album-title-inner`) only ran their scroll-to-reveal marquee animation on `:hover` — meaning on any touch device (iPad, iPhone, everything this app has been tested on) the animation never played at all, since touch never produces a sustained hover state. A title too long for its card just sat permanently cut off with no way to see the rest, looking like a hard character-length limit when it was really a missed device case. The Now Playing modal title and the mini-player bar title were both already correct (auto-play, no hover gate) — only the grid cards had this bug. Removed the `:hover` requirement so the animation runs the same way everywhere, matching the two mechanisms that already worked.

## v2.22.0 — Actual Root Cause Found: Native Fullscreen Chrome, Not Our CSS

### Fixed
- Confirmed via a side-by-side browser comparison: a windowed browser with no fullscreen showed the masthead rendering correctly, while Safari in fullscreen mode showed iOS's own native fullscreen-exit control (an "X" button plus a "swipe down to exit" toast) overlapping the header — OS chrome sitting on top of the page, not a CSS problem on our end at all. This is the same category of issue already fixed once before for the lens-room header (v2.14.2); this time it was hitting the top-level masthead specifically, which explains why every previous padding attempt (v2.21.6 through v2.21.9's revert) never showed any real difference — none of them were addressing the actual cause.
- Added a `fullscreenchange` listener that toggles a `.fs-clearance` class on the header, adding extra top padding **only while the page is actually in fullscreen** — the normal windowed view (confirmed already correct) is completely untouched, and the fullscreen case now gets clearance below where the native "X" sits.

## v2.21.9 — Reverted All Header Padding Changes (v2.21.6–v2.21.8)

### Reverted
- None of the three header-padding attempts (v2.21.6, v2.21.7, v2.21.8) were confirmed to fix the original iPad issue — the visual evidence throughout was unreliable (comparisons partly made against a cached Safari tab-switcher snapshot rather than a live re-render), while confirmed-working phone and Samsung Fold layouts carried real regression risk from those same edits, since two of the three changes touched breakpoints those devices also use. With no confirmed benefit and real risk to layouts already known to work, reverted the base `header {}` rule and both the `@media (max-width: 840px)` and `@media (max-width: 640px)` breakpoints back to their exact pre-v2.21.6 values. The original iPad header-spacing question remains open and would need a verified-fresh (non-cached, non-tab-switcher) screenshot to diagnose properly.

## v2.21.8 — Real Root Cause: Media-Query Breakpoints Were Overriding the Header Fix

### Fixed
- v2.21.6 and v2.21.7 only ever edited the base `header {}` rule — but two responsive breakpoints (`@media (max-width: 840px)` and `@media (max-width: 640px)`) each have their own `header { padding: ... }` override, resetting it back down to small fixed values (18px, 24px) on any phone-width viewport. Since those rules come later in the stylesheet, they always won on mobile — meaning neither prior fix ever had any visible effect on an actual phone, in Safari or Chrome, confirming what was reported. Both breakpoints now carry the same safe-area-aware padding as the base rule.

## v2.21.7 — Header Still Too Close to the Top (v2.21.6 Only Helped Fullscreen/PWA)

### Fixed
- v2.21.6's `env(safe-area-inset-top)` fix only applies in fullscreen/installed-PWA mode — in a regular Safari tab (address bar + tab strip visible), Safari's own chrome already occupies the notch area, so that value correctly evaluates to 0 there and the fix did nothing visible in that mode. Increased the header's fixed top padding substantially (36px → 64px, safe-area addition kept for when it does apply) so there's real, visible breathing room regardless of which browsing mode is being used.

## v2.21.6 — Header/Masthead Cut Off on iOS

### Fixed
- The "EMOTIONAL LENSES" header and wolf logo had no accounting for iOS's safe-area-inset-top (the notch/Dynamic Island region) at all, unlike the sticky room header which already handles this. Added `env(safe-area-inset-top, 0px)` to the header's top padding, plus a bit of extra fixed breathing room (22px → 36px base), pushing the masthead down clear of the status bar/notch. No effect on devices without a safe area.

## v2.21.5 — Tapper Resume: Anchor to the Trailing Weak Stretch, Not the First Weak Line

### Fixed
- "Fix in Tapper" resumed at the very first weak/interpolated line found anywhere in the song. Confirmed with a real test case: if an earlier occurrence of a repeated phrase also got flagged weak (a false positive, distinct from the genuine trouble spot), the tapper would jump there instead of to the actual cluster of weak lines near the song's sparse/quiet ending — looking exactly like "it started at the wrong copy of that line."
- Changed the resume logic to scan backward from the end of the song to find where the trailing weak stretch begins, anchoring there instead. Falls back to the original forward search only if the very last line is confident (meaning there's no trailing weak run at all — e.g. an isolated weak line stuck somewhere in the middle of the song). Verified against a simulated case with both an early false positive and a genuine trailing cluster: old logic resumed at the early false positive, new logic correctly resumes at the real trouble spot.

## v2.21.4 — Existing Lyrics Now Pre-load When Re-opening Sync Lyrics

### Fixed
- Reopening Sync Lyrics for a track that already had saved lyrics (`track.lrc` set) always started with an empty paste box — forcing a full re-find-and-re-paste of the original lyrics text just to tweak or re-sync timing. `openSyncModal()` now fetches the track's existing `.lrc`, strips its timestamps, and pre-fills the paste box with the plain lyric lines automatically — same convenience title/artist/cover already had, just extended to lyrics. Falls back to the M4A-extraction pre-fill (or an empty box) when the track has no saved lyrics yet, and shows a clear message if the existing file can't be loaded for some reason.

## v2.21.3 — Lyrics URL Had No Cache-Busting (Stale on Re-sync)

### Fixed
- `/lyrics/*` was served with `Cache-Control: public, max-age=300` and, unlike covers and track audio, its URL never changed between saves — same deterministic `/lyrics/{genre}/{filename}` every time. Re-syncing or re-saving lyrics for a track that already had them could serve the stale, previous version for up to 5 minutes after the resave, even though the new file was correctly written to storage immediately. First-time saves were never affected, since there was nothing cached yet to collide with. Fixed with the same `?v=<timestamp>` versioning already used for covers and track audio — confirmed safe since the server parses the path via `url.pathname`, which never includes the query string, so this only affects caching, not the actual file lookup.

## v2.21.2 — Auto-Sync: No More Silent 00:00.00, Smart Tapper Resume

### Fixed
- Diagnosed why some lines defaulted to `[00:00.00]` instead of a real timestamp: the forced-alignment search pointer only ever moves forward through the transcript and was capped at an 80-word lookahead — a repeated chorus/refrain later in the song could fall outside that window once the pointer had already passed its first occurrence, and a sparse/whispered passage gives AssemblyAI little to confidently transcribe in the first place. Either case previously produced a silent, indistinguishable `0:00` with no indication anything had gone wrong.
- Widened the lookahead window (80 → 260 words) so repeated sections later in a song are reachable again.
- Added confidence scoring per line; any line that doesn't clear a reasonable match threshold is now interpolated from its nearest confident neighbors instead of defaulting to zero — every line gets a reasonable placement, and weak lines are flagged rather than silently wrong.

### Added
- "Edit in Tapper" is now smart: previously it discarded every timestamp (including ones that auto-synced correctly) and forced a full manual re-tap of the entire song from 0:00. It now preserves every confidently-aligned line, jumps straight to the first line that needed estimating, and starts audio playback a couple seconds before that point — you only tap through the part that actually needs it. Button relabels itself ("Fix N Weak Lines in Tapper") when there's something to fix.
- Verified the interpolation math directly: two consecutive weak lines between known-good timestamps land evenly spaced between them, not at zero.

## v2.21.1 — GET /api/albums Cache-Control Was Trusting Browsers Too Long

### Fixed
- `GET /api/albums` was served with `Cache-Control: public, max-age=60`, which tells the *browser itself* to reuse its cached response for a full 60 seconds without even contacting the server — independent of whether the page itself was freshly loaded. Explains a report where a page showing the brand-new v2.21.0 build (and its new format-tag feature) still displayed stale album data (old format/duration) seconds after an admin upload — the JS/HTML was fresh, but the browser's own HTTP cache handed back a pre-upload `/api/albums` response without asking.
- Changed to `Cache-Control: no-cache` on all three response paths (200, and both 304 branches) — the browser now always revalidates with the server before using a cached copy. This isn't the same as disabling caching: revalidation is a cheap conditional request (ETag-based), returning a bodyless 304 when nothing changed, so the original R2-read protection is unaffected. Since `writeAlbums()` already purges the edge cache on every write, the very next request after any admin change now sees it immediately instead of after up to 60 seconds.

## v2.21.0 — Format Tag on the Main Site (Card + Now Playing)

### Added
- Every track card in the lens grid and Library View now shows a small, muted format tag (MP3/M4A/WAV/etc.) next to the lens badge — subtle, doesn't compete with the title or artwork.
- The Now Playing modal shows the format next to the duration readout, where it's actually relevant once you've opened a track.
- Both read the format straight off the track's URL extension — no new data needed, works for every track already in the library retroactively.

## v2.20.4 — Fixed: Auto-Extracted Lyrics Wiped Before Use + Format Badge in Library

### Fixed
- Extracted M4A lyrics were being cached in memory, but saving the album successfully triggered `cancelEdit()` → `resetForm()`, which cleared that cache immediately — so by the time you opened Sync Lyrics from the library list, the suggestion was already gone and the paste box was empty. Removed the premature clear; the cache is already safely guarded (matched by album ID, only offered while the track has no `.lrc` yet), so it doesn't need to be wiped on every save — it naturally stops being offered once real lyrics exist for that track.

### Added
- Library list now shows the file format (MP3/M4A/WAV/etc.) as a small badge next to each album's title, derived from the track's actual file extension — so you can tell at a glance which format is currently live for a song without opening it.

## v2.20.3 — Format LED Layout Fix

### Fixed
- The 3-light format LED indicator was squeezed into a flex row beside the track dropzone, overlapping into the Lens dropdown ("MP3" label was cut off, the indicator sat visually on top of "Select a Lens…"). Moved it to sit directly under the Lens dropdown instead, in its own row with room to breathe — track dropzone is back to full width.

## v2.20.2 — Auto-Extract Embedded Lyrics from M4A (Sync Lyrics Pre-fill)

### Added
- M4A files can carry embedded lyrics (`©lyr` atom) even when their MP3/WAV counterparts don't — confirmed on a real Suno export. Extended `extractM4ATags()` in the admin panel to pull this alongside title/artist/cover.
- New `cleanExtractedLyrics()` strips section-label lines (anything that's just a bracketed marker on its own line), a leading "Lyrics" header line some exports include, and blank lines — leaving only singable lines for the tap-sync tool. Verified against the real file: 65 raw lines in, 56 clean lines out, zero label/header/blank lines remaining.
- Workflow this targets directly: upload the MP3 first for its richer metadata (title/artist/cover), then later replace the track with the M4A version — the system now recognizes that swap, checks whether the track already has synced lyrics (`track.lrc`), and if not, offers the M4A's embedded lyrics as a pre-fill the next time you open Sync Lyrics for that track. Never overwrites lyrics that already exist.
- A small green hint ("🎤 Lyrics found — open Sync Lyrics to use them") appears next to the track picker when this happens, so it's not a silent, easy-to-miss change.

## v2.20.1 — True Track Replacement + Extraction on Edit + Format LEDs

### Changed
- `worker.js`: for the standard single-track-per-album model, uploading a replacement track file during an edit now always replaces that track's audio by position, regardless of filename or format — previously it only replaced in place if the new filename matched the old one exactly, otherwise it silently appended a second track. Covers the "swap this MP3 for an M4A" and "upload a remix" workflows cleanly. Multi-track albums (legacy/rare case) keep the old filename-match-or-append behavior for safety.
- Admin panel: selecting a replacement track during an edit now also runs the same title/artist/cover extraction used for brand-new uploads, pre-filling the form fields as editable suggestions — nothing is saved until you hit Save, so you can review or ignore them. Works for MP3 and M4A; WAV has no embedded title/artist/cover to extract (confirmed against an actual Suno WAV export — it only carries a RIFF INFO comment and encoder tag, no metadata fields at all), so the fields simply stay as they were for WAV.

### Added
- A small 3-light vertical LED indicator next to the track picker showing which format was detected in the selected file (MP3/M4A/WAV) — lights up the matching LED using the same byte-signature checks the extractors already rely on (`ID3` header, `ftyp` box, `RIFF...WAVE` header). Verified against real MP3 and WAV files.

## v2.20.0 — M4A Metadata Extraction (Title, Artist, Cover Art)

### Added
- M4A support alongside the existing MP3/ID3 extraction, both server-side (`worker.js`) and in the admin panel (`gx9k-panel.html`). M4A uses a completely different container format (MP4/QuickTime "atoms/boxes," not ID3v2) — added a hand-rolled box-walker (no npm deps, consistent with the ID3 parser) that reads `moov > udta > meta > ilst` and pulls `©nam` (title), `©ART` (artist), and `covr` (cover art).
- `worker.js`'s auto-cover fallback (used when no cover is uploaded) now tries ID3 first, then M4A — `extractEmbeddedCoverArt()` wraps both so the rest of the upload code doesn't need to know which format a track is.
- Admin panel's auto-fill (title/artist/cover preview on track selection) does the same ID3-then-M4A fallback, so M4A uploads now populate the form exactly like MP3 uploads already did.
- Verified against synthetic M4A files covering both cover-art branches (JPEG and PNG type indicators) — title, artist, and cover bytes all extracted correctly in both the worker and panel copies of the parser.

## v2.19.0 — Web Audio API Removed Entirely (Root Cause of the Playback Regressions)

### Changed
- Removed the Web Audio API from the codebase completely — `AudioContext`, `AnalyserNode`, `createMediaElementSource`, and the "unlock on first tap" listener are all gone. This was the actual root cause behind the whole string of recent playback bugs: rerouting `<audio>` through an `AudioContext` is a one-way, permanent-for-the-session operation, and getting it into a "suspended" state (which happens more easily than expected — a lyrics fetch's `await` breaking the gesture chain, a shared link autoplaying with no on-page tap at all to unlock it, etc.) silently mutes every track afterward while everything else about the page looks and behaves normally.
- The lyrics-panel bar visualizer is now purely time-driven off `audio.currentTime` — the same proven-reliable approach the cover reveal already uses successfully. Trade-off: the bars no longer react to actual frequency content, just a smooth per-bar wave pattern that moves while playing and settles when paused. In exchange, there is now zero code path anywhere that can interfere with audio playback — the `<audio>` element is never touched except to play it.
- Cross-tab pause coordination and the visible shared-link error states from v2.18.2 are unaffected by this change.

## v2.18.3 — Reverted: audio.load() Broke All Playback

### Fixed
- v2.18.2's `audio.load()` additions (speculative hardening for "doesn't always start from the beginning") broke sound entirely — likely an interaction with the Web Audio graph from v2.18.1's `AudioContext`/`MediaElementSourceNode` routing, which is inherently fragile since that routing is permanent for the session once established. Removed all three `.load()` calls; kept the `audio.pause()` before reassigning `.src` at each site, since that part is standard and low-risk. Cross-tab pause coordination and the visible shared-link error states from v2.18.2 are untouched.

## v2.18.2 — Shared-Link Reliability: Cross-Tab Pause, Play Hardening, Visible Failures

### Added
- Cross-tab pause coordination via `BroadcastChannel`: when any tab starts playing, it tells every other open tab of this site to pause. Best-guess fix for reported "old song keeps playing, new title shows up" behavior — a shared link commonly opens in a *new* tab while another tab is already open and playing; nothing previously told the old tab to stop, so both played simultaneously.
- Retry logic for a fresh visitor arriving via a shared link with no local cache: if the initial `albums.json` fetch fails (a first-second mobile-network hiccup right after tapping a link is common), retries once automatically instead of immediately giving up.

### Fixed
- Every failure path in the shared-link flow was silent — a deleted/stale album ID, a missing track, or a total data-load failure all just did nothing with zero indication anything was attempted. This is the confirmed explanation for "nothing played and no graphics at all" on one report (different platform/device than the cross-tab scenario, and not explained by it). Now shows a toast ("This link is no longer valid") or a real error state with a Try Again button, instead of silence.
- Hardened all three play-start entry points (`playTrack`, `playQueueItem`, shared-link autoplay) with explicit `audio.pause()` + `audio.load()` before assigning a new source and calling `.play()` — insurance against a track not always starting from position 0.

## v2.18.1 — Fixed: Silent Playback After a Lyrics-less Track (Web Audio Unlock Timing)

### Fixed
- Confirmed root cause of intermittent "cover builds, no sound" playback: the frequency-bar visualizer's `AudioContext` was being created/resumed from inside `openNowPlaying()`, *after* an `await fetch(...)` for the track's lyrics — a real network request that breaks the synchronous "still connected to a user gesture" chain iOS Safari requires for `AudioContext.resume()` to reliably take effect. Once that resume silently failed, the `<audio>` element stayed permanently routed through a suspended Web Audio graph for the rest of the session — muting every track afterward, lyrics or not — while `audio.currentTime` kept advancing normally, which is exactly why the time-based cover reveal kept building with no sound.
- Fixed properly rather than by dropping real audio-reactivity: added a one-time `pointerdown` listener that builds and resumes the Web Audio graph immediately, synchronously, on the very first tap anywhere on the page — before any lyrics fetch has a chance to run. Once unlocked there, it stays running for the rest of the session regardless of what async work happens per-track. The bars still react to real audio, same as when it was working correctly — this only fixes the timing of when the graph gets unlocked.

### Changed
- Shared-link autoplay-blocked state ("Tap play to start") is now also shown as a pulsing glow on the Now Playing play button, in addition to the existing 1.4s toast — the toast alone was too easy to miss right after landing from a shared link. Clears automatically on first successful play.

## v2.18.0 — Continue Listening, Keyboard Shortcuts, Albums Caching

### Changed
- **Continue listening was already fully built** — a complete `restoreLastPlayed()` function existed to restore the last track into the player bar (paused, ready to resume) and highlight its card, but was deliberately disabled with a comment ("start fresh on every page load") plus a line that wiped the saved state on every load. Removed both — landing on the site now shows your last-played track ready to resume, without auto-entering a lens or auto-playing.
- Added keyboard shortcuts (desktop browsers): Space (play/pause), Left/Right arrows (seek ±10s), Up/Down arrows (volume ±5%), N/P (next/previous track). Ignored while focus is in a form field.
- `GET /api/albums` now supports ETag + conditional requests (`304 Not Modified`) and a 60-second edge cache via Cloudflare's Cache API — previously every visitor triggered a fresh R2 read. `writeAlbums()` now purges that cache immediately on any admin write (new upload, edit, lyrics update, lens change), so admin changes still show up right away instead of waiting out the cache window — same principle as the earlier cover/track cache-busting fix.

## v2.17.1 — Now Playing Backdrop Was Too Transparent

### Fixed
- `.now-playing-overlay`'s open-state background was only 82% opaque black with a 12px blur — enough for the underlying lens grid's bright album art to show through faintly as ghost shapes behind the modal. Bumped to 95% opacity and 24px blur.

## v2.17.0 — Cover Reveal Moved to Actual Cover Art; Bars Restored

### Changed
- The 4-strip boustrophedon cover-reveal effect moved off the lyrics panel and onto the actual album cover art (`#np-cover`) in the Now Playing modal — and now runs for **every** track, lyrics or not, not just lyrics-less ones.
- The `<img id="np-cover">` element stays in the DOM (kept invisible via `opacity:0`) purely so its existing `onload`/`onerror` logic — placeholder fallback, title marquee sizing — keeps working unchanged. A new `<canvas id="np-cover-reveal">` overlays it (`pointer-events:none`, so it never blocks the progress bar/swipe-hint taps layered on the cover) and is the only thing actually visible.
- Frequency-bar visualizer restored for the lyrics panel on lyrics-less tracks — exactly as it was before v2.16.5, Web Audio `AnalyserNode` graph and all.
- Fixed a leak I caught while wiring this up: track changes now call `stopCoverReveal()` before starting a new reveal loop — without it, the previous track's `requestAnimationFrame` loop would keep re-scheduling itself forever, stacking multiple concurrent draw loops.
- Both the cover reveal and the bars stop when the Now Playing modal closes, and both are purely time-based/state-free, so reopening mid-song or switching tracks always shows the correct state with no special-casing.

## v2.16.5 — Cover Reveal Replaces the Frequency Bars

### Changed
- Replaced the frequency-bar visualizer entirely with a 4-strip boustrophedon (typewriter-scan) reveal of the album cover — strip 1 left→right, strip 2 right→left, strip 3 left→right, strip 4 right→left, each strip taking one quarter of the song's runtime.
- Purely time-based off `audio.currentTime / duration`, not audio-reactive — dropped the Web Audio API graph entirely (no `AudioContext`/`AnalyserNode`/`createMediaElementSource`), which also removes any autoplay/audio-context-policy risk that came with it.
- Perfectly synced with zero extra state: pausing freezes the reveal, seeking jumps it forward or back instantly, and reopening the Now Playing modal mid-song shows the correct partial reveal automatically — same "always reflects current time" approach as the wake lock and lyrics sync.
- Cover is cropped-to-fill (not stretched or letterboxed) to match whatever shape the lyrics window is in each responsive layout, since the source art is square but the window usually isn't.
- Heading/subtitle text now sits on a translucent scrim over the building image instead of centered in empty space.
- Verified the reveal-fraction math directly: each strip stays at 0 until its own quarter of the song begins, ramps smoothly across it, then locks at 1 once the next strip starts.

## v2.16.4 — Fixed: Newest-First Cards Were Playing the Wrong Track

### Fixed
- v2.16.3 reversed the card display order but the click handler still built the play queue from the old, unreversed `lensEntries` array while using the new reversed loop index — so the visually-first (newest) card actually queued and played whatever track used to be first (the oldest one), and Next/Prev within a row walked the wrong sequence too. Queue building now uses the same reversed `orderedEntries` array the cards are actually rendered from, so what you click is what plays.

## v2.16.3 — Newest Tracks First (Leftmost) in Lens Sections

### Changed
- Albums are always appended to the end of `albums.json`, and lens sections rendered tracks in that storage order — so the newest upload was always the last card, rightmost, requiring a scroll to find. Reversed the display order per lens section so the newest track is now leftmost. Applies everywhere tracks are grouped by lens: individual lens rooms and every section within Library View.
- New Pulse lens left untouched — it already sorts by album id descending (newest-first) on its own; reversing it too would have flipped it back to oldest-first.

## v2.16.2 — Fixed: Lyrics-less Fallback Rendered Nothing At All

### Fixed
- The v2.16.1 redesign reused the existing `.np-lyrics-fallback-label` div but never added its `id` attribute back — `document.getElementById('np-lyrics-fallback-label')` returned `null`, and setting `.textContent` on that threw, silently aborting the rest of `openNowPlaying()` (including the visualizer start). Net effect: the entire fallback area — heading, subtitle, and bars — rendered as nothing for any track without lyrics. Added the missing `id`; confirmed all four fallback element IDs (`np-lyrics-fallback`, `np-lyrics-fallback-label`, `np-lyrics-fallback-mood`, `np-lyrics-visualizer`) are present exactly once.

## v2.16.1 — Lyrics-less Fallback Redesigned (Cohesive, Calmer)

### Changed
- Replaced the generic "No lyrics available" label + lens mood description with a single crafted moment: heading "A Song Without Words," with a subtitle that alternates randomly per track between "Let the melody say what words couldn't." and "Some things are better felt than said." Lens description dropped — it was redundant clutter next to the new line.
- Visualizer replaced entirely: was a raw oscilloscope waveform (jittery, full-opacity red) — genuinely mismatched for something like the Soft Sleep lens. Now smoothed frequency bars (`smoothingTimeConstant: 0.85`, damped motion), muted opacity, same brand red but far softer, tuned to the lower/mid frequency range where music actually has energy.

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
