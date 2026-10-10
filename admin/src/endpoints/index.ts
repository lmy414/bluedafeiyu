import type { Endpoint } from 'payload'

import { AiFillEndpoints } from './ai-fill'
import { AgentEndpoints } from './agent'
import { BulkJobEndpoints } from './bulk-jobs'
import { ConsoleEndpoints } from './console'
import { AnalyticsEndpoints } from './analytics'
import { WorksByAuthorEndpoint } from './works-by-author'
import { DashboardEndpoints } from './dashboard'
import { IssueReplyEndpoints } from './issue-reply'
import { PublishEndpoints } from './publish'
import { RequestAgentEndpoints } from './request-agent'

export const endpoints: Endpoint[] = [
  ...ConsoleEndpoints,
  ...BulkJobEndpoints,
  ...AnalyticsEndpoints,
  ...PublishEndpoints,
  ...RequestAgentEndpoints,
  ...IssueReplyEndpoints,
  ...DashboardEndpoints,
  ...AiFillEndpoints,
  ...AgentEndpoints,
  WorksByAuthorEndpoint,
]
