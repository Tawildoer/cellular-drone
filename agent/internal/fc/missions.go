package fc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"
	"github.com/bluenviron/gomavlib/v3/pkg/message"

	"github.com/tomwildoer/cellular-drone/agent/internal/mission"
	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
)

const (
	transferStepTimeout = 1500 * time.Millisecond
	transferRetries     = 5
)

// UploadMission translates and uploads an app mission, then reads it back and
// checks the FC holds exactly that (docs/MAVLINK.md, Upload). On success it
// returns the readback, which the browser shows as what the aircraft will
// actually fly.
func (l *Link) UploadMission(ctx context.Context, m mission.Mission) (protocol.CommandResult, []mission.Row) {
	l.mu.Lock()
	flying := !l.st.Landed
	home := l.st.Home
	l.mu.Unlock()
	if flying {
		// Same rule as the mock drone: no mission changes in the air.
		return protocol.Rejected("cannot change the mission while flying"), nil
	}

	if err := mission.Validate(m); err != nil {
		return protocol.Rejected(err.Error()), nil
	}
	var h *mission.Home
	if home != nil {
		h = &mission.Home{Lat: home.Lat, Lon: home.Lon, AltAmslM: home.AltAmslM}
	}
	tr, err := mission.Translate(m, h)
	if err != nil {
		return protocol.Rejected(err.Error()), nil
	}
	// The agent is the authority: it won't upload something ArduPlane would
	// fly differently from the plan.
	var problems []string
	for _, is := range tr.Issues {
		if is.Severity == "error" {
			problems = append(problems, is.Message)
		}
	}
	if len(problems) > 0 {
		return protocol.Rejected(strings.Join(problems, "; ")), nil
	}

	l.transferMu.Lock()
	defer l.transferMu.Unlock()

	if err := l.uploadList(ctx, common.MAV_MISSION_TYPE_MISSION, tr.Items); err != nil {
		return protocol.Rejected("mission upload: " + err.Error()), nil
	}
	if err := l.applyFence(ctx, m, tr); err != nil {
		return protocol.Rejected("fence: " + err.Error()), nil
	}
	readback, err := l.downloadList(ctx, common.MAV_MISSION_TYPE_MISSION)
	if err != nil {
		return protocol.Rejected("mission readback: " + err.Error()), nil
	}
	if !mission.Same(tr.Items, readback) {
		l.log.Warn("mission_readback_mismatch", "uploaded", len(tr.Items), "readback", len(readback))
		return protocol.Rejected("the flight controller's copy differs from what was uploaded"), nil
	}

	rows := mission.WithAppIndices(readback, tr.Items)
	l.mu.Lock()
	l.plan = &plannedMission{mission: m, rows: rows}
	l.mu.Unlock()
	l.log.Info("mission_uploaded", "mission_id", m.ID, "rows", len(rows), "fence_vertices", len(tr.Fence))
	return protocol.CommandResult{OK: true}, rows
}

// applyFence makes the FC's fence match the mission's: the polygon as its own
// upload, plus FENCE_ALT_MAX / FENCE_TYPE / FENCE_ENABLE. These are the only
// parameters the agent ever writes (docs/MAVLINK.md).
func (l *Link) applyFence(ctx context.Context, m mission.Mission, tr mission.Result) error {
	if err := l.uploadList(ctx, common.MAV_MISSION_TYPE_FENCE, tr.Fence); err != nil {
		return err
	}
	fenceType := 0.0
	if len(tr.Fence) > 0 {
		fenceType += 4 // polygon
	}
	if alt, ok := tr.Params["FENCE_ALT_MAX"]; ok {
		fenceType += 1 // max altitude
		if err := l.setParam(ctx, "FENCE_ALT_MAX", alt); err != nil {
			return err
		}
	}
	if fenceType > 0 {
		if err := l.setParam(ctx, "FENCE_TYPE", fenceType); err != nil {
			return err
		}
	}
	enable := 0.0
	if m.Fence != nil && fenceType > 0 {
		enable = 1
	}
	return l.setParam(ctx, "FENCE_ENABLE", enable)
}

