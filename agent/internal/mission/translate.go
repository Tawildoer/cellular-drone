// Package mission turns an app Mission (the protocol/ v1 shape) into the
// ArduPlane mission, fence and params the agent uploads (docs/MAVLINK.md,
// ADR-0017). This is the authoritative translator: the browser has a preview
// copy (web/src/ardupilot) for planning, and both must pass the golden files
// in testdata/mission-translation/. Change them together.
package mission

import (
	"fmt"
	"math"
)

// MAV_CMD values used here.
const (
	CmdNavWaypoint                    = 16
	CmdNavLoiterUnlim                 = 17
	CmdNavLoiterTurns                 = 18
	CmdNavReturnToLaunch              = 20
	CmdNavVtolTakeoff                 = 84
	CmdNavVtolLand                    = 85
	CmdNavFencePolygonVertexInclusion = 5001
)

// MAV_FRAME values used here.
const (
	// FrameGlobal is altitude above mean sea level; ArduPilot's home row uses it.
	FrameGlobal = 0
	// FrameGlobalRelativeAlt is altitude above home, for every mission item.
	FrameGlobalRelativeAlt = 3
)

const (
	// ArduPilot packs a waypoint's accept radius and a loiter's turn count
	// into one byte each.
	maxByte = 255
	// Above 255 m, ArduPilot stores a LOITER_TURNS radius in tens of metres,
	// still in one byte.
	maxLoiterTurnsRadiusM = 2550
)

