import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sourceHash, sourceText, validateI18n } from '../localization/contract.mjs';

const run = path.resolve(process.argv[2] || '.build/classification-20261007');
const results = JSON.parse(fs.readFileSync(path.join(run, 'results.json'), 'utf8'));
const beforeById = new Map(JSON.parse(fs.readFileSync(path.join(run, 'manifest.json'), 'utf8')).map(x => [x.id, x.old]));
const snapshot = JSON.parse(fs.readFileSync('dist/site-data.json', 'utf8'));
const allowed = new Set(JSON.parse(fs.readFileSync('data/categories.json', 'utf8')).map(c => c.id));
assert.equal(Object.keys(results).length, snapshot.works.length, 'Classification must cover every public work');
const writes = ['works.json', 'owner-picks.json', 'blue-fish-editorial.json', 'work-localizations.json'];
const backup = path.join(run, 'original-data'); fs.mkdirSync(backup, { recursive: true });
const state = {};
for (const file of writes) {
  const text = fs.readFileSync('data/' + file, 'utf8');
  if (!fs.existsSync(path.join(backup, file))) fs.writeFileSync(path.join(backup, file), text);
  state[file] = { text, value: JSON.parse(text) };
}
const normal = new Map([...state['works.json'].value, ...state['owner-picks.json'].value].map(w => [w.id, w]));
const editorial = state['blue-fish-editorial.json'].value;
const translations = state['work-localizations.json'].value.works;
const rows = [], counts = {};
for (const original of snapshot.works) {
  const result = results[original.id];
  assert.ok(result && allowed.has(result.type), 'Missing or invalid type for ' + original.id);
  const next = { ...original, categoryIds: [result.type] };
  const oldSource = sourceText(original), newSource = sourceText(next);
  delete oldSource.categoryIds; delete newSource.categoryIds;
  assert.deepEqual(newSource, oldSource, 'Only type may change');
  const oldHash = sourceHash(original), nextHash = sourceHash(next);
  const record = original.source === 'blue-fish' ? (editorial[original.sourcePath] ||= {}) : normal.get(original.id);
  assert.ok(record, 'Authority record not found');
  record.categoryIds = next.categoryIds;
  // The translated prose and all Chinese facts are unchanged; rebind only their type-dependent hash.
  if (record.i18n?.sourceHash === oldHash) record.i18n = { ...record.i18n, sourceHash: nextHash };
  if (translations[original.id]?.sourceHash === oldHash) translations[original.id] = { ...translations[original.id], sourceHash: nextHash };
  if (original.i18n) validateI18n(original.i18n, next);
  counts[result.type] = (counts[result.type] || 0) + 1;
  const before = beforeById.get(original.id);
  assert.ok(before, 'Original classification not recorded');
  rows.push({ id: original.id, slug: original.slug, name: original.name, thumbnail: original.thumbUrl, before, after: result.type, changed: before.length !== 1 || before[0] !== result.type, confidence: result.confidence, reason: result.reason, model: result.model, provider: result.provider, individualReview: Boolean(result.individualReview), humanReviewed: Boolean(result.humanReviewed), reviewSource: result.reviewSource || null });
}
for (const [file, { text, value }] of Object.entries(state)) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync('data/' + file, (JSON.stringify(value, null, 2) + '\n').replace(/\n/g, eol));
}
const report = { total: rows.length, changed: rows.filter(x => x.changed).length, counts, lowConfidence: rows.filter(x => x.confidence < 0.7).length, rows };
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/2026-10-07-classification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, changed: report.changed, counts, lowConfidence: report.lowConfidence }));
