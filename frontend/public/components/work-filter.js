import {matchesCreationMethod} from '../archive/creation-method.js';
import {isGifWork} from '../archive/work-format.js';
// One predicate for the browse archive and the inline homepage. Roles intersect.
export function filterWorks(works,state,{scores=null,allowGif=false}={}) {
  const characters=String(state.character||'').split(',').filter(Boolean);
  return works.filter(work=>matchesCreationMethod(work,state.creation)&&characters.every(id=>work.cids.includes(id))&&(!state.type||(allowGif&&state.type==='gif'?isGifWork(work):work.k.includes(state.type)))&&(!scores||scores.has(work.id)));
}
