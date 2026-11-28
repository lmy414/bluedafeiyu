import { nationalDay } from '../content/national-day';
import { api, field, type EventItem } from './api';
import { copy, localizedText, type Locale } from './i18n';

export const eventCacheSeconds = 5;
const activeCache = new Map<Locale, { expiresAt: number; items: Promise<EventItem[]> }>();

export function isEventOpen(event: EventItem, now = Date.now()) {
  return event.status === 'active'
    && (event.startsAt == null || Date.parse(event.startsAt) <= now)
    && (event.endsAt == null || Date.parse(event.endsAt) >= now);
}

export const archivedNationalDay: EventItem = {
  id: nationalDay.id,
  slug: nationalDay.id,
  title: nationalDay.title[0]!,
  summary: nationalDay.summary[0],
  status: 'archived',
  endsAt: nationalDay.deadline,
  payload: { cover: { src: nationalDay.cover, width: 720, height: 900 }, exhibition: nationalDay.exhibition },
};

type ActiveEventSelection = { activeEvent?: EventItem; preview?: { event: EventItem; isPreview: true } };

export async function loadActiveEvent(locale: Locale, previewParam?: string | null): Promise<ActiveEventSelection | undefined> {
  try {
    if (previewParam == null) {
      const now = Date.now();
      let cached = activeCache.get(locale);
      if (!cached || cached.expiresAt <= now) {
        const items = api.events(locale, 'active', AbortSignal.timeout(250)).then(result => result.items);
        cached = { expiresAt: now + eventCacheSeconds * 1000, items };
        activeCache.set(locale, cached);
      }
      const activeEvent = (await cached.items).find(item => isEventOpen(item));
      return activeEvent ? { activeEvent } : undefined;
    }

    const { items } = await api.events(locale, 'active', AbortSignal.timeout(900));
    const activeEvent = items.find(item => isEventOpen(item));
    const slug = previewParam && previewParam !== '1' ? previewParam : undefined;
    let event = slug ? items.find(item => item.slug === slug) : activeEvent;
    if (!event) {
      const { items: all } = await api.events(locale, 'all', AbortSignal.timeout(900));
      const timestamp = (item: EventItem) => (item.startsAt && Date.parse(item.startsAt)) || (item.endsAt && Date.parse(item.endsAt)) || 0;
      event = all.find(item => item.slug === slug) ?? activeEvent ?? [...all].sort((a, b) => timestamp(b) - timestamp(a))[0] ?? archivedNationalDay;
    }
    return { activeEvent, preview: { event, isPreview: true } };
  } catch {
    return previewParam == null ? undefined : { preview: { event: archivedNationalDay, isPreview: true } };
  }
}

export function eventTitle(locale: Locale, event: EventItem) {
  return event.slug === nationalDay.id ? copy(locale, nationalDay.title) : field(locale, event, 'title');
}

export function eventSummary(locale: Locale, event: EventItem) {
  return event.slug === nationalDay.id ? copy(locale, nationalDay.summary) : field(locale, event, 'summary');
}

export function eventPopupLabel(locale: Locale, event: EventItem, key: 'badge' | 'shortLabel' | 'headline' | 'description' | 'ctaLabel' | 'secondaryLabel') {
  const popup = event.payload?.popup;
  const translation = popup?.i18n?.[locale]?.[key];
  const text = popup?.[key];
  return (typeof translation === 'string' && translation.trim()) || localizedText(locale, typeof text === 'string' ? text.trim() : undefined);
}
