export type VideoPreset = 'low' | 'medium' | 'high'

/**
 * The full set of commands the browser may send. There is deliberately no
 * manual-control variant (no RC_CHANNELS_OVERRIDE / MANUAL_CONTROL / setpoints) —
 * see CLAUDE.md and ADR-0008. The physical ELRS radio is the only manual path.
 */
export type Command =
  | { type: 'arm' }
  | { type: 'disarm' }
  | { type: 'mission.start' }
  | { type: 'mode.pause' }
  | { type: 'mode.resume' }
  | { type: 'mode.rtl' }
  | { type: 'mode.qland' }
  | { type: 'video.config'; preset: VideoPreset }

export type CommandRejectionReason =
  | 'rejected_by_vehicle'
  | 'blocked_rc_override'
  | 'preflight_failed'
  | 'timeout'
  | 'not_connected'
  | 'unauthorised'

export type CommandResult = { ok: true } | { ok: false; reason: CommandRejectionReason; detail?: string }
