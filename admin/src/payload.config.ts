import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { zh } from 'payload/i18n/zh'

import { AuditEvents } from './collections/AuditEvents'
import { Categories } from './collections/Categories'
import { Characters } from './collections/Characters'
import { Media } from './collections/Media'
import { PublishRuns } from './collections/PublishRuns'
import { Submissions } from './collections/Submissions'
import { TakedownRequests } from './collections/TakedownRequests'
import { Users } from './collections/Users'
import { Works } from './collections/Works'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: ' · 蓝色大肥鱼后台',
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    Users,
    Media,
    Characters,
    Categories,
    Submissions,
    Works,
    TakedownRequests,
    PublishRuns,
    AuditEvents,
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || 'file:./admin.db',
    },
  }),
  sharp,
  i18n: {
    fallbackLanguage: 'zh',
    supportedLanguages: { zh },
  },
  plugins: [],
})

