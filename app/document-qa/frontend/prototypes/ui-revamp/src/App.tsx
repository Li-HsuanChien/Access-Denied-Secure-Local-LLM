import { useEffect, useRef, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { ToastProvider } from './ui/toast';
import { Sidebar } from './features/shell/Sidebar';
import { TopBar } from './features/shell/TopBar';
import { ChatView } from './features/chat/ChatView';
import { LibraryView } from './features/library/LibraryView';
import { HistoryView } from './features/history/HistoryView';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { PdfViewer } from './features/pdf/PdfViewer';
import { Dialog } from './ui/overlay';

export function useMediaQuery(query: string): boolean {
	const [match, setMatch] = useState(() => window.matchMedia(query).matches);
	useEffect(() => {
		const mq = window.matchMedia(query);
		const on = () => setMatch(mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	}, [query]);
	return match;
}

function Shell() {
	const store = useStore();
	const { view, pdf, settings } = store;
	const compact = useMediaQuery('(max-width: 860px)');
	const wide = useMediaQuery('(min-width: 1180px)');
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const pdfReturn = useRef<HTMLElement | null>(null);

	useEffect(() => {
		const root = document.documentElement;
		if (settings.theme === 'system') root.removeAttribute('data-theme');
		else root.setAttribute('data-theme', settings.theme);
	}, [settings.theme]);

	useEffect(() => { setDrawerOpen(false); }, [view, store.currentId]);

	// Phone drawer: focus moves in on open; Escape closes it and returns focus to the menu button.
	useEffect(() => {
		if (!compact || !drawerOpen) return;
		window.setTimeout(() => document.querySelector<HTMLElement>('.sidebar .nav-item-strong')?.focus(), 0);
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || document.getElementById('root')?.hasAttribute('inert')) return;
			setDrawerOpen(false);
			window.setTimeout(() => document.querySelector<HTMLElement>('[aria-label="Open menu"]')?.focus(), 0);
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [compact, drawerOpen]);

	useEffect(() => {
		if (pdf) pdfReturn.current = pdf.returnFocus ?? null;
	}, [pdf]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); store.navigate({ name: 'history' }); }
			else if (mod && e.key.toLowerCase() === 'b' && !compact) { e.preventDefault(); setSidebarOpen(o => !o); }
			else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); store.newChat(); }
			else if (mod && e.key === ',') { e.preventDefault(); store.setSettingsOpen(true); }
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [compact, store]);

	const showSidebar = compact ? drawerOpen : sidebarOpen;
	const pdfMode: 'side' | 'overlay' = wide ? 'side' : 'overlay';
	const closePdf = () => {
		store.closePdf();
		const target = pdfReturn.current;
		window.setTimeout(() => target && document.contains(target) && target.focus({ preventScroll: true }), 0);
	};

	return (
		<div className="app" data-compact={compact || undefined} data-sidebar={showSidebar ? 'open' : 'closed'} data-pdf={pdf && pdfMode === 'side' ? 'side' : undefined}>
			<a href="#main" className="skip-link">Skip to conversation</a>
			{compact && drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />}
			<Sidebar
				open={showSidebar}
				compact={compact}
				onClose={() => (compact ? setDrawerOpen(false) : setSidebarOpen(false))}
			/>
			<div className="main-column">
				<TopBar
					sidebarOpen={showSidebar}
					compact={compact}
					onToggleSidebar={() => (compact ? setDrawerOpen(o => !o) : setSidebarOpen(o => !o))}
				/>
				<main id="main" className="main" tabIndex={-1}>
					{view.name === 'chat' && <ChatView />}
					{view.name === 'library' && <LibraryView />}
					{view.name === 'history' && <HistoryView compact={compact} />}
				</main>
			</div>
			{pdf && pdfMode === 'side' && (
				<aside className="pdf-side" aria-label="Document viewer">
					<PdfViewer key={pdf.key + pdf.page} target={pdf} onClose={closePdf} mode="side" />
				</aside>
			)}
			{pdf && pdfMode === 'overlay' && (
				<Dialog open onClose={closePdf} title={`${pdf.title}, document viewer`} variant="full">
					<PdfViewer key={pdf.key + pdf.page} target={pdf} onClose={closePdf} mode="overlay" />
				</Dialog>
			)}
			<SettingsDialog />
		</div>
	);
}

export function App() {
	return (
		<ToastProvider>
			<StoreProvider>
				<Shell />
			</StoreProvider>
		</ToastProvider>
	);
}
