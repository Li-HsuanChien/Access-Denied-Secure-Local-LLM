import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/node_modules/playwright/index.mjs';
import {createFixtureState,health,respond} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/migration-parity/fixtures/responses.mjs';
const out='/private/tmp/react-stage5b-placeholder-cause';await fs.mkdir(out,{recursive:true});
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


try {for(const port of [5173,5176]) {
 const p=await open(port);await p.page.locator('button').filter({hasText:'Summarize the key points'}).click();await p.page.getByText('From your documents',{exact:true}).waitFor();await p.page.mouse.move(1400,980);await p.page.waitForTimeout(700);
 const inspect=()=>{const e=document.querySelector('#chat-input p')||document.querySelector('#chat-input'),cs=getComputedStyle(e,'::before'),style={};for(const k of cs)style[k]=cs.getPropertyValue(k);return {node:e.outerHTML,rect:e.getBoundingClientRect().toJSON(),pseudo:style,ancestors:[e.parentElement,e.parentElement.parentElement].map(n=>({html:n.outerHTML.slice(0,400),rect:n.getBoundingClientRect().toJSON()}))};};
 const before=await p.page.evaluate(inspect);await shot(p.page,`${port}-base`);
 if(port===5176){await p.page.addStyleTag({content:'.chat-react .chat-editable:empty::before {float:left;position:absolute;}'});await shot(p.page,`${port}-absolute`);await p.page.addStyleTag({content:'.chat-react .chat-editable:empty::before {overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;}'});await shot(p.page,`${port}-native`);}
 results.push({port,before,after:await p.page.evaluate(inspect),errors:p.errors,blocked:p.blocked});await p.context.close();
}}finally{await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();}
