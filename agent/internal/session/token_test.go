package session

import (
	"errors"
	"testing"
)

func TestSessionTokensRefusedUnlessInsecureDev(t *testing.T) {
	if err := verifySessionToken("anything", false); !errors.Is(err, errTokensUnverifiable) {
		t.Errorf("without -insecure-dev-tokens a token must be refused, got %v", err)
	}
	if err := verifySessionToken("", true); err == nil {
		t.Error("an empty token must be refused even in insecure dev mode")
	}
	if err := verifySessionToken("unsigned-dev", true); err != nil {
		t.Errorf("insecure dev mode accepts a non-empty token, got %v", err)
	}
}
