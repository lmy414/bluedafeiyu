import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {IMAGE_PLACEHOLDER, assertWorkImages, missingWorkImages, workImagePresent} from '../work-image-integrity.mjs';
import {workImages} from '../../frontend/public/components/work-image.js';
import {languageSitemap, sitemapWorkImage, ORIGIN} from '../../frontend/scripts/localize-pages.mjs';

const ok = id => ({id, thumbUrl: `/submissions/previews/${id}.webp`, displayUrl: `/submissions/large/${id}.webp`});
const blank = id => ({id, thumbUrl: IMAGE_PLACEHOLDER, displayUrl: IMAGE_PLACEHOLDER});
const quiet = () => { const lines = []; return {lines, warn: line => lines.push(line)}; };
const localExists = (...paths) => {
  const pathname = value => new URL(value, 'https://fixture.invalid/').pathname;
  const known = new Set(paths.map(pathname));
  return value => known.has(pathname(value));
};

test('a release with every image present passes silently', () => {
  const log = quiet();
  assert.deepEqual(assertWorkImages([ok('a'), ok('b')], {log}), []);
  assert.deepEqual(log.lines, []);
});

test('the one percent boundary is inclusive, one work more aborts with every id', () => {
  const exactlyOnePercent = [...Array.from({length: 99}, (_, i) => ok('w' + i)), blank('lost')];
  const log = quiet();
  const missing = assertWorkImages(exactlyOnePercent, {log});
  assert.deepEqual(missing.map(work => work.id), ['lost']);
  assert.match(log.lines[0], /缺图作品 1\/100（1\.00%）/);
  assert.match(log.lines[0], /lost/);

  const aboveOnePercent = [...Array.from({length: 98}, (_, i) => ok('w' + i)), blank('alpha'), blank('beta')];
  assert.throws(
    () => assertWorkImages(aboveOnePercent, {log: quiet()}),
    /缺图作品 2\/100（2\.00%）超过 1%，构建中止[\s\S]*alpha, beta$/
  );
});

test('a warning lists every missing work id without truncating at twenty', () => {
  const missingIds = Array.from({length: 25}, (_, i) => 'lost-' + i);
  const works = [
    ...Array.from({length: 2975}, (_, i) => ok('w' + i)),
    ...missingIds.map(id => blank(id))
  ];
  const log = quiet();
  const missing = assertWorkImages(works, {log});
  assert.deepEqual(missing.map(work => work.id), missingIds);
  assert.equal(log.lines.length, 1);
  for (const id of missingIds) assert.ok(log.lines[0].includes(id), id);
  assert.doesNotMatch(log.lines[0], /…|\.\.\./);
  assert.match(log.lines[0], /缺图作品 25\/3000（0\.83%）/);
});

test('a failing gate also reports every id beyond the first twenty', () => {
  const missingIds = Array.from({length: 25}, (_, i) => 'gone-' + i);
  const works = [
    ...Array.from({length: 1475}, (_, i) => ok('w' + i)),
    ...missingIds.map(id => blank(id))
  ];
  assert.throws(() => assertWorkImages(works, {log: quiet()}), error => {
    for (const id of missingIds) assert.ok(error.message.includes(id), id);
    assert.match(error.message, /缺图作品 25\/1500（1\.67%）/);
    assert.doesNotMatch(error.message, /…|\.\.\./);
    return true;
  });
});

test('submissions, owner picks and first-batch previews all go through the same image check', () => {
  const works = [
    {id: 'submission-ok', source: 'submission', thumbUrl: '/submissions/previews/ok.webp', displayUrl: '/submissions/large/ok.webp'},
    {id: 'owner-missing', source: 'owner-picks', thumbUrl: '/owner-picks/previews/missing.webp', displayUrl: '/owner-picks/previews/missing.webp'},
    {id: 'blue-fish-missing', source: 'blue-fish', thumbUrl: 'data/blue-fish/previews/missing.webp', displayUrl: 'data/blue-fish/previews/missing.webp'},
    {id: 'blue-fish-ok', source: 'blue-fish', thumbUrl: 'data/blue-fish/previews/present.webp', displayUrl: 'data/blue-fish/previews/present.webp'}
  ];
  const missing = missingWorkImages(works, {
    imageExists: localExists('/submissions/previews/ok.webp', '/submissions/large/ok.webp', 'data/blue-fish/previews/present.webp')
  });
  assert.deepEqual(missing.map(work => work.id), ['owner-missing', 'blue-fish-missing']);
});

