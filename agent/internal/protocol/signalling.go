package protocol

import "github.com/pion/webrtc/v4"

// SignallingVersion matches SIGNALLING_VERSION in packages/protocol/src/signalling.ts.
const SignallingVersion = 2

// Signalling is the union of signalling messages as one flat struct: Type
// says which fields are set. Pointers and omitempty keep unset fields off
// the wire, since the server validates each message against its schema.
type Signalling struct {
	V            int                      `json:"v"`
	Type         string                   `json:"type"`
	Role         string                   `json:"role,omitempty"`
	VehicleID    string                   `json:"vehicleId,omitempty"`
	SessionID    string                   `json:"sessionId,omitempty"`
	SessionToken string                   `json:"sessionToken,omitempty"`
	Nonce        string                   `json:"nonce,omitempty"`      // challenge
	Signature    string                   `json:"signature,omitempty"`  // auth
	ServerTime   *int64                   `json:"serverTime,omitempty"` // welcome, ms since the epoch
	SDP          string                   `json:"sdp,omitempty"`
	Candidate    *webrtc.ICECandidateInit `json:"candidate,omitempty"`
	Online       *bool                    `json:"online,omitempty"`
	Message      string                   `json:"message,omitempty"`
}
