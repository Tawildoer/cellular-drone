# ArduPilot and MAVLink mapping

The browser speaks the app's own vocabulary (`domain/`, `protocol/` v1). The **drone agent** turns it into MAVLink2 for an **ArduPlane QuadPlane** flight controller, and turns MAVLink back into app types. This file is the reference for that translation (ADR-0017).

## Where the translation runs (ADR-0017 addendum)

| | Code | Role |
|---|---|---|
| Agent (Go) | `agent/internal/mission` | **Authoritative.** Produces what is uploaded. Refuses unknown item types. |
| Browser (TS) | `web/src/ardupilot`, via `services/MissionTranslator` | **Preview** and `.waypoints` export (not shown in the UI since 2026-10-08). |
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
| `arm` / `disarm` | `MAV_CMD_COMPONENT_ARM_DISARM` | Never force-disarm (param2). ArduPilot's own pre-arm checks still apply. 🧪 ArduPlane won't arm in RTL/QRTL/QLAND ("QRTL mode not armable"), and the FC is left in QRTL on the ground after any RTL landing. (Before ADR-0020 the GCS failsafe also put it there at power-up.) So `arm` on the ground first switches such modes to QLOITER. |
| `mission.start` | Set mode AUTO (`MAV_CMD_DO_SET_MODE`) | Armed, on the ground, first item `NAV_VTOL_TAKEOFF`. |
| `mode.pause` | Set mode QLOITER if hovering, else LOITER | |
| `mode.resume` | Set mode AUTO | Continues the current item (`MIS_RESTART` = 0). |
| `mode.rtl` | Set mode RTL | |
| `mode.qland` | Set mode QLAND | |
| `video.config` | none | Agent-local (encoder), not MAVLink. |
| `gimbal.release` | ❓ `MAV_CMD_DO_SET_ROI_NONE` | ADR-0023. Not in the agent yet. Drops the operator's lock; the gimbal goes back to looking ahead, or at a loiter's centre. |
| `freefly.start` | ❓ Upload a free-fly mission and stay in (or set) AUTO: one `NAV_LOITER_UNLIM` at the current position, `altM` and 80 m radius, `MISSION_SET_CURRENT` to it | ADR-0024. Not in the agent yet (rejected). Airborne only; a mode change, so hold-to-confirm and refused under RC override. The planned mission is kept by the agent and re-uploaded when free fly ends (RTL, QLAND or landing). |
| `freefly.waypoint` | ❓ Rewrite the mission's tail: …, the new `NAV_WAYPOINT` (`altM`, relative), then `NAV_LOITER_UNLIM` round it; the previous end circle becomes a plain `NAV_WAYPOINT` (or stays a `NAV_LOITER_TURNS` if it's a loiter waypoint), and if the aircraft was circling it, `MISSION_SET_CURRENT` to the next item | ADR-0024. Not in the agent yet. The whole route stays on the FC: with the link gone it flies out the queued waypoints and circles the last, until the battery failsafe. |
| `freefly.remove` | ❓ Rewrite the mission without that item; if it was the current one, `MISSION_SET_CURRENT` to the next (or an unlimited loiter where the aircraft is) | Only waypoints not yet reached; the browser sends the position it saw, so an edit to a changed route is refused. |
| `freefly.loiter` | ❓ Swap the item between `NAV_WAYPOINT` and `NAV_LOITER_TURNS` (1 turn, 80 m) | As above. The last item is circled until another is added either way (`NAV_LOITER_UNLIM`). |
| `gimbal.lock` | ❓ `MAV_CMD_DO_SET_ROI_LOCATION` (lat, lon, alt AMSL); `MAV_CMD_DO_SET_ROI_NONE` to release | ADR-0023. Not in the agent yet (rejected). Camera only: ArduPlane points the mount, never the aircraft. Allowed under RC override. ArduPilot doesn't release an ROI by distance, so the agent watches the range and sends `ROI_NONE` past 500 m. If the companion dies the lock stays on the FC until the mission or a pilot changes it: display only, no flight effect. |

Never sent, blocked in the agent: `RC_CHANNELS_OVERRIDE`, `MANUAL_CONTROL`, `SET_POSITION_TARGET_*`, `SET_ATTITUDE_TARGET`, `MAV_CMD_DO_REPOSITION` and parameter writes other than the fence ones above.

## Telemetry (MAVLink → `VehicleState`)

