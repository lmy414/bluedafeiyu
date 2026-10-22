import archive from '../../../data/video-archive.json' with { type: 'json' };
import avatars from './creator-avatars.json' with { type: 'json' };
export const publicCreator=c=>{const internal=/站长指定|公开主页资料收录|视频逐条审核/.test(c.intro||'');return {...c,intro:internal?'':c.intro,i18n:internal?{en:'',ja:''}:c.i18n,avatar:c.avatar || avatars[c.uid] || ''};};
export const videoArchive={...archive,creators:archive.creators.map(publicCreator)};
