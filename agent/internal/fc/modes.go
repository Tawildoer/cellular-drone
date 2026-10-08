package fc

import "fmt"

// ArduPlane custom_mode numbers (ArduPlane/mode.h).
const (
	ModeManual     uint32 = 0
	ModeCircle     uint32 = 1
	ModeStabilize  uint32 = 2
	ModeTraining   uint32 = 3
	ModeAcro       uint32 = 4
	ModeFBWA       uint32 = 5
	ModeFBWB       uint32 = 6
	ModeCruise     uint32 = 7
	ModeAutotune   uint32 = 8
	ModeAuto       uint32 = 10
	ModeRTL        uint32 = 11
	ModeLoiter     uint32 = 12
	ModeTakeoff    uint32 = 13
	ModeGuided     uint32 = 15
	ModeQStabilize uint32 = 17
	ModeQHover     uint32 = 18
	ModeQLoiter    uint32 = 19
	ModeQLand      uint32 = 20
	ModeQRTL       uint32 = 21
	ModeQAutotune  uint32 = 22
	ModeQAcro      uint32 = 23
)

// appFlightMode maps ArduPlane's mode to the app's FlightMode enum
// (web/src/domain/vehicle.ts). Modes the app has no name for are UNKNOWN.
func appFlightMode(mode uint32) string {
	switch mode {
	case ModeAuto:
		return "AUTO"
	case ModeLoiter:
		return "LOITER"
	case ModeQLoiter:
		return "QLOITER"
	case ModeRTL, ModeQRTL: // QRTL is RTL's vertical-landing phase (Q_RTL_MODE)
		return "RTL"
	case ModeQLand:
		return "QLAND"
	case ModeQHover:
		return "QHOVER"
	case ModeFBWA:
		return "FBWA"
	case ModeManual:
		return "MANUAL"
	default:
		return "UNKNOWN"
	}
}

// pilotMode reports modes that mean a person is flying with the sticks. If
// the FC enters one the agent didn't ask for, the RC pilot has taken over
// (ADR-0008). LOITER and QLOITER are also the agent's own "pause" modes, so
// they count only when the agent didn't command them.
func pilotMode(mode uint32) bool {
	switch mode {
	case ModeManual, ModeStabilize, ModeTraining, ModeAcro, ModeFBWA, ModeFBWB, ModeCruise,
		ModeQStabilize, ModeQHover, ModeQLoiter, ModeQAcro, ModeLoiter:
		return true
	}
	return false
}

// armableOnGround reports modes ArduPlane will arm in on the ground and that
// are safe to sit in there. Anything else (RTL, QRTL, QLAND, AUTO, ...) gets
// switched to QLOITER before arming.
func armableOnGround(mode uint32) bool {
	switch mode {
	case ModeQLoiter, ModeQHover, ModeQStabilize, ModeFBWA, ModeManual, ModeStabilize:
		return true
	}
	return false
}

// switchPosition is ArduPilot's 6-position mode switch (RC_Channel::
// read_6pos_switch): which of FLTMODE1..6 a PWM value selects, 0-based.
// False for a pulse outside 900–2200, which isn't a real reading.
func switchPosition(pwm uint16) (int, bool) {
	switch {
	case pwm <= 900 || pwm >= 2200:
		return 0, false
	case pwm < 1231:
		return 0, true
	case pwm < 1361:
		return 1, true
	case pwm < 1491:
		return 2, true
	case pwm < 1621:
		return 3, true
	case pwm < 1750:
		return 4, true
	}
	return 5, true
}

// modeName is the app name of a mode, or its number when the app has none.
func modeName(mode uint32) string {
	if name := appFlightMode(mode); name != "UNKNOWN" {
		return name
	}
	return fmt.Sprintf("mode %d", mode)
}
