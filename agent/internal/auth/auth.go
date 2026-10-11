// Package auth holds the agent's side of ADR-0030: the drone's own Ed25519
// key, which proves to the signalling server that this is the vehicle it
// claims to be, and the check on the session tokens the server signs, which
// the agent makes before answering any browser (ARCHITECTURE.md, session
// flow step 4). It mirrors packages/protocol/src/auth.ts by hand; both sides
// are tested on testdata/auth/vectors.json.
package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Context strings, matching VEHICLE_AUTH_CONTEXT and SESSION_TOKEN_CONTEXT
// in packages/protocol/src/auth.ts.
const (
	VehicleAuthContext  = "cellular-drone/vehicle-auth/v1\n"
	SessionTokenContext = "cellular-drone/session/v1."
	tokenVersion        = 1
	// ClockSkew is how far a token's times may be off the server clock the
	// agent tracks: allows for the offer's trip and clock steps.
	ClockSkew = 30 * time.Second
)

var b64 = base64.RawURLEncoding

// LoadOrCreateKey reads the drone's private key (PKCS#8 PEM) from path, or
// makes one there (mode 0600) if the file doesn't exist. created says which.
func LoadOrCreateKey(path string) (key ed25519.PrivateKey, created bool, err error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return createKey(path)
	}
	if err != nil {
		return nil, false, err
	}
	block, _ := pem.Decode(raw)
	if block == nil || block.Type != "PRIVATE KEY" {
		return nil, false, fmt.Errorf("%s: not a PEM private key", path)
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, false, fmt.Errorf("%s: %w", path, err)
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, false, fmt.Errorf("%s: not an Ed25519 key", path)
	}
	return key, false, nil
}

func createKey(path string) (ed25519.PrivateKey, bool, error) {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, false, err
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, false, err
	}
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, false, err
		}
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, false, err
	}
	defer f.Close()
	if err := pem.Encode(f, &pem.Block{Type: "PRIVATE KEY", Bytes: der}); err != nil {
		return nil, false, err
	}
	return key, true, f.Sync()
}

// PublicKeyString is the form the server's registry takes (drone:add) and
// gives out (keys:show): base64url of the raw 32 bytes, no padding.
func PublicKeyString(key ed25519.PrivateKey) string {
	return b64.EncodeToString(key.Public().(ed25519.PublicKey))
}

// ParsePublicKey reads a key in PublicKeyString's form (the -server-pubkey flag).
func ParsePublicKey(s string) (ed25519.PublicKey, error) {
	raw, err := b64.DecodeString(strings.TrimSpace(s))
	if err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, errors.New("a public key is 43 base64url characters (server: npm run cli -- keys:show)")
	}
	return ed25519.PublicKey(raw), nil
}

// SignChallenge answers the server's challenge nonce on connect.
func SignChallenge(key ed25519.PrivateKey, vehicleID, nonce string) string {
	return b64.EncodeToString(ed25519.Sign(key, []byte(VehicleAuthContext+vehicleID+"\n"+nonce)))
}

// Claims mirrors sessionTokenClaimsSchema.
type Claims struct {
	V         int    `json:"v"`
	Sub       string `json:"sub"`
	Role      string `json:"role"`
	VehicleID string `json:"vehicleId"`
	SessionID string `json:"sessionId"`
	Iat       int64  `json:"iat"`
	Exp       int64  `json:"exp"`
}

// VerifySessionToken checks a server-signed session token: the signature
// with the server's public key, that it's for this vehicle and this session,
// and its lifetime against now (the server's clock, see ServerClock).
func VerifySessionToken(serverKey ed25519.PublicKey, token, vehicleID, sessionID string, now time.Time) (Claims, error) {
	payload, signature, ok := strings.Cut(token, ".")
	if !ok {
		return Claims{}, errors.New("malformed session token")
	}
	sig, err := b64.DecodeString(signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return Claims{}, errors.New("malformed session token signature")
	}
	if !ed25519.Verify(serverKey, []byte(SessionTokenContext+payload), sig) {
		return Claims{}, errors.New("session token not signed by the server")
	}
	raw, err := b64.DecodeString(payload)
	if err != nil {
		return Claims{}, errors.New("malformed session token payload")
	}
	var c Claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return Claims{}, errors.New("malformed session token claims")
	}
	switch {
	case c.V != tokenVersion:
		return Claims{}, fmt.Errorf("session token version %d, want %d", c.V, tokenVersion)
	case c.Sub == "":
		return Claims{}, errors.New("session token names no user")
	case c.VehicleID != vehicleID:
		return Claims{}, fmt.Errorf("session token is for vehicle %q", c.VehicleID)
	case c.SessionID != sessionID:
		return Claims{}, errors.New("session token is for another session")
	case now.Add(ClockSkew).Before(time.Unix(c.Iat, 0)):
		return Claims{}, errors.New("session token issued in the future (clock?)")
	case now.Add(-ClockSkew).After(time.Unix(c.Exp, 0)):
		return Claims{}, errors.New("session token expired")
	}
	return c, nil
}

// ServerClock is the local clock corrected to the signalling server's, from
// the serverTime in its welcome. Token expiry is judged by it, so a drone
// whose clock is wrong at boot (no RTC, NTP not yet reached over LTE) still
// accepts fresh tokens. Until a welcome arrives it's the local clock.
type ServerClock struct {
	mu     sync.Mutex
	offset time.Duration
}

// Set records the server's time as of now.
func (c *ServerClock) Set(serverMs int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.offset = time.Until(time.UnixMilli(serverMs))
}

// Offset is how far the server's clock is ahead of this one.
func (c *ServerClock) Offset() time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.offset
}

func (c *ServerClock) Now() time.Time {
	return time.Now().Add(c.Offset())
}
