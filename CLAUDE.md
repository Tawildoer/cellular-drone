# Cellular VTOL drone: project context

A fixed-wing **VTOL (ArduPlane QuadPlane)** that flies **autonomous missions only**. It is supervised over **4G/LTE** from a **password-protected browser app** that works on any device. Live video goes down. **No manual control goes up.**

## Read first
- `docs/PLAN.md`: phased plan and current status. **Update the checkboxes as work completes.**
- `docs/ARCHITECTURE.md`: system design, session flow, command model, safety
- `docs/DECISIONS.md`: ADRs. Add new decisions here; don't silently change direction.
- `docs/FRONTEND.md`: **frontend contract and layering. Required reading before touching `web/`.**
- `docs/OPEN_QUESTIONS.md`, `docs/BOM.md`

## Key facts
- Transport: **WebRTC between the drone agent and the browser**. Peer-to-peer when possible, coturn TURN fallback (cellular CGNAT). Video track is H.264. Data channels: `telemetry` (unreliable) and `control` (reliable).
- VPS = auth + signalling + STUN/TURN + web hosting + mission and log storage. It does **not** proxy MAVLink or video in application code.
- Air unit: **Radxa Zero 3W** running `agent/` (Go + Pion), USB LTE modem (Quectel), MIPI or USB camera, UART MAVLink2 to the FC.
- FC: ArduPilot ArduPlane QuadPlane. Failsafes, geofence and RTL/QLAND live on the FC. A **local ELRS radio can always override** (permanent feature, ADR-0008): flipping the RC mode switch takes control at any point, and losing RC range must NOT abort an autonomous mission.
- The **drone agent enforces the command whitelist** and verifies the server-signed (Ed25519) session tokens. Never pass manual control over the cellular link (no MAVLink `RC_CHANNELS_OVERRIDE`, `MANUAL_CONTROL`, or attitude/velocity setpoints from the browser). The physical ELRS radio is the only manual path.
- QuadroFleet / OpenIPC 4G was the original inspiration and is no longer a dependency (ADR-0005). An OpenIPC port of the agent is a possible later optimisation.

## Repo layout
- `sim/`: ArduPlane SITL (Docker)
- `agent/`: drone agent (Go). Runs on a laptop against SITL, or on the Radxa.
- `mock-agent/`: dev-only standalone Node process standing in for `agent/` (ADR-0012) — runs the same simulated-VTOL engine as `MockLink`, behind a WebSocket, so the drone's state survives browser reloads. Not the real agent.
- `server/`: auth + signalling + API (TypeScript/Node 24), docker-compose, Caddy, coturn
- `web/`: React + Vite + TS frontend (MapLibre), laptop-primary for now (operator's base station); phone layout deferred, same components

## Conventions
- **Don't run verification (`npm run build`/`lint`/`test`, Playwright/live-browser checks) after a change without the user's confirmation first.** Ask before running it, don't just run it automatically.
- **Frontend is built first against `MockLink` (ADR-0009).** UI code (`features/`, `state/`) depends only on `domain/` types and the `VehicleLink` / `AuthClient` / `MissionRepository` interfaces. It never imports a concrete link, WebRTC, MAVLink or server details. Only `app/` wires up implementations. Every link implementation must pass the shared contract tests.
- `protocol/` (zod, versioned envelope) is the single wire contract between the web app, the server and the agent. Change it deliberately and bump `v` on breaking changes.
- Develop and test everything against SITL before hardware.
- Arm, start and mode changes need explicit UI confirmation and are audit-logged on the drone.
- Never commit secrets (drone keys, signing keys, TURN secret, passwords, APN creds). Use `.env` (gitignored) plus `.env.example`.
