package auth

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// vectors are the known answers the server's tests check too
// (server/src/__tests__/keys.test.ts): both sides must agree on these bytes.
type vectors struct {
	Session struct {
		ServerSeedHex   string `json:"serverSeedHex"`
		ServerPublicKey string `json:"serverPublicKey"`
		Claims          Claims `json:"claims"`
		Token           string `json:"token"`
	} `json:"session"`
	VehicleAuth struct {
		DroneSeedHex   string `json:"droneSeedHex"`
		DronePublicKey string `json:"dronePublicKey"`
		VehicleID      string `json:"vehicleId"`
		Nonce          string `json:"nonce"`
		Signature      string `json:"signature"`
	} `json:"vehicleAuth"`
}

func loadVectors(t *testing.T) vectors {
	t.Helper()
	raw, err := os.ReadFile("../../../testdata/auth/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func keyFromSeed(t *testing.T, seedHex string) ed25519.PrivateKey {
	t.Helper()
	seed, err := hex.DecodeString(seedHex)
	if err != nil {
		t.Fatal(err)
	}
	return ed25519.NewKeyFromSeed(seed)
}

func TestChallengeSignatureMatchesServer(t *testing.T) {
	v := loadVectors(t).VehicleAuth
	key := keyFromSeed(t, v.DroneSeedHex)
	if got := PublicKeyString(key); got != v.DronePublicKey {
		t.Errorf("public key %s, want %s", got, v.DronePublicKey)
	}
	if got := SignChallenge(key, v.VehicleID, v.Nonce); got != v.Signature {
		t.Errorf("signature %s, want %s", got, v.Signature)
	}
}

func TestVerifiesServerToken(t *testing.T) {
	v := loadVectors(t).Session
	pub, err := ParsePublicKey(v.ServerPublicKey)
	if err != nil {
		t.Fatal(err)
	}
	c := v.Claims
	inLife := time.Unix(c.Iat+10, 0)

	got, err := VerifySessionToken(pub, v.Token, c.VehicleID, c.SessionID, inLife)
	if err != nil {
		t.Fatalf("valid token refused: %v", err)
	}
	if got != c {
		t.Errorf("claims %+v, want %+v", got, c)
	}

	refused := map[string]struct {
		token, vehicle, session string
		now                     time.Time
	}{
		"another vehicle":     {v.Token, "drone-2", c.SessionID, inLife},
		"another session":     {v.Token, c.VehicleID, "other", inLife},
		"expired":             {v.Token, c.VehicleID, c.SessionID, time.Unix(c.Exp, 0).Add(ClockSkew + time.Second)},
		"not yet issued":      {v.Token, c.VehicleID, c.SessionID, time.Unix(c.Iat, 0).Add(-ClockSkew - time.Second)},
		"tampered payload":    {"x" + v.Token, c.VehicleID, c.SessionID, inLife},
		"tampered signature":  {v.Token[:len(v.Token)-2] + "AA", c.VehicleID, c.SessionID, inLife},
		"no signature":        {strings.Split(v.Token, ".")[0], c.VehicleID, c.SessionID, inLife},
		"the dev placeholder": {"unsigned-dev", c.VehicleID, c.SessionID, inLife},
	}
	for name, tc := range refused {
		if _, err := VerifySessionToken(pub, tc.token, tc.vehicle, tc.session, tc.now); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}

	// Signed by some other key: refused.
	other, _, _ := ed25519.GenerateKey(nil)
	if _, err := VerifySessionToken(other, v.Token, c.VehicleID, c.SessionID, inLife); err == nil {
		t.Error("a token checked against another server's key was accepted")
	}
}

func TestKeyCreatedOnceAndPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "keys", "drone.key")
	first, created, err := LoadOrCreateKey(path)
	if err != nil || !created {
		t.Fatalf("create: created=%v err=%v", created, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("key file mode %o, want 600", mode)
	}
	again, created, err := LoadOrCreateKey(path)
	if err != nil || created {
		t.Fatalf("reload: created=%v err=%v", created, err)
	}
	if !first.Equal(again) {
		t.Error("reloaded a different key")
	}
}

func TestServerClockFollowsServer(t *testing.T) {
	var c ServerClock
	c.Set(time.Now().Add(time.Hour).UnixMilli())
	if off := c.Offset(); off < 59*time.Minute || off > 61*time.Minute {
		t.Errorf("offset %v, want about an hour", off)
	}
}
