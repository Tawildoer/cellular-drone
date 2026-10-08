package fc

import (
	"context"
	"errors"
	"time"

	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"

	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
)

// Command carries out one whitelisted browser command (ARCHITECTURE.md,
// Command model). Anything else is refused: this is the safety gate the
// server can't be, since it isn't in the data path.
func (l *Link) Command(ctx context.Context, cmd protocol.Command) protocol.CommandResult {
	l.mu.Lock()
	landed, armed := l.st.Landed, l.st.Armed
	override := l.st.RC.OverrideActive
	vtol := l.st.VtolState
	hasMission := l.plan != nil && len(l.plan.mission.Items) > 0
	l.mu.Unlock()

	switch cmd.Type {
	case "arm":
		if !landed {
			return protocol.Rejected("arm only on the ground")
		}
		// ArduPlane won't arm in RTL/QRTL/QLAND, and the FC is often left in
		// one on the ground: after any RTL landing, and at power-up, when the
		// GCS failsafe fires because no browser is connected yet (FS_GCS_ENABL,
		// ARCHITECTURE.md). QLOITER holds on the ground at zero throttle;
		// mission.start then switches to AUTO.
		l.mu.Lock()
		mode := l.st.mode
		l.mu.Unlock()
		if !armableOnGround(mode) {
			if res := l.setMode(ctx, ModeQLoiter); !res.OK {
				return res
			}
		}
		return l.armDisarm(ctx, true)
	case "disarm":
		if !landed {
			return protocol.Rejected("disarm only when landed")
		}
		return l.armDisarm(ctx, false)
	case "video.config":
		// Agent-local, not MAVLink: the encoder doesn't take presets yet.
		return protocol.Rejected("video presets aren't implemented in the agent yet")
	}

	// Everything else is a mode change, which the RC pilot can veto by
	// holding a manual mode (ADR-0008).
	if override {
		return protocol.CommandResult{OK: false, Reason: "blocked_rc_override", Detail: "the RC pilot has control"}
	}
	switch cmd.Type {
	case "mission.start":
		if !armed {
			return protocol.CommandResult{OK: false, Reason: "preflight_failed", Detail: "not armed"}
		}
		if !hasMission {
			return protocol.CommandResult{OK: false, Reason: "preflight_failed", Detail: "no verified mission on the flight controller"}
		}
		return l.setMode(ctx, ModeAuto)
	case "mode.pause":
		if vtol == "mc" {
			return l.setMode(ctx, ModeQLoiter)
		}
		return l.setMode(ctx, ModeLoiter)
	case "mode.resume":
		return l.setMode(ctx, ModeAuto)
	case "mode.rtl":
		return l.setMode(ctx, ModeRTL)
	case "mode.qland":
		return l.setMode(ctx, ModeQLand)
	}
	return protocol.Rejected("command not allowed: " + cmd.Type)
}

func (l *Link) armDisarm(ctx context.Context, arm bool) protocol.CommandResult {
	p1 := float32(0)
	if arm {
		p1 = 1
	}
	// Never param2 = 21196 (force): ArduPilot's own arming checks stay in charge.
	res := ackResult(l.commandLong(ctx, common.MAV_CMD_COMPONENT_ARM_DISARM, p1))
	if !res.OK {
		return res
	}
	// The ack lands before the heartbeat that shows the new state; wait for
	// it, so a mission.start right after an arm doesn't see "not armed".
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		l.mu.Lock()
		armed := l.st.Armed
		l.mu.Unlock()
		if armed == arm {
			return res
		}
		select {
		case <-ctx.Done():
			return protocol.CommandResult{OK: false, Reason: "timeout"}
		case <-time.After(100 * time.Millisecond):
		}
	}
	return protocol.Rejected("flight controller acknowledged but its state didn't change")
}

func (l *Link) setMode(ctx context.Context, mode uint32) protocol.CommandResult {
	l.mu.Lock()
	m := mode
	l.st.commanded = &m
	l.mu.Unlock()
	return ackResult(l.commandLong(ctx, common.MAV_CMD_DO_SET_MODE, float32(common.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED), float32(mode)))
}

func ackResult(result common.MAV_RESULT, err error) protocol.CommandResult {
	switch {
	case errors.Is(err, errTimeout):
		return protocol.CommandResult{OK: false, Reason: "timeout"}
	case err != nil:
		return protocol.CommandResult{OK: false, Reason: "not_connected", Detail: err.Error()}
	case result != common.MAV_RESULT_ACCEPTED:
		return protocol.Rejected("flight controller: " + resultName(result))
	}
	return protocol.CommandResult{OK: true}
}
