import type { Access } from 'payload'

export type AdminRole = 'owner' | 'editor' | 'reviewer' | 'publisher' | 'ai-agent'

export const isAuthenticated: Access = ({ req }) => Boolean(req.user)

export const isOwner: Access = ({ req }) => req.user?.role === 'owner'

export const canManageContent: Access = ({ req }) =>
  ['owner', 'editor', 'reviewer', 'publisher'].includes(req.user?.role ?? '')

export const canReview: Access = ({ req }) =>
  ['owner', 'editor', 'reviewer'].includes(req.user?.role ?? '')

export const canPublish: Access = ({ req }) =>
  ['owner', 'publisher'].includes(req.user?.role ?? '')

