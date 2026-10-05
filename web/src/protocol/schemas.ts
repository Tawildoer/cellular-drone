import { z } from 'zod'

/** zod mirrors of the domain/ vocabulary (docs/FRONTEND.md section 3). This is
 * the wire contract: it stays decoupled from domain/ types so the two can be
 * versioned independently, but uses the same field names and units. */

export const flightModeSchema = z.enum([
  'AUTO',
  'LOITER',
  'QLOITER',
  'RTL',
  'QLAND',
  'QHOVER',
  'FBWA',
  'MANUAL',
  'UNKNOWN',
])

export const vtolStateSchema = z.enum(['mc', 'fw', 'transition'])
export const gpsFixTypeSchema = z.enum(['none', 'fix2d', 'fix3d', 'rtk'])

export const positionSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  altRelM: z.number(),
  altAmslM: z.number(),
})

export const attitudeSchema = z.object({
  rollDeg: z.number(),
  pitchDeg: z.number(),
  yawDeg: z.number(),
})

export const batterySchema = z.object({
  voltageV: z.number(),
  currentA: z.number(),
  percent: z.number(),
})

export const gpsStatusSchema = z.object({
  fixType: gpsFixTypeSchema,
  satellites: z.number(),
  hdop: z.number(),
})

export const missionProgressSchema = z.object({
  currentIndex: z.number(),
  total: z.number(),
})

export const rcStatusSchema = z.object({
  linked: z.boolean(),
  overrideActive: z.boolean(),
})

export const failsafeFlagsSchema = z.object({
  gcs: z.boolean(),
  battery: z.boolean(),
  geofence: z.boolean(),
  rc: z.boolean(),
})

export const homePositionSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  altAmslM: z.number(),
})

export const vehicleStateSchema = z.object({
  vehicleId: z.string(),
  position: positionSchema,
  attitude: attitudeSchema,
  groundSpeedMps: z.number(),
  airspeedMps: z.number(),
  climbMps: z.number(),
  battery: batterySchema,
  gps: gpsStatusSchema,
  flightMode: flightModeSchema,
  armed: z.boolean(),
  vtolState: vtolStateSchema,
  landed: z.boolean(),
  home: homePositionSchema.nullable(),
  missionProgress: missionProgressSchema,
  rc: rcStatusSchema,
  failsafe: failsafeFlagsSchema,
  updatedAt: z.number(),
})

export const vehicleEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), text: z.string(), ts: z.number() }),
  z.object({
    kind: z.literal('failsafe'),
    flag: z.enum(['gcs', 'battery', 'geofence', 'rc']),
    active: z.boolean(),
    ts: z.number(),
  }),
  z.object({ kind: z.literal('modeChanged'), mode: flightModeSchema, ts: z.number() }),
  z.object({ kind: z.literal('rcOverride'), active: z.boolean(), ts: z.number() }),
])

export const missionItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('vtolTakeoff'), altM: z.number() }),
  z.object({
    type: z.literal('waypoint'),
    lat: z.number(),
    lon: z.number(),
    altM: z.number(),
    acceptRadiusM: z.number().optional(),
  }),
  z.object({
    type: z.literal('loiter'),
    lat: z.number(),
    lon: z.number(),
    altM: z.number(),
    radiusM: z.number(),
    turns: z.number().optional(),
    untilUtcMinuteOfDay: z.number().optional(),
  }),
  z.object({ type: z.literal('vtolLand'), lat: z.number(), lon: z.number() }),
  z.object({ type: z.literal('returnToLaunch') }),
])

export const fenceSchema = z.object({
  polygon: z.array(z.object({ lat: z.number(), lon: z.number() })),
  maxAltM: z.number().optional(),
})

export const missionSchema = z.object({
  id: z.string(),
  name: z.string(),
  items: z.array(missionItemSchema),
  fence: fenceSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('arm') }),
  z.object({ type: z.literal('disarm') }),
  z.object({ type: z.literal('mission.start') }),
  z.object({ type: z.literal('mode.pause') }),
  z.object({ type: z.literal('mode.resume') }),
  z.object({ type: z.literal('mode.rtl') }),
  z.object({ type: z.literal('mode.qland') }),
  z.object({ type: z.literal('video.config'), preset: z.enum(['low', 'medium', 'high']) }),
])

export const commandResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum([
      'rejected_by_vehicle',
      'blocked_rc_override',
      'preflight_failed',
      'timeout',
      'not_connected',
      'unauthorised',
    ]),
    detail: z.string().optional(),
  }),
])
