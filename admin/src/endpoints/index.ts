import type { Endpoint } from 'payload'

import { AiFillEndpoints } from './ai-fill'
import { WorksByAuthorEndpoint } from './works-by-author'
import { DashboardEndpoints } from './dashboard'
import { IssueReplyEndpoints } from './issue-reply'
import { PublishEndpoints } from './publish'

export const endpoints: Endpoint[] = [
  ...PublishEndpoints,
  ...IssueReplyEndpoints,
  ...DashboardEndpoints,
  ...AiFillEndpoints,
  WorksByAuthorEndpoint,
]
