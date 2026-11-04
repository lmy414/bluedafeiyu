// Real-browser regression for late OpenCC readiness; use a served full build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Converter} from 'opencc-js/cn2t';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin=process.argv[2] || 'http://127.0.0.1:5173';
const output=process.argv[3] || '/tmp/preview-language-ready.json';
const convert=Converter({from:'cn',to:'twp'});
const traditional=s=>convert(s).replace(/孃/g,'娘');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
const results=[];
try{
  const snapshot=await (await fetch(origin+'/site-data.json')).json();
  const slug=snapshot.works.find(w=>w.status==='published').slug;
  for(const theme of ['light','dark']){
    for(const scenario of ['preview','step','zoom']){
      const context=await browser.newContext({viewport:{width:1440,height:1000}});
      await context.addInitScript(theme=>{localStorage.setItem('bluedafeiyu-theme',theme);window.previewViews=0;document.addEventListener('work:show',()=>window.previewViews++);},theme);
      const page=await context.newPage();
      let delayed=0;
      await page.route('**/vendor/opencc/**',async route=>{delayed++;await new Promise(resolve=>setTimeout(resolve,3500));await route.continue();});
      const route=scenario==='zoom'?'/zh-hant/works/'+slug+'.html':'/zh-hant/index.html';
      await page.goto(origin+route,{waitUntil:'domcontentloaded'});
      await page.locator(scenario==='zoom'?'.detail-image-open':'.work-art').first().click();
      const selector=scenario==='zoom'?'.preview-zoom img':'.preview-photo img';
      await page.locator(selector).waitFor();
      if(scenario==='step'){
        await page.locator('[data-preview-step="1"]').click();
        await page.waitForFunction(()=>document.querySelector('.preview-position b')?.textContent==='02');
      }
      assert.equal(await page.evaluate(()=>SiteLang.contentText('绘画')),'绘画','must open BEFORE OpenCC readiness');
      const element=await page.locator(selector).elementHandle();
      await page.locator('.preview-detail-link').focus();
      await page.evaluate(()=>{document.querySelector('#preview-dialog').scrollTop=48;});
      const before=await page.evaluate(selector=>({alt:document.querySelector(selector).alt,src:document.querySelector(selector).src,scroll:document.querySelector('#preview-dialog').scrollTop,views:window.previewViews}),selector);
      assert.notEqual(traditional(before.alt),before.alt,'fixture must contain convertible Chinese');
      await page.waitForFunction(()=>SiteLang.contentText('绘画')==='繪畫');
      await page.waitForFunction(({selector,alt})=>document.querySelector(selector).alt===alt,{selector,alt:traditional(before.alt)});
      assert.equal(await element.evaluate((el,selector)=>el===document.querySelector(selector),selector),true,'image node retained');
      const after=await page.evaluate(selector=>({alt:document.querySelector(selector).alt,src:document.querySelector(selector).src,scroll:document.querySelector('#preview-dialog').scrollTop,views:window.previewViews,focus:document.activeElement.classList.contains('preview-detail-link'),theme:document.documentElement.dataset.theme}),selector);
      assert.equal(after.src,before.src);assert.equal(after.scroll,before.scroll);assert.equal(after.views,before.views);assert.equal(after.focus,true);assert.equal(after.theme,theme);assert.equal(delayed,1);
      await page.keyboard.press('Escape');assert.equal(await page.locator('#preview-dialog').evaluate(el=>el.open),false);
      results.push({theme,scenario,delayMs:3500,beforeAlt:before.alt,afterAlt:after.alt,imageRetained:true,focusRetained:true,scrollRetained:true,viewCountUnchanged:true});
      await context.close();
    }
    for(const [locale,prefix] of [['zh',''],['zh-Hant','/zh-hant'],['en','/en'],['ja','/ja']]){
      const context=await browser.newContext();await context.addInitScript(theme=>localStorage.setItem('bluedafeiyu-theme',theme),theme);
      const page=await context.newPage();await page.goto(origin+prefix+'/index.html',{waitUntil:'domcontentloaded'});
      if(locale==='zh-Hant')await page.waitForFunction(()=>SiteLang.contentText('绘画')==='繪畫');
      const card=page.locator('.work-art').first(),expected=await card.locator('img').getAttribute('alt');
      await card.click();await page.locator('.preview-photo img').waitFor();
      assert.equal(await page.locator('.preview-photo img').getAttribute('alt'),expected);
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
      results.push({locale,theme,scenario:'ready-preview',alt:expected});await context.close();
    }
  }
}finally{fs.writeFileSync(output,JSON.stringify({origin,browser:browser.version(),results},null,2));await browser.close();}
console.log(JSON.stringify({cases:results.length,delayedCases:6,delayMs:3500,output}));
