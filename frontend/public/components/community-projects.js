export function filterProjectRows(root, kind = 'all') {
  const rows=[...root.querySelectorAll('[data-project-kind]')];
  const visible=rows.filter(row=>kind==='all'||row.dataset.projectKind===kind);
  for(const row of rows){row.hidden=!visible.includes(row);row.classList.toggle('is-last',row===visible.at(-1));}
  for(const button of root.querySelectorAll('[data-project-filter]')){const active=button.dataset.projectFilter===kind;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));}
  root.querySelector('[data-project-count]').textContent=visible.length;
  root.querySelector('[data-project-empty]').hidden=visible.length!==0;
  return visible.length;
}
export function installCommunityProjects(root = document) {
  for(const catalog of root.querySelectorAll('[data-project-catalog]')){
    catalog.addEventListener('click',event=>{const button=event.target.closest('[data-project-filter]');if(button&&catalog.contains(button))filterProjectRows(catalog,button.dataset.projectFilter);});
    filterProjectRows(catalog);
  }
}
