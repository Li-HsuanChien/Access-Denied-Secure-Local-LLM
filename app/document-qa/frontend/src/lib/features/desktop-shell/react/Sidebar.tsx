import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { useAnswering, useHealth, useLibrary, useNavigation, usePreferences, useServices } from '../../../../react/providers';
import type { AppPath, NavigationOptions } from '../../react-contracts';
import type { SavedConversation } from '../../history/historyClient';
import { useI18n } from '@/react/i18n';
import {
	BrandMark, ConfirmDialog, IconButton, IconCompose, IconLibrary, IconLock, IconMore, IconSearch, IconSidebar,
	IconSliders, IconTrash, Menu, Spinner, dateGroup, modifierLabel, parseTimestamp, type DateGroup
} from '../../design-system/react';
import { PinnedModelSection } from './PinnedModel';
import { OpenWebUiCredit } from './OpenWebUiCredit';
import { notifyHistoryChanged } from './useSavedThreads';

const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
export const conversationPath = (id: string) => `/conversation/${encodeURIComponent(id)}` as const;

export interface SidebarProps {
	open: boolean;
	compact: boolean;
	threads: { rows: SavedConversation[]; loaded: boolean; error: string; refresh(): void };
	onClose(): void;
	/** Called after any navigation from the sidebar (the shell closes the phone drawer). */
	onNavigate(): void;
}

