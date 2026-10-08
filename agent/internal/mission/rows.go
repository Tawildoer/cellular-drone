package mission

import (
	"fmt"
	"hash/crc32"
	"math"
)

// ArduPilot stores lat/lon as 1e-7 degree integers, altitude in cm and
// params as float32, so a readback never matches an upload bit for bit.
// Same tolerances as sameMissionItems in web/src/ardupilot/describe.ts.
const (
	latLonToleranceDeg = 2e-7
	altToleranceM      = 0.02
	paramTolerance     = 1e-3
)

// Same reports whether two mission lists say the same thing. Home (seq 0) is
// ignored, since ArduPilot rewrites it on arming, and so are frames, since
// ArduPilot reads back its own frame for a row.
func Same(a, b []Row) bool {
	a, b = withoutHome(a), withoutHome(b)
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !sameRow(a[i], b[i]) {
			return false
		}
	}
	return true
}

func withoutHome(rows []Row) []Row {
	if len(rows) > 0 && rows[0].Seq == 0 {
		return rows[1:]
	}
	return rows
}

func sameRow(a, b Row) bool {
	if a.Seq != b.Seq || a.Command != b.Command {
		return false
	}
	for i := range a.Params {
		if math.Abs(a.Params[i]-b.Params[i]) > paramTolerance {
			return false
		}
	}
	return math.Abs(a.Lat-b.Lat) <= latLonToleranceDeg &&
		math.Abs(a.Lon-b.Lon) <= latLonToleranceDeg &&
		math.Abs(a.AltM-b.AltM) <= altToleranceM
}

// WithAppIndices copies each app index from planned onto the matching seq of
// readback. Only meaningful once Same(planned, readback) holds.
func WithAppIndices(readback, planned []Row) []Row {
	out := make([]Row, len(readback))
	for i, r := range readback {
		r.AppIndex = nil
		for _, p := range planned {
			if p.Seq == r.Seq {
				r.AppIndex = p.AppIndex
				break
			}
		}
		out[i] = r
	}
	return out
}

// FromRows rebuilds an app Mission from a flight controller's mission, for
// when it holds one the agent didn't upload this run (agent restarted, or a
// ground-station tool changed it). It's the inverse of Translate for the
// rows Translate writes, and fails on anything else: the app can't show or
// edit a command it has no item for. The returned rows carry app indices.
func FromRows(rows []Row) (Mission, []Row, error) {
	m := Mission{Items: []Item{}}
	out := make([]Row, len(rows))
	copy(out, rows)
	for i := range out {
		out[i].AppIndex = nil
	}

	for i := 1; i < len(out); i++ {
		r := out[i]
		index := len(m.Items)
		var item Item
		switch r.Command {
		case CmdNavVtolTakeoff:
			item = Item{Type: "vtolTakeoff", AltM: r.AltM}
		case CmdNavWaypoint:
			item = Item{Type: "waypoint", Lat: r.Lat, Lon: r.Lon, AltM: r.AltM}
			if r.Params[1] > 0 {
				accept := r.Params[1]
				item.AcceptRadiusM = &accept
			}
		case CmdNavLoiterTurns:
			turns := r.Params[0]
			item = Item{Type: "loiter", Lat: r.Lat, Lon: r.Lon, AltM: r.AltM, RadiusM: math.Abs(r.Params[2]), Turns: &turns}
		case CmdNavLoiterUnlim:
			// Only the clock-mode pair Translate writes; a bare unlimited
			// loiter has no app item.
			if i+1 >= len(out) || out[i+1].Command != CmdDoSendScriptMessage || out[i+1].Params[0] != LoiterUntilScriptMsgID {
				return Mission{}, nil, fmt.Errorf("row %d: unlimited loiter without a loiter_until marker", r.Seq)
			}
			until := out[i+1].Params[1]
			item = Item{Type: "loiter", Lat: r.Lat, Lon: r.Lon, AltM: r.AltM, RadiusM: math.Abs(r.Params[2]), UntilUTCMinuteOfDay: &until}
			i++ // the marker row belongs to this item
		case CmdNavVtolLand:
			item = Item{Type: "vtolLand", Lat: r.Lat, Lon: r.Lon}
		case CmdNavReturnToLaunch:
			item = Item{Type: "returnToLaunch"}
		default:
			return Mission{}, nil, fmt.Errorf("row %d: MAV_CMD %d has no app mission item", r.Seq, r.Command)
		}
		out[r.Seq].AppIndex = intPtr(index)
		m.Items = append(m.Items, item)
	}

	// A stable id for the same contents, so re-reading the FC doesn't make
	// the app think the mission changed.
	sum := crc32.NewIEEE()
	for _, r := range withoutHome(out) {
		fmt.Fprintf(sum, "%d:%d:%.3f,%.3f,%.3f,%.3f:%.7f,%.7f,%.2f;", r.Seq, r.Command,
			r.Params[0], r.Params[1], r.Params[2], r.Params[3], r.Lat, r.Lon, r.AltM)
	}
	m.ID = fmt.Sprintf("fc-%08x", sum.Sum32())
	m.Name = "On flight controller"
	return m, out, nil
}
