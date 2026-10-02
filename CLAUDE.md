# Cellular VTOL drone: project context

A fixed-wing **VTOL (ArduPlane QuadPlane)** that flies **autonomous missions**. It is supervised over **4G/LTE** from a **password-protected Chrome web app**. The comms approach is based on OpenIPC 4G / QuadroFleet (https://openfpv.com.ua/en/software/openipc-4g, https://github.com/beep-systems/quadrofleet-masina).

## Read first
- `docs/PLAN.md`: phased plan and current status. **Update the checkboxes as work completes.**
- `docs/ARCHITECTURE.md`: system design, data paths, safety and security model
- `docs/DECISIONS.md`: ADRs. Add new decisions here; don't silently change direction.
- `docs/OPEN_QUESTIONS.md`, `docs/BOM.md`

## Key facts
- FC firmware: **ArduPilot (ArduPlane, QuadPlane)**. Link protocol: **MAVLink2**. We do **not** use QuadroFleet's CRSF manual-control path.
- Air unit: OpenIPC camera SoC (SSC338Q/SSC30KQ) + Quectel EC25/EP06 + WireGuard client + MAVLink UART↔UDP bridge.
- Chrome can't do WireGuard or raw UDP, so a **VPS relay** (WireGuard server + MAVLink↔WebSocket relay + MediaMTX WebRTC + web app behind Caddy) sits in between. Don't target serverless hosting.
- Safety: the aircraft must be safe with no link. Failsafes, geofence and RTL/QLAND live on the FC. A local ELRS safety pilot stays in place until hardening.

## Repo layout
- `sim/`: ArduPlane SITL (Docker)
- `server/`: relay + API + auth (TypeScript/Node 24), docker-compose, Caddy, MediaMTX config
- `web/`: React + Vite + TS frontend (MapLibre)
- `air/`: OpenIPC overlay: WireGuard templates, modem scripts, MAVLink bridge config/source

## Conventions
- Develop and test everything against SITL before hardware.
- The relay enforces a command whitelist. Arm, takeoff and mode changes need explicit UI confirmation and are audit-logged.
- Never commit secrets (WG keys, passwords, SIM APN creds). Use `.env` (gitignored) plus `.env.example`.
