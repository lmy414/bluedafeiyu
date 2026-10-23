import '../../../public/components/runtime.js';
// The Demo's shortest-column placement, shared with the browser and regression tests.
export function masonryPositions(heights, columns, width, gap) {
  const bottoms = Array(columns).fill(0);
  const positions = heights.map(height => {
    const column = bottoms.indexOf(Math.min(...bottoms));
    const point = {left: column * (width + gap), top: bottoms[column]};
    bottoms[column] += height + gap;
    return point;
  });
  return {positions, height: heights.length ? Math.max(...bottoms) - gap : 0};
}

export function installMasonry() {
  const observed = new WeakSet();
  let frame;
  let mode="masonry";
  try{mode=localStorage.getItem("bluefish-layout")==="grid"?"grid":"masonry";}catch{}
  const schedule = () => {cancelAnimationFrame(frame);frame=requestAnimationFrame(layout);};
  const resize = new ResizeObserver(entries => {
    if(entries.some(({target,contentRect}) => {
      const changed=target.dataset.layoutWidth!==String(contentRect.width);
      target.dataset.layoutWidth=String(contentRect.width);return changed;
    })) schedule();
  });
  function layout() {
    document.querySelectorAll('[data-design-layout]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.designLayout===mode)));
    document.querySelectorAll('.work-grid').forEach(grid => {
      if(!observed.has(grid)){observed.add(grid);resize.observe(grid);}
      if(grid.querySelector('[data-work-stats]:empty'))window.WorkStats?.paint();
      const items=[...grid.children].filter(el=>el.matches('.work-card,.video-card') && !el.hidden);
      if(!items.length){SiteComponents.masonryReset(grid);grid.classList.remove('is-laid-out');return;}
      grid.classList.toggle('layout-grid',mode==='grid');
      if(mode==='grid'){grid.classList.remove('is-laid-out');SiteComponents.masonryReset(grid);SiteComponents.masonryReset(grid,items);return;}
      const css=getComputedStyle(grid), columns=Number(css.getPropertyValue('--columns'))||4;
      const gap=parseFloat(css.getPropertyValue('--gap'))||18;
      const width=(grid.clientWidth-gap*(columns-1))/columns;
      if(width<=0)return;
      SiteComponents.masonryWidth(items,width);
      items.forEach(item=>{const img=item.querySelector('.work-art img');if(img?.naturalWidth)img.closest('.work-art').classList.toggle('is-long',img.naturalHeight/img.naturalWidth>2.8);});
      const result=masonryPositions(items.map(item=>item.offsetHeight),columns,width,gap);
      grid.classList.add('is-laid-out');
      SiteComponents.masonryPlace(grid,items,result);
    });
  }
  new MutationObserver(schedule).observe(document.querySelector('main'),{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  document.addEventListener('load',event=>{if(event.target.matches?.('.work-grid img'))schedule();},true);
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('pageshow',schedule);
  document.addEventListener('click',event=>{const button=event.target.closest('[data-design-layout]');if(!button)return;mode=button.dataset.designLayout;try{localStorage.setItem('bluefish-layout',mode);}catch{}schedule();});
  document.fonts?.ready.then(schedule);
  schedule();
}
