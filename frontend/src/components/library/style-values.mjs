// The legacy shell's data-dependent accent belongs to the component library.
export function accentAttributes(accent) {
  return accent ? {style:'--c:' + accent + ';--role-tab-ink:var(--on-art)'} : {};
}
