package session

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/tomwildoer/cellular-drone/agent/internal/auth"
	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
)

// fixedClock stands in for the server clock.
type fixedClock time.Time

func (c fixedClock) Now() time.Time { return time.Time(c) }

// signToken mints a token the way the server does (server/src/keys.ts).
func signToken(t *testing.T, key ed25519.PrivateKey, c auth.Claims) string {
	t.Helper()
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	return payload + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(auth.SessionTokenContext+payload)))
}

func offer(token string) protocol.Signalling {
	return protocol.Signalling{Type: "offer", SessionID: "s1", SessionToken: token}
}

func TestSessionTokens(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(nil)
	now := time.Unix(1_800_000_000, 0)
	claims := auth.Claims{V: 1, Sub: "pilot", Role: "operator", VehicleID: "drone-1", SessionID: "s1", Iat: now.Unix(), Exp: now.Unix() + 60}
	signed := signToken(t, key, claims)

	verifying := &Manager{cfg: Config{VehicleID: "drone-1", ServerKey: pub, Clock: fixedClock(now)}}
	got, err := verifying.verifySessionToken(offer(signed))
	if err != nil || got.Sub != "pilot" {
		t.Fatalf("a valid signed token must be accepted: %+v, %v", got, err)
	}
	if _, err := verifying.verifySessionToken(offer("unsigned-dev")); err == nil {
		t.Error("with a server key, an unsigned token must be refused")
	}
	if _, err := verifying.verifySessionToken(offer("")); err == nil {
		t.Error("an empty token must be refused")
	}

	// The server key wins over -insecure-dev-tokens: a bad token is still refused.
	both := &Manager{cfg: Config{VehicleID: "drone-1", ServerKey: pub, Clock: fixedClock(now), InsecureDevTokens: true}}
	if _, err := both.verifySessionToken(offer("unsigned-dev")); err == nil {
		t.Error("-insecure-dev-tokens must not override a configured server key")
	}

	// Expiry is judged by the server clock, not the drone's own (which may
	// be years out at boot without an RTC).
	late := &Manager{cfg: Config{VehicleID: "drone-1", ServerKey: pub, Clock: fixedClock(now.Add(5 * time.Minute))}}
	if _, err := late.verifySessionToken(offer(signed)); err == nil {
		t.Error("an expired token must be refused")
	}

	refusing := &Manager{cfg: Config{VehicleID: "drone-1"}}
	if _, err := refusing.verifySessionToken(offer(signed)); !errors.Is(err, errTokensUnverifiable) {
		t.Errorf("with no server key and no -insecure-dev-tokens every token is refused, got %v", err)
	}

	dev := &Manager{cfg: Config{VehicleID: "drone-1", InsecureDevTokens: true}}
	if got, err := dev.verifySessionToken(offer("unsigned-dev")); err != nil || got.Sub != unverifiedUser {
		t.Errorf("insecure dev mode accepts a non-empty token as unverified: %+v, %v", got, err)
	}
	if _, err := dev.verifySessionToken(offer("")); err == nil {
		t.Error("an empty token must be refused even in insecure dev mode")
	}
}
