import { useCallback, useEffect, useRef, useState } from 'react';
import type { Answer, SavedAnswerRecord, SavedConversation } from '../../react-contracts';
import './history.css';
import { readSavedAnswer, usePreferences, useServices } from '../../../../react/providers';

function failure(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

export function HistoryPage() {
	const services = useServices();
	const preferences = usePreferences();
	const [rows, setRows] = useState<SavedConversation[]>([]);
	const [selected, setSelected] = useState<SavedAnswerRecord | null>(null);
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const mounted = useRef(false);
	const listRequest = useRef(0);
	const openRequest = useRef(0);
	const mutationGeneration = useRef(0);
	const deletingIds = useRef(new Set<string>());
	const deletedIds = useRef(new Set<string>());
	const clearing = useRef(false);

	const refresh = useCallback(async () => {
		const request = ++listRequest.current;
		const [listResult, preferenceResult] = await Promise.allSettled([services.history.list(), preferences.refresh()]);
		if (!mounted.current || listRequest.current !== request) return;
		if (listResult.status === 'fulfilled') setRows(listResult.value.filter((row) => !deletedIds.current.has(row.conversation_id)));
		else setError(failure(listResult.reason, 'History is unavailable.'));
		if (preferenceResult.status === 'fulfilled') {
			const preferenceError = preferenceResult.value.errors.generalKnowledge || preferenceResult.value.errors.historyEnabled;
			if (preferenceError) setError(preferenceError);
		} else setError(failure(preferenceResult.reason, 'History is unavailable.'));
	}, [preferences.refresh, services.history]);

	useEffect(() => {
		mounted.current = true;
		document.title = 'History · Access Denied';
		void refresh();
		return () => {
			mounted.current = false;
			listRequest.current += 1;
			openRequest.current += 1;
		};
	}, [refresh]);

	useEffect(() => {
		const preferenceError = preferences.state.errors.generalKnowledge || preferences.state.errors.historyEnabled;
		if (preferenceError) setError(preferenceError);
	}, [preferences.state.errors]);

	async function open(id: string) {
		if (clearing.current || deletingIds.current.has(id) || deletedIds.current.has(id)) return;
		const request = ++openRequest.current;
		const mutation = mutationGeneration.current;
		try {
			const record = readSavedAnswer(await services.history.open(id));
			if (mounted.current && openRequest.current === request && mutationGeneration.current === mutation) setSelected(record);
		} catch (cause) {
			if (mounted.current && openRequest.current === request && mutationGeneration.current === mutation) setError(failure(cause, 'Could not open this conversation.'));
		}
	}

	async function remove(id: string) {
		mutationGeneration.current += 1;
		listRequest.current += 1;
		openRequest.current += 1;
		deletingIds.current.add(id);
		try {
			await services.history.remove(id);
			deletingIds.current.delete(id);
			deletedIds.current.add(id);
			if (!mounted.current) return;
			setSelected((current) => current?.conversation_id === id ? null : current);
			setNotice('Conversation deleted.');
			await refresh();
		} catch (cause) {
			deletingIds.current.delete(id);
			if (mounted.current) setError(failure(cause, 'Could not delete this conversation.'));
		}
	}

	async function clear() {
		if (!rows.length || !window.confirm('Delete all saved conversations from this computer?')) return;
		mutationGeneration.current += 1;
		listRequest.current += 1;
		openRequest.current += 1;
		clearing.current = true;
		try {
			await services.history.clear();
			clearing.current = false;
			for (const row of rows) deletedIds.current.add(row.conversation_id);
			if (!mounted.current) return;
			setSelected(null);
			setNotice('Saved history cleared.');
			await refresh();
		} catch (cause) {
			clearing.current = false;
			if (mounted.current) setError(failure(cause, 'Could not clear saved history.'));
		}
	}

	async function persistence(value: boolean) {
		try {
			const enabled = await preferences.setHistoryEnabled(value);
			if (mounted.current) setNotice(enabled ? 'New answers will be saved.' : 'New answers will not be saved.');
		} catch (cause) {
			if (mounted.current) setError(failure(cause, 'Could not update history setting.'));
		}
	}

	const answer = selected?.answer;
	return (
		<div className="workspace-page history-page" aria-labelledby="title">
			<p className="eyebrow">Saved on this computer</p>
			<h1 id="title">History</h1>
			<p className="lede">Saved answers retain the model and collection versions that produced them.</p>

			<section className="panel" aria-labelledby="conversations-title">
				<div className="heading"><h2 id="conversations-title">Conversations</h2><button className="btn quiet" type="button" onClick={() => void refresh()}>Refresh</button></div>
				<label className="setting"><span className="grow"><span className="name">Save new answers to local history</span></span><span className="workspace-switch"><input type="checkbox" role="switch" checked={preferences.state.historyEnabled} onChange={(event) => void persistence(event.currentTarget.checked)} /></span></label>
				{rows.length ? <>
					<ul className="rows">{rows.map((row) => <li className={`row${selected?.conversation_id === row.conversation_id ? ' current' : ''}`} key={row.conversation_id}>
						<button className="open grow" type="button" onClick={() => void open(row.conversation_id)}><span className="name">{row.title}</span><span className="meta">{`${row.updated_at} · model ${row.model_id || 'unknown'} · collection ${row.collection_version || 'unknown'}`}</span></button>
						<button className="btn danger delete" type="button" aria-label={`Delete ${row.title}`} onClick={() => void remove(row.conversation_id)}>Delete</button>
					</li>)}</ul>
					<div className="actions"><button className="btn danger" type="button" onClick={() => void clear()}>Clear all history</button></div>
				</> : <p className="empty">No saved conversations yet.</p>}
			</section>
			{notice && <p role="status" className="message notice">{notice}</p>}
			{error && <p role="alert" className="message error">{error}</p>}

			{selected && answer && <section className="panel" aria-labelledby="opened-title">
				<h2 id="opened-title">{selected.title}</h2>
				<p className="hint">{`Model ${selected.model_id || 'unknown'} · Collection ${selected.collection_version || 'unknown'}`}</p>
				<p><strong>Question:</strong> {answer.question}</p>
				{Array.isArray(answer.documents) && <div data-evidence-kind="document" className="evidence"><h3>From your documents</h3>{(answer.documents as Answer['documents']).map((claim, index) => <p key={index}>{claim.text}{' '}{(claim.citation_ids || []).map((id: string, citationIndex: number) => <span className="cite" key={`${id}-${citationIndex}`}>{id}</span>)}</p>)}</div>}
				{answer.general_knowledge && <div data-evidence-kind="general" className="evidence"><h3>General model knowledge</h3><p>{answer.general_knowledge}</p></div>}
				{Array.isArray(answer.limitations) && <div data-evidence-kind="uncertain" className="evidence"><h3>Limitations</h3><ul>{answer.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
			</section>}
			{Array.isArray(answer?.citations) && <section className="panel" aria-labelledby="sources-title">
				<h2 id="sources-title">Sources</h2>
				{(answer.citations as Answer['citations']).map((citation, index) => <details key={`${citation.citation_id}-${index}`}><summary>{citation.document_title} · pages {citation.page_start}{citation.page_end !== citation.page_start ? `–${citation.page_end}` : ''}</summary><blockquote>{citation.quote}</blockquote></details>)}
			</section>}
		</div>
	);
}
