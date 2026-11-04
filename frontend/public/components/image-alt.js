// Use recorded editorial text only; titles distinguish works sharing a description.
// Call with localized fields (or a field translator), before HTML escaping.
export function workImageAlt(work, text = value => value) {
  const name = String(text(work?.n ?? work?.name ?? '') ?? '').trim();
  const description = String(text(work?.d ?? work?.description ?? '') ?? '').trim();
  if (!name) return description;
  if (!description || description.includes(name)) return description || name;
  return `${name} — ${description}`;
}