// Mission mirrors missionSchema in web/src/protocol/schemas.ts.
type Mission struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Items     []Item `json:"items"`
	Fence     *Fence `json:"fence,omitempty"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

// Item is the flattened missionItemSchema union; Type says which fields apply.
type Item struct {
	Type                string   `json:"type"`
	Lat                 float64  `json:"lat"`
	Lon                 float64  `json:"lon"`
	AltM                float64  `json:"altM"`
	AcceptRadiusM       *float64 `json:"acceptRadiusM,omitempty"`
	RadiusM             float64  `json:"radiusM"`
	Turns               *float64 `json:"turns,omitempty"`
	UntilUTCMinuteOfDay *float64 `json:"untilUtcMinuteOfDay,omitempty"`
}

type Fence struct {
	Polygon []Point  `json:"polygon"`
	MaxAltM *float64 `json:"maxAltM,omitempty"`
}

type Point struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type Home struct {
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	AltAmslM float64 `json:"altAmslM"`
}

// Row is one flight-controller mission row (VehicleMissionItem in
// web/src/domain/vehicleMission.ts).
type Row struct {
	Seq      int        `json:"seq"`
	Command  int        `json:"command"`
	Frame    int        `json:"frame"`
	Params   [4]float64 `json:"params"`
	Lat      float64    `json:"lat"`
	Lon      float64    `json:"lon"`
	AltM     float64    `json:"altM"`
	AppIndex *int       `json:"appIndex"`
}

type Issue struct {
	ItemIndex *int   `json:"itemIndex"`
	Code      string `json:"code"`
	Severity  string `json:"severity"` // error | warning | info
	Message   string `json:"message"`
}

type Result struct {
	Items  []Row              `json:"items"`
	Fence  []Row              `json:"fence"`
	Params map[string]float64 `json:"params"`
	Issues []Issue            `json:"issues"`
}

func intPtr(v int) *int { return &v }

// Translate converts an app mission. home fills seq 0; nil leaves a
// placeholder, which ArduPilot replaces when it arms. It doesn't validate the
// mission; it reports where ArduPlane would store or fly something differently.
func Translate(m Mission, home *Home) (Result, error) {
	res := Result{Items: []Row{}, Fence: []Row{}, Params: map[string]float64{}, Issues: []Issue{}}

	homeRow := Row{Seq: 0, Command: CmdNavWaypoint, Frame: FrameGlobal}
	if home != nil {
		homeRow.Lat, homeRow.Lon, homeRow.AltM = home.Lat, home.Lon, home.AltAmslM
	} else {
		res.Issues = append(res.Issues, Issue{Code: "home_unknown", Severity: "info",
			Message: "no vehicle home yet, so the home row is a placeholder; ArduPilot sets home when it arms"})
	}
	res.Items = append(res.Items, homeRow)

	for i, item := range m.Items {
		row, err := translateItem(item, i, &res.Issues)
		if err != nil {
			return Result{}, err
		}
		res.Items = append(res.Items, row)
	}

	if m.Fence != nil {
		if count := len(m.Fence.Polygon); count >= 3 {
			for seq, v := range m.Fence.Polygon {
				res.Fence = append(res.Fence, Row{Seq: seq, Command: CmdNavFencePolygonVertexInclusion, Frame: FrameGlobal,
					Params: [4]float64{float64(count), 0, 0, 0}, Lat: v.Lat, Lon: v.Lon})
			}
		}
		if m.Fence.MaxAltM != nil {
			res.Params["FENCE_ALT_MAX"] = *m.Fence.MaxAltM
		}
		res.Issues = append(res.Issues, Issue{Code: "fence_separate_upload", Severity: "info",
			Message: "the fence is its own upload plus FENCE_ALT_MAX, and stays on the vehicle across missions"})
	}
	return res, nil
}

func translateItem(item Item, index int, issues *[]Issue) (Row, error) {
	row := Row{Seq: index + 1, Frame: FrameGlobalRelativeAlt, AppIndex: intPtr(index)}
	issue := func(code, severity, message string) {
		*issues = append(*issues, Issue{ItemIndex: intPtr(index), Code: code, Severity: severity, Message: message})
	}

	switch item.Type {
	case "vtolTakeoff":
		// Climbs over wherever it is; ArduPlane ignores lat/lon.
		row.Command, row.AltM = CmdNavVtolTakeoff, item.AltM

	case "waypoint":
		accept := 0.0
		if item.AcceptRadiusM != nil {
			accept = math.Trunc(*item.AcceptRadiusM)
		}
		if accept > maxByte {
			issue("accept_radius_too_large", "error", fmt.Sprintf("accept radius %g m is over ArduPilot's %d m limit", accept, maxByte))
			accept = maxByte
		}
		row.Command = CmdNavWaypoint
		row.Params = [4]float64{0, accept, 0, 0}
		row.Lat, row.Lon, row.AltM = item.Lat, item.Lon, item.AltM

	case "loiter":
		row.Lat, row.Lon, row.AltM = item.Lat, item.Lon, item.AltM
		if item.UntilUTCMinuteOfDay != nil {
			issue("loiter_until_not_native", "warning",
				"ArduPilot has no loiter-until-time-of-day; sent as an unlimited loiter that the agent or an FC script must end (ADR-0017)")
			row.Command = CmdNavLoiterUnlim
			row.Params = [4]float64{0, 0, item.RadiusM, 0}
			break
		}
		turns := 1.0
		if item.Turns != nil {
			turns = *item.Turns
		}
		if turns > maxByte {
			issue("loiter_turns_too_many", "error", fmt.Sprintf("%g laps is over ArduPilot's %d-lap limit", turns, maxByte))
			turns = maxByte
		}
		row.Command = CmdNavLoiterTurns
		// param4 = 1: leave along the next leg (ADR-0013).
		row.Params = [4]float64{turns, 0, loiterTurnsRadius(item.RadiusM, issue), 1}

	case "vtolLand":
		row.Command = CmdNavVtolLand
		row.Lat, row.Lon = item.Lat, item.Lon

	case "returnToLaunch":
		// VTOL landing at home comes from Q_RTL_MODE, a vehicle parameter.
		row.Command = CmdNavReturnToLaunch

	default:
		// Never guess at an unknown item: refusing is the safe answer.
		return Row{}, fmt.Errorf("mission item %d: unknown type %q", index, item.Type)
	}
	return row, nil
}

// loiterTurnsRadius is the radius ArduPilot will actually hold: whole metres
// up to 255, then rounded down to tens of metres.
func loiterTurnsRadius(radiusM float64, issue func(code, severity, message string)) float64 {
	whole := math.Trunc(radiusM)
	if whole <= maxByte {
		return whole
	}
	if whole > maxLoiterTurnsRadiusM {
		issue("loiter_radius_too_large", "error",
			fmt.Sprintf("loiter radius %g m is over ArduPilot's %d m limit for counted laps", radiusM, maxLoiterTurnsRadiusM))
		return maxLoiterTurnsRadiusM
	}
	stored := math.Floor(whole/10) * 10
	if stored != radiusM {
		issue("loiter_radius_rounded", "info",
			fmt.Sprintf("ArduPilot stores radii over %d m in tens of metres: %g m becomes %g m", maxByte, radiusM, stored))
	}
	return stored
}

// AppIndexForSeq maps a flight-controller seq (MISSION_CURRENT) to the app
// item index for MissionProgress.currentIndex, or nil for home and added rows.
func AppIndexForSeq(rows []Row, seq int) *int {
	for _, r := range rows {
		if r.Seq == seq {
			return r.AppIndex
		}
	}
	return nil
}
