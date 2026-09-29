import type { Access } from 'payload'

export type AdminRole = 'owner' | 'bot'

export const isAuthenticated: Access = ({ req }) => Boolean(req.user)

export const isOwner: Access = ({ req }) => req.user?.role === 'owner'

export const isBot: Access = ({ req }) => req.user?.role === 'bot'

export const isOwnerOrBot: Access = ({ req }) =>
  req.user?.role === 'owner' || req.user?.role === 'bot'

/** 只有站长能进入 Payload 后台界面；机器人只能走 API Key。 */
export const canAccessAdmin: Access = ({ req }) => req.user?.role === 'owner'

export const canReadContent: Access = isOwnerOrBot

export const canManageContent: Access = isOwner

export const canPublish: Access = isOwnerOrBot

export const canDeleteContent: Access = isOwner
