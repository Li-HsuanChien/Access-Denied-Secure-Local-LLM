import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const root='/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM';
const req=createRequire(root+'/app/document-qa/frontend/package.json');
const {chromium}=req('playwright');
const {createFixtureState,health,respond}=await import(root+'/app/document-qa/frontend/migration-parity/fixtures/responses.mjs');
const origin='http://127.0.0.1:4177';
const browser=await chromium.launch({executablePath:chromium.executablePath(),headless:true,args:['--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync']});
const source='> ```js\n> const quoted = 1;\n> ```\n\n```js\nconst top = 2;\n```\n';
const results=[];
try {for(const index of [1,0]){
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage(); const state=createFixtureState(); state.mode='answer'; const blocked=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const url=new URL(route.request().url());
 if(url.hostname==='127.0.0.1'&&url.port==='8765') {if(url.pathname==='/health')return route.fulfill({json:health('answer')});if(url.pathname!=='/v1/requests'){blocked.push(url.href);return route.abort();}const request=route.request().postDataJSON();const response=await respond(state,request);if(request.operation==='answering.ask')response.body.result.documents[0].text=source;return route.fulfill({status:response.status,json:response.body});}
 if(url.origin===origin)return route.continue();blocked.push(url.href);return route.abort();});
 await page.goto(origin+'/qa',{waitUntil:'networkidle'});await page.getByText('Summarize the key points',{exact:true}).click();await page.locator('.renderer-code').nth(1).waitFor();
 const before=await page.locator('.renderer-code .cm-content').allTextContents();const code=page.locator('.renderer-code').nth(index);const edited='const edited = '+(index+10)+';';
 await code.locator('.cm-content').fill(edited);await code.getByRole('button',{name:'Save',exact:true}).click();await code.getByRole('button',{name:'Saved',exact:true}).waitFor();
 await page.locator('.renderer-assistant-actions').getByRole('button',{name:'Copy',exact:true}).click();
 const copied=await page.evaluate(()=>navigator.clipboard.readText());const after=await page.locator('.renderer-code .cm-content').allTextContents();
 results.push({index,edited,source,before,after,copied,blocked,errors,records:state.records.length});await context.close();
}}finally{await browser.close();}
await fs.writeFile('/private/tmp/react-stage7a-fence-probe.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