| App field | Source |
|---|---|
| `position` | `GLOBAL_POSITION_INT` (`relative_alt`, `alt`) |
| `attitude` | `ATTITUDE` |
| `groundSpeedMps`, `airspeedMps`, `climbMps` | `VFR_HUD` |
| `battery` | `BATTERY_STATUS` / `SYS_STATUS`. `toHomePercent`: ❓ from the battery-return script (ADR-0025), e.g. a `NAMED_VALUE_FLOAT` it sends; omitted until then. |
| `gps` | `GPS_RAW_INT` |
| `flightMode`, `armed` | `HEARTBEAT` (`custom_mode` → app `FlightMode` via the ArduPlane mode table; `base_mode` armed flag) |
| `vtolState`, `landed` | `EXTENDED_SYS_STATE` (`vtol_state`, `landed_state`) |
| `home` | `HOME_POSITION` |
| `missionProgress` | `MISSION_CURRENT` through the index table |
| `rc` | `linked` from the `SYS_STATUS` RC receiver health flag. `modeSwitch`: the agent reads `FLTMODE_CH` and `FLTMODE1..6` once per FC connection, then turns that channel's `RC_CHANNELS` pulse into a position with ArduPilot's own thresholds (`read_6pos_switch`); omitted while RC isn't linked. `overrideActive` while armed: the switch is off AUTO, or the FC entered a pilot mode the agent didn't command (covers an unknown switch, and modes set by another ground station). |
| `failsafe.geofence` | `FENCE_STATUS` |
| `failsafe.battery`, `failsafe.rc` | `BATTERY_STATUS` / `SYS_STATUS` flags and `STATUSTEXT` ❓ |
| `failsafe.gcs` | The agent's own view of the commander session |
| `wind` (optional) | ❓ `WIND` (`direction` is where it blows from, `speed`): ArduPilot's own estimate. Not mapped by the agent yet; the mock reports its simulated wind when one is set (ADR-0026). |
| `gimbal` (optional) | ❓ Not mapped by the agent yet, so omitted from real telemetry. Plan: `GIMBAL_DEVICE_ATTITUDE_STATUS` (gimbal protocol v2, which ArduPilot sends for SIYI-style mounts): quaternion → `pitchDeg` from the horizon (negative down) and `yawDeg` from the nose; if `GIMBAL_DEVICE_FLAGS_YAW_IN_EARTH_FRAME` is set, subtract the vehicle's yaw first. `gimbal.lock` is the agent's own record of the ROI it set (ADR-0023), and `gimbal.lookAt` the spot it's pointed at: the lock, or the centre of a loiter being circled (a `DO_SET_ROI_LOCATION` the translator puts before each loiter item, cleared after it; not in the translator yet). The mock looks ahead at -45° pitch, at the locked spot, or at the loiter centre. Display only: the map draws the camera's line of sight to the ground from it; nothing in flight depends on it, and if the companion dies the FC keeps driving the mount. |
| clock (loiter until) | `SYSTEM_TIME` (GPS time) |
| events | `STATUSTEXT` → `status`, mode changes → `modeChanged` |

The agent requests rates with `SET_MESSAGE_INTERVAL` rather than relying on `SRx_*` params.

## Link and failsafe setup

- The agent heartbeats as a GCS (sysid 255) while a commander session is alive, but nothing depends on it: `FS_GCS_ENABL` is 0, so the link never triggers a failsafe (ADR-0020). Pauses are limited by `sim/scripts/pause_resume.lua` instead.
- 🧪 Resume rejoins the planned leg: `pause_resume.lua` calls `vehicle:set_crosstrack_start` with the previous planned waypoint just after AUTO resumes (ArduPlane on its own flies straight from where it is). Measured: back within 2 m of the leg 18 s after a resume, versus still 67 m off after 40 s without it. A browser pause (mode reason `GCS_COMMAND`) left for 120 s resumes by itself; an RC pilot's mode is never touched.
- RC failsafe in AUTO continues the mission (`FS_LONG_ACTN`, `THR_FAILSAFE`), see ADR-0008.
- Run `mavlink-router` on the air unit so Mission Planner or QGC can connect alongside the agent for setup and tuning. A second GCS that writes missions is detected by the mission-identity check.

## Planner estimates (ADR-0021)

