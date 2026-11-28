export const characterLimit = 12;

export function parseCharacters(params: URLSearchParams) {
  const ids = params.getAll('character').flatMap(value => value.split(',').map(id => id.trim()));
  return [...new Set(ids.filter(id => id.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)))].slice(0, characterLimit);
}

export function characterQuery(params: URLSearchParams, characters = parseCharacters(params)) {
  const query = new URLSearchParams(params);
  if (characters.length) query.set('character', characters.join(','));
  else query.delete('character');
  return query.size ? `?${query.toString().replace(/(^|&)character=[^&]+/g, match => match.replace(/%2C/g, ','))}` : '';
}
