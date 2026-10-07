import type { HomePosition, Mission, VehicleMissionItem } from '../../domain'
import {
  commandName,
  describeItem,
  sameMissionItems,
  toWaypointsFile,
  translateMission,
  waypointsFileName,
} from '../../ardupilot'
import type { FlightControllerRow, MissionExportFile, MissionTranslationPreview, MissionTranslator } from '../MissionTranslator'

/** The browser's preview of the agent's translation (web/src/ardupilot). */
export class ArduPilotMissionTranslator implements MissionTranslator {
  readonly flightStack = 'ArduPilot'

  preview(mission: Mission, home: HomePosition | null): MissionTranslationPreview {
    const result = translateMission(mission, home)
    return {
      rows: this.describe(result.items),
      raw: result.items,
      fenceVertexCount: result.fence.length,
      params: result.params,
      issues: result.issues.map(({ itemIndex, severity, message }) => ({ itemIndex, severity, message })),
    }
  }

  describe(items: VehicleMissionItem[]): FlightControllerRow[] {
    return items.map((item) => ({
      seq: item.seq,
      appIndex: item.appIndex,
      command: commandName(item.command),
      detail: describeItem(item),
    }))
  }

  matches(a: VehicleMissionItem[], b: VehicleMissionItem[]): boolean {
    return sameMissionItems(a, b)
  }

  exportFile(mission: Mission, home: HomePosition | null): MissionExportFile {
    return {
      filename: waypointsFileName(mission.name),
      mimeType: 'text/plain',
      text: toWaypointsFile(translateMission(mission, home).items),
    }
  }
}