// CurrentMission is the mission the FC holds, as an app Mission: the one the
// agent uploaded if the FC still matches it, otherwise one rebuilt from the
// FC's rows (nil if it's empty or holds commands the app can't show).
func (l *Link) CurrentMission(ctx context.Context) (*mission.Mission, error) {
	l.transferMu.Lock()
	readback, err := l.downloadList(ctx, common.MAV_MISSION_TYPE_MISSION)
	l.transferMu.Unlock()
	if err != nil {
		return nil, err
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	if l.plan != nil && mission.Same(l.plan.rows, readback) {
		m := l.plan.mission
		return &m, nil
	}
	if len(readback) <= 1 {
		l.plan = nil
		return nil, nil
	}
	m, rows, err := mission.FromRows(readback)
	if err != nil {
		l.plan = nil
		l.log.Info("fc_mission_not_representable", "reason", err.Error())
		return nil, nil
	}
	l.plan = &plannedMission{mission: m, rows: rows}
	l.log.Info("fc_mission_adopted", "mission_id", m.ID, "items", len(m.Items))
	return &m, nil
}

// uploadList runs the MAVLink mission upload: MISSION_COUNT, then the FC
// requests each item, then acknowledges.
func (l *Link) uploadList(ctx context.Context, missionType common.MAV_MISSION_TYPE, rows []mission.Row) error {
	sys, err := l.target()
	if err != nil {
		return err
	}
	w := l.expect(func(m message.Message) bool {
		switch r := m.(type) {
		case *common.MessageMissionRequestInt:
			return r.MissionType == missionType
		case *common.MessageMissionRequest:
			return r.MissionType == missionType
		case *common.MessageMissionAck:
			return r.MissionType == missionType
		}
		return false
	})
	defer l.done(w)

	sendCount := func() error {
		return l.send(&common.MessageMissionCount{TargetSystem: sys, TargetComponent: autopilotComp, Count: uint16(len(rows)), MissionType: missionType})
	}
	if err := sendCount(); err != nil {
		return err
	}
	lastSent := -1
	for retries := 0; ; {
		msg, err := w.next(ctx, transferStepTimeout)
		if errors.Is(err, errTimeout) {
			if retries++; retries > transferRetries {
				return err
			}
			// Repeat whatever we sent last; the FC re-requests on its own too.
			if lastSent < 0 {
				err = sendCount()
			} else {
				err = l.sendItem(sys, missionType, rows[lastSent])
			}
			if err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		retries = 0

		var seq uint16
		switch r := msg.(type) {
		case *common.MessageMissionAck:
			if r.Type != common.MAV_MISSION_ACCEPTED {
				return fmt.Errorf("rejected: %v", r.Type)
			}
			if lastSent != len(rows)-1 {
				return fmt.Errorf("acknowledged after %d of %d items", lastSent+1, len(rows))
			}
			return nil
		case *common.MessageMissionRequestInt:
			seq = r.Seq
		case *common.MessageMissionRequest:
			seq = r.Seq
		}
		if int(seq) >= len(rows) {
			return fmt.Errorf("asked for item %d of %d", seq, len(rows))
		}
		if err := l.sendItem(sys, missionType, rows[seq]); err != nil {
			return err
		}
		if int(seq) > lastSent {
			lastSent = int(seq)
		}
	}
}

func (l *Link) sendItem(sys uint8, missionType common.MAV_MISSION_TYPE, r mission.Row) error {
	current := uint8(0)
	if r.Seq == 0 && missionType == common.MAV_MISSION_TYPE_MISSION {
		current = 1
	}
	return l.send(&common.MessageMissionItemInt{
		TargetSystem: sys, TargetComponent: autopilotComp,
		Seq: uint16(r.Seq), Frame: common.MAV_FRAME(r.Frame), Command: common.MAV_CMD(r.Command),
		Current: current, Autocontinue: 1,
		Param1: float32(r.Params[0]), Param2: float32(r.Params[1]), Param3: float32(r.Params[2]), Param4: float32(r.Params[3]),
		X: int32(roundTo(r.Lat * 1e7)), Y: int32(roundTo(r.Lon * 1e7)), Z: float32(r.AltM),
		MissionType: missionType,
	})
}

// downloadList reads a list back: MISSION_REQUEST_LIST, MISSION_COUNT, then
// each item by seq, then an ack.
func (l *Link) downloadList(ctx context.Context, missionType common.MAV_MISSION_TYPE) ([]mission.Row, error) {
	sys, err := l.target()
	if err != nil {
		return nil, err
	}

	countW := l.expect(func(m message.Message) bool {
		c, ok := m.(*common.MessageMissionCount)
		return ok && c.MissionType == missionType
	})
	var count *common.MessageMissionCount
	for attempt := 0; attempt <= transferRetries && count == nil; attempt++ {
		if err := l.send(&common.MessageMissionRequestList{TargetSystem: sys, TargetComponent: autopilotComp, MissionType: missionType}); err != nil {
			l.done(countW)
			return nil, err
		}
		msg, err := countW.next(ctx, transferStepTimeout)
		if errors.Is(err, errTimeout) {
			continue
		}
		if err != nil {
			l.done(countW)
			return nil, err
		}
		count = msg.(*common.MessageMissionCount)
	}
	l.done(countW)
	if count == nil {
		return nil, errTimeout
	}

	rows := make([]mission.Row, 0, count.Count)
	for seq := uint16(0); seq < count.Count; seq++ {
		row, err := l.requestItem(ctx, sys, missionType, seq)
		if err != nil {
			return nil, fmt.Errorf("item %d: %w", seq, err)
		}
		rows = append(rows, row)
	}
	_ = l.send(&common.MessageMissionAck{TargetSystem: sys, TargetComponent: autopilotComp, Type: common.MAV_MISSION_ACCEPTED, MissionType: missionType})
	return rows, nil
}

func (l *Link) requestItem(ctx context.Context, sys uint8, missionType common.MAV_MISSION_TYPE, seq uint16) (mission.Row, error) {
	w := l.expect(func(m message.Message) bool {
		it, ok := m.(*common.MessageMissionItemInt)
		return ok && it.MissionType == missionType && it.Seq == seq
	})
	defer l.done(w)
	for attempt := 0; attempt <= transferRetries; attempt++ {
		if err := l.send(&common.MessageMissionRequestInt{TargetSystem: sys, TargetComponent: autopilotComp, Seq: seq, MissionType: missionType}); err != nil {
			return mission.Row{}, err
		}
		msg, err := w.next(ctx, transferStepTimeout)
		if errors.Is(err, errTimeout) {
			continue
		}
		if err != nil {
			return mission.Row{}, err
		}
		it := msg.(*common.MessageMissionItemInt)
		return mission.Row{
			Seq: int(it.Seq), Command: int(it.Command), Frame: int(it.Frame),
			Params: [4]float64{float64(it.Param1), float64(it.Param2), float64(it.Param3), float64(it.Param4)},
			Lat:    float64(it.X) / 1e7, Lon: float64(it.Y) / 1e7, AltM: float64(it.Z),
		}, nil
	}
	return mission.Row{}, errTimeout
}

// setParam writes a parameter and waits for the FC to echo the new value.
func (l *Link) setParam(ctx context.Context, name string, value float64) error {
	sys, err := l.target()
	if err != nil {
		return err
	}
	w := l.expect(func(m message.Message) bool {
		p, ok := m.(*common.MessageParamValue)
		return ok && p.ParamId == name
	})
	defer l.done(w)
	for attempt := 0; attempt <= transferRetries; attempt++ {
		if err := l.send(&common.MessageParamSet{TargetSystem: sys, TargetComponent: autopilotComp, ParamId: name,
			ParamValue: float32(value), ParamType: common.MAV_PARAM_TYPE_REAL32}); err != nil {
			return err
		}
		msg, err := w.next(ctx, transferStepTimeout)
		if errors.Is(err, errTimeout) {
			continue
		}
		if err != nil {
			return err
		}
		if got := float64(msg.(*common.MessageParamValue).ParamValue); got != float64(float32(value)) {
			return fmt.Errorf("%s is %g after setting %g", name, got, value)
		}
		return nil
	}
	return errTimeout
}

func roundTo(v float64) float64 {
	if v < 0 {
		return v - 0.5
	}
	return v + 0.5
}

// Param reads one parameter from the FC (PARAM_REQUEST_READ). Read-only, so
// unlike setParam it isn't restricted to the fence parameters.
func (l *Link) Param(ctx context.Context, name string) (float64, error) {
	sys, err := l.target()
	if err != nil {
		return 0, err
	}
	w := l.expect(func(m message.Message) bool {
		p, ok := m.(*common.MessageParamValue)
		return ok && p.ParamId == name
	})
	defer l.done(w)
	for attempt := 0; attempt <= transferRetries; attempt++ {
		if err := l.send(&common.MessageParamRequestRead{TargetSystem: sys, TargetComponent: autopilotComp, ParamId: name, ParamIndex: -1}); err != nil {
			return 0, err
		}
		msg, err := w.next(ctx, transferStepTimeout)
		if errors.Is(err, errTimeout) {
			continue
		}
		if err != nil {
			return 0, err
		}
		return float64(msg.(*common.MessageParamValue).ParamValue), nil
	}
	return 0, errTimeout
}
