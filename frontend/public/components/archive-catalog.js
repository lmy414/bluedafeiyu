// Shared field names are sent once; consumers keep the same work objects.
export function packArchiveCatalog(data) {
  const fields=[...new Set(data.works.flatMap(work=>Object.keys(work)))];
  return {...data,schema:'archive-client/2',fields,works:data.works.map(work=>fields.map(field=>work[field]??null))};
}

export function unpackArchiveCatalog(data) {
  if(data.schema!=='archive-client/2')return data;
  if(!Array.isArray(data.fields)||!data.fields.every(field=>typeof field==='string')||new Set(data.fields).size!==data.fields.length||!Array.isArray(data.works))throw Error('Invalid archive catalog');
  const {schema,fields,...rest}=data;
  return {...rest,works:data.works.map(row=>{
    if(!Array.isArray(row)||row.length!==fields.length)throw Error('Invalid archive row');
    return Object.fromEntries(fields.flatMap((field,index)=>row[index]===null?[]:[[field,row[index]]]));
  })};
}
