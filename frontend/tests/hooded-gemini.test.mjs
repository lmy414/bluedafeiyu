import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {sourceHash,validateI18n} from '../../tools/localization/contract.mjs';
import {isGifWork} from '../public/archive/work-format.js';

const root=path.resolve(import.meta.dirname,'../..');
const works=JSON.parse(fs.readFileSync(path.join(root,'data/works.json'),'utf8')).filter(w=>w.origin?.issue===133);
const topic=JSON.parse(fs.readFileSync(path.join(root,'data/topics.json'),'utf8')).find(t=>t.id==='hooded-gemini');

test('the curated topic contains exactly the 18 published ZIP members in their original order',()=>{
  assert.equal(works.length,18);
  assert.deepEqual(topic.workIds,works.toSorted((a,b)=>a.origin.archive.index-b.origin.archive.index).map(w=>w.id));
  assert.equal(new Set(topic.workIds).size,18);
  assert.ok(topic.workIds.includes(topic.coverWorkId));
  for(const work of works){
    assert.equal(work.status,'published');
    assert.equal(work.origin.archive.sha256,'4849bbe102503ff6e5a850d8ccaa422ce9b7ea029d78042073661a1b663a0920');
    assert.equal(work.slug,`gemini20261024${String(work.origin.archive.index+1).padStart(4,'0')}`);
    assert.equal(work.i18n.sourceHash,sourceHash(work));
    assert.doesNotThrow(()=>validateI18n(work.i18n,work));
    assert.ok(work.width>0&&work.height>0&&work.fileSize>0);
    const gif=work.origin.archive.member.endsWith('.gif');
    assert.equal(work.format,gif?'GIF':'WEBP');
    assert.equal(work.mimeType,gif?'image/gif':'image/webp');
    assert.equal(work.isAnimated,gif);
  }
  assert.deepEqual(works.filter(isGifWork).map(w=>w.slug),['gemini202610240015'],'the verified GIF original is included despite its legacy .png URL');
});

test('design credit, anonymous adaptation and unknown license stay distinct',()=>{
  assert.equal(topic.author,undefined,'the design source is not presented as the submitter of the derived stickers');
  for(const work of works){
    assert.equal(work.submitter.credit,'anonymous');
    assert.equal(work.submitter.name,'');
    assert.equal(work.origin.author,undefined);
    assert.equal(work.origin.sourceUrl,'https://space.bilibili.com/116292090');
    assert.ok(work.origin.note.includes('古明四季'));
    assert.ok(work.origin.note.includes('原形象'));
    assert.equal(work.license.type,'unknown');
    assert.ok(!JSON.stringify(work).includes('1cyberlangke1'),'anonymous choice applies to every field, including localized FAQs');
  }
});

test('the published topic, work links and source/permission notes are present in all four languages',()=>{
  const out=process.env.SITE_OUT_DIR||path.join(root,'.build/site');
  for(const prefix of ['','en/','ja/','zh-hant/']){
    const {document}=parseHTML(fs.readFileSync(path.join(out,prefix+'topics/hooded-gemini.html'),'utf8'));
    assert.equal(document.querySelector('[data-download-topic]').dataset.downloadTopic,'hooded-gemini');
    assert.equal(document.querySelectorAll('#results .work-card').length,18);
    for(const work of works){
      assert.ok(document.querySelector(`a[href="/${prefix}works/${work.slug}.html"]`));
      const page=parseHTML(fs.readFileSync(path.join(out,prefix+'works/'+work.slug+'.html'),'utf8')).document;
      assert.ok(page.querySelector('a[href="https://space.bilibili.com/116292090"]'));
      assert.ok(page.querySelector('[data-origin-note-text]').textContent.includes('116292090'));
      if(!prefix||prefix==='zh-hant/')assert.ok(page.querySelector('[data-origin-note-text]').textContent.includes('古明四季'));
      const schema=[...page.querySelectorAll('script[type="application/ld+json"]')].map(s=>JSON.parse(s.textContent)).find(s=>s['@type']==='ImageObject');
      assert.equal(schema.creator,undefined);
      assert.ok(schema.license.endsWith('#license-unknown'));
      assert.ok(!page.querySelector('.work-description').textContent.includes('1cyberlangke1'));
      assert.ok(!page.querySelector('[data-work-faq]')?.textContent.includes('1cyberlangke1'),'localized FAQ keeps the submitter anonymous');
    }
  }
});
