import type { Endpoint } from 'payload'

import { DashboardEndpoints } from './dashboard'
import { PublishEndpoints } from './publish'

export const endpoints: Endpoint[] = [
  ...PublishEndpoints,
  ...DashboardEndpoints,
]
