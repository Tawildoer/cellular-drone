--[[
loiter_until.lua: "loiter until a UTC time of day" for cellular-drone
(ADR-0013, ADR-0017). ArduPlane has no such mission command, so the mission
translator writes a clock-mode loiter as two rows:

  seq L    NAV_LOITER_UNLIM          (lat, lon, alt, param3 = radius)
  seq L+1  DO_SEND_SCRIPT_MESSAGE    param1 = 7301, param2 = end time (minutes after midnight UTC)

While the vehicle flies row L in AUTO, this script works out when to stop
(same rule as resolveLoiterUntilMs: the occurrence of that time within 12 h
either side of now, so arriving late means "already past"), always flies at
least one full lap, then waits until the aircraft points along the next leg
(at most one more lap) and jumps the mission to row L+2.

Runs on the flight controller, so it keeps working if the companion computer,
modem or browser is gone. Without it (or with SCR_ENABLE=0) the loiter never
ends by itself, and the battery failsafe eventually brings the aircraft home.
Needs an FC with Lua scripting: an H7, not an F405 (ADR-0002).
]]

local SCRIPT_MSG_ID = 7301
local CMD_RETURN_TO_LAUNCH = 20
local CMD_LOITER_UNLIM = 17
local CMD_SEND_SCRIPT_MESSAGE = 217
local NAV_CMD_LAST = 95 -- MAV_CMD values below this are NAV commands
local MODE_AUTO = 10
local GPS_OK_FIX_3D = 3
local GPS_LEAP_SECONDS = 18 -- GPS time runs ahead of UTC by this
local MS_PER_MINUTE = 60000
local MS_PER_DAY = 24 * 60 * MS_PER_MINUTE
local HALF_DAY_MS = MS_PER_DAY // 2
local ALIGN_TOLERANCE_RAD = math.rad(30)
local UPDATE_MS = 200
local MAV_SEVERITY_INFO = 6

-- State for the loiter being flown, or nil.
local active_seq = nil
local end_ms = 0
local lap_ms = 0

local function round(x)
  return math.floor(x + 0.5)
end

-- Milliseconds since midnight UTC, from GPS time; nil until GPS has a fix.
local function utc_ms_of_day()
  local instance = gps:primary_sensor()
  if gps:status(instance) < GPS_OK_FIX_3D then
    return nil
  end
  -- GPS weeks start at a midnight, so ms-of-week mod a day is ms-of-day.
  -- Kept small on purpose: ArduPilot's Lua uses 32-bit integers.
  local week_ms = gps:time_week_ms(instance):toint()
  return (week_ms - GPS_LEAP_SECONDS * 1000) % MS_PER_DAY
end

-- Where the aircraft goes after the loiter: the next NAV row's position, or
-- home when that row is RTL.
local function next_leg_target(seq)
  for i = seq + 2, mission:num_commands() - 1 do
    local item = mission:get_item(i)
    if item and item:command() < NAV_CMD_LAST then
      if item:command() == CMD_RETURN_TO_LAUNCH then
        return ahrs:get_home()
      end
      local loc = Location()
      loc:lat(item:x())
      loc:lng(item:y())
      return loc
    end
  end
  return nil
end

local function pointing_along_next_leg(seq)
  local target = next_leg_target(seq)
  local here = ahrs:get_location()
  if not target or not here then
    return true -- nothing to line up with
  end
  local course = math.rad(gps:ground_course(gps:primary_sensor()))
  local diff = (here:get_bearing(target) - course + math.pi) % (2 * math.pi) - math.pi
  return math.abs(diff) <= ALIGN_TOLERANCE_RAD
end

-- Our marker row (L+1) for the loiter at seq, or nil if it's a plain
-- unlimited loiter that isn't ours to end.
local function marker_for(seq)
  local item = mission:get_item(seq)
  if not item or item:command() ~= CMD_LOITER_UNLIM then
    return nil
  end
  local marker = mission:get_item(seq + 1)
  if not marker or marker:command() ~= CMD_SEND_SCRIPT_MESSAGE or round(marker:param1()) ~= SCRIPT_MSG_ID then
    return nil
  end
  return item, marker
end

local function start(seq, item, marker, now)
  local now_utc = utc_ms_of_day()
  if not now_utc then
    return false -- wait for GPS time
  end
  local until_minute = round(marker:param2())
  local delta = (until_minute * MS_PER_MINUTE - now_utc) % MS_PER_DAY
  if delta > HALF_DAY_MS then
    delta = 0 -- within the last 12 h: already past
  end

  local radius = math.abs(item:param3())
  if radius < 1 then
    radius = param:get('WP_LOITER_RAD') or 60
  end
  local speed = param:get('AIRSPEED_CRUISE') or 18
  lap_ms = round(2 * math.pi * radius / speed * 1000)

  active_seq = seq
  end_ms = now + math.max(delta, lap_ms)
  gcs:send_text(MAV_SEVERITY_INFO, string.format('Loiter until %02d:%02d UTC', until_minute // 60, until_minute % 60))
  return true
end

function update()
  if not arming:is_armed() or vehicle:get_mode() ~= MODE_AUTO then
    active_seq = nil
    return update, UPDATE_MS
  end

  local seq = mission:get_current_nav_index()
  local item, marker = marker_for(seq)
  if not item then
    active_seq = nil
    return update, UPDATE_MS
  end

  local now = millis():toint()
  if active_seq ~= seq and not start(seq, item, marker, now) then
    return update, UPDATE_MS
  end
  if now < end_ms then
    return update, UPDATE_MS
  end
  -- Time's up and the minimum lap is flown: leave along the next leg, or
  -- after one more lap at most, whichever comes first.
  if now < end_ms + lap_ms and not pointing_along_next_leg(seq) then
    return update, UPDATE_MS
  end
  if mission:set_current_cmd(seq + 2) then
    gcs:send_text(MAV_SEVERITY_INFO, 'Loiter end time reached, continuing mission')
    active_seq = nil
  end
  return update, UPDATE_MS
end

gcs:send_text(MAV_SEVERITY_INFO, 'loiter_until.lua loaded')
return update, UPDATE_MS
