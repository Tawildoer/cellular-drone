# ArduPilot and MAVLink mapping

The browser speaks the app's own vocabulary (`domain/`, `protocol/` v1). The **drone agent** turns it into MAVLink2 for an **ArduPlane QuadPlane** flight controller, and turns MAVLink back into app types. This file is the reference for that translation (ADR-0017).

## Where the translation runs (ADR-0017 addendum)

| | Code | Role |
|---|---|---|
| Agent (Go) | `agent/internal/mission` | **Authoritative.** Produces what is uploaded. Refuses unknown item types. |
| Browser (TS) | `web/src/ardupilot`, via `services/MissionTranslator` | **Preview** in the planner, and `.waypoints` export. |
| Both | `testdata/mission-translation/*.json` | Golden files both test suites run. Change a rule here, in both translators, and in a golden file together. |

After an upload the vehicle returns the FC's readback (`mission.uploaded.onVehicle`). The planner compares it with its preview; the readback is what the aircraft will actually fly.

**Rule:** a mission feature, command or telemetry field is only "done" when its row here says how ArduPlane executes it. If ArduPlane can't do it natively, the row says how we get it (and what happens if the companion computer dies), and the decision goes in `docs/DECISIONS.md`. UI code still never imports MAVLink. This rule shapes the *meaning* of the domain types, not their imports.

Status key: ✅ native · ⚠️ native, but behaves differently from the mock · ❌ no native equivalent · ❓ verify in SITL · 🧪 confirmed in SITL (Plane-4.7.1, `agent/cmd/sitlcheck`, 2026-10-07)

## Mission items (`MissionItem` → `MISSION_ITEM_INT`, mission type `MISSION`)

All mission items use frame `MAV_FRAME_GLOBAL_RELATIVE_ALT` (3), sent in `MISSION_ITEM_INT`: `altM` is metres above home. Home (seq 0) uses `MAV_FRAME_GLOBAL` (0, AMSL). DO commands use `MAV_FRAME_MISSION` (2). 🧪 ArduPlane reads back its own frame for rows without a position (RTL and the loiter marker came back as 0), so readback comparison ignores frames. Seq 0 is reserved for home, so the app's item `i` is never seq `i` (see Index mapping).

| App item | MAVLink command | Params | Status | Notes |
|---|---|---|---|---|
| `vtolTakeoff{altM}` | `MAV_CMD_NAV_VTOL_TAKEOFF` (84) | z = `altM` | ✅ | Climbs vertically at the current position; lat/lon ignored. ArduPlane transitions to fixed-wing when the next item is a fixed-wing nav item. |
| `waypoint{lat,lon,altM,acceptRadiusM?}` | `MAV_CMD_NAV_WAYPOINT` (16) | param2 = accept radius (0 = `WP_RADIUS`; one byte, max 255 m) | ⚠️ | ArduPlane counts it reached on horizontal distance **or** on passing the waypoint. It does not wait for altitude. The mock requires 3D proximity. |
| `loiter{…, turns}` | `MAV_CMD_NAV_LOITER_TURNS` (18) | param1 = turns, param3 = radius (sign = direction), param4 = 1 (xtrack: exit toward the next leg) | ✅ 🧪 | Matches ADR-0013's "peel off along the next leg". 🧪 Reads back unchanged (`[1 0 80 1]`), and flown in SITL. ArduPilot packs turns into one byte (max 255) and the radius into one byte: whole metres up to 255, then tens of metres rounded down, max 2550. ❓ The over-255 m encoding isn't exercised in SITL yet. |
| `loiter{…, untilUtcMinuteOfDay}` | `MAV_CMD_NAV_LOITER_UNLIM` (17) + `MAV_CMD_DO_SEND_SCRIPT_MESSAGE` (217) | loiter: param3 = radius. Marker row after it: param1 = 7301, param2 = end time (minutes after midnight UTC) | ❌ → 🧪 | No time-of-day loiter in ArduPlane. `sim/scripts/loiter_until.lua` on the FC reads the marker, uses GPS time, flies at least one lap, lines up with the next leg and jumps the mission past the marker (ADR-0017). 🧪 Ended at the set minute in SITL. The marker row has no app item, so later rows shift by one. Needs Lua on the FC (H7, not F405). |
| `vtolLand{lat,lon}` | `MAV_CMD_NAV_VTOL_LAND` (85) | lat/lon, z = 0 | ✅ ❓ | Flies there fixed-wing, transitions, descends. Approach behaviour depends on `Q_OPTIONS` / param1; check in SITL. |
| `returnToLaunch` | `MAV_CMD_NAV_RETURN_TO_LAUNCH` (20) | — | ⚠️ | VTOL landing at home via `Q_RTL_MODE`. ArduPlane flies RTL at `RTL_ALTITUDE`; the mock keeps its current altitude. |