test('raw manifests keep the same thumbnail/display slots before normalization', () => {
  const raw = {id: 'raw-blue-fish', thumbnailPath: 'data/blue-fish/previews/raw.webp', fullPath: 'data/blue-fish/previews/raw.webp'};
  assert.deepEqual(missingWorkImages([raw], {imageExists: () => false}).map(work => work.id), ['raw-blue-fish']);
  assert.deepEqual(missingWorkImages([raw], {imageExists: value => value.endsWith('/raw.webp')}), []);
  const blueFish = {id: 'raw-preview', previewPath: 'previews/raw.webp', largePath: 'large/raw.webp'};
  assert.deepEqual(missingWorkImages([blueFish], {imageExists: () => false}).map(work => work.id), ['raw-preview']);
  assert.deepEqual(missingWorkImages([blueFish], {imageExists: localExists('previews/raw.webp')}), []);
});

test('the gate counts a missing first-batch preview, not just placeholder fields', () => {
  const works = [
    ...Array.from({length: 99}, (_, i) => ok('w' + i)),
    {id: 'sticker_bf_missing', source: 'blue-fish', thumbUrl: 'data/blue-fish/previews/missing.webp', displayUrl: 'data/blue-fish/previews/missing.webp'}
  ];
  const log = quiet();
  const missing = assertWorkImages(works, {log, imageExists: value => !value.includes('/blue-fish/previews/missing')});
  assert.deepEqual(missing.map(work => work.id), ['sticker_bf_missing']);
  assert.match(log.lines[0], /缺图作品 1\/100（1\.00%）/);
  assert.match(log.lines[0], /sticker_bf_missing/);
});

test('local paths must exist even when neither field is the placeholder', () => {
  const works = [
    {id: 'missing-local', thumbUrl: '/submissions/previews/missing.webp', displayUrl: '/submissions/large/missing.webp'},
    {id: 'present-local', thumbUrl: '/submissions/previews/present.webp', displayUrl: '/submissions/large/present.webp'}
  ];
  assert.deepEqual(
    missingWorkImages(works, {imageExists: localExists('/submissions/previews/present.webp')}).map(work => work.id),
    ['missing-local']
  );
});

test('remote images count as real but are never probed as local files', () => {
  const probes = [];
  const remote = 'https://raw.githubusercontent.com/lmy414/archive/main/media/a.webp';
  assert.equal(workImagePresent(
    {id: 'remote', thumbUrl: remote, displayUrl: IMAGE_PLACEHOLDER},
    {imageExists: value => { probes.push(value); return false; }}
  ), true);
  assert.deepEqual(probes, []);
  assert.equal(workImagePresent(
    {id: 'remote-display', thumbUrl: IMAGE_PLACEHOLDER, displayUrl: remote},
    {imageExists: value => { probes.push(value); return false; }}
  ), true);
  assert.deepEqual(probes, []);
});

test('rejected raw URLs cannot hide a normalized placeholder from the gate', () => {
  const raw = {id: 'rejected-url', thumbnailPath: 'https://example.com/media/123'};
  const work = {...raw, ...workImages(raw)};
  assert.deepEqual(workImages(raw), {thumbUrl: IMAGE_PLACEHOLDER, displayUrl: IMAGE_PLACEHOLDER});
  assert.equal(workImagePresent(work), false);
  assert.throws(() => assertWorkImages([work], {log: quiet()}), /缺图作品 1\/1[\s\S]*rejected-url$/);
});

test('normalized missing images remain missing even when stale raw metadata names a real image', () => {
  const work = {...blank('normalized-missing'), fullPath: 'https://example.com/stale.webp'};
  assert.equal(workImagePresent(work), false);
});

test('the release gate checks published files and requires a nonempty placeholder', t => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'work-release-images-'));
  t.after(() => fs.rmSync(sandbox, {recursive: true, force: true}));
  const source = path.join(sandbox, 'source'), release = path.join(sandbox, 'release');
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';
  const put = (root, name, content = image) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content);
  };
  for (const root of [source, release]) {
    put(root, 'components/image-placeholder.svg');
    put(root, 'submissions/previews/present.svg');
  }
  put(source, 'data/blue-fish/previews/source-only.svg');
  const overlay = path.join(sandbox, 'works-v2.json');
  fs.writeFileSync(overlay, JSON.stringify({
    present: {id: 'present', i: '/submissions/previews/present.svg', l: '/submissions/previews/present.svg'},
    shared: {id: 'source-only', i: '/data/blue-fish/previews/source-only.svg', l: '/data/blue-fish/previews/source-only.svg'}
  }));
  const gate = fileURLToPath(new URL('../work-image-integrity.mjs', import.meta.url));
  const run = root => spawnSync(process.execPath, [gate, overlay, root], {encoding: 'utf8'});
  const complete = run(source);
  assert.equal(complete.status, 0, complete.stderr);
  assert.match(complete.stdout, /2\/2 works have an image/);
  const incomplete = run(release);
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /缺图作品 1\/2[\s\S]*source-only/);
  put(source, 'components/image-placeholder.svg', '');
  const emptyPlaceholder = run(source);
  assert.notEqual(emptyPlaceholder.status, 0);
  assert.match(emptyPlaceholder.stderr, /Missing or empty \/components\/image-placeholder\.svg/);
});

