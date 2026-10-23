import fs from 'node:fs';
import path from 'node:path';
// Content is an external build input, not template code in Astro's module graph.
const sourceRoot=process.env.SITE_SOURCE || (fs.existsSync(path.join(process.cwd(),'data/video-archive.json')) ? process.cwd() : path.resolve(process.cwd(),'..'));
const archive=JSON.parse(fs.readFileSync(path.join(sourceRoot,'data/video-archive.json'),'utf8'));
import avatars from './creator-avatars.json' with { type: 'json' };
export const publicCreator=c=>{const internal=/站长指定|公开主页资料收录|视频逐条审核/.test(c.intro||'');return {...c,intro:internal?'':c.intro,i18n:internal?{en:'',ja:''}:c.i18n,avatar:c.avatar || avatars[c.uid] || ''};};
export const videoArchive={...archive,creators:archive.creators.map(publicCreator)};
