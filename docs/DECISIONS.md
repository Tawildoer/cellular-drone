# Decision log

Short ADR-style entries. Add new ones at the bottom. Supersede old entries instead of editing them.

## ADR-0001: Autonomous-first, ArduPilot + MAVLink (2026-10-02, accepted)
**Context:** The cellular link has variable latency of 50–500+ ms, plus dropouts. QuadroFleet targets manual FPV with CRSF.
**Decision:** The aircraft flies **autonomous missions only** on ArduPlane (QuadPlane VTOL). The link is used for supervision and tasking, and carries MAVLink2. QuadroFleet's CRSF control path is not used. We reuse its OpenIPC + modem + WireGuard + video approach.
**Consequences:** We need a MAVLink UART↔UDP bridge on the camera SoC. Safety depends on on-board failsafes, not on the link.

## ADR-0002: Flight controller (2026-10-02, open)
SpeedyBee F405 WING is cheap, and you already have bootloader files for it. However, ArduPilot on 1 MB-flash F4 boards drops some features (scripting, some advanced functions).
**Leaning:** prototype on the F405 WING if you already own one. For the real aircraft, plan an H743-class wing FC (for example Matek H743-WING). Confirm by checking the ArduPilot feature list for the chosen board.

## ADR-0003: Browser access through a cloud relay (2026-10-02, accepted)
**Context:** Chrome can't join WireGuard or open raw UDP sockets.
**Decision:** A VPS runs a WireGuard server, a relay (MAVLink↔WebSocket), MediaMTX (RTP→WebRTC) and the web app behind Caddy (HTTPS).
**Consequences:** The VPS is a single point of failure, which the on-board failsafes mitigate. Not hosted on serverless platforms.

## ADR-0004: Tech stack (2026-10-02, proposed)
- Relay and API: TypeScript on Node 24. Fastify plus `ws`. `node-mavlink` for MAVLink2.
- Web: React + Vite + TypeScript, MapLibre GL, TanStack Query.
- DB: SQLite (via Drizzle) to start; Postgres later if multi-user.
- Video: MediaMTX (WHEP to the browser).
- Deploy: Docker Compose on the VPS. Caddy for TLS.
- Sim: ArduPilot SITL (ArduPlane, `-f quadplane`) in Docker.

## ADR-0005: Video codec (open, decide in Phase 2)
H.264 decodes in every Chrome. H.265 halves the bitrate but WebRTC H.265 depends on the hardware. Measure both.
