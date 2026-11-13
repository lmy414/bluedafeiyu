export function compareCreatorRows(a, b, sort = 'latest') {
  const left=a.dataset, right=b.dataset;
  const tie=left.name.localeCompare(right.name);
  return sort==='name' ? tie : sort==='count' ? Number(right.total)-Number(left.total)||tie : right.latest.localeCompare(left.latest)||tie;
}

export function installCreatorRails(root = document) {
  for(const rail of root.querySelectorAll('[data-creator-directory] [data-creator-rail]')) {
    rail.addEventListener('wheel', event => {
      if(event.ctrlKey || event.shiftKey || Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?rail.clientWidth:1);
      const canScroll=delta>0 ? rail.scrollLeft+rail.clientWidth<rail.scrollWidth-1 : rail.scrollLeft>0;
      if(!canScroll)return;
      event.preventDefault(); rail.scrollLeft+=delta;
    },{passive:false});
  }
}

export function installCreatorDirectory(root = document) {
const creatorSearch=root.querySelector('[data-design-creator-search]');
if(creatorSearch){
  const directory=root.querySelector('[data-design-creators]');
  const rows=[...directory.children];
  const update=()=>{
    const query=creatorSearch.elements.q.value.toLocaleLowerCase().trim();
    const sort=creatorSearch.elements.sort.value;
    const rank=row=>({'4168597':0,'4456176':1}[row.dataset.uid]??2);
    const sorted=[...rows].sort((a,b)=>directory.hasAttribute('data-creator-directory')?compareCreatorRows(a,b,sort):rank(a)-rank(b)||(sort==='latest'?b.dataset.latest.localeCompare(a.dataset.latest):a.dataset.name.localeCompare(b.dataset.name)));
    let count=0;
    sorted.forEach(row=>{row.hidden=!!query&&!row.textContent.toLocaleLowerCase().includes(query);if(!row.hidden)count++;directory.append(row);});
    root.querySelector('[data-design-creator-count]').textContent=count;
    root.querySelector('[data-creator-empty]').hidden=count!==0;
  };
  creatorSearch.addEventListener('submit',event=>{event.preventDefault();update();});
  creatorSearch.addEventListener('input',update);creatorSearch.addEventListener('change',update);
}

}