test('thumb and display fall back to each other inside the same work', () => {
  const both = '/submissions/large/a.webp';
  assert.deepEqual(
    workImages({thumbUrl: '/submissions/previews/a.webp', displayUrl: both}, localExists(both)),
    {thumbUrl: both, displayUrl: both}
  );
  const thumb = '/submissions/previews/b.webp';
  assert.deepEqual(
    workImages({thumbUrl: thumb, displayUrl: '/submissions/large/b.webp'}, localExists(thumb)),
    {thumbUrl: thumb, displayUrl: thumb}
  );
  const missing = workImages({thumbUrl: '/submissions/previews/c.webp', displayUrl: '/submissions/large/c.webp'}, () => false);
  assert.deepEqual(missing, {thumbUrl: IMAGE_PLACEHOLDER, displayUrl: IMAGE_PLACEHOLDER});
  assert.deepEqual(missingWorkImages([{id: 'c', ...missing}]), [{id: 'c', ...missing}]);
  assert.deepEqual(missingWorkImages([{id: 'a', ...workImages({thumbUrl: '/submissions/previews/a.webp', displayUrl: both}, localExists(both))}]), []);
});

test('work sitemap image prefers the display image, then a real thumbnail, never the placeholder', () => {
  assert.equal(
    sitemapWorkImage({displayUrl: '/submissions/large/a.webp', thumbUrl: '/submissions/previews/a.webp'}),
    ORIGIN + '/submissions/large/a.webp'
  );
  assert.equal(
    sitemapWorkImage({displayUrl: IMAGE_PLACEHOLDER, thumbUrl: '/submissions/previews/b.webp'}),
    ORIGIN + '/submissions/previews/b.webp'
  );
  assert.equal(
    sitemapWorkImage({displayUrl: IMAGE_PLACEHOLDER, thumbUrl: IMAGE_PLACEHOLDER}),
    null
  );
  assert.equal(
    sitemapWorkImage({displayUrl: 'https://example.com/a.webp'}),
    'https://example.com/a.webp'
  );
});

test('the four language variants of a work page carry the image namespace and loc', () => {
  const images = new Map([
    ['/works/alpha.html', 'https://xn--pssy23gqgbz2d718b.com/submissions/large/alpha.webp'],
    ['/works/encoded.html', '/submissions/large/%E6%B5%8B%E8%AF%95.webp?x=1&y=2']
  ]);
  const xml = languageSitemap(['/works/alpha.html', '/works/encoded.html', '/characters.html'], new Map(), images);
  assert.match(xml, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.equal((xml.match(/<image:image>/g) || []).length, 8);
  assert.equal((xml.match(/<\/url>/g) || []).length, 12);
  assert.equal((xml.match(/<image:loc>https:\/\/xn--pssy23gqgbz2d718b\.com\/submissions\/large\/alpha\.webp<\/image:loc>/g) || []).length, 4);
  assert.match(xml, /<image:loc>https:\/\/xn--pssy23gqgbz2d718b\.com\/submissions\/large\/%E6%B5%8B%E8%AF%95\.webp\?x=1&amp;y=2<\/image:loc>/);
  assert.doesNotMatch(xml, /<image:loc>[^<]*image-placeholder/);
});

test('pages that are not work details never advertise an image', () => {
  const xml = languageSitemap(['/characters.html', '/works/alpha.html'], new Map(), new Map([
    ['/works/alpha.html', ORIGIN + '/submissions/large/alpha.webp']
  ]));
  const rows = xml.split('<url>').slice(1);
  const characterRows = rows.filter(row => row.includes('characters.html</loc>'));
  assert.equal(characterRows.length, 4);
  for (const row of characterRows) assert.doesNotMatch(row, /<image:image>/);
  const workRows = rows.filter(row => row.includes('/works/alpha.html</loc>'));
  assert.equal(workRows.length, 4);
  for (const row of workRows) assert.match(row, /<image:image><image:loc>/);
});
