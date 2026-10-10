import { fromLocalEastNorthM, haversineDistanceM, type CellularSignal, type GeoPoint } from '../../domain'

/**
 * The mock's LTE signal: a few towers placed round home, each heard at a
 * strength that falls with distance, plus slow "shadowing" from the
 * landscape. Close to the ground the signal fades fast (buildings, trees);
 * up high the path is clear, so every tower is heard better, but they then
 * interfere with one another and SINR drops. That's the real effect that
 * makes cellular drones interesting, in a few lines. Deterministic in
 * position, so the same route measures the same coverage each flight, with
 * a little fast fading on top.
 */

interface Tower {
  eastM: number
  northM: number
  band: string
}

/** Positions round home, picked to leave a weaker patch to the south-west. */
const TOWERS: Tower[] = [
  { eastM: 900, northM: 1200, band: 'B28' },
  { eastM: -2600, northM: 400, band: 'B3' },
  { eastM: 400, northM: -3400, band: 'B28' },
  { eastM: 4200, northM: -900, band: 'B7' },
]

const TOWER_HEIGHT_M = 30
/** RSRP heard 100 m from a tower. */
const RSRP_AT_100M_DBM = -60
/** Path-loss exponents: cluttered near the ground, near free space up high. */
const EXPONENT_GROUND = 3.6
const EXPONENT_CLEAR = 2.2
/** Height above home at which the path counts as clear. */
const CLEAR_HEIGHT_M = 100
/** Tower antennas tilt down: above them, the drone is off the main beam,
 * losing this many dB per degree squared of elevation (5° costs ~4 dB). */
const OFF_BEAM_DB_PER_DEG_SQ = 0.15
const MAX_OFF_BEAM_DB = 18
const NOISE_FLOOR_DBM = -122
/** Share of the time neighbouring cells are transmitting. */
const NEIGHBOUR_LOAD = 0.5
const FAST_FADE_DB = 1.5

function toMw(dbm: number): number {
  return 10 ** (dbm / 10)
}

/** Smooth, repeatable ±6 dB of landscape: a few overlapping waves. */
function shadowingDb(eastM: number, northM: number): number {
  return (
    3 * Math.sin(eastM / 310 + 1.3) * Math.cos(northM / 270) +
    2 * Math.sin((eastM + northM) / 520 + 0.4) +
    1.2 * Math.cos((eastM - 2 * northM) / 190)
  )
}

export function simulatedCellSignal(home: GeoPoint, position: GeoPoint, altRelM: number, rng: () => number = Math.random): CellularSignal {
  const height = Math.max(0, altRelM)
  const clear = Math.min(1, height / CLEAR_HEIGHT_M)
  const exponent = EXPONENT_GROUND + (EXPONENT_CLEAR - EXPONENT_GROUND) * clear
  // The drone's east/north of home, for the shadowing field.
  const eastM = haversineDistanceM(home, { lat: home.lat, lon: position.lon }) * Math.sign(position.lon - home.lon)
  const northM = haversineDistanceM(home, { lat: position.lat, lon: home.lon }) * Math.sign(position.lat - home.lat)
  // Up high the landscape matters less.
  const shadow = shadowingDb(eastM, northM) * (1 - 0.6 * clear)

  const heard = TOWERS.map((t) => {
    const towerPoint = fromLocalEastNorthM(home, t.eastM, t.northM)
    const groundM = Math.max(1, haversineDistanceM(towerPoint, position))
    const above = height - TOWER_HEIGHT_M
    const slantM = Math.hypot(groundM, above)
    const elevationDeg = (Math.atan2(above, groundM) * 180) / Math.PI
    const offBeam = elevationDeg > 0 ? Math.min(MAX_OFF_BEAM_DB, OFF_BEAM_DB_PER_DEG_SQ * elevationDeg ** 2) : 0
    const rsrp = RSRP_AT_100M_DBM - 10 * exponent * Math.log10(Math.max(1, slantM / 100)) - offBeam + shadow
    return { rsrp, band: t.band }
  })
  heard.sort((a, b) => b.rsrp - a.rsrp)
  const [serving, ...others] = heard
  const fade = (rng() * 2 - 1) * FAST_FADE_DB
  const rsrpDbm = serving!.rsrp + fade
  const interferenceMw = others.reduce((sum, o) => sum + NEIGHBOUR_LOAD * toMw(o.rsrp), toMw(NOISE_FLOOR_DBM))
  const sinrDb = 10 * Math.log10(toMw(rsrpDbm) / interferenceMw)
  return {
    rsrpDbm: Math.round(rsrpDbm),
    sinrDb: Math.round(Math.min(30, sinrDb) * 10) / 10,
    band: serving!.band,
  }
}
