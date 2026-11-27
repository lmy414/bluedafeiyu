const icon = (shape: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shape}</svg>`

export const ICONS = Object.freeze({
  gallery: icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m3.5 16 4.75-4.25 3.5 3 3.75-4 5 4.25"/><circle cx="8.5" cy="8.75" r="1.25"/>'),
  characters: icon('<circle cx="10.5" cy="8" r="3.25"/><path d="M4 20v-1.25a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5V20M16 4.75a3.25 3.25 0 0 1 0 6.5m2 3.25a4 4 0 0 1 2.5 3.75V20"/>'),
  topics: icon('<path d="M8 5h11a1.5 1.5 0 0 1 1.5 1.5V17M5 8h11a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 16 19H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 8Z"/><path d="M7 12h7m-7 3h4"/>'),
  serials: icon('<path d="M12 7a6 6 0 0 0-4.5-2H4v13h3.5a6 6 0 0 1 4.5 2 6 6 0 0 1 4.5-2H20V5h-3.5A6 6 0 0 0 12 7Zm0 0v13M7 9h2m6 0h2M7 12h2m6 0h2"/>'),
  videos: icon('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>'),
  gifs: icon('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M9 10H7v4h2v-1.5m3-2.5v4m3 0v-4h2.25M15 12h1.75"/>'),
  submit: icon('<path d="M12 15V4m-4 4 4-4 4 4M4.5 14.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-4.5"/>'),
  search: icon('<circle cx="10.75" cy="10.75" r="5.75"/><path d="m15 15 4.5 4.5"/>'),
  download: icon('<path d="M12 3.75v11.5m-4-4 4 4 4-4M4.5 16.5V19A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5"/>'),
  copy: icon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 5.25C16 4.56 15.44 4 14.75 4H6a2 2 0 0 0-2 2v8.75c0 .69.56 1.25 1.25 1.25"/>'),
  share: icon('<circle cx="18.25" cy="5.75" r="2.25"/><circle cx="5.75" cy="12" r="2.25"/><circle cx="18.25" cy="18.25" r="2.25"/><path d="m7.75 11 8.5-4.25m-8.5 6.25 8.5 4.25"/>'),
  globe: icon('<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.5" ry="8.5"/><path d="M3.5 12h17"/>'),
  sun: icon('<circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.41 1.41m9.9 9.9 1.41 1.41m0-12.72-1.41 1.41m-9.9 9.9-1.41 1.41"/>'),
  moon: icon('<path d="M20.3 14.25A8.5 8.5 0 0 1 9.75 3.7 8.5 8.5 0 1 0 20.3 14.25Z"/>'),
  more: icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  close: icon('<path d="m6.5 6.5 11 11m0-11-11 11"/>'),
  chevronLeft: icon('<path d="m14.5 6.5-5.5 5.5 5.5 5.5"/>'),
  chevronRight: icon('<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>'),
  chevronDown: icon('<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>'),
  chevronUp: icon('<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>'),
  zoomIn: icon('<circle cx="10.75" cy="10.75" r="5.75"/><path d="m15 15 4.5 4.5m-11-8.75h4.5m-2.25-2.25V13"/>'),
  zoomOut: icon('<circle cx="10.75" cy="10.75" r="5.75"/><path d="m15 15 4.5 4.5m-11-8.75h4.5"/>'),
  externalLink: icon('<path d="M13 4.5h6.5V11m0-6.5-9 9m8 0V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V7A1.5 1.5 0 0 1 6 5.5h4.5"/>'),
  menu: icon('<path d="M4.5 6.5h15m-15 5.5h15m-15 5.5h15"/>'),
  check: icon('<path d="m5 12 4.5 4.5 9.5-9.5"/>'),
  alert: icon('<path d="M10.7 4.75a1.5 1.5 0 0 1 2.6 0l7.25 12.5a1.5 1.5 0 0 1-1.3 2.25H4.75a1.5 1.5 0 0 1-1.3-2.25ZM12 9v4.25m0 3.25h.01"/>'),
  shield: icon('<path d="M12 3.5 5 6.25v5.25c0 4 2.7 7 7 9 4.3-2 7-5 7-9V6.25ZM9 11.75l2 2 4-4"/>'),
  filter: icon('<path d="M4 5h16l-6 7.25V18l-4 1.75v-7.5Z"/>'),
  sort: icon('<path d="M7 19.5v-15m-3 3 3-3 3 3m7-3v15m-3-3 3 3 3-3"/>'),
  folderZip: icon('<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h5l2 2h7A1.5 1.5 0 0 1 20.5 9v8A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17Zm9 .75v1.5m1.5 1h-1.5m0 2H14m-1.5 2H14v2.5h-2.5v-2.5Z"/>'),
  trash: icon('<path d="M4.5 6.5h15m-12.5 0 1 12.25a1.5 1.5 0 0 0 1.5 1.25h5a1.5 1.5 0 0 0 1.5-1.25l1-12.25m-7.5-2.75h5M10.5 10v6.5m3-6.5v6.5"/>'),
  eye: icon('<path d="M3.25 12c2.5-3.75 5.4-5.75 8.75-5.75s6.25 2 8.75 5.75c-2.5 3.75-5.4 5.75-8.75 5.75S5.75 15.75 3.25 12Z"/><circle cx="12" cy="12" r="2.5"/>'),
  eyeOff: icon('<path d="m4 4 16 16M9.1 6.75a8 8 0 0 1 2.9-.5c3.35 0 6.25 2 8.75 5.75a16 16 0 0 1-2.75 3.15m-2.95 1.95c-.97.44-2 .65-3.05.65-3.35 0-6.25-2-8.75-5.75a17 17 0 0 1 3.2-3.55m3.2 3.2a2.5 2.5 0 0 0 2.7 2.7"/>'),
  edit: icon('<path d="m5 15.75 10.75-10.75a2 2 0 0 1 2.83 0l.42.42a2 2 0 0 1 0 2.83L8.25 19H5Zm9.5-9.5 3.25 3.25M12 19h7.5"/>'),
  refresh: icon('<path d="M19 9a7.5 7.5 0 0 0-12.75-2L4.5 9m0-4.5V9H9m-4 6a7.5 7.5 0 0 0 12.75 2l1.75-2m0 4.5V15H15"/>'),
  bot: icon('<rect x="5" y="7.5" width="14" height="12" rx="3"/><path d="M12 4v3.5M2.75 12v3m18.5-3v3M9.25 12v1m5.5-1v1m-4.25 3.5h3"/>'),
  dashboard: icon('<rect x="4" y="4" width="7" height="9" rx="1.5"/><rect x="13" y="4" width="7" height="5" rx="1.5"/><rect x="13" y="11" width="7" height="9" rx="1.5"/><rect x="4" y="15" width="7" height="5" rx="1.5"/>'),
  home: icon('<path d="m3.5 11 8.5-7 8.5 7M5.5 9.5V19h4v-5h5v5h4V9.5"/>'),
  plus: icon('<path d="M12 5.5v13M5.5 12h13"/>'),
  minus: icon('<path d="M5.5 12h13"/>'),
  arrowLeft: icon('<path d="m10.5 6-6 6 6 6m-6-6H20"/>'),
  arrowRight: icon('<path d="m13.5 6 6 6-6 6m6-6H4"/>'),
  fileText: icon('<path d="M13.5 3.75H6a1.5 1.5 0 0 0-1.5 1.5v13.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V9.75Zm0 0v6h6M8 13h8m-8 3.5h6"/>'),
  link: icon('<path d="m10 14 4-4m-3.5 6.5-2 2a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0m1-3 2-2a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0"/>'),
  play: icon('<path d="M8 5.5 19 12 8 18.5Z"/>'),
  pause: icon('<path d="M9 5.5v13m6-13v13"/>'),
  info: icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 11.25v5m0-8.5h.01"/>'),
  clock: icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l2.75 1.75"/>'),
  inbox: icon('<path d="M6.5 5.5h11l3 7V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-5.5Zm-3 7H9l1 2.5h4l1-2.5h5.5"/>'),
  lock: icon('<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14v2.5"/>'),
  logOut: icon('<path d="M11 5H6a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 6 19h5m-1-7h10m-4-4 4 4-4 4"/>'),
})

export type IconName = keyof typeof ICONS

export function renderIconSvg(name: IconName, className?: string): string {
  const svg = ICONS[name]
  if (!className) return svg
  const escaped = className.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return svg.replace('<svg ', () => `<svg class="${escaped}" `)
}
