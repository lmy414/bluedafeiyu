// Shared by both intake paths and Issue reconciliation. No network or disk writes.
const HOSTS = new Set(['user-images.githubusercontent.com', 'private-user-images.githubusercontent.com']);
const ASSET_HOST = /^github-production-user-asset-[a-z0-9-]+\.s3\.amazonaws\.com$/i;
const FILE_PATH = /^\/user-attachments\/files\/([1-9][0-9]*)\/[^/]+$/;

export function isAllowedAttachmentUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  if (url.hostname === 'github.com') return /^\/user-attachments\/assets\/[0-9a-f-]+$/i.test(url.pathname) || FILE_PATH.test(url.pathname);
  // Observed redirect for Issue #133. Limit the official object host to uploaded
  // repository-file objects; do not allow arbitrary object/download paths.
  if (url.hostname === 'objects.githubusercontent.com') return /^\/github-production-repository-file-[a-z0-9-]+\/[0-9]+\/[0-9]+$/.test(url.pathname);
  return HOSTS.has(url.hostname) || ASSET_HOST.test(url.hostname);
}

export function extractAttachments(body) {
  const patterns = [
    /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+/g,
    /https:\/\/user-images\.githubusercontent\.com\/[^\s)"'<>\]]+/g,
    /https:\/\/private-user-images\.githubusercontent\.com\/[^\s)"'<>\]]+/g,
    /https:\/\/github\.com\/user-attachments\/files\/[1-9][0-9]*\/[^\s)"'<>\]]+/g,
  ];
  return [...new Set(patterns.flatMap((pattern) => String(body || '').match(pattern) || []))];
}

export function assetIdOf(value) {
  const text = String(value);
  const asset = text.match(/\/user-attachments\/assets\/([0-9a-fA-F-]+)/);
  if (asset) return asset[1];
  const file = text.match(/\/user-attachments\/files\/([1-9][0-9]*)\//);
  if (file) return `file-${file[1]}`;
  const legacy = text.match(/user-images\.githubusercontent\.com\/\d+\/([^/]+)\//);
  return legacy ? legacy[1] : text;
}

export function attachmentName(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return ''; }
}

// Cardinality is part of every source key, including when the queue deduplicates
// a member against another Issue or a single image. A partial import cannot look complete.
export function archiveSourceId(parent, digest, count, index) {
  return `${parent}:zip:${digest}:${count}:${index}`;
}

export function archiveMembers(items, parent) {
  const groups = new Map();
  for (const item of items) {
    for (const sourceId of item.sourceIds || []) {
      if (!String(sourceId).startsWith(`${parent}:zip:`)) continue;
      const match = String(sourceId).slice(parent.length).match(/^:zip:([a-f0-9]{64}):([1-9][0-9]*):([0-9]+)$/);
      if (!match) continue;
      const count = Number(match[2]);
      const index = Number(match[3]);
      if (count > 100 || index >= count) continue;
      const group = groups.get(match[1]) || { count, members: new Map(), valid: true };
      if (group.count !== count || (group.members.has(index) && group.members.get(index).id !== item.id)) group.valid = false;
      group.members.set(index, item);
      groups.set(match[1], group);
    }
  }
  if (groups.size !== 1) return null;
  const [group] = groups.values();
  return group.valid && group.members.size === group.count
    ? [...group.members].sort(([a], [b]) => a - b).map(([, item]) => item) : null;
}
