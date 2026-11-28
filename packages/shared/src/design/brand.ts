const whaleOutline = 'M4 38.5C4 26.5 13.8 18 26.3 18c10 0 16 4.8 20.8 10.9 1.1-2.2 1.6-4.7 1.4-7.5-6.1-.5-10.1-4.4-10.6-10.2 4.9-.1 9.1 2.2 11.9 6.2 1.9-5.3 5.6-8.5 10.6-9.2.4 6.7-2.2 11.3-6.5 13.6 1 9.2-2.5 18-9.1 24.3-5.7 5.5-13.3 8.4-21.3 8.4C12.4 54.5 4 48.3 4 38.5Z'
const bellySweep = 'M8.6 39.4c4.5 3.7 10.2 5.9 16.5 5.9 7.2 0 14.5-2.6 20.7-7.5-4.7 8.2-13.3 13.1-22.4 13.1-7.5 0-13.1-4-14.8-11.5Z'
const bellyShade = 'M10.7 44c4.1 2.6 9.2 3.8 14.5 3.7 5.1 0 10.2-1.3 14.8-3.8-4.5 4.5-10.4 7-16.6 7-5.8 0-10.2-2.5-12.7-6.9Z'
const eye = (fill: string) => `<circle cx="14.8" cy="33.3" r="2.6" fill="${fill}"/>`

export const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="蓝色大肥鱼" focusable="false">
  <path data-brand-body fill="#2563eb" d="${whaleOutline}"/>
  <path fill="#fff" d="${bellySweep}"/>
  <path fill="#b9dbff" d="${bellyShade}"/>
  ${eye('#fff')}
</svg>`

export const BRAND_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="蓝色大肥鱼" focusable="false">
  <rect x="1" y="1" width="62" height="62" rx="16" fill="#1d4ed8"/>
  <g transform="translate(5.44 5.44) scale(.83)">
    <path fill="#fff" d="${whaleOutline}"/>
    <path fill="#a9d0ff" d="${bellySweep}"/>
    ${eye('#1d4ed8')}
  </g>
</svg>`
