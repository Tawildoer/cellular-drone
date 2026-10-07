// Package protocol mirrors, by hand, the parts of web/src/protocol the agent
// speaks: the v1 data-channel envelope (messages.ts), the VehicleState and
// CommandResult shapes (schemas.ts), and the signalling messages
// (signalling.ts). The browser drops anything that fails its zod schema, so
// field names, optionality and enum values must match exactly — change both
// sides together.
package protocol

import (
	"encoding/json"
	"time"

	"github.com/tomwildoer/cellular-drone/agent/internal/mission"
)

const Version = 1

// Envelope is the v1 wrapper around every data-channel message.
type Envelope struct {
	V       int             `json:"v"`
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	TS      int64           `json:"ts"`
	Payload json.RawMessage `json:"payload"`
}

// Encode wraps payload in a v1 envelope. id is empty for unsolicited messages
// and echoes the request's id for replies.
func Encode(msgType, id string, payload any) ([]byte, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Envelope{V: Version, Type: msgType, ID: id, TS: time.Now().UnixMilli(), Payload: raw})
}

type Position struct {
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	AltRelM  float64 `json:"altRelM"`
	AltAmslM float64 `json:"altAmslM"`
}

type Attitude struct {
	RollDeg  float64 `json:"rollDeg"`
	PitchDeg float64 `json:"pitchDeg"`
	YawDeg   float64 `json:"yawDeg"`
}

type Battery struct {
	VoltageV float64 `json:"voltageV"`
	CurrentA float64 `json:"currentA"`
	Percent  float64 `json:"percent"`
}

type GPSStatus struct {
	FixType    string  `json:"fixType"` // none | fix2d | fix3d | rtk
	Satellites int     `json:"satellites"`
	HDOP       float64 `json:"hdop"`
}

type MissionProgress struct {
	CurrentIndex int `json:"currentIndex"`
	Total        int `json:"total"`
}

type RCStatus struct {
	Linked         bool `json:"linked"`
	OverrideActive bool `json:"overrideActive"`
}

type FailsafeFlags struct {
	GCS      bool `json:"gcs"`
	Battery  bool `json:"battery"`
	Geofence bool `json:"geofence"`
	RC       bool `json:"rc"`
}

type HomePosition struct {
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	AltAmslM float64 `json:"altAmslM"`
}

type VehicleState struct {
	VehicleID       string          `json:"vehicleId"`
	Position        Position        `json:"position"`
	Attitude        Attitude        `json:"attitude"`
	GroundSpeedMps  float64         `json:"groundSpeedMps"`
	AirspeedMps     float64         `json:"airspeedMps"`
	ClimbMps        float64         `json:"climbMps"`
	Battery         Battery         `json:"battery"`
	GPS             GPSStatus       `json:"gps"`
	FlightMode      string          `json:"flightMode"` // AUTO | LOITER | ... | UNKNOWN
	Armed           bool            `json:"armed"`
	VtolState       string          `json:"vtolState"` // mc | fw | transition
	Landed          bool            `json:"landed"`
	Home            *HomePosition   `json:"home"`
	MissionProgress MissionProgress `json:"missionProgress"`
	RC              RCStatus        `json:"rc"`
	Failsafe        FailsafeFlags   `json:"failsafe"`
	UpdatedAt       int64           `json:"updatedAt"`
}

// StubVehicleState is what the agent reports with no flight controller
// attached: parked at home, nothing armed, no GPS fix, and zeros rather than
// invented readings for anything it can't measure.
func StubVehicleState(vehicleID string, home HomePosition) VehicleState {
	return VehicleState{
		VehicleID:  vehicleID,
		Position:   Position{Lat: home.Lat, Lon: home.Lon, AltAmslM: home.AltAmslM},
		GPS:        GPSStatus{FixType: "none"},
		FlightMode: "UNKNOWN",
		VtolState:  "mc",
		Landed:     true,
		Home:       &home,
		UpdatedAt:  time.Now().UnixMilli(),
	}
}

// CommandResult is the {ok: true} | {ok: false, reason, detail?} union.
type CommandResult struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
	Detail string `json:"detail,omitempty"`
}

func Rejected(detail string) CommandResult {
	return CommandResult{OK: false, Reason: "rejected_by_vehicle", Detail: detail}
}

type StatusEvent struct {
	Kind string `json:"kind"` // always "status"
	Text string `json:"text"`
	TS   int64  `json:"ts"`
}

type MissionUploaded struct {
	MissionID string        `json:"missionId"`
	Result    CommandResult `json:"result"`
	// OnVehicle is the flight controller's readback after a successful
	// upload, omitted when there is none (ADR-0017).
	OnVehicle []mission.Row `json:"onVehicle,omitempty"`
}
