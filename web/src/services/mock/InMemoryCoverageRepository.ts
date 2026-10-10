import type { CoverageSample } from '../../domain'
import type { CoverageRepository } from '../CoverageRepository'

export class InMemoryCoverageRepository implements CoverageRepository {
  private samples: CoverageSample[] = []

  async load(): Promise<CoverageSample[]> {
    return [...this.samples]
  }

  async save(samples: CoverageSample[]): Promise<void> {
    this.samples = [...samples]
  }

  async clear(): Promise<void> {
    this.samples = []
  }
}
