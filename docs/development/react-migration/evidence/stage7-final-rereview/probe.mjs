import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root='/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM';
const req=createRequire(root+'/app/document-qa/frontend/package.json');
const {chromium}=req('playwright');
const {createFixtureState,health,respond}=await import(root+'/app/document-qa/frontend/migration-parity/fixtures/responses.mjs');
const origin='http://127.0.0.1:4177';
const browser=await chromium.launch({executablePath:chromium.executablePath(),headless:true,args:['--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync']});
const results={browser:browser.version(),executable:chromium.executablePath(),origin,cases:[]};
const output='/private/tmp/react-stage7a-rereview.json';
async function pageFor(source){
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage(); const state=createFixtureState();state.mode='answer';const blocked=[],errors=[],requests=[],operations=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.route('**/*',async route=>{const url=new URL(route.request().url());
  if(url.pathname.includes('renderer-canary')){blocked.push(url.href);return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'});}
  if(url.hostname==='127.0.0.1'&&url.port==='8765'){
   if(url.pathname==='/health')return route.fulfill({json:health('answer')});
   if(url.pathname!=='/v1/requests'){blocked.push(url.href);return route.abort();}
   const request=route.request().postDataJSON();operations.push(request);const response=await respond(state,request);
   if(request.operation==='answering.ask')response.body.result.documents[0].text=source;
   return route.fulfill({status:response.status,json:response.body});
  }
  if(url.origin===origin)return route.continue();blocked.push(url.href);return route.abort();
 });
 await page.goto(origin+'/qa',{waitUntil:'networkidle'});await page.getByText('Summarize the key points',{exact:true}).click();await page.locator('.renderer-assistant .markdown-prose').waitFor();
 return{context,page,state,blocked,errors,requests,operations};
}
async function copy(page){await page.locator('.renderer-assistant-actions').getByRole('button',{name:'Copy',exact:true}).click();return await page.evaluate(()=>navigator.clipboard.readText());}
async function save(page,index,value){const code=page.locator('.renderer-code').nth(index);await code.locator('.cm-content').fill(value);await code.getByRole('button',{name:'Save',exact:true}).click();await code.getByRole('button',{name:'Saved',exact:true}).waitFor();}
try{
 const metadata=[
  'img: "'+origin+'/renderer-canary-original.svg"',
  '"img": "/renderer-canary-quoted.svg"',
  "'img': '../renderer-canary-single.svg'",
  String.raw`"i\u006dg": "\u0068ttp://127.0.0.1:4177/renderer-canary-unicode.svg"`,
  String.raw`"\x69mg": "/renderer-canary-hex.svg"`,
  String.raw`"\U00000069mg": "file:///renderer-canary-file.svg"`,
  'img: "//example.test/renderer-canary-protocol.svg"',
  'img: "#renderer-canary-paint"',
  'img: "data:image/svg+xml;base64,PHN2Zy8+"',
  'img: "blob:'+origin+'/renderer-canary-blob"',
  '\n  "img": >-\n    '+origin+'/renderer-canary-folded.svg\n  label: Canary\n'
 ];
 const malicious=metadata.map(value=>'flowchart LR\n A@{'+value+'}');
 const safe=['flowchart LR\n A[Safe] --> B[Done]','flowchart LR\n A@{ shape: rect, label: "Safe metadata" } --> B[Complete]','sequenceDiagram\n Alice->>Bob: Safe message\n Bob-->>Alice: Complete'];
 const source=[...malicious,...safe].map(s=>'```mermaid\n'+s+'\n```\n').join('\n');
 const test=await pageFor(source);
 await test.page.waitForFunction(()=>document.querySelectorAll('.renderer-panzoom > svg').length===3);
 await test.page.waitForTimeout(100);
 const alerts=await test.page.locator('.renderer-assistant .markdown-prose [role="alert"]').allTextContents();
 assert.equal(alerts.length,11);assert.ok(alerts.every(a=>a.includes('External diagram resources are disabled')),alerts.join('\n'));
 assert.equal(await test.page.locator('.renderer-panzoom').count(),3);
 assert.deepEqual(test.blocked,[]);assert.deepEqual(test.errors,[]);assert.equal(test.requests.filter(x=>x.includes('renderer-canary')).length,0);
 results.cases.push({name:'F7A1 production parsed metadata rejection and safe queued diagrams',metadata,alerts,safe,blocked:test.blocked,errors:test.errors,canaries:test.requests.filter(x=>x.includes('renderer-canary')),scripts:await test.page.locator('script[src]').evaluateAll(ns=>ns.map(n=>n.src))});await test.context.close();
 const quoted='> ```js\n> const quoted = 1;\n> ```\n\n';
 const listed='- Item\n\n  ```js\n  const listed = 1;\n  ```\n\n';
 const rootFence='```js\nconst same = 2;\n```\n\n';
 const source2=quoted+listed+rootFence+quoted+rootFence;
 const test2=await pageFor(source2);await test2.page.locator('.renderer-code').nth(4).waitFor();
 const originalCopy=await copy(test2.page),before=await test2.page.locator('.renderer-code .cm-content').allTextContents();
 for(const i of [0,1,3])await save(test2.page,i,'const localOnly = '+i+';');
 const afterNestedCopy=await copy(test2.page);assert.equal(afterNestedCopy,originalCopy);
 const afterNestedEditors=await test2.page.locator('.renderer-code .cm-content').allTextContents();assert.equal(afterNestedEditors[2],'const same = 2;');assert.equal(afterNestedEditors[4],'const same = 2;');
 await save(test2.page,2,'const first = 3;');await save(test2.page,4,'const second = 4;');
 const copied=await copy(test2.page);
 const expectedSource=quoted+listed+rootFence.replace('same = 2','first = 3')+quoted+rootFence.replace('same = 2','second = 4');
 assert.equal(copied,originalCopy.replace(source2.trimEnd(),expectedSource.trimEnd()));
 const savedPayloads=()=>test2.operations.filter(o=>o.operation==='history.save');
 assert.equal(savedPayloads().length,1);assert.equal(savedPayloads()[0].payload.answer.documents[0].text,source2);
 await test2.page.locator('.renderer-assistant-actions').getByRole('button',{name:'Regenerate',exact:true}).click();await test2.page.getByRole('button',{name:'Try Again',exact:true}).click();
 await test2.page.getByRole('button',{name:'Previous message',exact:true}).waitFor();await test2.page.getByRole('button',{name:'Previous message',exact:true}).click();
 const revisitedCopy=await copy(test2.page);const revisitedEditors=await test2.page.locator('.renderer-code .cm-content').allTextContents();assert.equal(revisitedCopy,copied);
 assert.deepEqual(revisitedEditors,['const quoted = 1;','const listed = 1;','const first = 3;','const quoted = 1;','const second = 4;']);assert.equal(savedPayloads().length,2);
 assert.deepEqual(test2.blocked,[]);assert.deepEqual(test2.errors,[]);
 results.cases.push({name:'F7A2 nested local saves and repeated root save/copy/branch revisit',source:source2,before,afterNestedEditors,afterNestedCopy,copied,revisitedCopy,revisitedEditors,historySaves:savedPayloads().length,originalSavedText:savedPayloads()[0].payload.answer.documents[0].text,blocked:test2.blocked,errors:test2.errors});await test2.context.close();
 results.result='passed';
}catch(error){results.result='failed';results.failure=error.stack;throw error;}finally{await browser.close();await fs.writeFile(output,JSON.stringify(results,null,2));console.log(JSON.stringify({result:results.result,cases:results.cases.length,output,failure:results.failure}));}
