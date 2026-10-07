import { describe, expect, it } from 'vitest'
import { homePositionSchema, missionSchema } from '../../protocol/schemas'
import { translateMission } from '../translate'

// Shared with the agent's Go translator (testdata/mission-translation/README.md).
const goldenFiles = import.meta.glob<string>('../../../../testdata/mission-translation/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const files = Object.keys(goldenFiles).sort()

describe('mission translation golden files', () => {
  it('finds the golden files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(file.split('/').pop()!, () => {
      const golden = JSON.parse(goldenFiles[file]!)
      // Parse through the wire schemas so a golden mission is always one the
      // browser could actually send.
      const mission = missionSchema.parse(golden.mission)
      const home = golden.home === null ? null : homePositionSchema.parse(golden.home)

      const result = translateMission(mission, home)

      expect(result.items).toEqual(golden.expected.items)
      expect(result.fence).toEqual(golden.expected.fence)
      expect(result.params).toEqual(golden.expected.params)
      expect(result.issues.map(({ itemIndex, code, severity }) => ({ itemIndex, code, severity }))).toEqual(
        golden.expected.issues,
      )
    })
  }
})
