import { getPayload } from 'payload'
import config from '../../src/payload.config'
if (process.env.ADMIN_QA_SEED !== '1' || !process.env.DATABASE_URL?.includes('admin-usability-qa'))
  throw new Error('仅允许初始化隔离的后台验收库')
const payload = await getPayload({ config })
const email = process.env.S3_ADMIN_OWNER_EMAIL || 'owner@local.test',
  password = process.env.S3_ADMIN_OWNER_PASSWORD
if (!password) throw new Error('缺少验收密码')
try {
  const old = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  if (old.docs[0])
    await payload.update({
      collection: 'users',
      id: old.docs[0].id,
      data: { password, role: 'owner' },
      overrideAccess: true,
    })
  else
    await payload.create({
      collection: 'users',
      data: { email, password, role: 'owner', displayName: '本地验收站长' },
      overrideAccess: true,
    })
  console.log('隔离测试账号已准备')
} finally {
  await payload.destroy()
}
