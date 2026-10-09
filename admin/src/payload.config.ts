import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { zh } from 'payload/i18n/zh'

import { AuditEvents } from './collections/AuditEvents'
import { BulkJobs } from './collections/BulkJobs'
import { Categories } from './collections/Categories'
import { Characters } from './collections/Characters'
import { LegacySnapshots } from './collections/LegacySnapshots'
import { Media } from './collections/Media'
import { PublishRuns } from './collections/PublishRuns'
import { Submissions } from './collections/Submissions'
import { TakedownRequests } from './collections/TakedownRequests'
import { Topics } from './collections/Topics'
import { Users } from './collections/Users'
import { Works } from './collections/Works'
import { endpoints } from './endpoints'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: ' · 蓝色大肥鱼后台',
    },
    components: {
      beforeNavLinks: [
        {
          path: './components/admin/AdminNav.tsx#AdminNav',
        },
      ],
      views: {
        dashboard: {
          Component: {
            path: './views/DashboardView.tsx#DashboardView',
          },
        },
        review: {
          Component: {
            path: './views/AdminViewTemplate.tsx#ReviewPage',
          },
          exact: true,
          path: '/review',
        },
        library: {
          Component: {
            path: './views/AdminViewTemplate.tsx#LibraryPage',
          },
          exact: true,
          path: '/library',
        },
        topicsBoard: {
          Component: {
            path: './views/AdminViewTemplate.tsx#TopicsPage',
          },
          exact: true,
          path: '/topics-board',
        },
        publish: {
          Component: {
            path: './views/AdminViewTemplate.tsx#PublishPage',
          },
          exact: true,
          path: '/publish',
        },
        bots: {
          Component: {
            path: './views/AdminViewTemplate.tsx#BotsPage',
          },
          exact: true,
          path: '/bots',
        },
      },
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  routes: {
    admin: '/admin',
    api: '/cms-api',
  },
  serverURL: process.env.PAYLOAD_PUBLIC_SERVER_URL,
  collections: [
    Users,
    Media,
    Characters,
    Categories,
    Submissions,
    Works,
    Topics,
    TakedownRequests,
    PublishRuns,
    AuditEvents,
    LegacySnapshots,
    BulkJobs,
  ],
  endpoints,
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || 'file:./admin.db',
    },
    transactionOptions: { behavior: 'immediate' },
    busyTimeout: 5000,
    migrationDir: path.resolve(dirname, 'migrations'),
    push: process.env.NODE_ENV !== 'production',
  }),
  sharp,
  i18n: {
    fallbackLanguage: 'zh',
    supportedLanguages: { zh },
  },
  plugins: [],
})
