// Unknown statistics stay unknown. Only published submission IDs can enter this list.
export function rankSubmissions(works,ids,snapshot){
  if(snapshot?.available!==true||!snapshot.works)return [];
  const allowed=new Set(ids);
  return works.filter(w=>allowed.has(w.id)&&Number.isFinite(snapshot.works[w.id]?.views)&&snapshot.works[w.id].views>0)
    .sort((a,b)=>snapshot.works[b.id].views-snapshot.works[a.id].views||(Number(snapshot.works[b.id].downloads)||0)-(Number(snapshot.works[a.id].downloads)||0)||a.slug.localeCompare(b.slug)).slice(0,4);
}
