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

Status key: ✅ native · ⚠️ native, but behaves differently from the mock · ❌ no native equivalent · ❓ verify in SITL

## Mission items (`MissionItem` → `MISSION_ITEM_INT`, mission type `MISSION`)

All mission items use frame `MAV_FRAME_GLOBAL_RELATIVE_ALT` (3), sent in `MISSION_ITEM_INT`: `altM` is metres above home. Home (seq 0) uses `MAV_FRAME_GLOBAL` (0, AMSL). Seq 0 is reserved for home, so the app's item `i` is never seq `i` (see Index mapping).

| App item | MAVLink command | Params | Status | Notes |
|---|---|---|---|---|
| `vtolTakeoff{altM}` | `MAV_CMD_NAV_VTOL_TAKEOFF` (84) | z = `altM` | ✅ | Climbs vertically at the current position; lat/lon ignored. ArduPlane transitions to fixed-wing when the next item is a fixed-wing nav item. |
| `waypoint{lat,lon,altM,acceptRadiusM?}` | `MAV_CMD_NAV_WAYPOINT` (16) | param2 = accept radius (0 = `WP_RADIUS`; one byte, max 255 m) | ⚠️ | ArduPlane counts it reached on horizontal distance **or** on passing the waypoint. It does not wait for altitude. The mock requires 3D proximity. |
| `loiter{…, turns}` | `MAV_CMD_NAV_LOITER_TURNS` (18) | param1 = turns, param3 = radius (sign = direction), param4 = 1 (xtrack: exit toward the next leg) | ✅ ❓ | Matches ADR-0013's "peel off along the next leg". ArduPilot packs turns into one byte (max 255) and the radius into one byte: whole metres up to 255, then tens of metres rounded down, max 2550. Confirm the exit behaviour and the encoding in SITL. |
| `loiter{…, untilUtcMinuteOfDay}` | `MAV_CMD_NAV_LOITER_UNLIM` (17), for now | param3 = radius | ❌ | No time-of-day loiter in ArduPlane. Sent as an unlimited loiter that something else must end; open decision, see ADR-0017. |
| `vtolLand{lat,lon}` | `MAV_CMD_NAV_VTOL_LAND` (85) | lat/lon, z = 0 | ✅ ❓ | Flies there fixed-wing, transitions, descends. Approach behaviour depends on `Q_OPTIONS` / param1; check in SITL. |
| `returnToLaunch` | `MAV_CMD_NAV_RETURN_TO_LAUNCH` (20) | — | ⚠️ | VTOL landing at home via `Q_RTL_MODE`. ArduPlane flies RTL at `RTL_ALTITUDE`; the mock keeps its current altitude. |

Things ArduPlane supports that the app may want later, each needing a domain item first: `DO_CHANGE_SPEED` (per-leg speed), `DO_LAND_START` (landing sequence for RTL), `NAV_LOITER_TO_ALT`, `DO_JUMP`.

### Index mapping
The agent keeps a table from MAVLink seq to app item index for the uploaded mission. Seq 0 is home, and any item the agent inserts (e.g. `DO_CHANGE_SPEED`) has no app index. `MissionProgress.currentIndex` (from `MISSION_CURRENT`) is always reported in **app** indices.

### Mission identity
ArduPilot stores no mission id or name. The agent keeps the last uploaded `Mission` JSON with a checksum of the items it wrote. `mission.download` reads the FC's mission back: if it matches, return the stored `Mission`; if not (someone changed it with Mission Planner, say), return a mission rebuilt from the readback, with a new id and a name that says so.

### Upload
MAVLink mission protocol: `MISSION_COUNT` → `MISSION_REQUEST_INT` / `MISSION_ITEM_INT` per item → `MISSION_ACK`, with retries. Then read it back (`MISSION_REQUEST_LIST`) and compare before replying `mission.uploaded` ok. Refuse an upload while armed in AUTO unless that's decided otherwise.

## Geofence (`Mission.fence`)

| App | ArduPilot | Status | Notes |
|---|---|---|---|
| `fence.polygon` | Mission type `FENCE`: `MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION` per vertex | ⚠️ | The FC's fence is vehicle-wide and persists across missions; the app attaches it to a mission. The agent uploads it with the mission. |
| `fence.maxAltM` | Param `FENCE_ALT_MAX` | ⚠️ | A parameter write, done by the agent as part of mission upload, not a browser command. |
| (action) | `FENCE_ACTION`, `FENCE_ENABLE` | — | Set once in the vehicle's parameter file, not per mission. |

Validation must check every **leg** and **loiter circle** against the polygon, not just item points, or the FC can trip the fence mid-mission.

## Commands (`Command` → MAVLink)

| App command | MAVLink | Notes |
|---|---|---|
| `arm` / `disarm` | `MAV_CMD_COMPONENT_ARM_DISARM` | Never force-disarm (param2). ArduPilot's own pre-arm checks still apply. |
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

- The agent heartbeats as a GCS (sysid 255, or whatever `SYSID_MYGCS` is set to) **only while a commander session is alive**. That's what drives `FS_GCS_ENABL`.
- RC failsafe in AUTO continues the mission (`FS_LONG_ACTN`, `THR_FAILSAFE`), see ADR-0008.
- Run `mavlink-router` on the air unit so Mission Planner or QGC can connect alongside the agent for setup and tuning. A second GCS that writes missions is detected by the mission-identity check.

## Mock vs ArduPlane

`MockLink` / `mock-agent` stand in for ArduPlane, so ETAs, drawn paths and minimum radii in the planner come from mock physics. Where they differ (⚠️ rows), **ArduPlane SITL is the reference**: tune the mock to match SITL, never the reverse. Known differences today:

- Waypoint reached: the mock uses 3D proximity; ArduPlane uses horizontal distance or passing the waypoint.
- RTL altitude: the mock keeps its current altitude; ArduPlane uses `RTL_ALTITUDE`.
- Turn radius: the mock uses a fixed turn rate (20°/s); ArduPlane's depends on bank limit (`ROLL_LIMIT_DEG`) and airspeed.
- Cruise speed: the mock hardcodes 18 m/s; ArduPlane uses `AIRSPEED_CRUISE`.
