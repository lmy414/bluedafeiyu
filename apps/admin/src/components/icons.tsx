import { ICONS } from '@dafeiyu/shared/icons';

const icons = {
  dashboard: ICONS.dashboard,
  submissions: ICONS.inbox,
  works: ICONS.gallery,
  characters: ICONS.characters,
  topics: ICONS.topics,
  videos: ICONS.videos,
  events: ICONS.clock,
  requests: ICONS.shield,
  logs: ICONS.fileText,
  sun: ICONS.sun,
  moon: ICONS.moon,
  arrow: ICONS.externalLink,
  menu: ICONS.menu,
  close: ICONS.close,
  clock: ICONS.clock,
  check: ICONS.check,
  alert: ICONS.alert,
  search: ICONS.search,
  chevron: ICONS.chevronRight,
  chevronDown: ICONS.chevronDown,
};

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  // The shared package supplies static, authored SVG markup for the site.
  return <span className="icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] }} />;
}

export function BrandLabel() {
  return <>
    <img className="brand-badge" src={`${import.meta.env.BASE_URL}avatar.png`} alt="" width={36} height={36} />
    <span className="brand-wordmark">蓝色大肥鱼 <span className="brand-cms">· CMS</span></span>
  </>;
}
