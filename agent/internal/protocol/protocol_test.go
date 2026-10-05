package protocol

import (
	"encoding/json"
	"testing"
)

func decode(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestEncodeWrapsPayloadInV1Envelope(t *testing.T) {
	raw, err := Encode("pong", "abc", struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	env := decode(t, raw)
	if env["v"] != float64(1) || env["type"] != "pong" || env["id"] != "abc" {
		t.Fatalf("unexpected envelope: %v", env)
	}
	if _, ok := env["ts"].(float64); !ok {
		t.Fatalf("ts must be a number: %v", env)
	}
}

func TestUnsolicitedMessagesOmitID(t *testing.T) {
	raw, _ := Encode("telemetry.state", "", StubVehicleState("drone-1", HomePosition{}))
	if _, present := decode(t, raw)["id"]; present {
		t.Fatal("id must be omitted, not empty, on unsolicited messages")
	}
}

func TestCommandResultShapes(t *testing.T) {
	ok := decode(t, mustMarshal(t, CommandResult{OK: true}))
	if len(ok) != 1 || ok["ok"] != true {
		t.Fatalf(`{ok: true} must carry no other keys, got %v`, ok)
	}
	rejected := decode(t, mustMarshal(t, Rejected("why")))
	if rejected["ok"] != false || rejected["reason"] != "rejected_by_vehicle" || rejected["detail"] != "why" {
		t.Fatalf("unexpected rejection: %v", rejected)
	}
}

func TestStubVehicleStateUsesSchemaEnumValues(t *testing.T) {
	state := decode(t, mustMarshal(t, StubVehicleState("drone-1", HomePosition{Lat: 1, Lon: 2})))
	if state["flightMode"] != "UNKNOWN" || state["vtolState"] != "mc" {
		t.Fatalf("unexpected enums: %v", state)
	}
	if state["gps"].(map[string]any)["fixType"] != "none" {
		t.Fatal("fixType must be one of none|fix2d|fix3d|rtk")
	}
	if state["home"] == nil {
		t.Fatal("home is reported")
	}
}

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
