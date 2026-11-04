// Optional real-browser acceptance against a served full build. No mock catalog.
// PLAYWRIGHT_MODULE may point at an existing Playwright installation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Converter} from 'opencc-js/cn2t';
import {auditImages} from './audit-image-alt.mjs';
import {workImageAlt} from '../public/components/image-alt.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin=process.argv[2] || 'http://127.0.0.1:5173';
const reportFile=process.argv[3] || '/tmp/image-alt-browser.json';
const snapshot=JSON.parse(fs.readFileSync(new URL('../../dist/site-data.json',import.meta.url),'utf8'));
const traditional=Converter({from:'cn',to:'twp'});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const report=[];
async function audit(locale,state){
  const result=auditImages(await page.content());
  report.push({locale,state,url:page.url(),images:result.images,decorations:result.decorations,issues:result.issues});
  assert.deepEqual(result.issues,[],locale+' '+state);
}
async function checkPreview(locale,state,selector){
  await page.locator(selector).waitFor();
  const href=await page.locator('.preview-detail-link').getAttribute('href');
  const slug=href.match(/\/works\/([^/]+)\.html/)?.[1];
  const work=snapshot.works.find(w=>w.slug===slug);
  assert.ok(work,href);
  const native=locale==='zh'?work:locale==='zh-Hant'?{name:traditional(work.name).replace(/孃/g,'娘'),description:traditional(work.description).replace(/孃/g,'娘')}:work.i18n[locale];
  const alt=await page.locator(selector).getAttribute('alt');
  assert.equal(alt,workImageAlt(native),locale+' '+state+' '+slug);
  await audit(locale,state);
  Object.assign(report.at(-1),{slug,title:native.name,alt});
  return href;
}
try{
  for(const [locale,prefix] of [['zh',''],['zh-Hant','/zh-hant'],['en','/en'],['ja','/ja']]){
    await page.goto(origin+prefix+'/index.html',{waitUntil:'domcontentloaded'});
    await audit(locale,'home');
    await page.locator('.work-art').first().click();
    await checkPreview(locale,'preview','.preview-photo img');
    await page.locator('[data-preview-step="1"]').click();
    await page.waitForFunction(()=>document.querySelector('.preview-position b')?.textContent==='02');
    const detail=await checkPreview(locale,'next','.preview-photo img');
    await page.keyboard.press('Escape');
    await page.goto(new URL(detail,origin).href,{waitUntil:'domcontentloaded'});
    await page.locator('.detail-image-open').click();
    await checkPreview(locale,'zoom','.preview-zoom img');
    await page.keyboard.press('Escape');
    await page.goto(origin+prefix+'/characters/gpt.html',{waitUntil:'domcontentloaded'});
    assert.ok((await page.locator('.character-portrait img').getAttribute('alt'))?.trim());
    await audit(locale,'gpt-role');
  }
}finally{
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify({states:report.length,locales:4,issues:report.flatMap(r=>r.issues).length,reportFile}));
