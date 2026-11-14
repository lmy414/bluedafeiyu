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

// Choose row breaks near the target height; the final row never enlarges to fill.
export function justifiedPositions(aspects, width, targetHeight, gap) {
  if (!aspects.length || width <= 0) return {positions:[], height:0};
  const ratios = aspects.map(value => Number.isFinite(value) && value > 0 ? value : 1);
  const target = Math.max(1, targetHeight), spacing = Math.max(0, gap);
  const costs = Array(ratios.length + 1).fill(Infinity), breaks = [];
  costs[ratios.length] = 0;
  for (let start = ratios.length - 1; start >= 0; start--) {
    let sum = 0;
    for (let end = start + 1; end <= ratios.length; end++) {
      sum += ratios[end - 1];
      const available = width - spacing * (end - start - 1);
      if (available <= 0) break;
      const filledHeight = available / sum, last = end === ratios.length;
      const height = last ? Math.min(target, filledHeight) : filledHeight;
      const empty = last ? 1 - (height * sum + spacing * (end - start - 1)) / width : 0;
      // Prefer readable rows over a tightly filled tail, without oversized hero rows.
      const heightCost = ((height - target) / target) ** 2 * (height > target ? 4 : 1);
      const cost = heightCost + .15 * empty ** 2 + costs[end];
      if (cost < costs[start]) { costs[start] = cost; breaks[start] = end; }
    }
  }
  const positions = [];
  let top = 0;
  for (let start = 0; start < ratios.length;) {
    const end = breaks[start], sum = ratios.slice(start, end).reduce((a,b) => a+b, 0);
    const filledHeight = (width - spacing * (end - start - 1)) / sum;
    const height = end === ratios.length ? Math.min(target, filledHeight) : filledHeight;
    let left = end === ratios.length ? Math.max(0, (width - height * sum - spacing * (end - start - 1)) / 2) : 0;
    for (let i = start; i < end; i++) {
      const itemWidth = ratios[i] * height;
      positions.push({left, top, width:itemWidth, height});
      left += itemWidth + spacing;
    }
    top += height + spacing;
    start = end;
  }
  return {positions, height:top - spacing};
}

function workAspectRatios(items) {
  return items.map(item => {
    const image = item.querySelector('.work-art img');
    const width = Number(image?.getAttribute('width')), height = Number(image?.getAttribute('height'));
    return width > 0 && height > 0 ? width / height : image?.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
  });
}

function layoutJustified(grid, items, positions, aspects) {
  if (!items.length || grid.clientWidth <= 0) return;
  const css = getComputedStyle(grid);
  const gap = parseFloat(css.getPropertyValue('--gap')) || 6;
  const target = parseFloat(css.getPropertyValue('--justified-height')) || 180;
  const result = positions(aspects(items), grid.clientWidth, target, gap);
  grid.classList.add('is-laid-out');
  SiteComponents.justifiedPlace(grid, items, result);
}

function layoutInitialJustified(layout, positions, aspects) {
  const grid = document.currentScript.previousElementSibling;
  const items = [...grid.children].filter(item => item.matches('.work-card') && !item.hidden);
  layout(grid, items, positions, aspects);
}

function masonryColumnCount(css) {
  const tracks = css.gridTemplateColumns?.trim().split(/\s+/).filter(track => /^\d+(?:\.\d+)?px$/.test(track));
  return tracks?.length || Number(css.getPropertyValue('--columns')) || 4;
}

function layoutInitialMasonry(positions, columnsForGrid) {
  const grid = document.currentScript.previousElementSibling;
  const items = [...grid.children].filter(item => item.matches('.work-card,.video-card') && !item.hidden);
  if (!items.length) return;
  const css = getComputedStyle(grid), columns = columnsForGrid(css);
  const gap = parseFloat(css.getPropertyValue('--gap')) || 18;
  const width = (grid.clientWidth - gap * (columns - 1)) / columns;
  if (width <= 0) return;
  SiteComponents.masonryWidth(items, width);
  const result = positions(items.map(item => item.offsetHeight), columns, width, gap);
  grid.classList.add('is-laid-out');
  SiteComponents.masonryPlace(grid, items, result);
}

// Inline only at the component boundary: no module fetch is needed for the first layout.
export function initialMasonryScript(layout = 'masonry') {
  if (layout === 'justified') return `<script>(${layoutInitialJustified.toString()})(${layoutJustified.toString()}, ${justifiedPositions.toString()}, ${workAspectRatios.toString()});</script>`;
  return `<script>(${layoutInitialMasonry.toString()})(${masonryPositions.toString()}, ${masonryColumnCount.toString()});</script>`;
}

export function installMasonry() {
  const observed = new WeakSet();
  let frame;
  const schedule = () => {cancelAnimationFrame(frame);frame=requestAnimationFrame(layout);};
  const resize = new ResizeObserver(entries => {
    if(entries.some(({target,contentRect}) => {
      const changed=target.dataset.layoutWidth!==String(contentRect.width);
      target.dataset.layoutWidth=String(contentRect.width);return changed;
    })) schedule();
  });
  function layout() {
    document.querySelectorAll('.work-grid').forEach(grid => {
      if(!observed.has(grid)){observed.add(grid);resize.observe(grid);}
      if(grid.querySelector('[data-work-stats]:empty'))window.WorkStats?.paint();
      const items=[...grid.children].filter(el=>el.matches('.work-card,.video-card') && !el.hidden);
      if(!items.length){SiteComponents.masonryReset(grid);grid.classList.remove('is-laid-out');return;}
      if(grid.classList.contains('work-grid--justified')){layoutJustified(grid,items,justifiedPositions,workAspectRatios);return;}
      const css=getComputedStyle(grid), columns=masonryColumnCount(css);
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
  document.fonts?.ready.then(schedule);
  schedule();
}