export function Sidebar({ open, compact, threads, onClose, onNavigate }: SidebarProps) {
	const { t } = useI18n();
	const { route, navigate } = useNavigation();
	const { state: preferences } = usePreferences();
	const { state: answering } = useAnswering();
	const { state: library } = useLibrary();
	const health = useHealth();
	const services = useServices();
	const [menu, setMenu] = useState<{ row: SavedConversation; anchor: HTMLElement } | null>(null);
	const [confirm, setConfirm] = useState<SavedConversation | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const mod = modifierLabel();

	const go = (path: AppPath, options?: NavigationOptions) => (event: MouseEvent) => {
		if (!plainClick(event)) return;
		event.preventDefault();
		navigate(path, options);
		onNavigate();
	};
	const newChat = () => { navigate('/', { newChat: true }); onNavigate(); };

	const groups = useMemo(() => {
		const sorted = [...threads.rows].sort((a, b) => parseTimestamp(b.updated_at) - parseTimestamp(a.updated_at));
		const map = new Map<DateGroup, SavedConversation[]>();
		for (const row of sorted) {
			const group = dateGroup(parseTimestamp(row.updated_at));
			map.set(group, [...(map.get(group) ?? []), row]);
		}
		return [...map.entries()];
	}, [threads.rows]);

	const onChatRoot = route.path === '/' || route.path === '/qa';
	const documentCount = health.health?.library.document_count;
	const libraryMeta = library.publication
		? <span className="shell-nav-meta"><Spinner size={12} /> Adding…</span>
		: library.busy ? <span className="shell-nav-meta"><Spinner size={12} /> Checking…</span>
		: typeof documentCount === 'number' ? <span className="shell-nav-meta" aria-hidden="true" title={`${documentCount} document${documentCount === 1 ? '' : 's'}`}>{documentCount}</span>
		: null;

	async function remove(row: SavedConversation) {
		const deleted = await services.history.remove(row.conversation_id);
		if (!deleted) throw new Error('This chat could not be deleted.');
		setConfirm(null);
		notifyHistoryChanged();
		if (route.path === conversationPath(row.conversation_id)) navigate('/', { newChat: true });
	}

	return (
		<nav id="sidebar" className="shell-sidebar" aria-label={t('Chat history')} data-open={open} aria-hidden={!open || undefined} inert={!open || undefined}>
			<div className="shell-sidebar-head">
				<button type="button" className="shell-brand" onClick={newChat} aria-label="Access Denied, start a new chat">
					<BrandMark />
					<span className="shell-brand-name">Access Denied</span>
				</button>
				<IconButton label={t('Close Sidebar')} shortcut={compact ? undefined : `${mod}B`} icon={<IconSidebar />} onClick={onClose} side="right" />
			</div>

			<div className="shell-sidebar-actions">
				<a href="/" className="shell-nav-item shell-nav-item-strong" draggable={false} aria-current={onChatRoot && !route.temporary ? 'page' : undefined} onClick={go('/', { newChat: true })}>
					<IconCompose /> <span>{t('New Chat')}</span>
				</a>
				<a href="/history" className="shell-nav-item" draggable={false} aria-current={route.path === '/history' ? 'page' : undefined} onClick={go('/history')}>
					<IconSearch /> <span>Search chats</span> <kbd className="shell-nav-kbd" aria-hidden="true">{mod}K</kbd>
				</a>
				<a href="/library" className="shell-nav-item" draggable={false} aria-current={route.path === '/library' ? 'page' : undefined} onClick={go('/library')}>
					<IconLibrary /> <span>Library</span>{libraryMeta}
				</a>
			</div>

			<div className="shell-sidebar-scroll" ref={listRef}>
				<PinnedModelSection onSelect={go('/', { newChat: true, localModel: true })} />
				{threads.error && (
					<p className="shell-sidebar-empty" role="alert">{threads.error} <button type="button" className="ui-link-btn" onClick={threads.refresh}>Try again</button></p>
				)}
				{!threads.error && threads.loaded && groups.length === 0 && (
					<p className="shell-sidebar-empty">
						{preferences.historyEnabled ? 'Your saved conversations will appear here.' : 'History is off, so new chats aren’t saved.'}
					</p>
				)}
				{groups.map(([group, items]) => (
					<section key={group} className="shell-nav-group" aria-label={t(group)}>
						<h3 className="shell-nav-group-title">{t(group)}</h3>
						<ul>
							{items.map(row => {
								const path = conversationPath(row.conversation_id);
								const active = route.path === path;
								const busy = answering.pending?.sessionId === row.conversation_id;
								return (
									<li key={row.conversation_id} className="shell-thread-row" data-active={active || undefined} data-menu={menu?.row.conversation_id === row.conversation_id || undefined}>
										<a href={path} className="shell-thread-link" title={row.title} aria-current={active ? 'page' : undefined} draggable={false} onClick={go(path)}>
											{row.title}
										</a>
										<button
											type="button"
											className="shell-thread-more"
											aria-label={`More options for ${row.title}`}
											aria-haspopup="menu"
											aria-expanded={menu?.row.conversation_id === row.conversation_id}
											disabled={busy}
											onClick={e => { const anchor = e.currentTarget; setMenu(m => (m?.row.conversation_id === row.conversation_id ? null : { row, anchor })); }}
										>
											<IconMore size={16} />
										</button>
									</li>
								);
							})}
						</ul>
					</section>
				))}
			</div>

			<div className="shell-sidebar-foot">
				<a href="/settings" className="shell-nav-item" draggable={false} aria-current={route.path === '/settings' ? 'page' : undefined} onClick={go('/settings')}>
					<IconSliders /> <span>Settings</span>
				</a>
				<p className="shell-local-note"><IconLock size={14} /> Private and offline</p>
				<OpenWebUiCredit />
			</div>

			<Menu
				label="Conversation options"
				anchor={menu?.anchor ?? null}
				open={!!menu}
				onClose={() => setMenu(null)}
				items={[{ label: 'Delete…', icon: <IconTrash size={16} />, destructive: true, onSelect: () => setConfirm(menu?.row ?? null) }]}
			/>
			<ConfirmDialog
				open={!!confirm}
				title="Delete this conversation?"
				description={<><strong>{confirm?.title}</strong> will be removed from this computer. This can’t be undone.</>}
				confirmLabel="Delete"
				onCancel={() => setConfirm(null)}
				onConfirm={() => confirm ? remove(confirm) : undefined}
				fallbackFocus={() => listRef.current?.querySelector<HTMLElement>('.shell-thread-link') ?? document.querySelector<HTMLElement>('.shell-nav-item-strong')}
			/>
		</nav>
	);
}
