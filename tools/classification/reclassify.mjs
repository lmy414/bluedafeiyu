import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { piVision } from './pi-vision.mjs';
import { WORK_TYPE_RULES } from '../../admin/src/lib/work-types.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const root = process.cwd();
const content = path.resolve(arg('--content-dir', '../AI娘表情包'));
const run = path.resolve(arg('--run-dir', '.build/classification-20261007'));
const limit = Number(arg('--limit', Infinity));
const concurrency = Number(arg('--concurrency', 8));
const batchSize = Number(arg('--batch-size', 8));
const works = JSON.parse(fs.readFileSync(arg('--snapshot', 'dist/site-data.json'), 'utf8')).works;
const allowed = new Set(JSON.parse(fs.readFileSync('data/categories.json', 'utf8')).map(x => x.id));
fs.mkdirSync(run, { recursive: true });
const imageFor = work => {
  const candidates = [work.displayUrl, work.thumbUrl].filter(Boolean).map(p => path.join(content, 'dist', decodeURIComponent(p)));
  return candidates.find(p => fs.existsSync(p)) || null;
};
const inputs = works.map(work => {
  const image = imageFor(work);
  if (!image) throw new Error('Missing image for ' + work.id);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex');
  return { id: work.id, slug: work.slug, name: work.name, old: work.categoryIds, source: work.source, image, digest };
});
const manifestFile = path.join(run, 'manifest.json');
const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : [];
for (const input of inputs) {
  const original = previous.find(x => x.id === input.id);
  if (original) input.old = original.old;
}
fs.writeFileSync(manifestFile, JSON.stringify(inputs, null, 2));
const resultsFile = path.join(run, 'results.json');
const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : {};
const pending = inputs.filter(x => results[x.id]?.digest !== x.digest).slice(0, limit);
const batches = [];
for (let i = 0; i < pending.length; i += batchSize) batches.push(pending.slice(i, i + batchSize));
let cursor = 0, failed = 0;
console.log(JSON.stringify({ total: inputs.length, pending: pending.length, batches: batches.length, concurrency }));
await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
  while (cursor < batches.length) {
    const index = cursor++, batch = batches[index];
    let success = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const label = `batch-${String(index).padStart(3, '0')}-attempt-${attempt}`;
      const request = { rules: WORK_TYPE_RULES, items: batch.map((x, i) => ({ index: i + 1, id: x.id })), schema: { works: [{ id: 'exact unchanged id', type: 'one category id', confidence: 0.95, reason: '20-60字具体画面依据' }] } };
      fs.writeFileSync(path.join(run, label + '.input.json'), JSON.stringify(request, null, 2));
      try {
        const result = await piVision('逐张查看所有图片，附件顺序与 items 一一对应。每张只分类，不改标题、不写描述。不参考旧分类。严格执行 rules。只输出符合 schema 的 JSON。\n' + JSON.stringify(request), batch.map(x => x.image), { cwd: root });
        fs.writeFileSync(path.join(run, label + '.output.json'), JSON.stringify(result, null, 2));
        const values = result.data.works;
        if (!Array.isArray(values) || values.length !== batch.length || new Set(values.map(x => x.id)).size !== batch.length) throw new Error('Incorrect number of results or duplicate IDs');
        for (const x of batch) {
          const v = values.find(v => v.id === x.id);
          if (!v || !allowed.has(v.type) || typeof v.reason !== 'string' || !v.reason.trim() || typeof v.confidence !== 'number' || v.confidence < 0 || v.confidence > 1) throw new Error('Invalid classification result for ' + x.id);
        }
        for (const x of batch) results[x.id] = { ...values.find(v => v.id === x.id), digest: x.digest, provider: result.provider, model: result.model };
        fs.writeFileSync(resultsFile + '.tmp', JSON.stringify(results, null, 2)); fs.renameSync(resultsFile + '.tmp', resultsFile);
        console.log(JSON.stringify({ batch: index, completed: Object.keys(results).length, total: inputs.length, model: result.model }));
        success = true; break;
      } catch (error) { console.log(JSON.stringify({ batch: index, attempt, error: error.message })); }
    }
    if (!success) failed += batch.length;
  }
}));
const counts = {}; for (const x of Object.values(results)) counts[x.type] = (counts[x.type] || 0) + 1;
console.log(JSON.stringify({ completed: Object.keys(results).length, failed, counts, resultsFile }));
if (failed) process.exitCode = 1;
