import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const root='/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM';
const req=createRequire(root+'/app/document-qa/frontend/package.json');
const {chromium}=req('playwright');
const {createFixtureState,health,respond}=await import(root+'/app/document-qa/frontend/migration-parity/fixtures/responses.mjs');
const browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync']});
const origin='http://127.0.0.1:4177';
const sources=[
'flowchart LR\n A@{ img: "'+origin+'/renderer-canary-image.svg", label: "Canary", pos: "t", w: 60, h: 60 }',
'flowchart LR\n A@{ shape: image, img: "'+origin+'/renderer-canary-image2.svg", label: "Canary", pos: "t", w: 60, h: 60 }',
'flowchart LR\n A[Safe] --> B[Done]'
];
const results=[];
try {
for (const source of sources) {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(); const state=createFixtureState(); state.mode='answer'; const blocked=[],errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message)); page.on('request',r=>requests.push(r.url()));
 await page.route('**/*',async route=>{const url=new URL(route.request().url());
 if(url.pathname.includes('renderer-canary')) {blocked.push(url.href);return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'});}
 if(url.hostname==='127.0.0.1'&&url.port==='8765') {if(url.pathname==='/health')return route.fulfill({json:health('answer')});if(url.pathname!=='/v1/requests'){blocked.push(url.href);return route.abort();}const request=route.request().postDataJSON();const response=await respond(state,request);if(request.operation==='answering.ask')response.body.result.documents[0].text='```mermaid\n'+source+'\n```\n';return route.fulfill({status:response.status,json:response.body});}
 if(url.origin===origin)return route.continue();blocked.push(url.href);return route.abort();
 });
 await page.goto(origin+'/qa',{waitUntil:'networkidle'});
 await page.getByText('Summarize the key points',{exact:true}).click();
 await page.locator('.renderer-assistant .markdown-prose').waitFor();
 await page.waitForTimeout(2000);
 results.push({source,blocked,errors,requests:requests.filter(x=>x.includes('canary')),text:await page.locator('.renderer-assistant .markdown-prose').innerText(),svg:await page.locator('.renderer-panzoom').count()});
 await context.close();
}
}finally{await browser.close();}
await fs.writeFile('/private/tmp/react-stage7a-mermaid-probe.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
