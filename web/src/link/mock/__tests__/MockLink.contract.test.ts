import { runVehicleLinkContractTests } from '../../__tests__/contract'
import { MockLink } from '../MockLink'

runVehicleLinkContractTests('MockLink', {
  createLink: () => new MockLink({ tickMs: 20 }),
})
