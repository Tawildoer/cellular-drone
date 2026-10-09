# Status

*Last updated 2026-10-10.* The table below is counted from [the plan](PLAN.md)'s checkboxes every time the site builds, so it's always current. The rest of the page is a written summary: update it with the [progress log](progress-log.md).

## Progress by phase

<!-- plan-progress -->

`█` done · `▒` in progress · `░` to do

## Where things stand

The software is ahead of the hardware, as planned. **Phase 1 runs end to end against the real flight-control firmware:** the browser plans a mission, uploads it through WebRTC to the Go agent, the agent writes it to ArduPlane SITL, and the browser arms, starts, pauses, resumes, RTLs and lands it. Three SITL tests prove that on every run. **No hardware has been bought yet** (Phase 0).

### Done

<span class="chip done">done</span> **Operator console** (1a): login, vehicle list, flight screen with 3D map, HUD, video, link quality, event log, RC override banner; mission planner with waypoints, loiters (laps or until a time of day), VTOL land or RTL ending, inline validation including the fence; preflight checklist gating arm; hold-to-confirm commands. Laptop layout.

<span class="chip done">done</span> **Operator awareness**: flight progress with time left and the way home, failsafe and stale-telemetry banners, command feedback with reasons for disabled buttons.

<span class="chip done">done</span> **Gimbal, free fly, battery and weather** (in the console and the mock; the agent is next): gimbal line of sight and click-to-lock, free fly from the map, the drone returning home on its battery estimate with warnings before it, wind and rain on the map with wind-aware estimates (ADR-0023 to ADR-0026).

<span class="chip done">done</span> **Mission planning tools**: height profile over real terrain with clearance warnings, distance and time at ArduPlane's figures, and *Follow terrain at X m* (ADR-0021).

<span class="chip done">done</span> **In-browser mock drone and `mock-agent`**: the whole UI was built against it; it now also reports simulated LTE conditions. Public demo on Cloudflare.

<span class="chip done">done</span> **ArduPlane SITL** (Plane 4.7.1 QuadPlane) in Docker, with the project's failsafe params and two FC Lua scripts: clock-mode loiters (`loiter_until.lua`) and pauses that can't strand the aircraft and rejoin the planned leg (`pause_resume.lua`).

<span class="chip done">done</span> **Go agent against SITL**: MAVLink2 link, mode mapping, command whitelist, mission and fence upload with readback, RC override from the mode switch itself, start only with the switch at AUTO, and a fsynced flight log of every command, upload, FC event and state sample.

<span class="chip done">done</span> **WebRTC link**: Go + Pion agent on a Raspberry Pi 5 stand-in, signalling relay, `WebRtcLink`; proven on a LAN (5–13 ms RTT, 720p). From a phone hotspot there's no direct IPv4 path (symmetric carrier NAT), so IPv6 end to end is the intended direct path and TURN is on hold (ADR-0015).

### Next up

<span class="chip next">next</span> **Finish 1b**
:   Tune the mock to SITL (25 m/s cruise, waypoint-reached and RTL-altitude behaviour). More SITL scenarios: browser closed mid-mission, agent killed mid-flight, mission changed from another ground station. The slow check that a pilot's LOITER isn't time-limited (ADR-0020). Video test pattern in SITL mode. Go protocol types held to the zod schemas by tests.

<span class="chip next">next</span> **Phase 1c: the real server**
:   Today the server is only a signalling relay. Still to build: argon2id login, drone registry and Ed25519 session tokens (so the agent's token check stops being a stub), the agent's per-drone key, mission storage and flight-log upload, deploying to the VPS. That unlocks the Phase 1 exit test: a phone on mobile data, through the VPS, flying SITL.

<span class="chip next">next</span> **1a loose ends**
:   A dev panel for the mock's fault injection, a Playwright smoke test against the mock, and a deliberate Chrome laptop check. Phone layout stays deferred.

### Waiting on hardware or decisions

<span class="chip wait">waiting</span> **Phase 0 decisions**: country rules, airframe, flight controller (it must be an H7 class board for the Lua scripts, ADR-0002), BOM, VPS, data SIM. See [open questions](OPEN_QUESTIONS.md).

<span class="chip wait">waiting</span> **Real-SIM link test**: the Pi on an IPv6-capable SIM and modem, checking the carrier allows inbound IPv6 between mobiles: the key test for ADR-0015.

<span class="chip wait">waiting</span> **Phases 2–5**: air unit on the bench (Orange Pi 5, modem, cameras, UART to the FC), airframe build and tuning under RC, VLOS missions from the browser with a safety pilot, then hardening.

## Known gaps

- **Planner estimates use SITL's figures**, not the real airframe's; battery estimates use a placeholder endurance (2000 s) until Phase 3 data exists.
- **Gimbal lock, free fly and the battery return run in the mock only**: the agent rejects their commands, and the battery-return Lua script is still to write and prove in SITL.
- **Follow terrain is done by the planner**, between waypoints only; ArduPlane's own terrain following (which also covers RTL) is a later ADR.
- **The mock still flies differently from ArduPlane** in places (cruise speed, waypoint radius, RTL altitude): listed in [the MAVLink mapping](MAVLINK.md#mock-vs-arduplane).
- **No authentication yet** (Phase 1c): the agent refuses every browser unless started with `-insecure-dev-tokens`, for SITL and the bench only. Sessions are identified by id, not user. See `SECURITY.md` in the repository root.
