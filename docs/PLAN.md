# Project plan

Status key: `[ ]` todo · `[~]` in progress · `[x]` done

Guiding principle: **build software against the simulator first, then hardware on the bench, and only fly last.** Each phase ends with a demo-able exit criterion. Don't start a flight phase until the previous phase's exit criterion is met.

---

## Phase 0: Requirements, regulations, budget
- [ ] Confirm the country or countries of operation, and record the rules in `docs/OPEN_QUESTIONS.md`. Cover open/specific category, VLOS vs BVLOS, operator ID, remote ID, and whether a SIM may be used airborne under the carrier's terms.
- [ ] Choose the airframe. Options: an off-the-shelf foam VTOL (for example a Heewing T2/T1 VTOL or a MakeFlyEasy-class VTOL) or a DIY QuadPlane conversion. Record the choice in `docs/DECISIONS.md`.
- [ ] Choose the flight controller. See ADR-0002 for the SpeedyBee F405 WING vs H743 question.
- [ ] Finalise `docs/BOM.md` and the budget.
- [ ] Rent the VPS and pick a region near the flying area.
- [ ] Get a data SIM. Check coverage and upload speed at the flying site, at altitude if possible, using a phone on a pole or a kite as a rough test.

**Exit:** BOM ordered, regulations understood, flying site chosen.

## Phase 1: Software against SITL (no hardware needed). Start here in the CLI.
- [ ] `sim/`: Docker setup for **ArduPlane SITL** with a QuadPlane frame (`-f quadplane`) that emits MAVLink on UDP.
- [ ] `server/` relay (TypeScript, Node 24):
  - [ ] MAVLink2 UDP endpoint (for example the `node-mavlink` lib), with a heartbeat and link-quality tracker
  - [ ] WebSocket API: telemetry stream, command channel with a whitelist, mission upload and download state machine
  - [ ] Structured flight log (tlog plus JSON events)
- [ ] `server/` auth:
  - [ ] Single-tenant user table with argon2id hashing and session cookies
  - [ ] Login rate limiting
  - [ ] Seed admin user from an env var
- [ ] `web/` (React + Vite + TypeScript, MapLibre GL or Leaflet):
  - [ ] Login page
  - [ ] Live map with aircraft position, heading, home and trail
  - [ ] Telemetry HUD: mode, armed state, battery, airspeed, altitude, GPS, link RTT
  - [ ] Mission planner: VTOL takeoff → waypoints → VTOL land; altitude per waypoint; save and load missions
  - [ ] Pre-flight checklist gate before Arm and Start mission
  - [ ] Commands: Arm, Auto, RTL, QLAND, Pause (loiter). Each one asks for confirmation.
- [ ] `server/docker-compose.yml`: relay, web, Caddy, MediaMTX (video placeholder: a test pattern stream)
- [ ] Test the end-to-end loop in SITL: log in → plan → upload → fly → RTL → land.

**Exit:** a full autonomous VTOL mission flown in SITL from Chrome, through the deployed VPS stack.

## Phase 2: Air unit on the bench (OpenIPC 4G)
- [ ] Get an SSC338Q (preferred) or SSC30KQ OpenIPC camera board and a Quectel EC25 or EP06 modem.
- [ ] Build or flash OpenIPC firmware with modem plus WireGuard support. Use the QuadroFleet firmware guide and `beep-systems/quadrofleet-masina` as a reference.
- [ ] Bring up the modem: APN, auto-reconnect watchdog, and signal logging (RSSI, RSRP, SINR) sent back as a custom telemetry stream.
- [ ] WireGuard client → VPS. Check that keepalive copes with CGNAT.
- [ ] **MAVLink bridge** on the camera: UART ↔ UDP over WG. Evaluate OpenIPC `mavfwd` or a small custom C bridge. This replaces QuadroFleet's CRSF path.
- [ ] Video: majestic → RTP → MediaMTX → WebRTC in Chrome. Measure glass-to-glass latency and bitrate for H.264 vs H.265. Pick one (ADR).
- [ ] Power: a 5 V BEC sized for modem TX peaks (about 2 A), with a capacitor near the modem.

**Exit:** on the bench, a USB-powered FC with ArduPlane shows live telemetry and video in Chrome over LTE.

## Phase 3: Airframe build and conventional tuning (local RC only)
- [ ] Build the airframe. Install the FC, GPS/compass, airspeed sensor, ELRS receiver and the air unit. Keep the modem antenna away from GPS.
- [ ] Do the ArduPilot QuadPlane setup: frame class/type, motor order, `Q_ENABLE`, servo outputs, calibrations.
- [ ] Do manual and assisted flights over **local RC**: QHOVER/QLOITER tuning, then FBWA, then transitions, then AUTOTUNE.
- [ ] Confirm the air unit doesn't interfere (RF noise on GPS, power sag).

**Exit:** reliable VTOL takeoff, transition and landing under RC, with a tuned aircraft.

## Phase 4: Cellular supervision, VLOS with a safety pilot
- [ ] Set the failsafes: `FS_GCS_ENABL`, long and short timeouts and actions, `Q_RTL_MODE`, geofence, battery failsafe.
- [ ] Ground test: pull the modem mid-mission (in SITL first, then on the bench) and check the behaviour.
- [ ] Flights: start an AUTO mission from Chrome, with the RC pilot ready to take over. Start with short, low missions.
- [ ] Record link stats along the flight path, such as latency and signal against altitude. Build a coverage picture.

**Exit:** 10+ successful VLOS autonomous missions started and monitored from Chrome. Link loss tested in flight.

## Phase 5: Hardening
- [ ] Turn on MAVLink2 signing between the relay and the FC.
- [ ] Add TOTP 2FA, audit log UI and roles (viewer vs pilot).
- [ ] Add a second connectivity path (dual SIM on different carriers, or ELRS kept as a parallel link).
- [ ] Add a flight log archive with replay in the web app.
- [ ] Add monitoring and alerts for the VPS, plus an auto-restart and recovery plan.
- [ ] Prepare the BVLOS operational case, if you pursue it (ops manual, risk assessment such as SORA in the EU/UK).

**Exit:** production-ready system that meets your local regulatory requirements.

---

## Suggested first CLI session
> "Read CLAUDE.md and docs/PLAN.md. Start Phase 1: set up `sim/` with ArduPlane QuadPlane SITL in Docker, then scaffold `server/` (relay + auth) and `web/`."
