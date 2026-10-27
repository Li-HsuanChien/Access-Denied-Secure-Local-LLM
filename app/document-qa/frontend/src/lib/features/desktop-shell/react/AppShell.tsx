import { useCallback, useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { useNavigation, usePreferences, useServices } from '../../../../react/providers';
import type { AppPath } from '../../react-contracts';
import type { HealthStatus } from '../../answering/types';
import tippy from 'tippy.js';
import './shell.css';
import { useMobileSwipe } from './useMobileSwipe';
import { ConversationList } from '../../history/react/ConversationList';
import { PinnedModelSection } from './PinnedModel';
import { useI18n } from '@/react/i18n';

const navigation = [{ label: 'Library', href: '/library', icon: 'library' }, { label: 'History', href: '/history', icon: 'history' }, { label: 'Settings', href: '/settings', icon: 'settings' }] as const;
function Icon({ name, className = 'size-4' }: { name: string; className?: string }) {
 const paths: Record<string, string> = {
  library: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM9 4h4.5v16H9M15.2 6.3l3.4-.9 3 11.6-3.4.9-3-11.6Z',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v3.9h3.9M12 7.5V12l3 2', settings: 'M4 7h9M17 7h3M4 17h3M11 17h9',
  sidebar: 'M19 21L5 21C3.89543 21 3 20.1046 3 19L3 5C3 3.89543 3.89543 3 5 3L19 3C20.1046 3 21 3.89543 21 5L21 19C21 20.1046 20.1046 21 19 21ZM9.5 21V3M5.5 10L7.25 12L5.5 14',
  edit: 'M14.3632 5.65156L15.8431 4.17157C16.6242 3.39052 17.8905 3.39052 18.6716 4.17157L20.0858 5.58579C20.8668 6.36683 20.8668 7.63316 20.0858 8.41421L18.6058 9.8942M14.3632 5.65156L4.74749 15.2672C4.41542 15.5993 4.21079 16.0376 4.16947 16.5054L3.92738 19.2459C3.87261 19.8659 4.39148 20.3848 5.0115 20.33L7.75191 20.0879C8.21972 20.0466 8.65806 19.8419 8.99013 19.5099L18.6058 9.8942M14.3632 5.65156L18.6058 9.8942'
 };
 return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'sidebar' ? <><path d="M19 21L5 21C3.89543 21 3 20.1046 3 19L3 5C3 3.89543 3.89543 3 5 3L19 3C20.1046 3 21 3.89543 21 5L21 19C21 20.1046 20.1046 21 19 21Z" /><path d="M9.5 21V3" /><path d="M5.5 10L7.25 12L5.5 14" /></> : <path d={paths[name]} />}{name === 'settings' && <><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>}</svg>;
}
function Tooltip({ content, placement = 'right', children }: { content: string; placement?: 'right' | 'bottom'; children: ReactNode }) {
 const ref = useRef<HTMLDivElement>(null);
 useEffect(() => { if (!ref.current) return; const instance = tippy(ref.current, { content, placement, theme: 'dark', arrow: false, offset: [0,4], allowHTML: true }); return () => instance.destroy(); }, [content, placement]);
 return <div ref={ref} className="flex">{children}</div>;
}
const storedWidth = () => { const value = Number(localStorage.getItem('sidebarWidth')); return value >= 220 && value <= 480 ? value : 245; };
export function AppShell({ children }: { children: ReactNode }) {
 const { t } = useI18n();
 const { route, navigate } = useNavigation();
 const { state: preferences, setGeneralKnowledge } = usePreferences();
 const services = useServices();
 const [mobile, setMobile] = useState(() => window.innerWidth < 768);
 const [open, setOpen] = useState(() => window.innerWidth >= 768 && localStorage.sidebar !== 'false');
 const [width, setWidth] = useState(storedWidth);
 const [healthMessage, setHealthMessage] = useState('Checking the local service…');
 const [healthError, setHealthError] = useState(false);
 const [preferenceError, setPreferenceError] = useState('');
 const drag = useRef<{ id: number; x: number; width: number } | null>(null);
 const swipe = useMobileSwipe(mobile, open, width, setOpen);
 const refreshHealth = useCallback(async () => {
  setHealthError(false);
  try {
   const health: HealthStatus = await services.answering.health();
   const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
   setHealthMessage(health.ready ? `${count(health.library.document_count, 'document')} · ${count(health.library.chunk_count, 'passage')} · local model ready` : health.answering.error?.message ?? 'The local model or library is not ready.');
   if (!health.ready && health.answering.ready) setHealthMessage('Local model ready — publish documents to your Library to start asking questions.');
   setHealthError(!health.answering.ready);
  } catch (error) { setHealthError(true); setHealthMessage(error instanceof Error ? error.message : 'The local service is unavailable.'); }
 }, [services]);
 useEffect(() => { void refreshHealth(); }, [refreshHealth]);
 useEffect(() => { localStorage.sidebar = String(open); }, [open]);
 useEffect(() => { document.documentElement.style.setProperty('--sidebar-width', `${width}px`); }, [width]);
 useEffect(() => {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const syncTheme = () => { const theme = localStorage.theme ?? 'system'; document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && dark.matches)); };
  const resize = () => { const next = window.innerWidth < 768; setMobile(next); if (next) setOpen(false); };
  syncTheme(); window.addEventListener('resize', resize); dark.addEventListener('change', syncTheme);
  return () => { window.removeEventListener('resize', resize); dark.removeEventListener('change', syncTheme); };
 }, []);
 useEffect(() => {
  const move = (event: PointerEvent) => { if (drag.current && drag.current.id === event.pointerId) setWidth(Math.min(480, Math.max(220, drag.current.width + event.clientX - drag.current.x))); };
  const end = (event: PointerEvent) => { if (!drag.current || drag.current.id !== event.pointerId) return; drag.current = null; document.body.style.userSelect = ''; localStorage.setItem('sidebarWidth', document.documentElement.style.getPropertyValue('--sidebar-width').replace('px', '')); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); document.body.style.userSelect = ''; };
 }, []);
 const go = (path: AppPath, newChat = false, localModel = false) => (event: MouseEvent) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(path, { ...(newChat ? { newChat: true } : {}), ...(localModel ? { localModel: true } : {}) }); if (mobile) setOpen(false); };
 const logo = <img src="/static/favicon.png" className="sidebar-new-chat-icon size-5 rounded-full" alt="" crossOrigin="anonymous" />;
 const collapsed = !mobile && !open;
 return <div className={`desktop-shell react-desktop-shell${open && !mobile ? ' sidebar-open' : ''}`}>
  {mobile && swipe.visible && <div className="shell-backdrop" style={{ opacity: swipe.progress * 0.6, pointerEvents: swipe.progress > 0.02 ? undefined : 'none', transition: `opacity ${swipe.transition}` }} onMouseDown={() => setOpen(false)} />}
  {collapsed && <div id="sidebar" role="navigation" aria-label={t('Chat history')} className="shell-rail w-[calc(42px*var(--app-text-scale,1))] shrink-0 py-[calc(0.25rem*var(--app-text-scale,1))] px-[calc(0.25rem*var(--app-text-scale,1))] flex flex-col justify-between text-gray-700 dark:text-gray-300 hover:bg-gray-50/30 dark:hover:bg-gray-800/30 h-full z-10 transition-all border-e-[0.5px] border-gray-50 dark:border-gray-850/30">
   <div className="flex flex-col flex-1 cursor-[e-resize]" onClick={() => setOpen(true)}>
    <div className="pb-1"><Tooltip content={t('Open Sidebar')}><button className="flex size-8.5 items-center justify-center transition group cursor-[e-resize]" aria-label={t('Open Sidebar')}><div className="self-center flex size-[calc(30px*var(--app-text-scale,1))] items-center justify-center rounded-lg transition group-hover:bg-gray-100 dark:group-hover:bg-gray-900"><span className="group-hover:hidden">{logo}</span><Icon name="sidebar" className="size-4 hidden group-hover:flex" /></div></button></Tooltip></div>
    {[{label:t('New Chat'),href:'/',icon:'edit'},...navigation].map(item => <div key={item.label}><Tooltip content={item.label}><a className="flex size-8 items-center justify-center transition group" href={item.href} aria-label={item.label} aria-current={route.path === item.href && item.href !== '/' ? 'page' : undefined} draggable={false} onClick={event => { event.stopPropagation(); go(item.href as AppPath, item.href === '/')(event); }}><div className={`self-center flex size-[calc(30px*var(--app-text-scale,1))] items-center justify-center rounded-lg transition ${route.path === item.href && item.href !== '/' ? 'bg-black/[0.06] dark:bg-white/[0.08]' : 'group-hover:bg-gray-100 dark:group-hover:bg-gray-900'}`}><Icon name={item.icon} /></div></a></Tooltip></div>)}
   </div>
  </div>}
  {(swipe.visible || !mobile) && <div id={swipe.visible ? 'sidebar' : undefined} role="navigation" aria-label={t('Chat history')} aria-hidden={!open} inert={!open} data-state={open} className="shell-expanded h-screen max-h-[100dvh] min-h-screen select-none bg-gray-50 dark:bg-gray-950 z-50 shrink-0 text-gray-700 dark:text-gray-300 text-[0.8125rem] leading-5 fixed top-0 left-0 overflow-x-hidden" style={{ width: mobile ? width : open ? width : 0, pointerEvents: open ? undefined : 'none', ...(mobile ? { transform: `translateX(${(swipe.progress - 1) * 100}%)`, transition: `transform ${swipe.transition}` } : {}) }}>
   <div className="my-auto flex flex-col justify-between h-screen max-h-[100dvh] w-[var(--sidebar-width)] overflow-x-hidden scrollbar-hidden z-50 border-e border-gray-50 dark:border-gray-850/30">
    <div className="sidebar px-1 pt-1.5 pb-1 flex justify-between space-x-1 text-gray-600 dark:text-gray-400 sticky top-0 z-10 -mb-2">
     {/* LICENSE covers this reused Open WebUI sidebar logo/name. https://docs.openwebui.com/license */}
     <a className="flex items-center rounded-xl size-8.5 h-full justify-center hover:bg-gray-100 dark:hover:bg-gray-900 transition no-drag-region" href="/" draggable={false} onClick={go('/',true)}>{logo}</a>
     <a href="/" className="flex flex-1 px-0.5" onClick={go('/',true)}><div id="sidebar-webui-name" className="self-center font-normal text-gray-700 dark:text-gray-200">Access Denied</div></a>
     <Tooltip content={t('Close Sidebar')} placement="bottom"><button className="flex size-[1.875rem] justify-center items-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition cursor-[w-resize]" aria-label={t('Close Sidebar')} onClick={() => setOpen(false)}><div className="self-center"><Icon name="sidebar" /></div></button></Tooltip>
     <div className="invisible sidebar-bg-gradient-to-b bg-linear-to-b from-gray-50 dark:from-gray-950 to-transparent from-50% pointer-events-none absolute inset-0 -z-10 -mb-6" />
    </div>
    <div className="relative flex flex-col flex-1 overflow-y-auto scrollbar-hidden space-y-1.5 pt-2.5 pb-2.5">
     <div className="pb-1">
      <div className="px-1 flex justify-center text-gray-700 dark:text-gray-300"><a id="sidebar-new-chat-button" className="group grow flex items-center space-x-2 rounded-xl px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-900 transition outline-none" href="/" draggable={false} aria-label={t('New Chat')} onClick={go('/',true)}><div className="self-center flex size-4 shrink-0 items-center justify-center"><Icon name="edit" /></div><div className="flex flex-1 self-center translate-y-[0.5px]"><div className="self-center text-[0.8125rem] leading-5">{t('New Chat')}</div></div><div className="hidden md:flex items-center self-center text-xs text-gray-400 dark:text-gray-600 hover-reveal"><span>{/Mac/i.test(navigator.userAgent) ? '⌘⇧O' : 'Ctrl+Shift+O'}</span></div></a></div>
      {navigation.map(item => <div key={item.label} className="px-1 flex justify-center text-gray-700 dark:text-gray-300"><a href={item.href} onClick={go(item.href)} aria-current={route.path === item.href ? 'page' : undefined} draggable={false} className={`grow flex items-center space-x-2 rounded-xl px-2 py-1.5 transition ${route.path === item.href ? 'bg-black/[0.06] dark:bg-white/[0.08]' : 'hover:bg-gray-100 dark:hover:bg-gray-900'}`}><div className="self-center flex size-4 shrink-0 items-center justify-center"><Icon name={item.icon} /></div><div className="flex self-center translate-y-[0.5px]"><div className="self-center text-[0.8125rem] leading-5">{item.label}</div></div></a></div>)}
      <div id="pinned-menu-items-list" />
     </div>
     <PinnedModelSection onSelect={go('/', true, true)} />
     <ConversationList onSelect={() => { if (mobile) setOpen(false); }} />
    </div><div />
   </div>
  </div>}
  {!mobile && open && <div id="sidebar-resizer" role="separator" className="relative flex items-center justify-center group border-r border-gray-50 dark:border-gray-850/30 hover:border-gray-200 dark:hover:border-gray-800 transition z-20 bg-transparent p-0 appearance-none" onPointerDown={event => { event.preventDefault(); drag.current = {id:event.pointerId,x:event.clientX,width}; event.currentTarget.setPointerCapture?.(event.pointerId); document.body.style.userSelect='none'; }}><div className="absolute -left-1.5 -right-1.5 top-0 bottom-0 z-20 cursor-col-resize bg-transparent" style={{touchAction:'none'}} /></div>}
  <div className="workspace">
   <div className={`service-status${healthError ? ' degraded' : ''}`} role="status" aria-live="polite">
    {mobile && <button type="button" className="menu-button" aria-label="Open sidebar" onClick={() => setOpen(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button>}
    <span className="status-mark" aria-hidden="true" /><div className="status-text"><strong>{healthError ? 'Workspace needs attention' : 'Local workspace'}</strong><span title={healthMessage}>{healthMessage}</span></div>
    <label className="workspace-switch"><input type="checkbox" role="switch" checked={preferences.generalKnowledge} onChange={async event => { const checked = event.currentTarget.checked; setPreferenceError(''); try { await setGeneralKnowledge(checked); } catch { setPreferenceError('Could not save this preference. Please retry.'); } }} /><span>Include general model knowledge</span></label>
    <a className="status-action" href={route.temporary ? '/' : '/?local-temporary=true'} onClick={event => {
     if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
     event.preventDefault();
     navigate('/', { newChat: true, temporary: !route.temporary });
     if (mobile) setOpen(false);
    }}>{route.temporary ? 'Start saved chat' : 'Start temporary chat'}</a>
    <button type="button" className="status-action" onClick={() => void refreshHealth()}>Refresh</button>
   </div>
   {preferenceError && <p className="preference-error" role="alert">{preferenceError}</p>}
   <main id="main-content">{children}</main>
  </div>
 </div>;
}
