import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { BotsView } from './BotsView'
import { LibraryView } from './LibraryView'
import { PublishView } from './PublishView'
import { ReviewView } from './ReviewView'
import { TopicsView } from './TopicsView'

function Template({ children, props }: { children: React.ReactNode; props: AdminViewServerProps }) {
  const { initPageResult, ...rest } = props
  return (
    <DefaultTemplate {...rest} visibleEntities={initPageResult.visibleEntities}>
      {children}
    </DefaultTemplate>
  )
}

export function ReviewPage(props: AdminViewServerProps) {
  return <Template props={props}><ReviewView /></Template>
}

export function LibraryPage(props: AdminViewServerProps) {
  return <Template props={props}><LibraryView /></Template>
}

export function TopicsPage(props: AdminViewServerProps) {
  return <Template props={props}><TopicsView /></Template>
}

export function PublishPage(props: AdminViewServerProps) {
  return <Template props={props}><PublishView /></Template>
}

export function BotsPage(props: AdminViewServerProps) {
  return <Template props={props}><BotsView /></Template>
}
