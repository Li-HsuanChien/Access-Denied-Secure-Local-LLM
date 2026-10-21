import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/node_modules/playwright/index.mjs';
import {createFixtureState,health,respond} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/migration-parity/fixtures/responses.mjs';
const out='/private/tmp/react-stage5b-empty-diagnostic';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:['--disable-background-networking']});
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

const selector='#model-selector-model-button';
for(const port of [5173,5176])for(const route of ['/qa','/c/baseline-session']){
 const p=await open(port,{route});const key=`${port}-${route.includes('/c/')?'redirect':'qa'}`;await p.page.waitForTimeout(1000);
 const record=await p.page.locator(selector).evaluate(e=>{const out=[];for(let p=e;p;p=p.parentElement){const style=getComputedStyle(p),props={};for(const k of style)props[k]=style.getPropertyValue(k);const ranges=[];for(const node of p.childNodes){if(node.nodeType===3){const r=document.createRange();r.selectNodeContents(node);ranges.push({text:node.textContent,rect:[...r.getClientRects()].map(x=>x.toJSON())});}}out.push({tag:p.tagName,cls:p.className,html:p.outerHTML.slice(0,500),rect:p.getBoundingClientRect().toJSON(),style:props,ranges,animations:p.getAnimations().map(a=>({state:a.playState,timing:a.effect.getTiming(),frames:a.effect.getKeyframes()}))});}return{ancestors:out,animations:document.getAnimations().map(a=>({target:a.effect.target?.outerHTML?.slice(0,300),state:a.playState,timing:a.effect.getTiming(),frames:a.effect.getKeyframes()}))};});
 record.suggestions=await p.page.locator('button[role=listitem]').evaluateAll(es=>es.map(e=>{const style=getComputedStyle(e),props={};for(const k of style)props[k]=style.getPropertyValue(k);return{html:e.outerHTML,rect:e.getBoundingClientRect().toJSON(),style:props};}));
 await shot(p.page,key);await fs.writeFile(`${out}/${key}.json`,JSON.stringify(record,null,2));await p.context.close();
}
await browser.close();
