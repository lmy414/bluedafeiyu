// Runs next to the server-rendered grid, before the deferred gallery module.
(() => {
  const grid = document.currentScript?.previousElementSibling;
  if (!(grid instanceof HTMLElement) || !grid.matches('.gallery-grid')) return;

  const heights = new WeakMap();
  let width = 0;
  let columns = [];
  let placed = 0;
  let frame = 0;

  const observer = new ResizeObserver((entries) => {
    const changed = entries.some(({ target, borderBoxSize }) => target === grid
      ? borderBoxSize[0].inlineSize !== width
      : borderBoxSize[0].blockSize !== heights.get(target));
    if (changed) scheduleLayout();
  });

  function layout(reset = false) {
    const style = getComputedStyle(grid);
    const count = Number(style.getPropertyValue('--gallery-columns'));
    const gap = parseFloat(style.columnGap);
    const nextWidth = grid.getBoundingClientRect().width;
    if (!count || !nextWidth) return;
    if (reset || nextWidth !== width || count !== columns.length) {
      width = nextWidth;
      columns = Array(count).fill(0);
      placed = 0;
      grid.dataset.masonry = '';
    }

    const tiles = Array.from(grid.children).slice(placed);
    // Read all card sizes before writing positions, including the mobile caption.
    const sizes = tiles.map((tile) => tile.getBoundingClientRect());
    for (const [index, tile] of tiles.entries()) {
      const column = columns.indexOf(Math.min(...columns));
      const { height } = sizes[index];
      tile.style.setProperty('--tile-column', String(column));
      tile.style.top = `${columns[column]}px`;
      columns[column] += height + gap;
      if (!heights.has(tile)) observer.observe(tile, { box: 'border-box' });
      heights.set(tile, height);
    }
    placed = grid.childElementCount;
    grid.style.height = `${Math.max(0, ...columns.map((bottom) => bottom - gap))}px`;
  }

  function scheduleLayout() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      layout(true);
    });
  }

  layout();
  observer.observe(grid, { box: 'border-box' });
  window.addEventListener('resize', scheduleLayout, { passive: true });
  grid.addEventListener('masonry:append', () => {
    if (frame) cancelAnimationFrame(frame);
    layout(Boolean(frame));
    frame = 0;
  });
})();
