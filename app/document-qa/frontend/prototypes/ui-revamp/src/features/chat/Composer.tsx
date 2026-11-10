import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { IconArrowUp, IconBook, IconSparkle } from '../../ui/icons';
import { Popover } from '../../ui/overlay';
import { Button, Spinner, Tooltip } from '../../ui/primitives';

export interface ComposerHandle { focus: () => void }

/** Prototype panel can prefill the composer; each seed is applied once. */
let lastSeed = 0;

export const Composer = forwardRef<ComposerHandle, { placeholder: string; autoFocus?: boolean }>(function Composer({ placeholder, autoFocus }, ref) {
	const store = useStore();
	const [text, setText] = useState('');
	const area = useRef<HTMLTextAreaElement>(null);
	const composing = useRef(false);
	const [docsAnchor, setDocsAnchor] = useState<HTMLElement | null>(null);
	const [docsOpen, setDocsOpen] = useState(false);
	const docsTitle = useId();
	const hintId = useId();
	const { model } = store.scenario;
	const ready = model === 'ready';
	const canSend = ready && !store.busy && text.trim().length > 0;
	const enabled = store.docs.filter(d => d.enabled);
	const gkSaving = store.saveState.generalKnowledge === 'saving';

	useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }));
	useEffect(() => { if (autoFocus) area.current?.focus(); }, [autoFocus]);
	useEffect(() => {
		const seed = store.composerSeed;
		if (seed && seed.n > lastSeed) { lastSeed = seed.n; setText(seed.text); area.current?.focus(); }
	}, [store.composerSeed]);
	useLayoutEffect(() => {
		const el = area.current;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
	}, [text]);

	const send = () => {
		if (!canSend) return;
		if (store.ask(text)) setText('');
	};

	const toggleGeneral = async () => {
		await store.updateSetting('generalKnowledge', !store.settings.generalKnowledge);
	};

	const sendLabel = !ready ? 'Answers are paused until the model is ready' : store.busy ? 'Wait for the current answer to finish' : 'Send';

	return (
		<div className="composer-wrap">
			{model !== 'ready' && (
				<p className="composer-notice" role="status" data-state={model}>
					{model === 'starting' ? (
						<><Spinner size={14} /> The local model is starting. Type your question now and send it when it’s ready.</>
					) : (
						<>Answers are paused because the local model isn’t running.<button type="button" className="link-btn" onClick={() => store.setScenario({ model: 'starting' })}>Start again</button></>
					)}
				</p>
			)}
			<div className="composer" data-temporary={(store.current ? store.current.temporary : store.temporaryMode) || undefined} onClick={e => { if (e.target === e.currentTarget) area.current?.focus(); }}>
				<label className="sr-only" htmlFor="composer-input">Your question</label>
				<textarea
					id="composer-input"
					ref={area}
					rows={1}
					value={text}
					placeholder={placeholder}
					aria-describedby={hintId}
					onChange={e => setText(e.target.value)}
					onCompositionStart={() => { composing.current = true; }}
					onCompositionEnd={() => { composing.current = false; }}
					onKeyDown={e => {
						if (e.key === 'Enter' && !e.shiftKey && !composing.current) { e.preventDefault(); send(); }
					}}
				/>
				<div className="composer-row">
					<div className="composer-tools">
						<button ref={setDocsAnchor} type="button" className="chip" aria-haspopup="dialog" aria-expanded={docsOpen} onClick={() => setDocsOpen(o => !o)}>
							<IconBook size={15} />
							{enabled.length} {enabled.length === 1 ? 'document' : 'documents'}
						</button>
						<Tooltip content={store.settings.generalKnowledge ? 'Used only when your documents can’t answer. Always labeled.' : 'Off: answers come only from your documents.'} side="top">
							<button type="button" className="chip" aria-pressed={store.settings.generalKnowledge} data-on={store.settings.generalKnowledge || undefined} onClick={toggleGeneral} aria-busy={gkSaving || undefined}>
								{gkSaving ? <Spinner size={13} /> : <IconSparkle size={15} />}
								General knowledge
								<span className="chip-state">{store.settings.generalKnowledge ? 'On' : 'Off'}</span>
							</button>
						</Tooltip>
					</div>
					<Tooltip content={sendLabel} side="top">
						<button type="button" className="send" aria-label={sendLabel} aria-disabled={!canSend} onClick={send} data-ready={canSend || undefined}>
							{store.busy ? <Spinner size={16} /> : <IconArrowUp size={18} />}
						</button>
					</Tooltip>
				</div>
			</div>
			<p id={hintId} className="composer-hint">
				{(store.current ? store.current.temporary : store.temporaryMode)
					? 'Temporary chat: not saved, and follow-ups won’t remember earlier questions.'
					: 'Answers cite their pages. Check anything important against the original document.'}
			</p>
			<Popover anchor={docsAnchor} open={docsOpen} onClose={() => setDocsOpen(false)} labelledBy={docsTitle} side="top" align="start" className="docs-popover">
				<h2 id={docsTitle} className="popover-title">Answers use these documents</h2>
				{enabled.length ? (
					<ul className="docs-mini">
						{enabled.map(d => <li key={d.id}><IconBook size={14} /> {d.title}</li>)}
					</ul>
				) : <p className="popover-text">No documents are switched on, so answers can only come from general knowledge.</p>}
				{store.docs.length > enabled.length && <p className="popover-text">{store.docs.length - enabled.length} more in your library {store.docs.length - enabled.length === 1 ? 'is' : 'are'} switched off.</p>}
				<Button size="sm" variant="secondary" onClick={() => { setDocsOpen(false); store.navigate({ name: 'library' }); }}>Manage library</Button>
			</Popover>
		</div>
	);
});
