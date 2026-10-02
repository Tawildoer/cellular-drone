# Decision log

Short ADR-style entries. Add new ones at the bottom. Supersede old entries instead of editing them.

## ADR-0001: Autonomous only, ArduPilot + MAVLink (2026-10-02, accepted; amended same day)
**Decision:** The aircraft flies **autonomous missions only** on ArduPlane (QuadPlane VTOL). **No manual control is sent to it**: no RC override, no stick or gamepad input. The browser sends only mission tasking and high-level commands (arm, start, pause, RTL, QLAND). A live video downlink is wanted, but latency isn't the top priority.
**Consequences:** Safety depends on on-board failsafes, not the link.

## ADR-0002: Flight controller (2026-10-02, open)
SpeedyBee F405 WING is cheap, and you already have bootloader files for it. However, ArduPilot on 1 MB-flash F4 boards drops some features (for example Lua scripting).
**Leaning:** prototype on the F405 WING if you already own one. For the real aircraft, use an H743-class wing FC (for example Matek H743-WING). Confirm against the ArduPilot feature list for the board.

## ADR-0003: Browser access through a cloud relay with WireGuard (2026-10-02, SUPERSEDED by ADR-0005)

## ADR-0004: Tech stack (2026-10-02, accepted)
- Drone agent: **Go + Pion WebRTC** (single static binary, cross-compiles to arm64/armv7), gomavlib for MAVLink2, GStreamer (RK MPP) for H.264 on the Radxa.
- Signalling and API: TypeScript on Node 24, Fastify + `ws`, SQLite via Drizzle.
- Web: React + Vite + TypeScript, MapLibre GL. Responsive, works on mobile Safari and Chrome.
- TURN: coturn with time-limited (REST API) credentials.
- Deploy: Docker Compose on a VPS behind Caddy.
- Sim: ArduPilot SITL (ArduPlane, `-f quadplane`) in Docker.

## ADR-0005: WebRTC between drone and browser, TURN fallback (2026-10-02, accepted)
**Context:** We want lower latency, peer-to-peer where possible, and a browser app that works on any device. QuadroFleet (WireGuard + raw UDP + native app) needs a translating server for browsers.
**Decision:** The drone runs a WebRTC peer. Video is a media track (H.264). Telemetry uses an unreliable data channel; commands use a reliable one. The VPS does auth, signalling and STUN/TURN only. The drone checks a server-signed session token before accepting a peer. The command whitelist is enforced **on the drone**.
**Consequences:** Cellular CGNAT will often force TURN, which costs a small latency hit from a nearby VPS. Each viewer uses drone uplink, so cap viewers (SFU later if needed). QuadroFleet is no longer a dependency; we keep only its hardware references.

## ADR-0006: Air unit = Radxa Zero 3W companion (2026-10-02, accepted)
**Context:** WebRTC on an OpenIPC SigmaStar SoC would mean porting a WebRTC stack into buildroot, and Majestic's WebRTC support on SigmaStar is unclear. A Linux SBC runs Pion and GStreamer as-is.
**Decision:** Prototype on a **Radxa Zero 3W** (RK3566, hardware H.264/H.265 encode, ~10 g) with a USB LTE modem and a MIPI or USB camera. Keep the agent portable Go so an OpenIPC port stays possible.
**Alternatives:** Pi Zero 2W (weaker CPU, H.264 only). Pi 4/CM4 (heavier). OpenIPC SSC338Q (lightest, but more embedded work). Revisit in Phase 5.

## ADR-0007: Video codec (2026-10-02, accepted provisionally)
**Decision:** H.264. It's universal across browsers on all devices. Revisit H.265 only if uplink bandwidth turns out to be the bottleneck.

## ADR-0008: Permanent local RC override (2026-10-02, accepted)
**Decision:** An ELRS receiver wired directly to the FC is a **permanent** part of the system, not a development-only tool. The RC pilot can take control at any time by changing the mode switch, and RC always has authority over browser commands. Losing RC range during AUTO **continues the mission**. Cellular loss is handled by the GCS failsafe. The agent reports RC state and refuses browser mode changes while RC holds a manual mode.
**Consequences:** "No manual control" (ADR-0001) applies only to the cellular/browser path. The ArduPilot RC and GCS failsafe parameters must be designed together and tested in SITL (an RC-loss simulation) before flight.

## ADR-0009: Frontend first, behind a transport-agnostic contract (2026-10-02, accepted)
**Context:** The user wants to start with the UI. The backend architecture (WebRTC P2P vs relay, agent implementation) could still change.
**Decision:** Build `web/` first against an in-browser `MockLink` simulator. The UI depends only on the app-owned `domain/` types, the versioned `protocol/` messages (zod) and the `VehicleLink` / `AuthClient` / `MissionRepository` interfaces. A shared contract test suite defines correct link behaviour. The full design is in `docs/FRONTEND.md`.
**Consequences:** Swapping the backend means writing one new `VehicleLink` implementation that passes the contract tests, with no UI changes. The agent must emit the same `protocol/` messages, so the domain vocabulary (not MAVLink) is the source of truth for the UI.
