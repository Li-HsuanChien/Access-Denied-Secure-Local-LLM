import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/node_modules/playwright/index.mjs';
import {createFixtureState,health,respond} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/migration-parity/fixtures/responses.mjs';
const out='/private/tmp/react-stage5b-empty-font-timing';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:['--disable-background-networking']});
const results=[];
async function open(port,{width=1440,height=1000,dark=false,locale='en-US',stored='',query='',sidebar=true,mode='answer',route='/qa',fontWarm=false,fontDelay=0}={}){
 const origin=`http://127.0.0.1:${port}`,context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',colorScheme:dark?'dark':'light',locale,timezoneId:'America/New_York',permissions:['clipboard-read','clipboard-write']});
 await context.addInitScript(({dark,stored,sidebar})=>{if(top!==window)return;localStorage.theme=dark?'dark':'light';localStorage.sidebar=String(sidebar);if(stored)localStorage.locale=stored;Math.random=()=>0.5;const NativeDate=Date,epoch=NativeDate.parse('2026-10-20T12:00:00Z'),start=performance.now();window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[epoch+performance.now()-start]));}static now(){return epoch+performance.now()-start;}};let n=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`});},{dark,stored,sidebar});
 const page=await context.newPage(),state=createFixtureState(),errors=[],blocked=[],requests=[];state.mode=mode;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin==='http://127.0.0.1:8765'){if(u.pathname==='/health')return r.fulfill({json:health(mode)});if(u.pathname==='/v1/requests'){const body=r.request().postDataJSON();requests.push(body);const response=await respond(state,body);return r.fulfill({status:response.status,json:response.body});}}if(u.origin===origin){if(u.pathname==='/main.tsx'&&fontWarm){const response=await r.fetch();const body=await response.text();return r.fulfill({response,body:"await document.fonts.load('400 14px Inter'); await document.fonts.ready;\n"+body});}if(u.pathname.endsWith('/Inter-Variable.ttf')&&fontDelay)await new Promise(resolve=>setTimeout(resolve,fontDelay));return r.continue();}blocked.push(u.href);return r.abort();});
 await page.goto(origin+route+query,{waitUntil:'networkidle'});await page.locator('#chat-input').waitFor();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 return{page,context,errors,blocked,requests};
}
async function shot(page,name){await page.screenshot({path:`${out}/${name}.png`,animations:'disabled'});}

for(const mode of ['cold','warm','delayed'])for(let run=0;run<4;run++){
 const p=await open(5176,{fontWarm:mode==='warm',fontDelay:mode==='delayed'?500:0});await p.page.waitForTimeout(500);await shot(p.page,`${mode}-${run}`);results.push({mode,run,evidence:await p.page.evaluate(()=>({fonts:[...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight})),resources:performance.getEntriesByType('resource').filter(r=>/Inter-Variable|main.tsx/.test(r.name)).map(r=>({name:r.name,start:r.startTime,end:r.responseEnd})),model:document.querySelector('#model-selector-model-button span').getBoundingClientRect().toJSON()})),errors:p.errors,blocked:p.blocked});await p.context.close();
}
await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();
