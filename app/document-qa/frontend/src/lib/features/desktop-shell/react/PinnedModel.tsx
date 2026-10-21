import { createContext, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import tippy from 'tippy.js';
import { useI18n } from '@/react/i18n';
import { nativeSlideOptions, useNativeTransition } from './nativeMotion';

const PinnedModelContext = createContext<{ pinned: boolean; setPinned(value: boolean): void } | null>(null);
/** Presentation only: survives routed screens/New Chat and is lost with the app mount. */
export function PinnedModelProvider({ children }: { children: ReactNode }) {
 const [pinned, setPinned] = useState(false);
 return <PinnedModelContext.Provider value={{ pinned, setPinned }}>{children}</PinnedModelContext.Provider>;
}
export function usePinnedModel() {
 const state = useContext(PinnedModelContext);
 if (!state) throw new Error('AppProviders is required.');
 return state;
}

function UnpinTooltip({ children }: { children: ReactNode }) {
 const { t } = useI18n();
 const ref = useRef<HTMLDivElement>(null);
 const content = t('Unpin');
 useEffect(() => {
  if (!ref.current) return;
  const instance = tippy(ref.current, { content, placement: 'top', theme: 'dark', allowHTML: true, arrow: false, offset: [0, 4] });
  return () => instance.destroy();
 }, [content]);
 return <div ref={ref} className="flex items-center">{children}</div>;
}
/** Native slide retains the original section's interruption and exit semantics. */
function SectionContent({ open, children }: { open: boolean; children: ReactNode }) {
 const { present, ref } = useNativeTransition(open, nativeSlideOptions);
 return present ? <div ref={ref} inert={!open}>{children}</div> : null;
}

export function PinnedModelSection({ onSelect }: { onSelect(event: MouseEvent<HTMLAnchorElement>): void }) {
 const { pinned, setPinned } = usePinnedModel();
 const { t } = useI18n();
 const [open, setOpen] = useState(() => localStorage.getItem('sidebar-models-folder-state') !== 'false');
 const [hover, setHover] = useState(false);
 const [shift, setShift] = useState(false);
 useEffect(() => {
  const down = (event: KeyboardEvent) => { if (event.key === 'Shift') setShift(true); };
  const up = (event: KeyboardEvent) => { if (event.key === 'Shift') setShift(false); };
  window.addEventListener('keydown', down); window.addEventListener('keyup', up);
  return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
 }, []);
 if (!pinned) return null;
 const toggle = () => { setOpen(value => { const next = !value; localStorage.setItem('sidebar-models-folder-state', String(next)); return next; }); };
 return <div className="relative">
  <div className="w-full">
   <div className="w-full cursor-pointer" onClick={event => { event.stopPropagation(); toggle(); }}>
    <div><div className="flex items-start justify-between">
     <div className="flex items-center justify-between h-6 w-full pl-3.5 pr-1.5 shrink-0">
      <button type="button" className="group flex flex-1 h-full items-center gap-1 text-left text-xs text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400 transition-colors duration-100" aria-expanded={open} aria-controls="sidebar-models-content">
       <span>{t('Models')}</span><span className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-100" style={{ transform: `rotate(${open ? '90deg' : '0deg'})` }}><svg className="size-[0.6875rem]" aria-hidden="true" viewBox="0 0 24 24" strokeWidth="1.5" fill="none"><path d="M9 6L15 12L9 18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      </button><div className="contents" onClick={event => event.stopPropagation()} />
     </div>
    </div></div>
   </div>
   <SectionContent open={open}>
    <div id="sidebar-models-content" className="w-full px-1.5">
     <div className="mt-0.5 pb-1.5" id="pinned-models-list">
      <div className="flex justify-center text-gray-800 dark:text-gray-200 cursor-grab relative group" data-id="secure-qa-local" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
       <a className="grow flex items-center space-x-2 rounded-xl px-2 py-[0.4375rem] group-hover:bg-gray-100 dark:group-hover:bg-gray-900 transition" href="/?model=secure-qa-local" onClick={onSelect} draggable={false}>
        <div className="self-center shrink-0">{/* LICENSE covers this Open WebUI fallback logo. https://docs.openwebui.com/license */}<img src="/favicon.png" className="size-4 rounded-full" alt="logo" /></div>
        <div className="flex self-center translate-y-[0.5px]"><div className="self-center text-[0.8125rem] leading-5 line-clamp-1">Document Assistant</div></div>
       </a>
       {hover && shift && <div className="absolute right-5 top-2.5"><div className="flex items-center self-center space-x-1.5"><UnpinTooltip><button className="self-center dark:hover:text-white transition" type="button" onClick={() => setPinned(false)}><svg className="size-3.5" aria-hidden="true" viewBox="0 0 24 24" strokeWidth="1.5" fill="none"><path d="M9.5 14.5L3 21" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /><path d="M7.67602 7.8896L6.69713 7.78823L5.00007 9.48528L14.1925 18.6777L15.8895 16.9806L15.7879 16M11.4847 7L15.1568 2.67141L21.0065 8.5211L16.6991 12.175" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 3L21 21" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg></button></UnpinTooltip></div></div>}
      </div>
     </div>
    </div>
   </SectionContent>
  </div>
 </div>;
}
