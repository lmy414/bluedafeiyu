// Public pages keep complete editorial records; interactions receive only the
// fields they use. Chinese search terms stay available in every locale.
const workFields = ['owners','id','slug','n','c','cid','cids','roles','col','i','l','w','h','p','v','d','cm','o','f','s','bytes','lk','lt','ls','ln','a','sa','k','tg','dt','at'];
const translationFields = ['name','description','commentary','tags','licenseNote'];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key,value[key]]));

export function publicArchiveData(data) {
  return {...data, works:data.works.map(work => ({...work,
    i18n:Object.fromEntries(Object.entries(work.i18n || {}).map(([locale,value]) => [locale,pick(value,translationFields)]))
  }))};
}

export function clientArchiveData(data, locale) {
  return {characters:data.characters.map(character=>pick(character,['id','name','aliases'])),types:data.types.map(type=>pick(type,['id','name'])),topics:data.topics.map(topic=>pick(topic,['id','name','slugs'])),works:data.works.map(work => ({...pick(work,workFields),
    ...(['en','ja'].includes(locale) ? {i18n:{[locale]:pick(work.i18n[locale],translationFields)}} : {})
  }))};
}

export function homeArchiveData(data, snapshot) {
  const ids = new Set(snapshot.works.filter(work => work.source === 'submission' && work.status === 'published').map(work => work.id));
  const fields = ['id','slug','n','c','cid','roles','col','i','w','h','p','k','tg','dt'];
  return {works:data.works.filter(work => ids.has(work.id)).map(work => ({...pick(work,fields),
    i18n:Object.fromEntries(Object.entries(work.i18n || {}).map(([locale,value]) => [locale,{name:value.name}]))
  }))};
}

export function downloadArchiveData(data) {
  const fields = ['id','slug','n','c','cid','roles','col','i','o','w','h','p','k','tg','dt','at','lk','ls','lt'];
  return {works:data.works.map(work => ({...pick(work,fields),
    i18n:Object.fromEntries(Object.entries(work.i18n || {}).map(([locale,value]) => [locale,{name:value.name}]))
  }))};
}
