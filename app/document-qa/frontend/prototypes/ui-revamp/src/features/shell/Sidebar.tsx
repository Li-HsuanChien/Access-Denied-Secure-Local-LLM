import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import { BrandMark, IconCompose, IconLibrary, IconLock, IconMore, IconSearch, IconSidebar, IconSliders, IconTrash } from '../../ui/icons';
import { ConfirmDialog, Menu } from '../../ui/overlay';
import { IconButton, Spinner, dateGroup } from '../../ui/primitives';

export function Sidebar({ open, compact, onClose }: { open: boolean; compact: boolean; onClose: () => void }) {
	const store = useStore();
	const { conversations, currentId, view, publication, settings } = store;
	const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
	const [confirm, setConfirm] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const isMac = navigator.platform.includes('Mac');
	const mod = isMac ? '⌘' : 'Ctrl+';

	const groups = useMemo(() => {
		const saved = conversations.filter(c => c.saved).sort((a, b) => b.updatedAt - a.updatedAt);
		const map = new Map<string, typeof saved>();
		for (const c of saved) {
			const g = dateGroup(c.updatedAt);
			map.set(g, [...(map.get(g) ?? []), c]);
		}
		return [...map.entries()];
	}, [conversations]);

	const target = conversations.find(c => c.id === confirm);
	const publishing = publication && (publication.phase === 'publishing' || publication.phase === 'checking');
	const chatActive = view.name === 'chat';

	return (
		<nav className="sidebar" aria-label="Main" data-open={open} aria-hidden={!open || undefined} inert={!open || undefined}>
			<div className="sidebar-head">
				<button type="button" className="brand" onClick={() => store.newChat()} aria-label="Access Denied, start a new chat">
					<BrandMark />
					<span className="brand-name">Access Denied</span>
				</button>
				<IconButton label={compact ? 'Close sidebar' : 'Hide sidebar'} shortcut={compact ? undefined : `${mod}B`} icon={<IconSidebar />} onClick={onClose} side="right" />
			</div>

			<div className="sidebar-actions">
				<button type="button" className="nav-item nav-item-strong" onClick={() => store.newChat()} aria-current={chatActive && !currentId ? 'page' : undefined}>
					<IconCompose /> <span>New chat</span>
				</button>
				<button type="button" className="nav-item" onClick={() => store.navigate({ name: 'history' })} aria-current={view.name === 'history' ? 'page' : undefined}>
					<IconSearch /> <span>Search chats</span> <kbd className="nav-kbd">{mod}K</kbd>
				</button>
				<button type="button" className="nav-item" onClick={() => store.navigate({ name: 'library' })} aria-current={view.name === 'library' ? 'page' : undefined}>
					<IconLibrary /> <span>Library</span>
					{publishing ? (
						<span className="nav-meta"><Spinner size={12} /> {publication.phase === 'checking' ? 'Checking' : 'Adding'}</span>
					) : (
						<span className="nav-meta">{store.docs.filter(d => d.enabled).length}</span>
					)}
				</button>
			</div>

			<div className="sidebar-scroll" ref={listRef}>
				{groups.length === 0 && (
					<p className="sidebar-empty">
						{settings.historyEnabled ? 'Your saved conversations will appear here.' : 'History is off, so new chats aren’t saved.'}
					</p>
				)}
				{groups.map(([group, items]) => (
					<section key={group} className="nav-group" aria-label={group}>
						<h3 className="nav-group-title">{group}</h3>
						<ul>
							{items.map(c => {
								const active = chatActive && currentId === c.id;
								return (
									<li key={c.id} className="thread-row" data-active={active || undefined} data-menu={menu?.id === c.id || undefined}>
										<button type="button" className="thread-link" aria-current={active ? 'page' : undefined} onClick={() => store.openConversation(c.id)}>
											{c.title}
										</button>
										<button
											type="button"
											className="thread-more"
											aria-label={`More options for ${c.title}`}
											aria-haspopup="menu"
											aria-expanded={menu?.id === c.id}
											onClick={e => setMenu(m => (m?.id === c.id ? null : { id: c.id, anchor: e.currentTarget }))}
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

			<div className="sidebar-foot">
				<button type="button" className="nav-item" onClick={() => store.setSettingsOpen(true)}>
					<IconSliders /> <span>Settings</span>
				</button>
				<p className="local-note"><IconLock size={14} /> Private and offline · <span className="sample-tag">Sample data</span></p>
			</div>

			<Menu
				label="Conversation options"
				anchor={menu?.anchor ?? null}
				open={!!menu}
				onClose={() => setMenu(null)}
				items={[{ label: 'Delete…', icon: <IconTrash size={16} />, destructive: true, onSelect: () => setConfirm(menu?.id ?? null) }]}
			/>
			<ConfirmDialog
				open={!!target}
				title="Delete this conversation?"
				description={<><strong>{target?.title}</strong> will be removed from this computer. This can’t be undone.</>}
				confirmLabel="Delete"
				onCancel={() => setConfirm(null)}
				onConfirm={async () => { if (target) await store.deleteConversation(target.id); setConfirm(null); }}
				fallbackFocus={() => listRef.current?.querySelector<HTMLElement>('.thread-link') ?? document.querySelector<HTMLElement>('.nav-item-strong')}
			/>
		</nav>
	);
}
