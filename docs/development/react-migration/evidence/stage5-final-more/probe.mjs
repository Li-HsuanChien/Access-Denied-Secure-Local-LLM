import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/node_modules/playwright/index.mjs';
import {createFixtureState,health,respond} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/migration-parity/fixtures/responses.mjs';
const out='/private/tmp/react-stage5b-build7-more';await fs.mkdir(out,{recursive:true});
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
try {
 for(const port of [5173,4177])for(const name of []) {
  const p=await open(port),{page}=p,input=page.locator('#chat-input');
  if(name==='leading')await input.press('Shift+Enter');
  await input.pressSequentially('first');
  const count=name==='blank'?2:name==='consecutive'?3:1;
  for(let i=0;i<count;i++)await input.press('Shift+Enter');
  await input.pressSequentially('third');
  if(name==='trailing'){await input.press('Shift+Enter');await input.press('Shift+Enter');}
  const before=await input.evaluate(e=>({html:e.innerHTML,text:e.innerText}));await input.press('Enter');await page.getByText('From your documents',{exact:true}).waitFor();
  const questions=p.requests.filter(r=>r.operation==='answering.ask').map(r=>r.payload.question);
  const expected={single:'first\nthird',blank:'first\n  \nthird',leading:'  \nfirst\nthird',trailing:'first\nthird',consecutive:'first\n  \n  \nthird'}[name];
  assert.deepEqual(questions,[expected]);
  results.push({case:'wire-'+name,port,before,questions,errors:p.errors,blocked:p.blocked});await p.context.close();
 }
 for(const port of [5173,4177])for(const config of [{name:'desktop-light'},{name:'narrow-dark',width:390,height:844,dark:true,sidebar:false}]) {
  const p=await open(port,config),{page}=p,unsupported=[];
  page.on('request',r=>{if(r.method()==='POST'&&!r.url().includes(':8765'))unsupported.push({url:r.url(),body:r.postData()});});
  await page.locator('#model-selector-model-button').click();await page.getByRole('option',{name:'Select Document Assistant model',exact:true}).hover();await page.locator('button[aria-label="More Options"]').click();await page.waitForTimeout(300);
  const menu=page.getByRole('menu'),initialMenu=await menu.innerText(),menuRect=await menu.boundingBox();await page.mouse.move((config.width??1440)-5,(config.height??1000)-5);await shot(page,`more-${port}-${config.name}`);
  await page.getByRole('button',{name:'Copy Link',exact:true}).click();await page.waitForTimeout(250);const copied=await page.evaluate(()=>navigator.clipboard.readText());const copyToasts=await page.locator('[data-sonner-toast],[role=alert]').allTextContents();assert.equal(copied,`http://127.0.0.1:${port}/?model=secure-qa-local`);
  await page.getByRole('option',{name:'Select Document Assistant model',exact:true}).hover();await page.locator('button[aria-label="More Options"]').click();await page.getByRole('button',{name:'Keep in Sidebar',exact:true}).click();await page.waitForTimeout(300);
  await page.getByRole('option',{name:'Select Document Assistant model',exact:true}).hover();await page.locator('button[aria-label="More Options"]').click();const afterMenu=await page.getByRole('menu').innerText();assert.match(afterMenu,/Hide from Sidebar/);await page.getByRole('button',{name:'Hide from Sidebar',exact:true}).click();await page.waitForTimeout(250);
  const pinStorage=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>['settings','pinnedModels'].includes(k))));assert.deepEqual(pinStorage,{});if(port===4177)assert.deepEqual(unsupported,[]);
  results.push({case:'more-options',port,variant:config.name,initialMenu,menuRect,copied,copyToasts,afterMenu,pinStorage,unsupported,errors:p.errors,blocked:p.blocked});await p.context.close();
 }
}finally{await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();}
console.log(JSON.stringify(results,null,2));
