import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/node_modules/playwright/index.mjs';
import {createFixtureState,health,respond} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/migration-parity/fixtures/responses.mjs';
const out='/private/tmp/react-stage5b-final-production-css';await fs.mkdir(out,{recursive:true});
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


try {for(const port of [5173,5176,4177]) {
 const p=await open(port,{sidebar:false});await p.page.waitForTimeout(500);
 await p.page.locator('#chat-input').click();await p.page.keyboard.type('parity');await p.page.mouse.move(1400,980);await p.page.waitForTimeout(500);
 const styles=await p.page.locator('#chat-input').evaluate(e=>{let out=[];for(let n=e;n&&n!==document.body;n=n.parentElement){const style={},cs=getComputedStyle(n);for(const k of cs)style[k]=cs.getPropertyValue(k);out.push({tag:n.tagName,id:n.id,cls:n.className,rect:n.getBoundingClientRect().toJSON(),style});}return out;});
 const rules=await p.page.evaluate(()=>{let out=[];for(const s of document.styleSheets){try{for(const r of s.cssRules)if(r.cssText.includes('shadow')||r.cssText.includes('composer'))out.push(r.cssText);}catch{}}return out;});
 await shot(p.page,String(port));results.push({port,styles,rules,errors:p.errors,blocked:p.blocked});await p.context.close();
}}finally{await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();}