The planner's height profile and time estimate model how ArduPlane flies the mission, at SITL's figures (`domain/missionProfile.ts`, `SITL_PERFORMANCE`): VTOL takeoff straight up at home at 2.5 m/s, ~10 s transition on the first leg, legs at `AIRSPEED_CRUISE` (25 m/s) with the height changing evenly along each leg, loiter laps at cruise, RTL home at `RTL_ALTITUDE` (assumed 60 m, `sim/params`), and a VTOL landing (land item or RTL) approached at the current height, ~10 s back-transition, then 1.5 m/s down to `Q_LAND_FINAL_ALT` (6 m) and `Q_LAND_SPEED` (0.5 m/s) to the ground. Change these with the parameters they name. In flight, a loiter being circled counts only its laps left (counted in the browser from the angle swept around its centre: telemetry doesn't report laps), and a clock-mode loiter runs to its actual end time, as `loiter_until.lua` ends it (at least one lap). When planning, with no start time, a clock-mode loiter counts one lap and the time shows as a minimum.

*Follow terrain at X m* (ADR-0021 addendum) produces plain `NAV_WAYPOINT` / loiter rows in `MAV_FRAME_GLOBAL_RELATIVE_ALT` with heights computed from the terrain, plus extra waypoints over ridges: no terrain frame, no `TERRAIN_*` parameters, nothing the FC needs to know about. RTL still flies at `RTL_ALTITUDE`.

## Mock vs ArduPlane

`MockLink` / `mock-agent` stand in for ArduPlane, so ETAs, drawn paths and minimum radii in the planner come from mock physics. Where they differ (⚠️ rows), **ArduPlane SITL is the reference**: tune the mock to match SITL, never the reverse. Known differences today:

- Waypoint reached: the mock uses 3D proximity (20 m); ArduPlane uses horizontal distance or passing the waypoint, and starts its turn there. 🧪 With ArduPilot's default `WP_RADIUS` 90 it was "reached" 82 m short, which cut corners visibly. SITL now sets `WP_RADIUS` 30 (`sim/params`), and it's reached at 29 m. The real value is a Phase 3 tuning decision; a per-waypoint `acceptRadiusM` overrides it.
- Resume after a pause: 🧪 ArduPlane flies **straight from wherever it is to the current target**; it does not rejoin the planned leg (`agent/cmd/sitlcheck -resume`: after being pushed 168 m off, it tracked a straight line to the target). With `pause_resume.lua` it instead rejoins the planned leg (ADR-0020), and the mock does the same. The map never follows the aircraft: the dashed path is always the fixed planned route, trimmed by progress along it, so any gap between it and the aircraft is visible (a UI rule, not a flight one).
- Height along a leg: the mock now flies ArduPlane's glide slope, the height changing evenly from where the leg started to the next item's (2026-10-10). It used to climb or descend at 3 m/s straight away, which put it well above or below the drawn path for most of a leg. Its 3 m/s climb limit still applies, so a steep leg falls behind the slope.
- RTL altitude: the mock keeps its current altitude; ArduPlane uses `RTL_ALTITUDE`.
- Turn radius: the mock uses a fixed turn rate (20°/s); ArduPlane's depends on bank limit (`ROLL_LIMIT_DEG`) and airspeed.
- Cruise speed: the mock hardcodes 18 m/s; ArduPlane uses `AIRSPEED_CRUISE`. 🧪 SITL's QuadPlane cruises at 25 m/s. At 18 m/s it sits on `Q_ASSIST_SPEED` (18), so VTOL assist keeps cutting in. The real airframe's figure replaces both; until then the mock should move to 25 m/s, which also changes its turn radius and `MIN_LOITER_RADIUS_M`.
- Disarm after landing: 🧪 ArduPlane disarms by itself a few seconds after a VTOL landing (QLAND, QRTL, `NAV_VTOL_LAND`). The operator doesn't have to.
- Landed VTOL state: 🧪 ArduPlane reports `fw` on the ground in a fixed-wing mode such as FBWA (SITL booted into it from its RC switch position until `FLTMODE6` was set to AUTO); the mock says `mc`.
- The RC mode switch needs an AUTO position (ADR-0008): `mission.start` is refused unless RC is linked and the switch is there. SITL holds the switch channel at 1800 µs (position 6), so `sim/params` sets `FLTMODE6 10`. ArduPlane only acts on the switch when it *moves*, but at boot it takes the switch's mode, so the FC powers up in AUTO, disarmed; `arm` switches it to QLOITER first, so arming never starts the mission.
