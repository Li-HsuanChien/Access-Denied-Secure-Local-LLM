import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Answer, SavedConversation } from '../../react-contracts';
import { useAnswering, useNavigation, usePreferences, useServices } from '../../../../react/providers';
import {
	Button, ConfirmDialog, IconArrowLeft, IconBook, IconChat, IconInfo, IconSearch, IconSparkle, IconTrash,
	dateGroup, formatRelative, isModalOpen, pageLabel, useToast, useViewportAtLeast
} from '../../design-system/react';
import { COMPACT_MAX_WIDTH, SHELL_SEARCH_ATTRIBUTE } from '../../desktop-shell/react/AppShell';
import { notifyHistoryChanged, HISTORY_CHANGED_EVENT } from '../../desktop-shell/react/useSavedThreads';
import { answerBasisLabel } from '../../personality/presentation';
import {
	basisOf, firstAnswerExcerpt, parseStamp, readPreview, searchSnippet,
	type HistoryPreview, type PreviewTurn
} from './preview';
import './history.css';

function failure(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

type OpenState = { id: string; status: 'loading' | 'ready' | 'error'; error: string };

/**
 * Saved chats: client-side search over titles (and content of chats already previewed in this view),
 * date groups, and a preview pane. Uses only the existing History interface (list/open/remove).
 */
export function HistoryPage() {
	const services = useServices();
	const { state: answeringState } = useAnswering();
	const { navigate } = useNavigation();
	const preferences = usePreferences();
	const compact = !useViewportAtLeast(COMPACT_MAX_WIDTH);
	const [rows, setRows] = useState<SavedConversation[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [listError, setListError] = useState('');
	const [previews, setPreviews] = useState<Record<string, HistoryPreview>>({});
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [openState, setOpenState] = useState<OpenState | null>(null);
	const [query, setQuery] = useState('');
	const [confirmId, setConfirmId] = useState<string | null>(null);
	const toast = useToast();
	const search = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const refocusItem = useRef<string | null>(null);
	const mounted = useRef(false);
	const listRequest = useRef(0);
	const openRequest = useRef(0);
	const mutationGeneration = useRef(0);
	const deletingIds = useRef(new Set<string>());
	const deletedIds = useRef(new Set<string>());
	const searchHintId = useId();

	const refresh = useCallback(async () => {
		const request = ++listRequest.current;
		const [listResult] = await Promise.allSettled([services.history.list(), preferences.refresh()]);
		if (!mounted.current || listRequest.current !== request) return;
		if (listResult.status === 'fulfilled') {
			setRows(listResult.value.filter((row) => !deletedIds.current.has(row.conversation_id)));
			setListError('');
		} else setListError(failure(listResult.reason, 'History is unavailable.'));
		setLoaded(true);
	}, [preferences.refresh, services.history]);

	useEffect(() => {
		mounted.current = true;
		document.title = 'History · Access Denied';
		void refresh();
		const onChange = () => { void refresh(); };
		window.addEventListener(HISTORY_CHANGED_EVENT, onChange);
		return () => {
			mounted.current = false;
			listRequest.current += 1;
			openRequest.current += 1;
			window.removeEventListener(HISTORY_CHANGED_EVENT, onChange);
		};
	}, [refresh]);

	// Arriving from "Search chats" puts the caret in the search field (Cmd/Ctrl+K is handled by the shell).
	useEffect(() => {
		const active = document.activeElement;
		if (!isModalOpen() && (!active || active === document.body || active.closest('a[href="/history"]'))) search.current?.focus({ preventScroll: true });
	}, []);

	async function open(id: string) {
		if (deletingIds.current.has(id) || deletedIds.current.has(id)) return;
		const request = ++openRequest.current;
		const mutation = mutationGeneration.current;
		const current = () => mounted.current && openRequest.current === request && mutationGeneration.current === mutation;
		setOpenState({ id, status: 'loading', error: '' });
		try {
			const preview = readPreview(await services.history.open(id));
			if (!current()) return;
			if (!preview) {
				setOpenState({ id, status: 'error', error: 'This conversation is no longer available.' });
				return;
			}
			setPreviews((all) => ({ ...all, [id]: preview }));
			setOpenState({ id, status: 'ready', error: '' });
		} catch (cause) {
			if (current()) setOpenState({ id, status: 'error', error: failure(cause, 'Could not open this conversation.') });
		}
	}

	function select(id: string | null) {
		if (id === null && selectedId) refocusItem.current = selectedId;
		setSelectedId(id);
		if (id) void open(id);
		else { openRequest.current += 1; setOpenState(null); }
	}

	async function remove(id: string) {
		if (answeringState.pending?.sessionId === id) throw new Error('This chat is answering a question.');
		mutationGeneration.current += 1;
		listRequest.current += 1;
		openRequest.current += 1;
		deletingIds.current.add(id);
		try {
			await services.history.remove(id);
		} catch (cause) {
			deletingIds.current.delete(id);
			throw new Error(failure(cause, 'Could not delete this conversation.'));
		}
		deletingIds.current.delete(id);
		deletedIds.current.add(id);
		if (!mounted.current) return;
		setRows((all) => all.filter((row) => row.conversation_id !== id));
		setPreviews(({ [id]: _removed, ...rest }) => rest);
		setSelectedId((current) => current === id ? null : current);
		setOpenState((current) => current?.id === id ? null : current);
		toast({ tone: 'success', text: 'Conversation deleted.' });
		notifyHistoryChanged();
	}

	const sorted = useMemo(() => [...rows].sort((a, b) => parseStamp(b.updated_at) - parseStamp(a.updated_at)), [rows]);
	const matches = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return sorted.map((row) => ({ row, hit: '' }));
		return sorted.flatMap((row) => {
			if (row.title.toLowerCase().includes(q)) return [{ row, hit: '' }];
			const hit = searchSnippet(previews[row.conversation_id], q);
			return hit === null ? [] : [{ row, hit }];
		});
	}, [sorted, query, previews]);
	const groups = useMemo(() => {
		const map = new Map<string, typeof matches>();
		for (const match of matches) {
			const group = dateGroup(parseStamp(match.row.updated_at));
			map.set(group, [...(map.get(group) ?? []), match]);
		}
		return [...map.entries()];
	}, [matches]);

	// Back from the compact detail view returns focus to the chat that was open.
	useLayoutEffect(() => {
		if (selectedId || !refocusItem.current) return;
		const id = refocusItem.current;
		refocusItem.current = null;
		const item = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-conversation-id]') ?? [])].find((el) => el.dataset.conversationId === id);
		(item ?? search.current)?.focus({ preventScroll: true });
	}, [selectedId]);

	const selected = sorted.find((row) => row.conversation_id === selectedId) ?? null;
	const target = sorted.find((row) => row.conversation_id === confirmId) ?? null;
	const historyOff = preferences.state.loaded.historyEnabled && !preferences.state.historyEnabled;
	const showList = !compact || !selected;
	const showDetail = !compact || !!selected;

	return (
		<div className="history-view" data-compact={compact || undefined} data-has-selection={!!selected || undefined}>
			{showList && <div className="history-list-pane">
				<header className="history-head">
					<h1 className="history-title">History</h1>
					<label className="history-search">
						<IconSearch size={16} />
						<span className="ui-sr-only">Search chats</span>
						<input
							ref={search} type="search" placeholder="Search chats" value={query}
							aria-describedby={searchHintId} onChange={(event) => setQuery(event.currentTarget.value)}
							{...{ [SHELL_SEARCH_ATTRIBUTE]: '' }}
						/>
					</label>
					<p id={searchHintId} className="history-search-hint">Searches titles, plus the questions and answers of chats you’ve previewed here.</p>
					{historyOff && <p className="history-off"><IconInfo size={15} /> <span>History is off. New chats aren’t saved.</span>
						<button type="button" className="ui-link-btn" onClick={() => navigate('/settings')}>Change</button></p>}
				</header>
				<div className="history-list" ref={listRef}>
					{listError && <p role="alert" className="ui-callout ui-callout-error">{listError}</p>}
					{loaded && !listError && sorted.length === 0 && <div className="history-empty">
						<IconChat size={22} />
						<h2>No saved chats yet</h2>
						<p>{historyOff ? 'History is off, so new chats aren’t saved.' : 'Conversations are saved here as you go, so you can pick them up later.'}</p>
						<Button variant="primary" onClick={() => navigate('/', { newChat: true })}>Start a chat</Button>
					</div>}
					{sorted.length > 0 && matches.length === 0 && <p className="history-none" role="status">No chats match “{query.trim()}”.</p>}
					{groups.map(([group, items]) => <section key={group} aria-label={group} className="history-group">
						<h2 className="history-group-title">{group}</h2>
						<ul>{items.map(({ row, hit }) => {
							const stamp = parseStamp(row.updated_at);
							const meta = hit || firstAnswerExcerpt(previews[row.conversation_id]);
							return <li key={row.conversation_id}>
								<button
									type="button" className="history-item" data-conversation-id={row.conversation_id}
									aria-current={selectedId === row.conversation_id ? 'true' : undefined}
									onClick={() => select(row.conversation_id)}
								>
									<span className="history-item-title">{row.title}</span>
									<time className="history-item-time" dateTime={stamp ? new Date(stamp).toISOString() : undefined}>{stamp ? formatRelative(stamp) : row.updated_at}</time>
									{meta && <span className="history-item-meta">{meta}</span>}
								</button>
							</li>;
						})}</ul>
					</section>)}
				</div>
			</div>}
			{showDetail && <div className="history-detail-pane">
				{selected ? <HistoryDetail
					row={selected}
					preview={previews[selected.conversation_id]}
					openState={openState?.id === selected.conversation_id ? openState : null}
					compact={compact}
					deleteDisabled={answeringState.pending?.sessionId === selected.conversation_id}
					onBack={() => select(null)}
					onContinue={() => navigate(`/conversation/${encodeURIComponent(selected.conversation_id)}`)}
					onDelete={() => setConfirmId(selected.conversation_id)}
				/> : <div className="history-placeholder"><IconChat size={24} /><p>Select a chat to preview it.</p></div>}
			</div>}
			<ConfirmDialog
				open={!!target}
				title="Delete this conversation?"
				description={<><strong>{target?.title}</strong> will be removed from this computer. This can’t be undone.</>}
				confirmLabel="Delete"
				onCancel={() => setConfirmId(null)}
				onConfirm={async () => { if (target) await remove(target.conversation_id); setConfirmId(null); }}
				fallbackFocus={() => listRef.current?.querySelector<HTMLElement>('.history-item') ?? search.current}
			/>
		</div>
	);
}

