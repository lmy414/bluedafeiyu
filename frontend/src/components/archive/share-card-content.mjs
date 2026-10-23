export function workShareCopy(work) {
  return {title:work.n,sub:work.cm ? 'DeepSeek娘说：' + work.cm : work.d || work.c,tag:work.c || '',quote:Boolean(work.cm)};
}
