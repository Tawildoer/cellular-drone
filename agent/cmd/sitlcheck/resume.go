package main

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/tomwildoer/cellular-drone/agent/internal/fc"
	"github.com/tomwildoer/cellular-drone/agent/internal/mission"
	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
)

// resumeExperiment measures what ArduPlane does after a pause mid-leg: does
// it rejoin the planned leg, or fly straight from where it resumed to the
// target? And how early does it count a waypoint as reached? The answers
// decide how the map draws the path and how the mock flies (ADR-0017).
func resumeExperiment(ctx context.Context, link *fc.Link, home protocol.HomePosition, waitForPauseLimit bool) {
	for _, name := range []string{"WP_RADIUS", "NAVL1_PERIOD", "ROLL_LIMIT_DEG", "AIRSPEED_CRUISE", "WP_LOITER_RAD"} {
		v, err := link.Param(ctx, name)
		fmt.Printf("  %-16s %v %v\n", name, v, errText(err))
	}

	step("uploading a long east-west leg")
	aLat, aLon := offsetM(home, 0, 600)
	bLat, bLon := offsetM(home, 1800, 600)
	m := mission.Mission{ID: "resume-exp", Name: "Resume experiment", Items: []mission.Item{
		{Type: "vtolTakeoff", AltM: 40},
		{Type: "waypoint", Lat: aLat, Lon: aLon, AltM: 60},
		{Type: "waypoint", Lat: bLat, Lon: bLon, AltM: 60},
		{Type: "returnToLaunch"},
	}}
	result, _ := link.UploadMission(ctx, m)
	expectOK("upload", result)
	armAndStart(ctx, link)

	step("flying until ~400 m along the A→B leg")
	waitFor(ctx, link, 4*time.Minute, func(s protocol.VehicleState) bool {
		east, _ := enu(aLat, aLon, s.Position.Lat, s.Position.Lon)
		return s.MissionProgress.CurrentIndex == 2 && east > 400
	})
	s := link.State()
	east, north := enu(aLat, aLon, s.Position.Lat, s.Position.Lon)
	fmt.Printf("  on the leg: %.0f m along, %.0f m off it\n", east, north)

	var p protocol.Position
	if waitForPauseLimit {
		step("pause, and don't resume: pause_resume.lua should resume by itself after 120 s")
		expectOK("mode.pause", link.Command(ctx, protocol.Command{Type: "mode.pause"}))
		paused := time.Now()
		waitFor(ctx, link, 3*time.Minute, func(s protocol.VehicleState) bool { return s.FlightMode == "AUTO" })
		fmt.Printf("  back in AUTO after %.0f s, nobody resumed it\n", time.Since(paused).Seconds())
		p = link.State().Position
	} else {
		step("pause 25 s (fixed-wing LOITER circles where it is)")
		expectOK("mode.pause", link.Command(ctx, protocol.Command{Type: "mode.pause"}))
		time.Sleep(25 * time.Second)
		p = link.State().Position
	}
	pEast, pNorth := enu(aLat, aLon, p.Lat, p.Lon)
	fmt.Printf("  resuming from %.0f m along, %.0f m off the leg\n", pEast, pNorth)

	step("resume, then compare the track with both candidate lines")
	if !waitForPauseLimit {
		expectOK("mode.resume", link.Command(ctx, protocol.Command{Type: "mode.resume"}))
	}
	bEast, bNorth := enu(aLat, aLon, bLat, bLon)
	var sumLeg, sumDirect float64
	var n int
	start := time.Now()
	for time.Since(start) < 40*time.Second {
		time.Sleep(2 * time.Second)
		q := link.State().Position
		qe, qn := enu(aLat, aLon, q.Lat, q.Lon)
		toLeg := math.Abs(qn) // the leg runs due east along north = 0
		toDirect := distToLine(qe, qn, pEast, pNorth, bEast, bNorth)
		sumLeg += toLeg
		sumDirect += toDirect
		n++
		fmt.Printf("  t+%2.0fs  %5.0f m along  off leg %5.1f m  off resume→B line %5.1f m\n", time.Since(start).Seconds(), qe, toLeg, toDirect)
	}
	fmt.Printf("  MEAN off leg %.1f m, off resume→B line %.1f m\n", sumLeg/float64(n), sumDirect/float64(n))

	step("RTL")
	expectOK("mode.rtl", link.Command(ctx, protocol.Command{Type: "mode.rtl"}))
}

func armAndStart(ctx context.Context, link *fc.Link) {
	step("arming")
	deadline := time.Now().Add(2 * time.Minute)
	for !link.Command(ctx, protocol.Command{Type: "arm"}).OK {
		if time.Now().After(deadline) {
			fail("could not arm")
		}
		time.Sleep(3 * time.Second)
	}
	expectOK("mission.start", link.Command(ctx, protocol.Command{Type: "mission.start"}))
}

func offsetM(home protocol.HomePosition, eastM, northM float64) (float64, float64) {
	const mPerDeg = 111320.0
	return home.Lat + northM/mPerDeg, home.Lon + eastM/(mPerDeg*cosDeg(home.Lat))
}

// enu is p relative to origin, in local east/north metres.
func enu(originLat, originLon, lat, lon float64) (float64, float64) {
	const mPerDeg = 111320.0
	return (lon - originLon) * mPerDeg * cosDeg(originLat), (lat - originLat) * mPerDeg
}

// distToLine is the distance from (x, y) to the infinite line through a and b.
func distToLine(x, y, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	return math.Abs(dy*(x-ax)-dx*(y-ay)) / math.Hypot(dx, dy)
}

func errText(err error) string {
	if err != nil {
		return "(" + err.Error() + ")"
	}
	return ""
}
