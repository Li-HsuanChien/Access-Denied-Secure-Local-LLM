import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation } from '../../data/samples';
import { useStore } from '../../store';
import { IconArrowLeft, IconBook, IconChat, IconInfo, IconSearch, IconSparkle, IconTrash } from '../../ui/icons';
import { ConfirmDialog } from '../../ui/overlay';
import { Button, dateGroup, formatRelative } from '../../ui/primitives';

function excerpt(text: string, n = 150): string {
	const plain = text.replace(/(^|\n)- /g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
	return plain.length > n ? `${plain.slice(0, n).trimEnd()}…` : plain;
}

export function HistoryView({ compact }: { compact: boolean }) {
	const store = useStore();
	const [query, setQuery] = useState('');
	const [confirm, setConfirm] = useState<string | null>(null);
	const search = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const selectedId = store.view.name === 'history' ? store.view.selected : undefined;

	useEffect(() => { if (!selectedId) search.current?.focus(); }, [selectedId]);

	const saved = useMemo(() => store.conversations.filter(c => c.saved).sort((a, b) => b.updatedAt - a.updatedAt), [store.conversations]);
	const matches = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return saved.map(c => ({ c, hit: '' }));
		return saved.flatMap(c => {
			if (c.title.toLowerCase().includes(q)) return [{ c, hit: '' }];
			for (const m of c.messages) {
				const text = m.role === 'user' ? m.text : m.reply?.text ?? '';
				const i = text.toLowerCase().indexOf(q);
				if (i >= 0) {
					const start = i > 40 ? text.indexOf(' ', i - 40) + 1 : 0;
					return [{ c, hit: `${start > 0 ? '…' : ''}${excerpt(text.slice(start), 110)}` }];
				}
			}
			return [];
		});
	}, [saved, query]);

	const groups = useMemo(() => {
		const map = new Map<string, typeof matches>();
		for (const m of matches) map.set(dateGroup(m.c.updatedAt), [...(map.get(dateGroup(m.c.updatedAt)) ?? []), m]);
		return [...map.entries()];
	}, [matches]);

	const selected = saved.find(c => c.id === selectedId) ?? null;
	const target = saved.find(c => c.id === confirm);
	const select = (id?: string) => store.navigate({ name: 'history', selected: id });
	const showList = !compact || !selected;
	const showDetail = !compact || !!selected;

	return (
		<div className="view history" data-has-selection={!!selected || undefined}>
			{showList && (
				<div className="history-list-pane">
					<header className="history-head">
						<h1 className="view-title">Chats</h1>
						<label className="search-field">
							<IconSearch size={16} />
							<span className="sr-only">Search conversations</span>
							<input ref={search} type="search" placeholder="Search titles, questions and answers" value={query} onChange={e => setQuery(e.target.value)} />
						</label>
						{!store.settings.historyEnabled && (
							<p className="history-off"><IconInfo size={15} /> History is off. New chats aren’t saved.
								<button type="button" className="link-btn" onClick={() => store.setSettingsOpen(true)}>Change</button></p>
						)}
					</header>
					<div className="history-list" ref={listRef}>
						{saved.length === 0 && (
							<div className="empty-state empty-small">
								<IconChat size={22} />
								<h2>No saved chats yet</h2>
								<p>Conversations are saved here as you go, so you can pick them up later.</p>
								<Button variant="primary" onClick={() => store.newChat()}>Start a chat</Button>
							</div>
						)}
						{saved.length > 0 && matches.length === 0 && <p className="history-none" role="status">No chats match “{query}”.</p>}
						{groups.map(([group, items]) => (
							<section key={group} aria-label={group}>
								<h2 className="nav-group-title">{group}</h2>
								<ul>
									{items.map(({ c, hit }) => (
										<li key={c.id}>
											<button type="button" className="history-item" aria-current={selectedId === c.id ? 'true' : undefined} onClick={() => select(c.id)} onDoubleClick={() => store.openConversation(c.id)}>
												<span className="history-item-title">{c.title}</span>
												<span className="history-item-meta">{hit || excerpt(firstAnswer(c), 90)}</span>
												<span className="history-item-time">{formatRelative(c.updatedAt)}</span>
											</button>
										</li>
									))}
								</ul>
							</section>
						))}
					</div>
				</div>
			)}
			{showDetail && (
				<div className="history-detail-pane">
					{selected ? (
						<HistoryDetail conversation={selected} compact={compact} onBack={() => select(undefined)} onDelete={() => setConfirm(selected.id)} />
					) : (
						<div className="history-placeholder">
							<IconChat size={24} />
							<p>Select a chat to preview it.</p>
						</div>
					)}
				</div>
			)}
			<ConfirmDialog
				open={!!target}
				title="Delete this conversation?"
				description={<><strong>{target?.title}</strong> will be removed from this computer. This can’t be undone.</>}
				confirmLabel="Delete"
				onCancel={() => setConfirm(null)}
				onConfirm={async () => { if (target) await store.deleteConversation(target.id); setConfirm(null); }}
				fallbackFocus={() => listRef.current?.querySelector<HTMLElement>('.history-item') ?? search.current}
			/>
		</div>
	);
}

function firstAnswer(c: Conversation): string {
	const a = c.messages.find(m => m.role === 'assistant');
	return a && a.role === 'assistant' ? a.reply?.text ?? '' : '';
}

function HistoryDetail({ conversation: c, compact, onBack, onDelete }: { conversation: Conversation; compact: boolean; onBack: () => void; onDelete: () => void }) {
	const store = useStore();
	const heading = useRef<HTMLHeadingElement>(null);
	useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [c.id]);
	const turns = c.messages.filter(m => m.role === 'user').length;
	const docs = new Set(c.messages.flatMap(m => (m.role === 'assistant' ? m.reply?.citations.map(x => x.document_title) ?? [] : [])));
	return (
		<article className="history-detail" aria-labelledby="hd-title">
			{compact && <Button variant="ghost" size="sm" icon={<IconArrowLeft size={16} />} onClick={onBack} className="history-back">All chats</Button>}
			<header className="hd-head">
				<h2 id="hd-title" ref={heading} tabIndex={-1} className="hd-title">{c.title}</h2>
				<p className="hd-meta">
					{new Date(c.updatedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
					{' · '}{turns} {turns === 1 ? 'question' : 'questions'}
					{docs.size > 0 && <> · cites {[...docs].join(', ')}</>}
				</p>
				<div className="hd-actions">
					<Button variant="primary" icon={<IconChat size={16} />} onClick={() => store.openConversation(c.id)}>Continue this chat</Button>
					<Button variant="danger-ghost" icon={<IconTrash size={16} />} onClick={onDelete}>Delete</Button>
				</div>
			</header>
			<ol className="hd-transcript" aria-label="Conversation preview">
				{c.messages.map(m => m.role === 'user' ? (
					<li key={m.id} className="hd-q">{m.text}</li>
				) : (
					<li key={m.id} className="hd-a" data-basis={m.reply?.basis}>
						<p className="basis">
							{m.reply?.basis === 'documents' ? <IconBook size={14} /> : m.reply?.basis === 'general' ? <IconSparkle size={14} /> : <IconInfo size={14} />}
							{m.reply?.basis === 'documents' ? 'Based on your documents' : m.reply?.basis === 'general' ? 'General knowledge · no supporting documents' : 'No supporting documents'}
						</p>
						<p>{excerpt(m.reply?.text ?? '', 320)}</p>
						{!!m.reply?.citations.length && <p className="hd-cites">{m.reply.citations.length} citations · open the chat to view the quotes and pages</p>}
					</li>
				))}
			</ol>
		</article>
	);
}
