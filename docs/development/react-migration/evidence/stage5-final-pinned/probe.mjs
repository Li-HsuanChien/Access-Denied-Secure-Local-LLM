import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/node_modules/playwright/index.mjs';
import {createFixtureState,health,respond} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/migration-parity/fixtures/responses.mjs';
const out='/private/tmp/react-stage5b-build7-pinned';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:['--disable-background-networking']});
await fs.writeFile(out+'/browser.json',JSON.stringify({version:browser.version(),executable:chromium.executablePath()},null,2));
const results=[];
async function open(port,{width=1440,height=1000,dark=false,locale='en-US',stored='',query='',sidebar=true,mode='answer',route='/qa'}={}){
 const origin=`http://127.0.0.1:${port}`,context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',colorScheme:dark?'dark':'light',locale,timezoneId:'America/New_York',permissions:['clipboard-read','clipboard-write']});
 await context.addInitScript(({dark,stored,sidebar})=>{if(top!==window)return;localStorage.theme=dark?'dark':'light';localStorage.sidebar=String(sidebar);if(stored)localStorage.locale=stored;Math.random=()=>0.5;const NativeDate=Date,epoch=NativeDate.parse('2026-10-20T12:00:00Z'),start=performance.now();window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[epoch+performance.now()-start]));}static now(){return epoch+performance.now()-start;}};let n=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`});},{dark,stored,sidebar});
 const page=await context.newPage(),state=createFixtureState(),errors=[],blocked=[],requests=[];state.mode=mode;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin==='http://127.0.0.1:8765'){if(u.pathname==='/health')return r.fulfill({json:health(mode)});if(u.pathname==='/v1/requests'){const body=r.request().postDataJSON();requests.push(body);const response=await respond(state,body);return r.fulfill({status:response.status,json:response.body});}}if(u.origin===origin)return r.continue();blocked.push(u.href);return r.abort();});
 await page.goto(origin+route+query,{waitUntil:'networkidle'});await page.locator('#chat-input').waitFor();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 return{page,context,errors,blocked,requests};
}
async function shot(page,name){await page.screenshot({path:`${out}/${name}.png`,animations:'disabled'});}
const catalogs=Object.fromEntries(await Promise.all(['en-US','fr-FR','de-DE'].map(async l=>[l,JSON.parse(await fs.readFile(`/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/src/lib/i18n/locales/${l}/translation.json`,'utf8'))])));
const key=(l,k)=>catalogs[l]?.[k]||k;
async function pin(page,locale){await page.locator('#model-selector-model-button').click();await page.getByRole('option').first().hover();await page.getByRole('button',{name:key(locale,'More Options'),exact:true}).last().click();await page.getByRole('button',{name:key(locale,'Keep in Sidebar'),exact:true}).click();await page.getByText('Local workspace',{exact:true}).click();await page.waitForTimeout(600);}
try{for(const config of [{name:'light'},{name:'dark',dark:true},{name:'mobile',width:390,height:844,sidebar:false},{name:'fr',locale:'fr-FR'},{name:'de',locale:'de-DE'}])for(const port of [5173,4177]){
 const p=await open(port,config),{page}=p,locale=config.locale||'en-US';await pin(page,locale);
 if(config.name==='mobile'){await page.getByRole('button',{name:'Open sidebar',exact:true}).click();await page.waitForTimeout(400);}
 await page.mouse.move((config.width||1440)-5,(config.height||1000)-5);await page.waitForTimeout(200);await shot(page,`${port}-${config.name}-pinned`);
 const entry={port,variant:config.name,sidebar:await page.locator('#sidebar').innerText(),section:await page.getByRole('button',{name:key(locale,'Models'),exact:true}).getAttribute('aria-expanded'),row:await page.locator('#pinned-models-list').evaluate(e=>({html:e.outerHTML,rect:e.getBoundingClientRect().toJSON(),images:[...e.querySelectorAll('img')].map(i=>({src:new URL(i.src).pathname,natural:i.naturalWidth}))})),errors:p.errors,blocked:p.blocked};
 if(config.name!=='mobile'){
  const row=page.locator('#pinned-models-list [data-id="secure-qa-local"]');await row.hover();await page.keyboard.down('Shift');await row.locator('button').waitFor();await shot(page,`${port}-${config.name}-shift`);await row.locator('button').hover();await page.waitForTimeout(500);entry.unpinTooltip=await page.locator('[role="tooltip"]').last().innerText();await row.locator('button').click();await page.keyboard.up('Shift');entry.afterUnpin=await page.locator('#sidebar').innerText();await pin(page,locale);
  await page.getByRole('button',{name:key(locale,'Models'),exact:true}).click();await page.waitForTimeout(450);await page.mouse.move(1435,995);await shot(page,`${port}-${config.name}-collapsed`);entry.folder=await page.evaluate(()=>localStorage.getItem('sidebar-models-folder-state'));
  await page.getByRole('button',{name:key(locale,'Models'),exact:true}).click();await page.waitForTimeout(400);
 }
 await page.locator('#pinned-models-list a').click();await page.waitForTimeout(500);entry.afterClick={url:new URL(page.url()).pathname+new URL(page.url()).search,hasPin:await page.locator('#pinned-models-list').count(),input:await page.locator('#chat-input').innerText(),asks:p.requests.filter(r=>r.operation==='answering.ask').length,saves:p.requests.filter(r=>r.operation==='history.save').length,sidebarVisible:await page.locator('#sidebar').isVisible()};
 entry.afterClick.sidebarState=await page.evaluate(()=>localStorage.sidebar);console.log(`${port}-${config.name} complete`);results.push(entry);await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await p.context.close();
}}finally{await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();}
console.log(JSON.stringify(results.map(({port,variant,unpinTooltip,folder,afterClick,errors,blocked})=>({port,variant,unpinTooltip,folder,afterClick,errors,blocked})),null,2));
