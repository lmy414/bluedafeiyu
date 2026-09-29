import type { Endpoint } from 'payload'

import { DashboardEndpoints } from './dashboard'
import { IssueReplyEndpoints } from './issue-reply'
import { PublishEndpoints } from './publish'

export const endpoints: Endpoint[] = [
  ...PublishEndpoints,
  ...IssueReplyEndpoints,
  ...DashboardEndpoints,
]
