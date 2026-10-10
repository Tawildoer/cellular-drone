# Cellular VTOL drone: project context

A fixed-wing **VTOL (ArduPlane QuadPlane)** that flies **autonomous missions only**. It is supervised over **4G/LTE** from a **password-protected browser app** that works on any device. Live video goes down. **No manual control goes up.**

## Read first
- `docs/PLAN.md`: phased plan and current status. **Update the checkboxes as work completes.**
- Docs site (MkDocs, `mkdocs.yml`): `docs/status.md` (its progress table is generated from PLAN.md's checkboxes by `docs-hooks/plan_progress.py`) and `docs/progress-log.md`. **When work lands, add a dated entry to the progress log and refresh the status summary in the same change.** Build with `pip install -r requirements-docs.txt && mkdocs serve`; `mkdocs build --strict` must pass.
- `docs/ARCHITECTURE.md`: system design, session flow, command model, safety
- `docs/DECISIONS.md`: ADRs. Add new decisions here; don't silently change direction.
- `docs/FRONTEND.md`: **frontend contract and layering. Required reading before touching `web/`.**
- `docs/MAVLINK.md`: **how every mission item, command and telemetry field maps onto ArduPlane / MAVLink2 (ADR-0017). Required reading before touching missions, commands, `domain/`, `protocol/` or the agent.**
- `docs/OPEN_QUESTIONS.md`, `docs/BOM.md`

## Key facts
- Transport: **WebRTC between the drone agent and the browser**. Peer-to-peer when possible, coturn TURN fallback (cellular CGNAT). Video track is H.264. Data channels: `telemetry` (unreliable) and `control` (reliable).
- VPS = auth + signalling + STUN/TURN + web hosting + mission and log storage. It does **not** proxy MAVLink or video in application code.
- Air unit: **Orange Pi 5 (RK3588S)** running `agent/` (Go + Pion), USB LTE modem (Quectel), UART MAVLink2 to the FC (ADR-0018, replaces the Radxa Zero 3W). Cameras: a 2-axis **gimbal camera** (the one live stream by default), plus **aux cameras** the operator can cycle the stream to, plus **CV cameras** that stay onboard (results only go to the browser). Only one video stream crosses the cellular link at a time.
- FC: ArduPilot ArduPlane QuadPlane. Failsafes, geofence and RTL/QLAND live on the FC. A **local ELRS radio can always override** (permanent feature, ADR-0008): flipping the RC mode switch takes control at any point, and losing RC range must NOT abort an autonomous mission.
- The **drone agent enforces the command whitelist** and verifies the server-signed (Ed25519) session tokens. Never pass manual control over the cellular link (no MAVLink `RC_CHANNELS_OVERRIDE`, `MANUAL_CONTROL`, or attitude/velocity setpoints from the browser). The physical ELRS radio is the only manual path.
- QuadroFleet / OpenIPC 4G was the original inspiration and is no longer a dependency (ADR-0005). An OpenIPC port of the agent is a possible later optimisation.

## Repo layout
- `sim/`: ArduPlane SITL (Docker)
- `agent/`: drone agent (Go). Runs on a laptop against SITL, or on the Orange Pi 5 (Pi 5 stand-in for link work, ADR-0014).
- `mock-agent/`: dev-only standalone Node process standing in for `agent/` (ADR-0012) — runs the same simulated-VTOL engine as `MockLink`, behind a WebSocket, so the drone's state survives browser reloads. Not the real agent.
- `server/`: auth + signalling + API (TypeScript/Node 24), docker-compose, Caddy, coturn
- `web/`: React + Vite + TS frontend (MapLibre), laptop-primary for now (operator's base station); phone layout deferred, same components. Stays first-class: phones and any browser use it.
- `desktop/`: the Mac app (ADR-0027), an Electron shell running the same web build, updated over the air from `app-manifest.json` published by `npm run deploy`. Only shell changes need a new `.dmg`.

## Conventions
- **Don't run verification (`npm run build`/`lint`/`test`, Playwright/live-browser checks) after a change without the user's confirmation first.** Ask before running it, don't just run it automatically.
- **Frontend is built first against `MockLink` (ADR-0009).** UI code (`features/`, `state/`) depends only on `domain/` types and the `VehicleLink` / `AuthClient` / `MissionRepository` interfaces. It never imports a concrete link, WebRTC, MAVLink or server details. Only `app/` wires up implementations. Every link implementation must pass the shared contract tests.
- `protocol/` (zod, versioned envelope) is the single wire contract between the web app, the server and the agent. Change it deliberately and bump `v` on breaking changes.
- Develop and test everything against SITL before hardware.
- **ArduPilot and MAVLink are the reference for mission planning (ADR-0017).** Before adding or changing a mission item, command, telemetry field or planner behaviour, check `docs/MAVLINK.md` and add or update its row: which ArduPlane command or mode does it, or how we get it if there's none, and what happens if the companion computer dies. Don't build mission features ArduPlane can't fly on its own without an ADR. Where `MockLink` and ArduPlane SITL disagree, SITL is right; fix the mock.
- Arm, start and mode changes need explicit UI confirmation and are audit-logged on the drone.
- Never commit secrets (drone keys, signing keys, TURN secret, passwords, APN creds). Use `.env` (gitignored) plus `.env.example`.
