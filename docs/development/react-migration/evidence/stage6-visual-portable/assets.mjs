import fs from 'node:fs/promises';
import path from 'node:path';
const reviewRepoRoot=path.resolve(process.env.PARITY_REPO_ROOT||process.cwd());
const previewPort=Number(process.env.PARITY_PORT||'4177');
import assert from 'node:assert/strict';
const {chromium}=await import(`${reviewRepoRoot}/app/document-qa/frontend/node_modules/playwright/index.mjs`);
const {createFixtureState,health,respond}=await import(`${reviewRepoRoot}/app/document-qa/frontend/migration-parity/fixtures/responses.mjs`);
const out=process.env.PARITY_OUTPUT_DIR||'/private/tmp/react-stage6-visual-assets';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:['--disable-background-networking']});
const results=[];
async function open(port,{width=1440,height=1000,dark=false,locale='en-US',stored='',query='',sidebar=true,mode='answer',route='/qa'}={}){
 const origin=`http://127.0.0.1:${port}`,context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',colorScheme:dark?'dark':'light',locale,timezoneId:'America/New_York',permissions:['clipboard-read','clipboard-write']});
 await context.addInitScript(({dark,stored,sidebar})=>{if(top!==window)return;localStorage.theme=dark?'dark':'light';localStorage.sidebar=String(sidebar);if(stored)localStorage.locale=stored;Math.random=()=>0.5;const NativeDate=Date,epoch=NativeDate.parse('2026-10-20T12:00:00Z'),start=performance.now();window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[epoch+performance.now()-start]));}static now(){return epoch+performance.now()-start;}};let n=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`});},{dark,stored,sidebar});
 const page=await context.newPage(),state=createFixtureState(),errors=[],blocked=[],requests=[];state.mode=mode;
 page.on('pageerror',e=>errors.push(e.message));const responses=[];page.on('response',r=>responses.push({url:r.url(),status:r.status(),type:r.request().resourceType(),mime:r.headers()['content-type']}));page.on('requestfailed',r=>errors.push('REQUESTFAILED '+r.url()+' '+r.failure()?.errorText));
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin==='http://127.0.0.1:8765'){if(u.pathname==='/health')return r.fulfill({json:health(mode)});if(u.pathname==='/v1/requests'){const body=r.request().postDataJSON();requests.push(body);const response=await respond(state,body);return r.fulfill({status:response.status,json:response.body});}}if(u.origin===origin)return r.continue();blocked.push(u.href);return r.abort();});
 await page.goto(origin+route+query,{waitUntil:'networkidle'});await page.locator('#chat-input').waitFor();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 return{page,context,errors,blocked,requests,responses};
}
async function shot(page,name){await page.screenshot({path:`${out}/${name}.png`,animations:'disabled'});}


try{
 const p=await open(previewPort,{mode:'rich'});await p.page.locator('button').filter({hasText:'Summarize the key points'}).click();await p.page.getByText('Rich response',{exact:true}).waitFor();await p.page.waitForTimeout(1000);
 const fonts=await p.page.evaluate(async()=>{await document.fonts.load('16px Inter','Document Assistant');await document.fonts.load('16px Vazirmatn','مرحبا');await document.fonts.ready;return [...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight}));});
 const icons=await p.page.evaluate(async()=>Promise.all(['/favicon.png','/static/favicon.png'].map(async path=>{const r=await fetch(path);return{path,status:r.status,mime:r.headers.get('content-type'),bytes:(await r.arrayBuffer()).byteLength};})));
 const images=await p.page.locator('img').evaluateAll(es=>es.map(e=>({src:e.src,loaded:e.complete&&e.naturalWidth>0,naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight})));
 results.push({responses:p.responses,fonts,icons,images,errors:p.errors,blocked:p.blocked});await p.context.close();
}finally{await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();}