function HistoryDetail({ row, preview, openState, compact, deleteDisabled, onBack, onContinue, onDelete }: {
	row: SavedConversation; preview: HistoryPreview | undefined; openState: OpenState | null; compact: boolean;
	deleteDisabled: boolean; onBack: () => void; onContinue: () => void; onDelete: () => void;
}) {
	const heading = useRef<HTMLHeadingElement>(null);
	const titleId = useId();
	// In the single-column layout the list disappears, so move focus to the preview heading.
	useEffect(() => { if (compact) heading.current?.focus({ preventScroll: true }); }, [row.conversation_id, compact]);
	const stamp = parseStamp(row.updated_at);
	const questions = preview?.turns.filter((turn) => turn.kind === 'question').length;
	const docs = new Set(preview?.turns.flatMap((turn) => turn.kind === 'answer' && turn.answer && basisOf(turn.answer) === 'documents'
		? turn.answer.citations.map((citation) => citation.document_title) : []) ?? []);
	return (
		<section className="history-detail" aria-labelledby={titleId}>
			{compact && <Button variant="ghost" size="sm" icon={<IconArrowLeft size={16} />} onClick={onBack} className="history-back">All chats</Button>}
			<header className="history-detail-head">
				<h2 id={titleId} ref={heading} tabIndex={-1} className="history-detail-title">{row.title}</h2>
				<p className="history-detail-meta">
					{stamp ? new Date(stamp).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : row.updated_at}
					{questions !== undefined && <>{' · '}{questions} {questions === 1 ? 'question' : 'questions'}</>}
					{docs.size > 0 && <>{' · cites '}{[...docs].join(', ')}</>}
				</p>
				<p className="history-detail-provenance">{`Model ${row.model_id || 'unknown'} · Collection ${row.collection_version || 'unknown'}`}</p>
				<div className="history-detail-actions">
					<Button variant="primary" icon={<IconChat size={16} />} onClick={onContinue}>Continue this chat</Button>
					<Button variant="danger-ghost" icon={<IconTrash size={16} />} onClick={onDelete} disabled={deleteDisabled}>Delete</Button>
				</div>
			</header>
			{openState?.status === 'error' && <p role="alert" className="ui-callout ui-callout-error">{openState.error}</p>}
			{openState?.status === 'loading' && !preview && <p role="status" className="history-loading">Loading preview…</p>}
			{preview && openState?.status !== 'error' && <ol className="history-transcript" aria-label="Conversation preview">
				{preview.turns.map((turn, index) => <TranscriptTurn key={index} turn={turn} />)}
			</ol>}
		</section>
	);
}

