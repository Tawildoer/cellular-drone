package fc

import (
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"

	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
)

func TestSwitchPositionMatchesArduPilot(t *testing.T) {
	cases := []struct {
		pwm uint16
		pos int
		ok  bool
	}{
		{0, 0, false}, {900, 0, false}, {901, 0, true}, {1230, 0, true}, {1231, 1, true},
		{1360, 1, true}, {1361, 2, true}, {1490, 2, true}, {1491, 3, true}, {1500, 3, true},
		{1620, 3, true}, {1621, 4, true}, {1749, 4, true}, {1750, 5, true}, {1800, 5, true},
		{2199, 5, true}, {2200, 0, false},
	}
	for _, c := range cases {
		pos, ok := switchPosition(c.pwm)
		if ok != c.ok || (ok && pos != c.pos) {
			t.Errorf("switchPosition(%d) = %d, %v; want %d, %v", c.pwm, pos, ok, c.pos, c.ok)
		}
	}
}

func TestChannelPWM(t *testing.T) {
	m := &common.MessageRcChannels{Chancount: 8, Chan5Raw: 1800, Chan8Raw: 65535}
	sw := &modeSwitch{channel: 5}
	if pwm, ok := channelPWM(m, sw); !ok || pwm != 1800 {
		t.Errorf("channel 5 = %d, %v", pwm, ok)
	}
	for _, c := range []*modeSwitch{nil, {channel: 0}, {channel: 9}, {channel: 8}} {
		if _, ok := channelPWM(m, c); ok {
			t.Errorf("channelPWM(%+v) should have no reading", c)
		}
	}
}

// SITL's setup: switch on channel 5, position 6 (1800 µs) is AUTO.
func testLink() *Link {
	l := &Link{log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	l.modeSwitch = &modeSwitch{channel: 5, modes: [6]uint32{ModeAuto, ModeRTL, ModeLoiter, ModeFBWA, ModeQLoiter, ModeAuto}}
	l.st.RC.Linked = true
	return l
}

// feedSwitch is what handle does with an RC_CHANNELS message.
func feedSwitch(l *Link, pwm uint16) []Event {
	l.readSwitchLocked(&common.MessageRcChannels{Chancount: 8, Chan5Raw: pwm})
	return l.updateOverrideLocked(0)
}

func TestSwitchOffAutoWhileArmedIsAnOverride(t *testing.T) {
	l := testLink()
	l.st.Armed = true

	if ev := feedSwitch(l, 1800); len(ev) != 0 || l.st.RC.ModeSwitch != "AUTO" {
		t.Fatalf("switch at AUTO: events %v, modeSwitch %q", ev, l.st.RC.ModeSwitch)
	}
	ev := feedSwitch(l, 1500) // position 4: FBWA
	if !l.st.RC.OverrideActive || l.st.RC.ModeSwitch != "FBWA" || len(ev) != 1 ||
		ev[0] != (protocol.RCOverrideEvent{Kind: "rcOverride", Active: true}) {
		t.Fatalf("switch to FBWA: override %v, modeSwitch %q, events %v", l.st.RC.OverrideActive, l.st.RC.ModeSwitch, ev)
	}
	if ev := feedSwitch(l, 1800); l.st.RC.OverrideActive || len(ev) != 1 {
		t.Fatalf("switch back to AUTO should hand back: override %v, events %v", l.st.RC.OverrideActive, ev)
	}
}

func TestSwitchOffAutoWhileDisarmedIsNotAnOverride(t *testing.T) {
	l := testLink()
	if feedSwitch(l, 1500); l.st.RC.OverrideActive {
		t.Error("disarmed on the ground, the switch position isn't a takeover")
	}
}

func TestInferredOverrideStillCountsWithTheSwitchAtAuto(t *testing.T) {
	// A mode the agent didn't command, e.g. another ground station.
	l := testLink()
	l.st.Armed = true
	feedSwitch(l, 1800)
	l.st.inferredOverride = true
	if l.updateOverrideLocked(0); !l.st.RC.OverrideActive {
		t.Error("inferred override ignored")
	}
}

func TestLostRCLinkForgetsTheSwitch(t *testing.T) {
	l := testLink()
	l.st.Armed = true
	l.st.RC.Linked = false
	if feedSwitch(l, 1500); l.st.RC.OverrideActive || l.st.RC.ModeSwitch != "" {
		t.Error("out of range, the switch channel isn't the pilot")
	}
}

func TestRCPreflight(t *testing.T) {
	l := testLink()
	feedSwitch(l, 1800)
	if why := l.rcPreflightLocked(); why != "" {
		t.Errorf("switch at AUTO with RC linked should pass, got %q", why)
	}

	feedSwitch(l, 1500)
	if why := l.rcPreflightLocked(); !strings.Contains(why, "FBWA") {
		t.Errorf("switch at FBWA: %q", why)
	}

	l = testLink()
	l.st.RC.Linked = false
	if why := l.rcPreflightLocked(); !strings.Contains(why, "no RC link") {
		t.Errorf("no RC: %q", why)
	}

	l = testLink()
	l.modeSwitch = nil
	if why := l.rcPreflightLocked(); !strings.Contains(why, "FLTMODE_CH") {
		t.Errorf("switch setup unread: %q", why)
	}

	l = testLink()
	if why := l.rcPreflightLocked(); !strings.Contains(why, "no reading") {
		t.Errorf("no RC_CHANNELS yet: %q", why)
	}
}
