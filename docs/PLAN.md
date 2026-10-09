# Project plan

Status key: `[ ]` todo · `[~]` in progress · `[x]` done

Guiding principle: **build software against the simulator first, then hardware on the bench, and only fly last.** Each phase ends with a demo-able exit criterion. Don't start a flight phase until the previous phase's exit criterion is met.

---

## Phase 0: Requirements, regulations, budget
- [ ] Confirm the country or countries of operation, and record the rules in `docs/OPEN_QUESTIONS.md`. Cover VLOS vs BVLOS, operator ID, remote ID, and whether a SIM may be used airborne under the carrier's terms.
- [ ] Choose the airframe: an off-the-shelf foam VTOL or a DIY QuadPlane conversion. Record it in `docs/DECISIONS.md`.
- [ ] Choose the flight controller (ADR-0002).
- [ ] Finalise `docs/BOM.md` and order parts.
- [ ] Rent the VPS in a region near the flying area.
- [ ] Get a data SIM and check LTE coverage and uplink at the site.

**Exit:** BOM ordered, regulations understood, flying site chosen.

## Phase 1: Software (no hardware). Start here in the CLI.
Order: **frontend first against a mock vehicle**, then the real backend underneath it. See `docs/FRONTEND.md` for the contract that keeps UI work safe from backend changes (ADR-0009).

