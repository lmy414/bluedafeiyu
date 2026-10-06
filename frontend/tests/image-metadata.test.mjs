import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { imageMetadata, imageRights } from '../src/lib/image-metadata.mjs';

const sample = { name: '测试作品', slug: 'test', displayUrl: '/images/test.webp', thumbUrl: '/images/thumb.webp', tags: [] };
test('未知作者不变成投稿者或占位 Person，授权备注不变成网址', () => {
  for (const author of [null, '', '未标注', '本人', '上游清单导入', 'GPT画的']) {
    const meta = imageMetadata({ ...sample, origin: { author }, submitter: { name: '整理者' }, license: { note: '允许本站下载' } });
    assert.equal(meta.creator, undefined);
    assert.match(meta.creditText, /整理者.*整理收录/);
    assert.match(meta.copyrightNotice, /原作者未标注/);
    assert.match(meta.license, /^https:\/\/.*about\.html#license-unknown$/);
    assert.match(meta.acquireLicensePage, /about\.html#licensing$/);
  }
});
test('投稿署名、来源作者与 CC0 声明互不混淆', () => {
  const meta = imageMetadata({ ...sample, origin: { author: '原作者' }, submitter: { credit: 'named', name: '投稿署名' } });
  assert.equal(meta.creator.name, '原作者');
  assert.equal(meta.creditText, '投稿署名；蓝色大肥鱼（整理收录）');
  assert.match(meta.copyrightNotice, /原作者 原作者/);
  const anonymous = imageMetadata({ ...sample, submitter: { credit: 'anonymous', name: '不要公开' } });
  assert.ok(!JSON.stringify(anonymous).includes('不要公开'));
  const cc0 = imageMetadata({ ...sample, license: { type: 'cc0' } });
  assert.match(cc0.copyrightNotice, /CC0 公共领域/);
  assert.ok(!cc0.copyrightNotice.includes('版权归'));
});
test('所有发布页的四项字段有可达锚点，结构化数据与浮层、静态正文一致', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const out = process.env.SITE_OUT_DIR || path.join(root, '.build/site');
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'dist/site-data.json'), 'utf8'));
  const about = fs.readFileSync(path.join(out, 'about.html'), 'utf8');
  const overlay = JSON.parse(fs.readFileSync(path.join(out, 'works-v2.json'), 'utf8'));
  for (const work of snapshot.works) {
    const html = fs.readFileSync(path.join(out, 'works', work.slug + '.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    const meta = scripts.map(m => JSON.parse(m[1])).find(m => m['@type'] === 'ImageObject');
    assert.ok(meta, work.slug);
    for (const key of ['license', 'acquireLicensePage']) {
      const url = new URL(meta[key]);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.pathname, '/about.html');
      assert.ok(about.includes(`id="${url.hash.slice(1)}"`), `${work.slug}: ${key}`);
      assert.equal(meta[key], overlay[work.slug].rights[key]);
    }
    for (const key of ['creditText', 'copyrightNotice']) {
      assert.ok(meta[key]);
      assert.equal(meta[key], overlay[work.slug].rights[key]);
      const escaped = meta[key].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      assert.ok(html.includes(escaped), `${work.slug}: ${key} 未显示`);
    }
    assert.equal(meta.creator?.name, imageRights(work).creator || undefined, work.slug + ': creator must match the recorded original artist');
    assert.ok(!meta.license.includes('creativecommons.org'), '没有版本依据时不指定 CC 版本');
  }
});
