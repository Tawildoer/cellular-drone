package mission

import "fmt"

// MaxAltM matches DEFAULT_MAX_ALT_M in web/src/domain/validation.ts.
const MaxAltM = 120

// Validate applies the structural rules from web/src/domain/validation.ts
// that the agent must enforce itself rather than trust the browser for:
// start with a VTOL takeoff, end with a land or RTL, stay under the altitude
// limit. Fence containment is enforced by the FC's own fence.
func Validate(m Mission) error {
	if len(m.Items) == 0 {
		return fmt.Errorf("mission has no items")
	}
	if m.Items[0].Type != "vtolTakeoff" {
		return fmt.Errorf("mission must start with a VTOL takeoff")
	}
	if last := m.Items[len(m.Items)-1].Type; last != "vtolLand" && last != "returnToLaunch" {
		return fmt.Errorf("mission must end with a VTOL land or return-to-launch")
	}
	for i, item := range m.Items {
		if item.AltM > MaxAltM {
			return fmt.Errorf("item %d: altitude %gm exceeds the limit of %dm", i+1, item.AltM, MaxAltM)
		}
	}
	return nil
}
