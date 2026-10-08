package main

import "math"

func cosDeg(deg float64) float64 { return math.Cos(deg * math.Pi / 180) }

func distanceM(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371000
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}
