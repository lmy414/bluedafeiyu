'use client'

import { useEffect, useState } from 'react'

export type CurrentTopic = {
  id: string
  name: string
  topicId: string
}

const KEY = 's3-current-topic'
const EVENT = 's3-current-topic-changed'

function read(): CurrentTopic | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CurrentTopic>
    return parsed.id && parsed.name && parsed.topicId
      ? { id: String(parsed.id), name: String(parsed.name), topicId: String(parsed.topicId) }
      : null
  } catch {
    return null
  }
}

export function useCurrentTopic() {
  const [current, setCurrentState] = useState<CurrentTopic | null>(null)

  useEffect(() => {
    const sync = () => setCurrentState(read())
    sync()
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  function setCurrent(topic: CurrentTopic | null) {
    setCurrentState(topic)
    try {
      if (topic) window.localStorage.setItem(KEY, JSON.stringify(topic))
      else window.localStorage.removeItem(KEY)
    } catch {
      // 隐私模式下只在当前页生效。
    }
    window.dispatchEvent(new Event(EVENT))
  }

  return { current, setCurrent }
}
