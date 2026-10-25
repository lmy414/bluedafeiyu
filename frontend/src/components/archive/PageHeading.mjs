// Shared heading structure. Callers pass escaped text or component-rendered HTML.
export function renderPageHeading({ eyebrow = '', title, description = '', extra = '' }) {
  return `<header class="page-head"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1>${description ? `<p class="lede">${description}</p>` : ''}</div>${extra}</header>`;
}
