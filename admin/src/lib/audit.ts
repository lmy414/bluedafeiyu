import type { PayloadRequest } from 'payload'

type AnyUser = {
  displayName?: null | string
  email?: null | string
  id?: null | number | string
  role?: null | string
}

export function actorName(user?: AnyUser | null): string {
  return String(user?.displayName || user?.email || 'system')
}

export function actorType(user?: AnyUser | null): 'ai' | 'human' | 'system' {
  if (!user) return 'system'
  return user.role === 'bot' ? 'ai' : 'human'
}

function compactAuditValue(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

export async function writeAudit(
  req: PayloadRequest,
  input: {
    action: string
    after?: unknown
    before?: unknown
    targetId: number | string
    targetType: string
  },
): Promise<void> {
  if (req.context?.audit === false) return
  const user = req.user as AnyUser | null | undefined
  await req.payload.create({
    collection: 'audit-events',
    context: { audit: false },
    data: {
      action: input.action,
      actor: (user?.id ?? undefined) as any,
      actorName: actorName(user),
      actorType: actorType(user),
      after: compactAuditValue(input.after) as any,
      before: compactAuditValue(input.before) as any,
      targetId: String(input.targetId),
      targetType: input.targetType,
    },
    overrideAccess: true,
  })
}

export function auditAfterChange(collectionSlug: string) {
  return async ({ doc, operation, previousDoc, req }: any) => {
    await writeAudit(req, {
      action: `${collectionSlug}.${operation === 'create' ? 'create' : 'update'}`,
      after: doc,
      before: previousDoc,
      targetId: doc.id,
      targetType: collectionSlug,
    })
    return doc
  }
}

export function auditAfterDelete(collectionSlug: string) {
  return async ({ doc, id, req }: any) => {
    await writeAudit(req, {
      action: `${collectionSlug}.delete`,
      before: doc,
      targetId: id,
      targetType: collectionSlug,
    })
    return doc
  }
}
