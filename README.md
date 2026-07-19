# Generify Presents: Emotional Lenses

Version: 2.8.6

Emotional Lenses transforms music discovery from genre-first browsing into emotionally guided exploration.

## Philosophy

Every song begins as:
- a memory
- a feeling
- a moment
- an atmosphere

The listener enters through emotional space first.

## Current Lens Structure

- New Pulse (computed — always the 3 most recently added albums)
- Bittersweet
- Campfire
- A Night Out
- Healing
- Dreamscape
- Late Night
- Funny Bone
- Soft Sleep
- Reflection
- Human Connections
- Rainy Window
- Road Trip
- Quiet House

## Asset Structure

assets/
└── lenses/
    └── <lens-name>/
        └── hero.webp

## Deployment

Cloudflare Workers + static assets served from project root. Deploy pipeline: ZipToGit → GitHub → Cloudflare auto-deploy.

## Version

v2.8.6 — Admin API auth hardening + XSS fix on OG tags. See `generify-music-handoff.md` for full session history and `my-music-player/README.md` for the current architecture reference.
