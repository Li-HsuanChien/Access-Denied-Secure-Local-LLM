import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppProviders, createAppRuntime, createDefaultServices } from '../../../../react/providers';
import { AppShell } from './AppShell';
import { usePinnedModel } from './PinnedModel';

beforeEach(() => {
 localStorage.clear();window.history.replaceState(null,'','/qa');
 Object.defineProperty(window,'innerWidth',{configurable:true,writable:true,value:1440});
 window.matchMedia=vi.fn().mockReturnValue({matches:false,addEventListener(){},removeEventListener(){}});
});
afterEach(cleanup);
function PinControl(){const {pinned,setPinned}=usePinnedModel();return <button onClick={()=>setPinned(!pinned)}>{pinned?'Hide model':'Keep model'}</button>;}
function setup(){
 const services=createDefaultServices();
 services.settings.read=vi.fn(async()=>({general_knowledge:true}));services.settings.update=vi.fn(async v=>v);services.history.enabled=vi.fn(async()=>true);
 services.answering.health=vi.fn(async()=>({ready:true,library:{document_count:1,chunk_count:3},answering:{}} as any));
 const runtime=createAppRuntime(services,window);
 const view=render(<AppProviders runtime={runtime}><AppShell><PinControl/></AppShell></AppProviders>);
 return {runtime,view};
}
it('shares temporary pin state across feature navigation and New Chat without settings writes',async()=>{
 const {runtime}=setup();await screen.findByText('1 document · 3 passages · local model ready');
 const storage={...localStorage};
 fireEvent.click(screen.getByText('Keep model'));
 expect(screen.getByRole('button',{name:'Models'})).toBeTruthy();
 expect(screen.getByRole('link',{name:'logo Document Assistant'})).toBeTruthy();
 expect({...localStorage}).toEqual(storage);
 fireEvent.click(screen.getByRole('link',{name:'Library'}));
 expect(runtime.navigation.getSnapshot().path).toBe('/library');
 expect(screen.getByRole('link',{name:'logo Document Assistant'})).toBeTruthy();
 fireEvent.click(screen.getByRole('link',{name:'New Chat'}));
 expect(runtime.navigation.getSnapshot().path).toBe('/');
 expect(screen.getByText('Hide model')).toBeTruthy();
 expect(runtime.services.settings.update).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('Hide model'));
 expect(screen.queryByRole('button',{name:'Models'})).toBeNull();
});
it('resets the pin when the application provider is mounted afresh',()=>{
 const {view}=setup();fireEvent.click(screen.getByText('Keep model'));view.unmount();setup();
 expect(screen.queryByRole('button',{name:'Models'})).toBeNull();
 expect(screen.getByText('Keep model')).toBeTruthy();
});
it('retains the original section collapse preference separately from temporary pin state',async()=>{
 setup();fireEvent.click(screen.getByText('Keep model'));
 const section=screen.getByRole('button',{name:'Models'});
 fireEvent.click(section);
 expect(section.getAttribute('aria-expanded')).toBe('false');
 await waitFor(()=>expect(screen.queryByRole('link',{name:'logo Document Assistant'})).toBeNull());
 expect(localStorage.getItem('sidebar-models-folder-state')).toBe('false');
 fireEvent.click(screen.getByText('Hide model'));fireEvent.click(screen.getByText('Keep model'));
 expect(screen.getByRole('button',{name:'Models'}).getAttribute('aria-expanded')).toBe('false');
 fireEvent.click(screen.getByRole('button',{name:'Models'}));
 expect(screen.getByRole('link',{name:'logo Document Assistant'})).toBeTruthy();
 expect(localStorage.getItem('sidebar-models-folder-state')).toBe('true');
});
it('reveals Unpin only with Shift and row hover and removes the shared pin',async()=>{
 setup();fireEvent.click(screen.getByText('Keep model'));
 const row=document.querySelector('#pinned-models-list [data-id="secure-qa-local"]')!;
 fireEvent.mouseEnter(row);expect(row.querySelector('button')).toBeNull();
 fireEvent.keyDown(window,{key:'Shift'});
 const unpin=row.querySelector('button')!;expect(unpin).toBeTruthy();
 fireEvent.mouseEnter(unpin.parentElement!);
 await waitFor(()=>expect(screen.getByRole('tooltip').textContent).toBe('Unpin'));
 fireEvent.click(unpin);
 expect(screen.queryByRole('button',{name:'Models'})).toBeNull();
 expect(screen.getByText('Keep model')).toBeTruthy();
 fireEvent.keyUp(window,{key:'Shift'});
});

it('selects the sole pinned model as a new Chat with its original fixed query and closes mobile navigation',()=>{
 window.innerWidth=390;const {runtime}=setup();
 fireEvent.click(screen.getByText('Keep model'));
 fireEvent.click(screen.getByRole('button',{name:'Open sidebar'}));
 const link=screen.getByRole('link',{name:'logo Document Assistant'});
 expect(link.getAttribute('href')).toBe('/?model=secure-qa-local');
 fireEvent.click(link);
 expect(runtime.navigation.getSnapshot()).toEqual({path:'/',chatEpoch:1});
 expect(window.location.pathname+window.location.search).toBe('/?model=secure-qa-local');
 expect(localStorage.sidebar).toBe('false');
 expect(screen.getByText('Hide model')).toBeTruthy();
});
