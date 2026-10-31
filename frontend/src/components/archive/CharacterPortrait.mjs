import portraitManifest from '../../../../data/character-portraits.json' with {type: 'json'};

/** A cutout may only refer to a work still visible in this character's archive. */
export function resolveCharacterPortrait(character, fallback) {
  const image = portraitManifest.portraits[character.id];
  const work = image && character.list.find(work => work.id === image.workId);
  return work ? {work, image} : {work: fallback, image: null};
}
