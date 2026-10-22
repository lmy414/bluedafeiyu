import archive from '../../../data/video-archive.json' with { type: 'json' };
import avatars from './creator-avatars.json' with { type: 'json' };
export const videoArchive={...archive,creators:archive.creators.map(c=>({...c,avatar:c.avatar || avatars[c.uid] || ''}))};
