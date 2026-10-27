import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/node_modules/playwright/index.mjs';
import {createFixtureState,health,respond} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/migration-parity/fixtures/responses.mjs';
const out='/private/tmp/react-stage5b-build6b-corners';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:['--disable-background-networking']});
const results=[];
async function open(port,{width=1440,height=1000,dark=false,locale='en-US',stored='',query='',sidebar=true,mode='answer',route='/qa'}={}){
 const origin=`http://127.0.0.1:${port}`,context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',colorScheme:dark?'dark':'light',locale,timezoneId:'America/New_York',permissions:['clipboard-read','clipboard-write']});
 await context.addInitScript(({dark,stored,sidebar})=>{if(top!==window)return;localStorage.theme=dark?'dark':'light';localStorage.sidebar=String(sidebar);if(stored)localStorage.locale=stored;Math.random=()=>0.5;const NativeDate=Date,epoch=NativeDate.parse('2026-10-20T12:00:00Z'),start=performance.now();window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[epoch+performance.now()-start]));}static now(){return epoch+performance.now()-start;}};let n=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`});},{dark,stored,sidebar});
 const page=await context.newPage(),state=createFixtureState(),errors=[],blocked=[],requests=[];state.mode=mode;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin==='http://127.0.0.1:8765'){if(u.pathname==='/health')return r.fulfill({json:health(mode)});if(u.pathname==='/v1/requests'){const body=r.request().postDataJSON();requests.push(body);const response=await respond(state,body);return r.fulfill({status:response.status,json:response.body});}}if(u.origin===origin)return r.continue();blocked.push(u.href);return r.abort();});
 await page.goto(origin+route+query,{waitUntil:'networkidle'});await page.locator(route==='/qa'?'#chat-input':'#main-content h1').waitFor();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 return{page,context,errors,blocked,requests};
}
async function shot(page,name){await page.screenshot({path:`${out}/${name}.png`,animations:'disabled'});}


try{for(const port of [5173,4177])for(const config of [{name:'library-dark',route:'/library',dark:true,mode:'publication-failure'},{name:'answer-light'}]){
 const p=await open(port,config);if(config.name==='answer-light'){await p.page.locator('button').filter({hasText:'Summarize the key points'}).click();await p.page.getByText('From your documents',{exact:true}).waitFor();}await p.page.mouse.move(1400,980);await p.page.waitForTimeout(700);
 const read=()=>[{x:262,y:20},{x:1136,y:17},{x:519,y:374},{x:519,y:391}].map(p=>{const e=document.elementFromPoint(p.x,p.y),style={},cs=getComputedStyle(e);for(const k of cs)if(!k.startsWith('--'))style[k]=cs.getPropertyValue(k);return {...p,html:e.outerHTML,rect:e.getBoundingClientRect().toJSON(),style};});
 const before=await p.page.evaluate(read);await shot(p.page,`${port}-${config.name}-base`);await p.page.getByText('Local workspace',{exact:true}).hover();await p.page.mouse.move(1400,980);await p.page.waitForTimeout(300);await shot(p.page,`${port}-${config.name}-hover`);results.push({port,variant:config.name,before,after:await p.page.evaluate(read),errors:p.errors,blocked:p.blocked});await p.context.close();
}}finally{await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();}
