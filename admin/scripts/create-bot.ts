import 'dotenv/config'
import crypto from 'node:crypto'

import { getPayload } from 'payload'

import config from '../src/payload.config'

const EMAIL = 'hermes@bot.local'
const payload = await getPayload({ config })
const apiKey = crypto.randomBytes(32).toString('base64url')
const password = crypto.randomBytes(32).toString('base64url')
const existing = await payload.find({
  collection: 'users',
  where: { email: { equals: EMAIL } },
  limit: 1,
  overrideAccess: true,
})

if (existing.docs[0]) {
  await payload.update({
    collection: 'users',
    id: existing.docs[0].id,
    data: {
      role: 'bot',
      displayName: 'hermes',
      enableAPIKey: true,
      apiKey,
    },
    context: { audit: false },
    overrideAccess: true,
  } as never)
  console.log('已重置机器人账号。')
} else {
  await payload.create({
    collection: 'users',
    data: {
      email: EMAIL,
      password,
      role: 'bot',
      displayName: 'hermes',
      enableAPIKey: true,
      apiKey,
    },
    context: { audit: false },
    overrideAccess: true,
  } as never)
  console.log('已创建机器人账号。')
}

console.log(`email=${EMAIL}`)
console.log(`API Key（仅本次显示）：${apiKey}`)
process.exit(0)
