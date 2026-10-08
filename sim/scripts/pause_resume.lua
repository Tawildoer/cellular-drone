--[[
pause_resume.lua: pauses that can't strand the aircraft, and resumes that
rejoin the planned leg (cellular-drone, ADR-0020).

A browser "pause" switches AUTO to LOITER (fixed-wing) or QLOITER (hover),
and "resume" switches back to AUTO. On its own, ArduPlane then starts the
current leg afresh from wherever the aircraft is and flies straight to the
target, away from the planned line (measured in SITL, agent/cmd/sitlcheck
-resume). This script puts the leg's start back to the previous planned
waypoint, so ArduPlane's normal line-following steers back onto the plan.

It also limits a pause: if the browser paused the mission and it's still
paused after PAUSE_MAX_S, the script resumes it. The link has no failsafe of
its own (FS_GCS_ENABL 0), so this is what stops a pause left behind by a lost
link, or a forgotten one, from circling until the battery runs low. Only a
browser pause is limited (mode reason GCS_COMMAND); a mode the RC pilot chose
is never overridden (ADR-0008).

Runs on the flight controller: the aircraft behaves the same whether or not
anyone is connected. Needs an FC with Lua scripting (H7, ADR-0002).
]]

local MODE_AUTO = 10
local MODE_LOITER = 12
local MODE_QLOITER = 19
local CMD_WAYPOINT = 16
local CMD_LOITER_UNLIM = 17
local CMD_LOITER_TURNS = 18
local CMD_VTOL_TAKEOFF = 84
local CMD_VTOL_LAND = 85
local NAV_CMD_LAST = 95 -- MAV_CMD values below this are NAV commands
-- AUTO sets up its own leg start as it resumes; wait this long, then replace it.
local REJOIN_DELAY_MS = 300
local UPDATE_MS = 100
local PAUSE_MAX_S = 120
local REASON_GCS_COMMAND = 2 -- ModeReason: a ground station (the agent) asked
local MAV_SEVERITY_WARNING = 4
local MAV_SEVERITY_INFO = 6

local last_mode = -1
local paused_seq = nil -- nav item being flown when the pause began
local rejoin_at_ms = nil
local pause_ends_ms = nil -- set only for a browser pause

local function is_pause(mode)
  return mode == MODE_LOITER or mode == MODE_QLOITER
end

-- Legs that are flown as a line to a point; the others (takeoff, RTL) have
-- no planned line to rejoin.
local function flies_a_leg(cmd)
  return cmd == CMD_WAYPOINT or cmd == CMD_LOITER_UNLIM or cmd == CMD_LOITER_TURNS or cmd == CMD_VTOL_LAND
end

-- Where the leg into item seq starts in the plan: the previous NAV item's
-- position, or home when there is none (the first leg after takeoff), the
-- same way the app draws the planned path.
local function planned_leg_start(seq)
  for i = seq - 1, 1, -1 do
    local item = mission:get_item(i)
    if item and item:command() < NAV_CMD_LAST then
      if item:command() == CMD_VTOL_TAKEOFF or (item:x() == 0 and item:y() == 0) then
        return ahrs:get_home()
      end
      local loc = Location()
      loc:lat(item:x())
      loc:lng(item:y())
      loc:alt(math.floor(item:z() * 100))
      loc:relative_alt(true)
      return loc
    end
  end
  return ahrs:get_home()
end

local function rejoin()
  local seq = mission:get_current_nav_index()
  if seq ~= paused_seq then
    return -- the mission moved on during the pause; nothing to rejoin
  end
  local item = mission:get_item(seq)
  if not item or not flies_a_leg(item:command()) then
    return
  end
  local start = planned_leg_start(seq)
  if start and vehicle:set_crosstrack_start(start) then
    gcs:send_text(MAV_SEVERITY_INFO, 'Resumed: rejoining the planned leg')
  else
    gcs:send_text(MAV_SEVERITY_WARNING, 'Resumed: could not restore the planned leg')
  end
end

function update()
  local mode = vehicle:get_mode()
  if not arming:is_armed() then
    last_mode, paused_seq, rejoin_at_ms, pause_ends_ms = mode, nil, nil, nil
    return update, UPDATE_MS
  end

  if mode ~= last_mode then
    if last_mode == MODE_AUTO and is_pause(mode) then
      paused_seq = mission:get_current_nav_index()
      pause_ends_ms = nil
      if vehicle:get_control_mode_reason() == REASON_GCS_COMMAND then
        pause_ends_ms = millis():toint() + PAUSE_MAX_S * 1000
      end
    elseif mode == MODE_AUTO and is_pause(last_mode) and paused_seq then
      rejoin_at_ms = millis():toint() + REJOIN_DELAY_MS
    else
      -- RTL, QLAND, an RC pilot's mode: not a pause and resume.
      paused_seq, rejoin_at_ms = nil, nil
    end
    if not is_pause(mode) then
      pause_ends_ms = nil
    end
    last_mode = mode
  end

  if pause_ends_ms and millis():toint() >= pause_ends_ms then
    pause_ends_ms = nil
    gcs:send_text(MAV_SEVERITY_INFO, string.format('Paused for %d s: resuming the mission', PAUSE_MAX_S))
    vehicle:set_mode(MODE_AUTO) -- the next update sees pause -> AUTO and rejoins
  end

  if rejoin_at_ms and millis():toint() >= rejoin_at_ms then
    rejoin_at_ms = nil
    if mode == MODE_AUTO then
      rejoin()
    end
    paused_seq = nil
  end
  return update, UPDATE_MS
end

gcs:send_text(MAV_SEVERITY_INFO, 'pause_resume.lua loaded')
return update, UPDATE_MS
