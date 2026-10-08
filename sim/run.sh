#!/bin/sh
# Starts ArduPlane SITL as a QuadPlane at SITL_HOME (lat,lon,alt AMSL,heading).
# Defaults match the web app's demo home so the map lines up. -w wipes the
# simulated EEPROM, so every start loads the parameter files fresh.
set -e
HOME_LOC="${SITL_HOME:--37.861,145.062,50,0}"
exec /sitl/arduplane -w \
  --model quadplane \
  --home "$HOME_LOC" \
  --speedup "${SITL_SPEEDUP:-1}" \
  --defaults /sitl/default_params/quadplane.parm,/sitl/params/cellular-drone.parm \
  --serial0 tcp:0 \
  --serial1 tcp:2 \
  "$@"
