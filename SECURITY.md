# Security

This project controls an aircraft over the internet, so security is part of the design, not an add-on. The code is open on purpose: nothing here depends on the source being secret, only on keys and passwords being secret, and none are in this repository.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private reporting instead: the repository's **Security** tab → **Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker could do with it. You'll get an answer as soon as possible.

## What protects the aircraft

The design assumes the link, the browser and the server can all fail or be attacked, and keeps the aircraft safe regardless ([ARCHITECTURE.md](docs/ARCHITECTURE.md), safety model):

- **No manual control over the network, ever.** The agent has a fixed whitelist of commands: arm and disarm (on the ground only), start the mission, pause, resume, RTL, QLAND, and uploading a mission it validates. It never sends `RC_CHANNELS_OVERRIDE`, `MANUAL_CONTROL` or attitude, velocity or position setpoints, whatever it's asked.
- **The flight controller is in charge.** The mission, geofence, battery failsafe and RTL live on ArduPilot. Losing the link, or the companion computer, never changes the flight (ADR-0020).
- **The pilot's radio always wins** (ADR-0008). It's wired straight to the flight controller, not through the companion computer or the network; moving the mode switch takes control at once, and the agent then refuses browser commands.
- **The drone dials out.** The agent holds an outbound connection to the signalling server and has no API port of its own. The only inbound traffic it takes is WebRTC's, for a session that signalling has already set up (and, from Phase 1c, that a signed token has authorised).
- **Every command is logged on the drone** with its result (the flight log), whether or not anyone is watching.

## Status: what isn't built yet

This is a work in progress (see [the status page](docs/status.md)). **Authentication is built** (Phase 1c, ADR-0030) but hasn't faced a deployment yet: it runs locally and in the SITL tests, not yet behind Caddy on a VPS.

| Piece | Today | Planned (Phase 1c / 5) |
| --- | --- | --- |
| Browser login | **Done on the server:** argon2id passwords, `HttpOnly` `SameSite=Strict` session cookies, rate limiting, `Origin` checks. (The public demo still has a cosmetic mock login: it has no server and no vehicle.) | TOTP later |
| Session tokens | **Done:** the server signs a short-lived Ed25519 token for every offer (user, vehicle, session, expiry); the agent checks it with the server's public key (`-server-pubkey`) before answering, and records the user in its flight log. Without the key it refuses every browser, unless started with `-insecure-dev-tokens` (bench only) | Per-drone access and one commander at a time |
| Drone identity | **Done:** each drone has its own Ed25519 key, made on the drone; the server holds only the public half and challenges the drone on every connect | |
| Signalling server | Browsers need a session cookie from the server's own origin; drones prove their key | TLS through Caddy in the deployment |
| Agent ↔ flight controller | Plain MAVLink2 on a UART | MAVLink2 signing (Phase 5) |

**Never run the agent with `-insecure-dev-tokens` outside SITL or a bench**, and keep the server behind TLS (Caddy) when it's reachable from the internet. The public demo at drone.tomwildoer.com is the in-browser mock only: it has no connection to any vehicle.

## Secrets

Never commit drone keys, signing keys, the TURN secret, passwords or APN credentials. They go in `.env` files (gitignored), with a `.env.example` showing the names.
