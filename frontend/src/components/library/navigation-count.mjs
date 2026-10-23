export const navigationCountPlaceholder='__BLUEFISH_WORK_TOTAL__';
// This shared component can change without re-rendering every page template.
export function finalizeNavigationCount(html, total) {
  if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid navigation work count');
  return html.replace(/(<small\b[^>]*\bdata-library-work-total(?:="[^"]*")?[^>]*>)[^<]*(<\/small>)/g,(_match,open,close)=>open+total+close);
}
