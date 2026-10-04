import {renderWorkCard} from '../../../public/archive/work-card.js';
export function createWorkCards() {
  const card = (work, eager = false) => renderWorkCard(work, {eager});
  const grid = (list, cls = '', eager = false) => `<div class="work-grid ${cls}">${list.map((work,i)=>card(work,eager && i<4)).join('')}</div>`;
  return {card,grid};
}
