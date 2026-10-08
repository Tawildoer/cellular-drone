import type { GeoPoint } from '../domain'

/**
 * Ground elevation for the planner's terrain profile. UI code only sees this
 * interface; app/config picks the source. Optional: with none configured the
 * profile shows the planned heights without the ground under them.
 */
export interface TerrainService {
  /** For the panel's footnote, e.g. "MapTiler terrain, ~30 m grid". */
  readonly description: string
  /** Ground elevation in metres AMSL at each point, null where there's no data. */
  elevationsM(points: GeoPoint[], signal?: AbortSignal): Promise<(number | null)[]>
}
