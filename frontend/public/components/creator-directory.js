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