### 1a: Frontend against MockLink  ← START HERE
- [x] Scaffold `web/`: Vite + React + TS (strict), Tailwind + shadcn/ui, Zustand, zod, MapLibre, Vitest, Playwright, ESLint import-boundary rule
- [x] `domain/` types + pure helpers (mission validation, preflight checklist), with unit tests
- [x] `protocol/` zod message schemas (v1 envelope), with round-trip tests
- [x] `link/VehicleLink` interface + **contract test suite**
- [x] `MockLink`: simulated VTOL flying missions, canvas test-pattern video, fault injection (latency, loss, link drop, RC override, low battery, failsafe). Passes the contract tests.
- [x] `services/`: `AuthClient` (mock) + `MissionRepository` (localStorage)
- [x] UI: login → vehicle list → flight screen (map, HUD, video, link badge, RC override banner, event log)
- [x] UI: mission planner (tap to add, VTOL takeoff/land items, inline validation, save and load)
- [x] Fence validation checks legs and loiter circles, not just item points (ADR-0017, 2026-10-07)
- [x] Planner: ArduPilot mission panel (preview rows, issues, vehicle readback match) and `.waypoints` export (ADR-0017 addendum, 2026-10-07). Removed from the UI 2026-10-08 as clutter; the translator, readback and golden tests stay
- [x] Planner: height profile over terrain with clearance warnings, distance and time estimates at ArduPlane SITL figures (ADR-0021, 2026-10-08)
- [x] Planner: "Follow terrain at X m" sets heights from the terrain and adds waypoints over ridges (ADR-0021 addendum, 2026-10-08). Native ArduPlane terrain following is a later ADR
- [x] UI: preflight checklist gate + command bar with hold-to-confirm (arm, start, RTL, QLAND)
- [x] UI: flight log (each flight's stats, kept in the browser), follow-drone camera (chase 30° or top-down), progress panel only during a mission (2026-10-09)
- [x] UI: operator awareness: mission progress (item, distance, time left), way home, failsafe banners, stale-telemetry warning with the aircraft faded on the map, commands that show pending/accepted and say why they're disabled (2026-10-09)
- [ ] Dev panel for MockLink fault injection
- [ ] Playwright smoke: login → plan → upload → arm → start → pause/resume → RTL
- [ ] Check it on Chrome desktop (laptop, primary target now). Chrome Android / iOS Safari (phone layout) deferred — same components, verify later.

**Exit 1a:** the whole operator workflow is usable end to end against MockLink on phone and laptop.

### 1b: SITL + drone agent
Do this before new planner features (ADR-0017). Mapping reference: `docs/MAVLINK.md`.
- [x] `sim/`: ArduPlane SITL in Docker with a QuadPlane frame. MAVLink exposed over TCP/UDP. (2026-10-07: Plane-4.7.1, ports 5760/5762, `sim/README.md`)
- [ ] `agent/` (Go, Pion WebRTC):
  - [x] MAVLink2 connection (serial or TCP) → map into `protocol/` messages (`VehicleState`, events). Mode mapping → app `FlightMode`. (`internal/fc`, `-fc` flag)
  - [x] Mission translation rules per `docs/MAVLINK.md`, as code: Go `agent/internal/mission` (authoritative) + TS preview `web/src/ardupilot`, both held to `testdata/mission-translation/` (2026-10-07)
  - [x] Wire `mission.Translate` into the agent's `mission.upload`: MAVLink upload with retries, readback into `onVehicle`, seq ↔ app index for `MISSION_CURRENT`, fence upload + `FENCE_ALT_MAX`, stored mission identity (and adopting a mission already on the FC)
  - [x] Decide clock-mode loiter: Lua script on the FC, `sim/scripts/loiter_until.lua`, proven in SITL (ADR-0017)
  - [ ] Fly the same missions in MockLink and SITL; tune the mock to SITL (waypoint reached, RTL altitude, turn radius, cruise speed: SITL cruises at 25 m/s, see docs/MAVLINK.md)
  - [x] Fly a mission from the browser through WebRtcLink → agent → SITL: `web/e2e-sitl` (`npm run e2e:sitl`), flight, RC takeover by the mode switch, and start needing the switch at AUTO. (2026-10-08: all three pass, 5.6 min)
  - [ ] More SITL scenarios: browser closed mid-mission, agent killed mid-flight, mission changed from another ground station
  - [x] Data channels: `telemetry` (unreliable) and `control` (reliable), carrying the **same `protocol/` v1 messages** as MockLink (flown end to end by `web/e2e-sitl`, 2026-10-08)
  - [x] Command whitelist and safety gate. Mission upload, download and verify state machine. (Flown end to end in SITL by `cmd/sitlcheck`; not yet from a browser)
  - [x] GCS heartbeat only while a commander session is alive. Informational since ADR-0020 (`FS_GCS_ENABL 0`): no failsafe depends on it. (Any session with an open control channel counts; one-commander rule still to do)
  - [x] RC-override awareness: report RC link and mode-switch state; refuse browser mode changes while RC holds a manual mode. (2026-10-08: switch position read via `FLTMODE_CH`, reported as `rc.modeSwitch`; off AUTO while armed is an override; start needs RC linked + switch at AUTO. Proven in SITL with `cmd/sitlpilot -switch`. Still open: a LOITER-switch test that a pilot's loiter isn't time-limited, ADR-0020)
  - [ ] Video track: test pattern in SITL mode
  - [x] Local command and flight log (JSONL): `internal/flightlog`, `-flight-log-dir`; sessions, commands, uploads, FC events, state samples (2026-10-08). Upload to the server is Phase 1c
  - [ ] WSS client to signalling with a per-drone key; verify the Ed25519 session token before answering an offer
- [ ] Generate JSON Schema from the zod `protocol/` definitions; Go types generated from it or hand-mirrored with tests

### 1c: Server + real link
- [ ] Move `protocol/` to a shared workspace package (`packages/protocol`)
- [ ] `server/` (TypeScript, Node 24, Fastify):
  - [ ] Auth: argon2id, session cookies, rate limiting, admin seeded from env
  - [ ] Drone registry (per-drone keys) and session-token minting (Ed25519)
  - [ ] Signalling WebSocket relay between the browser and the drone
  - [ ] Missions CRUD and log upload endpoint
  - [ ] `docker-compose.yml`: server, Caddy, coturn (with time-limited TURN credentials)
- [ ] `web/`: `WebRtcLink`, `HttpAuthClient`, `HttpMissionRepository`. All pass the same contract tests. Switch with `VITE_VEHICLE_LINK=webrtc`.
- [ ] Test end to end in SITL: log in from a phone on mobile data → plan → upload → arm → fly → pause/resume → RTL → land.
- [ ] Test forced-TURN mode (`iceTransportPolicy: "relay"`), and kill the agent mid-flight to check the SITL failsafe.

**Exit:** a full autonomous VTOL mission in SITL, run from a phone browser and a laptop browser, through the deployed VPS, with both direct and relayed paths tested. **No UI feature code changed when switching from MockLink to WebRtcLink.**

### Link slice on a Raspberry Pi 5 (pulled forward from 1b/1c, ADR-0014, details in `docs/P2P_TESTING.md`)
- [x] 1. Prove the basics with both ends on home wifi (2026-10-05: Pi agent ↔ Chrome on the same LAN, direct host pair, 720p video, telemetry, RTT 5–13 ms):
  - [x] `server/`: minimal signalling WebSocket relay (no auth yet)
  - [x] `agent/`: Go + Pion on the Pi. WSS to signalling with reconnect; `telemetry` (unordered, `maxRetransmits: 0`) and `control` (reliable) channels; `ping`/`pong` and a stub `telemetry.state` in the `protocol/` v1 envelope; session-token check stubbed but in the code path; ICE state and selected pair logged as JSONL
  - [x] Video: GStreamer `videotestsrc → x264enc` (720p30, 1–2 Mbps) into a Pion track (the Pi 5 has no hardware H.264 encoder)
  - [x] `web/`: `WebRtcLink` implementing `VehicleLink` (browser is the offerer and drives ICE restart); `getStats()` feeds `LinkStatus` path, `rttMs`, `videoKbps`
- [x] 2. Laptop on the phone hotspot; signalling reachable publicly (VPS or tunnel); STUN only. Check IPv6 and the selected pair. (2026-10-05: no path, as the hotspot IPv4 NAT is symmetric, so TURN is needed; see DECISIONS.md, Link test results)
- [ ] 3. **On hold (ADR-0015):** coturn on the VPS with time-limited credentials; forced-relay test (`iceTransportPolicy: "relay"`). Build it if the IPv6 test in step 5 fails, or operators need IPv4-only networks.
- [ ] 4. netns lab on the Pi: own NAT, `tc netem` impairment, scripted outages and IP changes (ICE restart)
- [ ] 5. Pi on a real IPv6-capable SIM and modem (EC25-AU or EG25-G, band 28), configured for IPv4 and IPv6 (`ipv4v6`), agent `-iface wwan0`. **First test:** browser on the phone hotspot, check the selected pair is IPv6 and direct, which proves the carrier allows inbound IPv6 between mobiles (ADR-0015).
- [ ] Record each run's results (path, setup time, recovery time, RTT, bitrate) in `docs/DECISIONS.md`

## Phase 2: Air unit on the bench
- [ ] Orange Pi 5 (ADR-0018): flash a minimal Debian/Armbian. Cross-compile the agent (`GOARCH=arm64`). Run it as a systemd service.
- [ ] Bring up the LTE modem: ModemManager/NetworkManager, APN, reconnect watchdog. Report signal metrics (RSRP, SINR, band) as telemetry.
- [ ] Gimbal camera: forward its Ethernet H.264/H.265 into the Pion track without transcoding. Measure glass-to-glass latency.
- [ ] Aux cameras: hardware H.264 through the RK MPP encoder (GStreamer `mpph264enc`) into Pion; switch the one live stream between gimbal and aux cameras. Measure latency, bitrate and CPU.
- [ ] CV cameras: capture into an RKNN model on the NPU; send results (not video) to the browser. Measure CPU, NPU load and power.
- [ ] UART to the FC (MAVLink2, 921600 baud). `SERIALx_PROTOCOL=2`.
- [ ] Power: a 5 V 3 A BEC, plus a capacitor near the modem for TX peaks. Measure total draw.
- [ ] Measure how often LTE CGNAT forces TURN vs direct. Record it in `docs/DECISIONS.md`.

**Exit:** on the bench, the FC (USB-powered, ArduPlane) shows live video and telemetry in a phone browser over LTE.

## Phase 3: Airframe build and tuning (local RC only)
- [ ] Build: FC, GPS/compass, airspeed sensor, ELRS RC override, air unit. Keep the LTE antennas away from GPS.
- [ ] ArduPilot QuadPlane setup and calibrations
- [ ] QHOVER/QLOITER tuning → FBWA → transitions → AUTOTUNE, under RC
- [ ] Check for interference from the air unit (GPS noise, power sag)

**Exit:** reliable VTOL takeoff, transition and landing under RC.

## Phase 4: Autonomous missions from the browser, VLOS with a safety pilot
- [ ] Set the failsafes: `FS_GCS_ENABL 0` (ADR-0020), `FS_LONG_ACTN`, `Q_RTL_MODE`, geofence, battery. Install `pause_resume.lua` and `loiter_until.lua` on the FC
- [ ] Bench test: pull the modem mid-mission and check the response
- [ ] Configure and test the RC override (ADR-0008): mode-switch takeover mid-mission, hand back to AUTO, and RC loss in AUTO continues the mission
- [ ] Short, low missions started from the browser, with the RC pilot ready to take over
- [ ] Log link quality along the flight path (RTT, signal, direct vs relay)

**Exit:** 10+ successful VLOS autonomous missions run from the browser. Link loss tested in flight.

## Phase 5: Hardening
- [ ] MAVLink2 signing (agent ↔ FC)
- [ ] TOTP 2FA. Roles: viewer vs commander. Audit log UI.
- [ ] Second cellular link: dual-SIM / dual-modem on different carriers
- [ ] Flight log archive and replay. Upload onboard HD recordings.
- [ ] VPS monitoring and alerts
- [ ] Optional: port the agent to an OpenIPC SoC (SSC338Q) to save weight and power (ADR-0006)
- [ ] BVLOS operational case, if you pursue it
- [ ] Obstacle avoidance (ADR-0019), each stage proven in SITL first:
  - [ ] Stage 2 groundwork, possible now: the agent injects synthetic `OBSTACLE_DISTANCE` into SITL; record which QuadPlane modes avoid
  - [ ] Stage 1: aux-camera detection on the NPU, detections and avoidance health shown in the browser (flight unaffected)
  - [ ] Stage 2: real proximity data from the vision pipeline into the FC
  - [ ] Stage 3: escape actions (LOITER/QLOITER, RTL, QLAND) where the FC can't avoid itself, blocked under RC override, can be turned off per mission; later as a Lua script on the FC

**Exit:** a production-ready system that meets your local regulatory requirements.

---

## Suggested first CLI session
> "Read CLAUDE.md, docs/PLAN.md and docs/FRONTEND.md. Start Phase 1a: scaffold `web/` and build the domain types, protocol schemas, VehicleLink interface + contract tests, and MockLink first, before any UI screens."