Things ArduPlane supports that the app may want later, each needing a domain item first: `DO_CHANGE_SPEED` (per-leg speed), `DO_LAND_START` (landing sequence for RTL), `NAV_LOITER_TO_ALT`, `DO_JUMP`.

### Index mapping
The agent keeps a table from MAVLink seq to app item index for the uploaded mission. Seq 0 is home, and any item the agent inserts (e.g. `DO_CHANGE_SPEED`) has no app index. `MissionProgress.currentIndex` (from `MISSION_CURRENT`) is always reported in **app** indices.

### Mission identity
ArduPilot stores no mission id or name. The agent keeps the last uploaded `Mission` JSON with a checksum of the items it wrote. `mission.download` reads the FC's mission back: if it matches, return the stored `Mission`; if not (someone changed it with Mission Planner, say), return a mission rebuilt from the readback, with a new id and a name that says so.

### Upload
MAVLink mission protocol: `MISSION_COUNT` → `MISSION_REQUEST_INT` / `MISSION_ITEM_INT` per item → `MISSION_ACK`, with retries. Then read it back (`MISSION_REQUEST_LIST`) and compare before replying `mission.uploaded` ok (🧪 `agent/internal/fc/missions.go`). The agent refuses an upload while the aircraft is flying (the mock's rule too), one that fails the structural rules (`mission.Validate`), and one with an `error`-severity translation issue.

## Geofence (`Mission.fence`)

| App | ArduPilot | Status | Notes |
|---|---|---|---|
| `fence.polygon` | Mission type `FENCE`: `MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION` per vertex | ⚠️ | The FC's fence is vehicle-wide and persists across missions; the app attaches it to a mission. The agent uploads it with the mission. |
| `fence.maxAltM` | Param `FENCE_ALT_MAX` | ⚠️ | A parameter write, done by the agent as part of mission upload, not a browser command. The agent also sets `FENCE_TYPE` (4 polygon + 1 altitude) and `FENCE_ENABLE` (on with a fence, off without). These three are the only parameters it writes. |
| (action) | `FENCE_ACTION`, `FENCE_ENABLE` | — | Set once in the vehicle's parameter file, not per mission. |

Validation must check every **leg** and **loiter circle** against the polygon, not just item points, or the FC can trip the fence mid-mission.

## Commands (`Command` → MAVLink)

| App command | MAVLink | Notes |
|---|---|---|
| `arm` / `disarm` | `MAV_CMD_COMPONENT_ARM_DISARM` | Never force-disarm (param2). ArduPilot's own pre-arm checks still apply. 🧪 ArduPlane won't arm in RTL/QRTL/QLAND ("QRTL mode not armable"), and the FC is often in one on the ground: after any RTL landing, and at power-up, because the GCS failsafe fires before a browser connects (the agent heartbeats only with a commander session). So `arm` on the ground first switches such modes to QLOITER. |
| `mission.start` | Set mode AUTO (`MAV_CMD_DO_SET_MODE`) | Armed, on the ground, first item `NAV_VTOL_TAKEOFF`. |
| `mode.pause` | Set mode QLOITER if hovering, else LOITER | |
| `mode.resume` | Set mode AUTO | Continues the current item (`MIS_RESTART` = 0). |
| `mode.rtl` | Set mode RTL | |
| `mode.qland` | Set mode QLAND | |
| `video.config` | none | Agent-local (encoder), not MAVLink. |

Never sent, blocked in the agent: `RC_CHANNELS_OVERRIDE`, `MANUAL_CONTROL`, `SET_POSITION_TARGET_*`, `SET_ATTITUDE_TARGET`, `MAV_CMD_DO_REPOSITION` and parameter writes other than the fence ones above.

## Telemetry (MAVLink → `VehicleState`)

| App field | Source |
|---|---|
| `position` | `GLOBAL_POSITION_INT` (`relative_alt`, `alt`) |
| `attitude` | `ATTITUDE` |
| `groundSpeedMps`, `airspeedMps`, `climbMps` | `VFR_HUD` |
| `battery` | `BATTERY_STATUS` / `SYS_STATUS` |
| `gps` | `GPS_RAW_INT` |
| `flightMode`, `armed` | `HEARTBEAT` (`custom_mode` → app `FlightMode` via the ArduPlane mode table; `base_mode` armed flag) |
| `vtolState`, `landed` | `EXTENDED_SYS_STATE` (`vtol_state`, `landed_state`) |
| `home` | `HOME_POSITION` |
| `missionProgress` | `MISSION_CURRENT` through the index table |
| `rc` | `RC_CHANNELS` (link from `rssi` / channel count; mode-switch position from `FLTMODE_CH`) |
| `failsafe.geofence` | `FENCE_STATUS` |
| `failsafe.battery`, `failsafe.rc` | `BATTERY_STATUS` / `SYS_STATUS` flags and `STATUSTEXT` ❓ |
| `failsafe.gcs` | The agent's own view of the commander session |
| clock (loiter until) | `SYSTEM_TIME` (GPS time) |
| events | `STATUSTEXT` → `status`, mode changes → `modeChanged` |

The agent requests rates with `SET_MESSAGE_INTERVAL` rather than relying on `SRx_*` params.

## Link and failsafe setup

- The agent heartbeats as a GCS (sysid 255) while a commander session is alive, but nothing depends on it: `FS_GCS_ENABL` is 0, so the link never triggers a failsafe (ADR-0020). Pauses are limited by `sim/scripts/pause_resume.lua` instead.
- 🧪 Resume rejoins the planned leg: `pause_resume.lua` calls `vehicle:set_crosstrack_start` with the previous planned waypoint just after AUTO resumes (ArduPlane on its own flies straight from where it is). Measured: back within 2 m of the leg 18 s after a resume, versus still 67 m off after 40 s without it. A browser pause (mode reason `GCS_COMMAND`) left for 120 s resumes by itself; an RC pilot's mode is never touched.
- RC failsafe in AUTO continues the mission (`FS_LONG_ACTN`, `THR_FAILSAFE`), see ADR-0008.
- Run `mavlink-router` on the air unit so Mission Planner or QGC can connect alongside the agent for setup and tuning. A second GCS that writes missions is detected by the mission-identity check.

## Mock vs ArduPlane

`MockLink` / `mock-agent` stand in for ArduPlane, so ETAs, drawn paths and minimum radii in the planner come from mock physics. Where they differ (⚠️ rows), **ArduPlane SITL is the reference**: tune the mock to match SITL, never the reverse. Known differences today:

- Waypoint reached: the mock uses 3D proximity (20 m); ArduPlane uses horizontal distance or passing the waypoint, and starts its turn there. 🧪 With ArduPilot's default `WP_RADIUS` 90 it was "reached" 82 m short, which cut corners visibly. SITL now sets `WP_RADIUS` 30 (`sim/params`), and it's reached at 29 m. The real value is a Phase 3 tuning decision; a per-waypoint `acceptRadiusM` overrides it.
- Resume after a pause: 🧪 ArduPlane flies **straight from wherever it is to the current target**; it does not rejoin the planned leg (`agent/cmd/sitlcheck -resume`: after being pushed 168 m off, it tracked a straight line to the target). With `pause_resume.lua` it instead rejoins the planned leg (ADR-0020), and the mock does the same. The map never follows the aircraft: the dashed path is always the fixed planned route, trimmed by progress along it, so any gap between it and the aircraft is visible (a UI rule, not a flight one).
- RTL altitude: the mock keeps its current altitude; ArduPlane uses `RTL_ALTITUDE`.
- Turn radius: the mock uses a fixed turn rate (20°/s); ArduPlane's depends on bank limit (`ROLL_LIMIT_DEG`) and airspeed.
- Cruise speed: the mock hardcodes 18 m/s; ArduPlane uses `AIRSPEED_CRUISE`. 🧪 SITL's QuadPlane cruises at 25 m/s. At 18 m/s it sits on `Q_ASSIST_SPEED` (18), so VTOL assist keeps cutting in. The real airframe's figure replaces both; until then the mock should move to 25 m/s, which also changes its turn radius and `MIN_LOITER_RADIUS_M`.
- Disarm after landing: 🧪 ArduPlane disarms by itself a few seconds after a VTOL landing (QLAND, QRTL, `NAV_VTOL_LAND`). The operator doesn't have to.
- Landed VTOL state: 🧪 ArduPlane reports `fw` on the ground in a fixed-wing mode (it boots into FBWA from the SITL RC switch position); the mock says `mc`.
