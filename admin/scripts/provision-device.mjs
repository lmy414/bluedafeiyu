// Server-side provisioning through Payload, using the existing users schema.
import crypto from 'node:crypto'
import { buildConfig, getPayload } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
const email = process.env.DEVICE_EMAIL,
  name = process.env.DEVICE_NAME || '本地工作站'
if (
  !email?.endsWith('@automation.local') ||
  !process.env.DATABASE_URL ||
  !process.env.PAYLOAD_SECRET
)
  throw new Error('Device email and admin database environment are required')
const config = await buildConfig({
  secret: process.env.PAYLOAD_SECRET,
  db: sqliteAdapter({ client: { url: process.env.DATABASE_URL }, push: false }),
  collections: [
    {
      slug: 'users',
      auth: { useAPIKey: true },
      fields: [
        { name: 'role', type: 'select', options: ['owner', 'bot'], required: true },
        { name: 'displayName', type: 'text' },
      ],
    },
  ],
})
const payload = await getPayload({ config, disableOnInit: true })
try {
  const found = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  if (found.docs.length && !process.argv.includes('--rotate'))
    throw new Error('Device already exists; use explicit --rotate to replace its key')
  const apiKey = crypto.randomBytes(32).toString('hex')
  if (found.docs.length)
    await payload.update({
      collection: 'users',
      id: found.docs[0].id,
      data: { apiKey, enableAPIKey: true, role: 'owner', displayName: name },
      overrideAccess: true,
    })
  else
    await payload.create({
      collection: 'users',
      data: {
        email,
        displayName: name,
        role: 'owner',
        password: crypto.randomUUID() + crypto.randomUUID(),
        enableAPIKey: true,
        apiKey,
      },
      overrideAccess: true,
    })
  process.stdout.write(
    'DEVICE_CONFIG=' +
      JSON.stringify({ baseUrl: process.env.PAYLOAD_PUBLIC_SERVER_URL, apiKey }) +
      '\n',
  )
} finally {
  await payload.destroy()
}
