import {characterBrandAssets} from './character-brand-assets.mjs';
import {characterHeroDecor} from './character-hero-decor.mjs';

// Static staff geometry follows the user's Moonshot reference: https://www.moonshot.cn/.
const kimiStaff = `<div class="character-kimi-staff"><svg viewBox="0 0 1240 128" focusable="false" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <g id="character-kimi-quarter-up"><ellipse rx="7" ry="4.6" transform="rotate(-20)" fill="currentColor"/><path d="M6 0v-35" fill="none" stroke="currentColor" stroke-width="1.7"/></g>
    <g id="character-kimi-quarter-down"><ellipse rx="7" ry="4.6" transform="rotate(-20)" fill="currentColor"/><path d="M-6 0v35" fill="none" stroke="currentColor" stroke-width="1.7"/></g>
    <g id="character-kimi-eighth-up"><use href="#character-kimi-quarter-up"/><path d="M6-35c0 12 18 12 7 29 4-15-7-14-7-19Z" fill="currentColor"/></g>
    <g id="character-kimi-eighth-down"><use href="#character-kimi-quarter-down"/><path d="M-6 35c0-12-18-12-7-29-4 15 7 14 7 19Z" fill="currentColor"/></g>
    <path id="character-kimi-rest" d="m0 0 7 9-7 6 7 9-8 5 3 9" fill="none" stroke="currentColor" stroke-width="2.5"/>
  </defs>
  <path d="M8 40h1224M8 52h1224M8 64h1224M8 76h1224M8 88h1224M8 40v48M370 40v48M706 40v48M1042 40v48" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/>
  <path d="M29 57c-9-10 4-21 15-12 18 15-2 42-23 45 19-10 30-30 20-39-7-6-14-1-12 6Z" fill="currentColor"/>
  <circle cx="55" cy="49" r="2.5" fill="currentColor"/><circle cx="55" cy="70" r="2.5" fill="currentColor"/>
  <path d="m76 35-2 38m10-36-2 38m-13-24 20-5m-21 20 20-5m11-12-2 37m10-34-2 37m-13-22 20-5m-21 19 20-5" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <g fill="currentColor" font-family="Georgia, serif" font-size="25"><text x="125" y="59">3</text><text x="125" y="84">4</text></g>
  <use href="#character-kimi-eighth-up" x="178" y="76"/><use href="#character-kimi-rest" x="211" y="52"/>
  <use href="#character-kimi-quarter-down" x="268" y="28"/><use href="#character-kimi-eighth-down" x="318" y="46"/><use href="#character-kimi-eighth-up" x="349" y="76"/>
  <use href="#character-kimi-quarter-up" x="414" y="100"/><use href="#character-kimi-quarter-up" x="477" y="88"/><use href="#character-kimi-eighth-up" x="540" y="82"/>
  <use href="#character-kimi-eighth-down" x="594" y="64"/><use href="#character-kimi-rest" x="638" y="48"/>
  <use class="character-kimi-accent-note" href="#character-kimi-eighth-up" x="751" y="76"/><use href="#character-kimi-rest" x="791" y="52"/>
  <use href="#character-kimi-quarter-down" x="846" y="28"/><use href="#character-kimi-eighth-down" x="900" y="46"/><use href="#character-kimi-eighth-up" x="952" y="76"/>
  <use href="#character-kimi-quarter-up" x="1085" y="100"/><use href="#character-kimi-quarter-up" x="1155" y="88"/><use href="#character-kimi-eighth-up" x="1210" y="82"/>
  <path d="M262 24V12h18m22 0h18v12M475 58V46h20m24 0h20v12M840 24V12h18m24 0h18v12" fill="none" stroke="currentColor" stroke-width="1"/>
  <g fill="currentColor" font-family="Georgia, serif" font-size="19"><text x="286" y="18">3</text><text x="501" y="52">3</text><text x="865" y="18">3</text></g>
</svg></div>`;

// Mistral's stepped pixel mark, kept inside the shared hero strip.
const mistralPixels = `<div class="character-mistral-pixels"><svg viewBox="0 0 1240 64" focusable="false" preserveAspectRatio="xMinYMid meet" xmlns="http://www.w3.org/2000/svg">
  <g fill="#ffaf01"><rect x="0" y="40" width="26" height="24"/><rect x="26" y="30" width="26" height="34"/><rect x="52" y="20" width="26" height="44"/></g>
  <g fill="#fa500f"><rect x="0" y="16" width="16" height="16"/><rect x="96" y="44" width="18" height="20"/><rect x="78" y="2" width="12" height="12"/></g>
  <g fill="#ffe0b2"><rect x="114" y="20" width="14" height="14"/><rect x="36" y="0" width="10" height="10"/></g>
</svg></div>`;

const eyebrow = '<p class="eyebrow">CHARACTER ARCHIVE</p>';
// Measured symbol regions in the official full lockups; foreground lockups stay complete.
const emblemRegions = {
  hunyuan: {viewBox: '0 0 97 96', width: 416, height: 96},
  llama: {viewBox: '0 0 15.3 10.2', width: 50, height: 11}
};

// Decoration that lives in the hero's own strip, below both text columns.
const stripArt = {kimi: kimiStaff, mistral: mistralPixels};

function brandLogo(logo, define = false, region) {
  const id = 'character-brand-' + logo.id;
  return `<svg class="character-brand-icon" viewBox="${region?.viewBox || logo.viewBox}"${region ? ' data-emblem-crop' : ''} aria-hidden="true" focusable="false">${define ? `<defs><symbol id="${id}" viewBox="${logo.viewBox}">${logo.markup}</symbol></defs>` : ''}<use href="#${id}"${region ? ` width="${region.width}" height="${region.height}"` : ''}/></svg>`;
}

/** Hero decoration: one overlay layer with identical slots for every brand. */
function heroDecor(id) {
  const art = characterHeroDecor[id] || {};
  const svg = (body) => body ? `<svg viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">${body}</svg>` : '';
  return `<div class="character-hero-decor" aria-hidden="true"><span class="character-hero-decor-wash"></span><span class="character-hero-decor-shape">${svg(art.shape)}</span><span class="character-hero-decor-accent">${svg(art.accent)}</span></div>`;
}

/** Keep each official mark once in the document; the decor reuses its symbol. */
export function renderCharacterBrand(id, tr) {
  const brand = characterBrandAssets[id];
  const decor = heroDecor(id);
  const strip = stripArt[id];
  const hero = strip ? `<div class="character-hero-strip" aria-hidden="true">${strip}</div>` : '';
  if (!brand) return {line: `<div class="character-brandline">${eyebrow}</div>`, decor, strip: hero};
  const links = brand.logos.map(logo => `<a class="character-brand" data-logo-kind="${logo.kind}" href="${logo.url}" target="_blank" rel="noopener noreferrer">${brandLogo(logo, true)}<span class="character-brand-label">${tr('characterBrand.logo.' + logo.id, logo.name, logo.en || logo.name, logo.en || logo.name)}</span></a>`).join('');
  const line = `<div class="character-brandline">${brand.logos.length > 1 ? `<span class="character-brand-logo-set">${links}</span>` : links}${eyebrow}</div>`;
  return {line, decor, strip: hero};
}
