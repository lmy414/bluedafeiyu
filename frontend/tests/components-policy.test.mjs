import test from 'node:test';
import assert from 'node:assert/strict';
import {checkComponents,pageViolations,inlineStylePattern} from '../scripts/check-components.mjs';
test('business routes import components and cannot add markup, styles or class overrides',async()=>{
 const valid='---\nimport Card from "../components/Card.astro";\n---\n<Card variant="primary" />';
 assert.deepEqual(await pageViolations(valid,'test.astro'),[]);
 for(const body of ['<div><Card /></div>','<Card style="color:red" />','<Card class="custom" />','<Card class:list={["custom"]} />','<Card pageStyles={["/custom.css"]} />','<Card {...Astro.props} />','<script>document.body.style.color="red"</script>']) {
  const source=valid.slice(0,valid.lastIndexOf('<Card'))+body;
  assert.ok((await pageViolations(source,'test.astro')).length,body);
 }
 assert.ok((await pageViolations('---\nimport Card from "../lib/fake.astro";\n---\n<Card />','test.astro')).length);
 assert.ok((await pageViolations(valid.replace('import Card','import "../components/custom.css";\nimport Card'),'test.astro')).length);
});
test('style checks also cover HTML strings and runtime mutations',()=>{
 for(const source of ['`<div style="color:red">`','node.style.left="2px"','node["style"].color="red"','node.setAttribute("style","color:red")','sheet.insertRule("body{}")','`<style>p{}</style>`'])assert.match(source,inlineStylePattern);
});
test('the complete frontend satisfies the library boundary',async()=>assert.deepEqual(await checkComponents(),[]));
