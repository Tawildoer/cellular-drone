import type { CoverageSample } from '../domain'

/** Where the cell coverage the drone has measured is kept, so the planned
 * route can be coloured by what earlier flights saw. */
export interface CoverageRepository {
  load(): Promise<CoverageSample[]>
  save(samples: CoverageSample[]): Promise<void>
  clear(): Promise<void>
}