/** History's distinct plain presentation: one basis label, plain claims with citation IDs, source details. */
function TranscriptTurn({ turn }: { turn: PreviewTurn }) {
	if (turn.kind === 'question') return <li className="history-q">{turn.text}</li>;
	const answer = turn.answer;
	const basis = basisOf(answer);
	const icon = basis === 'documents' ? <IconBook size={14} /> : basis === 'general' ? <IconSparkle size={14} /> : <IconInfo size={14} />;
	return (
		<li className="history-a" data-basis={basis}>
			<p className="history-basis">{icon}<span>{answerBasisLabel(basis)}</span></p>
			{!answer && <p>{turn.text}</p>}
			{answer && basis === 'documents' && <div data-evidence-kind="document" className="history-claims">
				{(answer.documents as Answer['documents']).map((claim, index) => <p key={index}>{claim.text}{' '}
					{claim.citation_ids.map((id, citationIndex) => <span className="history-cite" key={`${id}-${citationIndex}`}>{id}</span>)}</p>)}
			</div>}
			{answer && basis === 'general' && <p data-evidence-kind="general">{answer.general_knowledge}</p>}
			{answer && basis === 'none' && <p>{answer.error?.message || 'I couldn’t find enough evidence in your documents to answer this question.'}</p>}
			{!!answer?.limitations.length && <div data-evidence-kind="uncertain" className="history-limitations">
				<h3>Limitations</h3><ul>{answer.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
			</div>}
			{answer?.warnings.filter((warning) => warning.code !== 'insufficient_evidence').map((warning, index) =>
				<p className="history-warning" key={index}><IconInfo size={14} /> <span>{warning.message}</span></p>)}
			{answer && basis === 'documents' && answer.citations.length > 0 && <div className="history-sources">
				<h3>Sources</h3>
				{answer.citations.map((citation, index) => <details key={`${citation.citation_id}-${index}`}>
					<summary>{`${citation.document_title} · ${pageLabel(citation.page_start, citation.page_end).toLowerCase()}`}</summary>
					<blockquote>{citation.quote}</blockquote>
				</details>)}
			</div>}
		</li>
	);
}
