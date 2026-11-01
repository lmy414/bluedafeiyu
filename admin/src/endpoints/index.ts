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
import { TaskEndpoints } from './tasks'
import { TopicMembershipEndpoints } from './topics-membership'
import { TopicTranslationEndpoints } from './topics-translate'
import { ServerBatchEndpoints } from './server-batches'
import { AutomationEndpoints } from './automation'
import { VideoEndpoints } from './videos'

export const endpoints: Endpoint[] = [
  ...VideoEndpoints,
  ...TaskEndpoints,
  ...ServerBatchEndpoints,
  ...AutomationEndpoints,
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
