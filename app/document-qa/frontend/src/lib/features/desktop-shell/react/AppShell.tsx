import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDocumentViewer, useHealth, useLibrary, useNavigation } from '../../../../react/providers';
import { Dialog, isModalOpen, useViewportAtLeast } from '../../design-system/react';
import { DocumentViewerPanel } from '../../document-viewer/react/DocumentViewerPanel';
import { Sidebar, conversationPath } from './Sidebar';
import { TopBar } from './TopBar';
import { useSavedThreads } from './useSavedThreads';
import { useThemeSync } from './theme';
import './shell.css';

/** Below this width the sidebar is a drawer. */
export const COMPACT_MAX_WIDTH = 860;
/** At or above this width the document viewer is a side panel; below it, a full-screen dialog. */
export const VIEWER_SIDE_MIN_WIDTH = 1180;
/** Search inputs that Cmd/Ctrl+K should focus carry this attribute (History owns the input). */
export const SHELL_SEARCH_ATTRIBUTE = 'data-shell-search';

function storedSidebarOpen() {
	try { return localStorage.getItem('sidebar') !== 'false'; } catch { return true; }
}
function storeSidebarOpen(open: boolean) {
	try { localStorage.setItem('sidebar', String(open)); } catch { /* in-memory only */ }
}

export function AppShell({ children }: { children: ReactNode }) {
	const { route, navigate } = useNavigation();
	const health = useHealth();
	const { state: library } = useLibrary();
	const viewer = useDocumentViewer();
	const threads = useSavedThreads();
	const compact = !useViewportAtLeast(COMPACT_MAX_WIDTH);
	const wide = useViewportAtLeast(VIEWER_SIDE_MIN_WIDTH);
	const [sidebarOpen, setSidebarOpen] = useState(storedSidebarOpen);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const menuReturn = useRef<HTMLElement | null>(null);
	useThemeSync();

	// Readiness: read on mount, and again when a publication finishes (document count changes).
	const { refresh: refreshHealth } = health;
	const publishing = !!library.publication;
	useEffect(() => { void refreshHealth(); }, [refreshHealth]);
	const wasPublishing = useRef(publishing);
	useEffect(() => {
		if (wasPublishing.current && !publishing) void refreshHealth();
		wasPublishing.current = publishing;
	}, [publishing, refreshHealth]);

	const toggleDesktop = useCallback(() => setSidebarOpen(open => { storeSidebarOpen(!open); return !open; }), []);
	const closeDrawer = useCallback((refocus: boolean) => {
		setDrawerOpen(false);
		if (refocus) {
			const target = menuReturn.current;
			window.setTimeout(() => (target && document.contains(target) ? target : document.querySelector<HTMLElement>('[data-shell-menu-button]'))?.focus({ preventScroll: true }), 0);
		}
	}, []);
	const openDrawer = useCallback(() => {
		menuReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		setDrawerOpen(true);
	}, []);

	// Leaving the drawer layout closes it.
	useEffect(() => { if (!compact) setDrawerOpen(false); }, [compact]);

	// Phone drawer: focus moves in on open; Escape closes it and returns focus to the menu button.
	useEffect(() => {
		if (!compact || !drawerOpen) return;
		const timer = window.setTimeout(() => document.querySelector<HTMLElement>('.shell-sidebar .shell-nav-item-strong')?.focus(), 0);
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.defaultPrevented || isModalOpen()) return;
			e.preventDefault();
			closeDrawer(true);
		};
		document.addEventListener('keydown', onKey);
		return () => { window.clearTimeout(timer); document.removeEventListener('keydown', onKey); };
	}, [compact, drawerOpen, closeDrawer]);

	// Shortcuts: Cmd/Ctrl+K opens chat search; Cmd/Ctrl+B toggles the sidebar (desktop layout).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || isModalOpen()) return;
			const key = e.key.toLowerCase();
			if (key === 'k') {
				e.preventDefault();
				if (route.path !== '/history') navigate('/history');
				setDrawerOpen(false);
				window.setTimeout(() => document.querySelector<HTMLElement>(`[${SHELL_SEARCH_ATTRIBUTE}]`)?.focus(), 0);
			} else if (key === 'b' && !compact) {
				e.preventDefault();
				toggleDesktop();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [compact, navigate, route.path, toggleDesktop]);

	const showSidebar = compact ? drawerOpen : sidebarOpen;
	const current = viewer.current;
	const viewerMode = current ? (wide ? 'side' : 'overlay') : undefined;
	const title = threads.rows.find(row => conversationPath(row.conversation_id) === route.path)?.title;
	// Navigating from the phone drawer closes it; focus left on the now-inert nav moves to the page instead.
	const afterNavigate = useCallback(() => {
		if (!compact) return;
		closeDrawer(false);
		window.setTimeout(() => {
			const active = document.activeElement;
			if (!active || active === document.body || active.closest('.shell-sidebar')) {
				document.getElementById('main-content')?.focus({ preventScroll: true });
			}
		}, 0);
	}, [compact, closeDrawer]);
	const drawerModal = compact && drawerOpen;

	return (
		<div
			className="desktop-shell react-desktop-shell shell"
			data-compact={compact || undefined}
			data-sidebar={showSidebar ? 'open' : 'closed'}
			data-viewer={viewerMode === 'side' ? 'side' : undefined}
		>
			<a href="#main-content" className="ui-skip-link" inert={drawerModal || undefined}>Skip to content</a>
			{compact && drawerOpen && <div className="shell-drawer-scrim" aria-hidden="true" onClick={() => closeDrawer(true)} />}
			<Sidebar
				open={showSidebar}
				compact={compact}
				threads={threads}
				onClose={() => (compact ? closeDrawer(true) : toggleDesktop())}
				onNavigate={afterNavigate}
			/>
			{/* The open phone drawer is modal: content under the scrim is inert so Tab stays in the drawer. */}
			<div className="shell-main-column" inert={drawerModal || undefined}>
				<TopBar
					sidebarOpen={showSidebar}
					compact={compact}
					title={title}
					onToggleSidebar={() => (compact ? openDrawer() : toggleDesktop())}
					onNavigate={afterNavigate}
				/>
				<main id="main-content" className="shell-main" tabIndex={-1}>{children}</main>
			</div>
			{current && viewerMode === 'side' && (
				<aside className="shell-viewer" aria-label="Document viewer">
					<DocumentViewerPanel key={current.id} request={current} mode="side" onClose={viewer.close} />
				</aside>
			)}
			{current && viewerMode === 'overlay' && (
				<Dialog open onClose={viewer.close} title={`${current.title}, document viewer`} variant="full" returnFocus={current.returnFocus}>
					<DocumentViewerPanel key={current.id} request={current} mode="overlay" onClose={viewer.close} />
				</Dialog>
			)}
		</div>
	);
}
