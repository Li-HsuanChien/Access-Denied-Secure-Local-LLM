import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/node_modules/playwright/index.mjs';
import {createFixtureState,health,respond} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/migration-parity/fixtures/responses.mjs';
const out='/private/tmp/react-stage5b-build7-regenerate-motion';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:['--disable-background-networking']});
const results=[];
async function open(port,{width=1440,height=1000,dark=false,locale='en-US',stored='',query='',sidebar=true,mode='answer',route='/qa'}={}){
 const origin=`http://127.0.0.1:${port}`,context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',colorScheme:dark?'dark':'light',locale,timezoneId:'America/New_York',permissions:['clipboard-read','clipboard-write']});
 await context.addInitScript(({dark,stored,sidebar})=>{if(top!==window)return;localStorage.theme=dark?'dark':'light';localStorage.sidebar=String(sidebar);if(stored)localStorage.locale=stored;Math.random=()=>0.5;const NativeDate=Date,epoch=NativeDate.parse('2026-10-20T12:00:00Z'),start=performance.now();window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[epoch+performance.now()-start]));}static now(){return epoch+performance.now()-start;}};let n=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`});},{dark,stored,sidebar});
 await context.addInitScript(()=>{window.__animationCalls=[];const native=Element.prototype.animate;Element.prototype.animate=function(frames,options){window.__animationCalls.push({cls:this.className,tag:this.tagName,options,frames:Array.isArray(frames)?[frames[0],frames.at(-1)]:frames});return native.call(this,frames,options);};});
 const page=await context.newPage(),state=createFixtureState(),errors=[],blocked=[],requests=[];state.mode=mode;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin==='http://127.0.0.1:8765'){if(u.pathname==='/health')return r.fulfill({json:health(mode)});if(u.pathname==='/v1/requests'){const body=r.request().postDataJSON();requests.push(body);const response=await respond(state,body);return r.fulfill({status:response.status,json:response.body});}}if(u.origin===origin)return r.continue();blocked.push(u.href);return r.abort();});
 await page.goto(origin+route+query,{waitUntil:'networkidle'});await page.locator('#chat-input').waitFor();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 return{page,context,errors,blocked,requests};
}
async function shot(page,name){await page.screenshot({path:`${out}/${name}.png`,animations:'disabled'});}


const rootSelector = '#floating-message-input';
const read = () => {
 const input=document.querySelector('#floating-message-input');
 if(!input)return null;
 const node=input.closest('.renderer-regenerate-menu') || input.closest('[role="menu"]');
 return {node,animation:node.getAnimations().find(a=>Number(a.effect.getTiming().duration)>0 && a.effect.getKeyframes().some(f=>f.transform))};
};
try { for (const port of [5173,4177]) {
 const p=await open(port);await p.page.locator('button').filter({hasText:'Summarize the key points'}).click();await p.page.getByText('From your documents',{exact:true}).waitFor();await p.page.waitForTimeout(300);
 const trigger=p.page.locator('button[aria-label="Regenerate"]');await trigger.click();
 await p.page.waitForFunction(()=>{const input=document.querySelector('#floating-message-input');const n=input?.closest('.renderer-regenerate-menu')||input?.closest('[role="menu"]');return n?.getAnimations().some(a=>a.effect.getTiming().duration===200);});
 const snapshot=()=>{const input=document.querySelector('#floating-message-input'),node=input.closest('.renderer-regenerate-menu')||input.closest('[role="menu"]');const a=node.getAnimations().find(a=>Number(a.effect.getTiming().duration)>1&&a.effect.getKeyframes().some(f=>f.transform));return {duration:a.effect.getTiming().duration,frames:a.effect.getKeyframes(),inert:node.inert,style:{opacity:getComputedStyle(node).opacity,transform:getComputedStyle(node).transform},inputSame:window.__initialMenuInput===input};};
 await p.page.evaluate(()=>{window.__initialMenuInput=document.querySelector('#floating-message-input');const n=window.__initialMenuInput.closest('.renderer-regenerate-menu')||window.__initialMenuInput.closest('[role="menu"]');const a=n.getAnimations().find(a=>a.effect.getTiming().duration===200);a.pause();a.currentTime=40;});
 const initial=await p.page.evaluate(snapshot);await p.page.keyboard.press('Escape');
 await p.page.waitForFunction(()=>{const input=document.querySelector('#floating-message-input'),n=input?.closest('.renderer-regenerate-menu')||input?.closest('[role="menu"]');return n?.getAnimations().some(a=>Number(a.effect.getTiming().duration)>1&&Number(a.effect.getTiming().duration)<199);});
 const interrupted=await p.page.evaluate(snapshot);assert.ok(Math.abs(interrupted.duration-97.6)<.001);assert.ok(Math.abs(Number(interrupted.frames[0].opacity)-.488)<.0001);assert.equal(interrupted.inert,true);
 await p.page.evaluate(()=>{const input=document.querySelector('#floating-message-input'),n=input.closest('.renderer-regenerate-menu')||input.closest('[role="menu"]');const a=n.getAnimations().find(a=>Number(a.effect.getTiming().duration)>1&&a.effect.getKeyframes().some(f=>f.transform));a.pause();a.currentTime=Number(a.effect.getTiming().duration)/2;});
 await trigger.click();await p.page.waitForFunction(()=>{const input=document.querySelector('#floating-message-input'),n=input?.closest('.renderer-regenerate-menu')||input?.closest('[role="menu"]');return n?.getAnimations().some(a=>Number(a.effect.getTiming().duration)>180&&Number(a.effect.getTiming().duration)<199);});
 const reopened=await p.page.evaluate(snapshot);results.push({port,interrupted,reopened});assert.ok(Math.abs(reopened.duration-187.8)<.001);assert.ok(Math.abs(Number(reopened.frames[0].opacity)-.061)<.0001);assert.equal(reopened.inputSame,true);
 await p.page.waitForTimeout(250);await p.page.keyboard.press('Escape');await p.page.waitForFunction(()=>{const input=document.querySelector('#floating-message-input'),n=input?.closest('.renderer-regenerate-menu')||input?.closest('[role="menu"]');return n?.getAnimations().some(a=>a.effect.getTiming().duration===200);});
 const settled=await p.page.evaluate(snapshot);assert.equal(Number(settled.frames[0].opacity),1);await p.page.waitForTimeout(250);assert.equal(await p.page.locator('#floating-message-input').count(),0);assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
 results.push({port,initial,interrupted,reopened,settled,errors:p.errors,blocked:p.blocked});await p.context.close();
 }}finally{await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();}
