import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/node_modules/playwright/index.mjs';
import {createFixtureState,health,respond} from '/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM/app/document-qa/frontend/migration-parity/fixtures/responses.mjs';
const out='/private/tmp/react-stage5b-build7-menus';await fs.mkdir(out,{recursive:true});
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

const focusState=()=>({active:document.activeElement?.outerHTML?.slice(0,350),id:document.activeElement?.id,role:document.activeElement?.getAttribute('role'),selected:[...document.querySelectorAll('[role=option]')].map(e=>({text:e.textContent,selected:e.getAttribute('aria-selected'),arrow:e.getAttribute('data-arrow-selected')}))});
try{for(const port of [5173,4177])for(const config of [{name:'desktop-light'},{name:'desktop-dark',dark:true},{name:'narrow-light',width:390,height:844,sidebar:false},{name:'narrow-dark',width:390,height:844,sidebar:false,dark:true}]){
 const p=await open(port,config);await p.page.locator('button').filter({hasText:'Summarize the key points'}).click();await p.page.getByText('From your documents',{exact:true}).waitFor();await p.page.waitForTimeout(300);const row={port,variant:config.name};results.push(row);
 for(const [name,selector] of [['chat-actions','#chat-context-menu-button'],['regenerate','button[aria-label="Regenerate"]'],['model','#model-selector-model-button']]){
  await p.page.locator(selector).click();await p.page.waitForTimeout(300);await p.page.mouse.move((config.width??1440)-5,(config.height??1000)-5);await p.page.waitForTimeout(200);
  const menu=name==='model'?p.page.getByRole('textbox',{name:'Search In Models',exact:true}):p.page.locator(port===5173?'.app-dropdown-menu':name==='chat-actions'?'.chat-actions-menu':'.app-dropdown-menu').last();
  row[name]=await menu.evaluate((element,isModel)=>{let e=element;if(isModel)while(e.parentElement&&!e.classList.contains('chat-model-menu')&&!e.classList.contains('z-40'))e=e.parentElement;const cs=getComputedStyle(e),style={};for(const k of ['padding','border-radius','background-color','border-top-color','color','font-size','max-width','max-height','overflow','position','z-index'])style[k]=cs.getPropertyValue(k);return{html:e.outerHTML,rect:e.getBoundingClientRect().toJSON(),style,viewport:{width:innerWidth,height:innerHeight},controls:[...e.querySelectorAll('button,input')].map(n=>({html:n.outerHTML,rect:n.getBoundingClientRect().toJSON(),color:getComputedStyle(n).color,font:getComputedStyle(n).font,padding:getComputedStyle(n).padding}))};},name==='model');
  row[name].focus={open:await p.page.evaluate(focusState)};await shot(p.page,`${port}-${config.name}-${name}`);
  for(const key of ['ArrowDown','ArrowUp','Home','End']){await p.page.keyboard.press(key);row[name].focus[key]=await p.page.evaluate(focusState);}
  await p.page.keyboard.press('Escape');await p.page.waitForTimeout(250);row[name].focus.Escape=await p.page.evaluate(focusState);
  {await p.page.locator(selector).click();await p.page.waitForTimeout(250);await p.page.mouse.click((config.width??1440)-5,(config.height??1000)-5);await p.page.waitForTimeout(250);row[name].focus.outside=await p.page.evaluate(focusState);}
  await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));
 }
 row.errors=p.errors;row.blocked=p.blocked;await p.context.close();
}}finally{await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();}
