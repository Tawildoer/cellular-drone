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

## Phase 1: Software against SITL (no hardware). Start here in the CLI.
Build everything so the **drone agent runs on a laptop against SITL**. It becomes the real air unit in Phase 2.

- [ ] `sim/`: ArduPlane SITL in Docker with a QuadPlane frame. MAVLink exposed over TCP/UDP.
- [ ] `agent/` (Go, Pion WebRTC):
  - [ ] MAVLink2 connection (serial or UDP) with a heartbeat and a vehicle-state model
  - [ ] WSS client to signalling with a per-drone key. Auto-reconnect.
  - [ ] Verify the Ed25519 session token before answering an offer
  - [ ] Data channels: `telemetry` (unreliable) and `control` (reliable)
  - [ ] Command whitelist and safety gate (see ARCHITECTURE.md). Mission upload, download and verify state machine.
  - [ ] GCS heartbeat only while a commander session is alive (this drives the FC failsafe)
  - [ ] RC-override awareness: report RC link and mode-switch state; refuse browser mode changes while RC holds a manual mode
  - [ ] Video track: test pattern / file source in SITL mode (via a GStreamer pipeline or Pion's sample writer)
  - [ ] Local command and flight log (JSONL)
- [ ] `server/` (TypeScript, Node 24, Fastify):
  - [ ] Auth: argon2id, session cookies, rate limiting, admin seeded from env
  - [ ] Drone registry (per-drone keys) and session-token minting (Ed25519)
  - [ ] Signalling WebSocket relay between the browser and the drone
  - [ ] Missions CRUD and log upload endpoint
  - [ ] `docker-compose.yml`: server, Caddy, coturn (with time-limited TURN credentials)
- [ ] `web/` (React + Vite + TS, MapLibre, responsive and mobile-first):
  - [ ] Login
  - [ ] Drone page: WebRTC connect with a status badge (direct vs relayed, RTT, bitrate)
  - [ ] Live map: aircraft, heading, trail, home, mission and geofence overlay
  - [ ] HUD: mode, armed state, battery, airspeed, altitude, GPS, link quality, RC link / RC override banner
  - [ ] Video panel
  - [ ] Mission planner: VTOL takeoff → waypoints → VTOL land. Save and load missions.
  - [ ] Pre-flight checklist gate. Commands: arm, start, pause, resume, RTL, QLAND, each with confirmation.
- [ ] Test end to end in SITL: log in from a phone on mobile data → plan → upload → arm → fly → pause/resume → RTL → land.
- [ ] Test forced-TURN mode (`iceTransportPolicy: "relay"`), and kill the agent mid-flight to check the SITL failsafe.

**Exit:** a full autonomous VTOL mission in SITL, run from a phone browser and a laptop browser, through the deployed VPS, with both direct and relayed paths tested.

## Phase 2: Air unit on the bench
- [ ] Radxa Zero 3W: flash a minimal Debian/Armbian. Cross-compile the agent (`GOARCH=arm64`). Run it as a systemd service.
- [ ] Bring up the LTE modem: ModemManager/NetworkManager, APN, reconnect watchdog. Report signal metrics (RSRP, SINR, band) as telemetry.
- [ ] Camera: MIPI CSI or USB. Hardware H.264 through the RK MPP encoder (GStreamer `mpph264enc`) into Pion. Measure latency, bitrate and CPU.
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
- [ ] Set the failsafes: `FS_GCS_ENABL`, `FS_LONG_ACTN`, `Q_RTL_MODE`, geofence, battery
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

**Exit:** a production-ready system that meets your local regulatory requirements.

---

## Suggested first CLI session
> "Read CLAUDE.md and docs/PLAN.md. Start Phase 1: set up `sim/` with ArduPlane QuadPlane SITL in Docker, then scaffold `agent/`, `server/` and `web/`."
