import { useEffect, useRef, useState } from 'react';
import { SUGGESTIONS } from '../../data/samples';
import { useStore } from '../../store';
import { IconTemporary, IconUpload } from '../../ui/icons';
import { Button } from '../../ui/primitives';
import { AssistantMessage, UserMessage } from './Messages';
import { Composer } from './Composer';

export function ChatView() {
	const store = useStore();
	const { current, temporaryMode } = store;
	const scroller = useRef<HTMLDivElement>(null);
	const [announce, setAnnounce] = useState('');
	const messages = current?.messages ?? [];
	const last = messages[messages.length - 1];
	const lastState = last?.role === 'assistant' ? last.state : null;

	// Keep the newest turn in view as it arrives.
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
	}, [messages.length, lastState]);

	useEffect(() => {
		if (lastState === 'done') setAnnounce('Answer ready.');
		else if (lastState === 'failed') setAnnounce('The answer could not be completed.');
	}, [lastState, last?.id]);

	// Opening a different conversation starts at its latest answer.
	useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [current?.id]);

	if (!current) return <EmptyChat temporary={temporaryMode} />;

	return (
		<div className="chat">
			<div className="thread-scroll" ref={scroller}>
				<section className="thread" aria-label="Conversation">
					{messages.map((m, i) =>
						m.role === 'user'
							? <UserMessage key={m.id} text={m.text} />
							: <AssistantMessage key={m.id} message={m} conversation={current} isLast={i === messages.length - 1} />,
					)}
				</section>
			</div>
			<div className="chat-bottom">
				<Composer placeholder={current.temporary ? 'Ask a follow-up (not remembered)…' : 'Ask a follow-up…'} />
			</div>
			<p className="sr-only" aria-live="polite">{announce}</p>
		</div>
	);
}

function EmptyChat({ temporary }: { temporary: boolean }) {
	const store = useStore();
	const enabled = store.docs.filter(d => d.enabled).length;
	const ready = store.scenario.model === 'ready';
	return (
		<div className="chat chat-empty">
			<div className="hello">
				{temporary ? (
					<>
						<span className="hello-icon" aria-hidden="true"><IconTemporary size={22} /></span>
						<h1 className="hello-title">Temporary chat</h1>
						<p className="hello-sub">This chat won’t be saved to history, and follow-up questions won’t remember earlier ones.</p>
					</>
				) : (
					<>
						<h1 className="hello-title">What would you like to find out?</h1>
						<p className="hello-sub">
							{enabled > 0
								? <>I’ll answer from your {enabled} {enabled === 1 ? 'document' : 'documents'} and show you the page behind every claim.</>
								: <>No documents are switched on yet, so I can only answer from general knowledge.</>}
						</p>
					</>
				)}
				<Composer placeholder="Ask about your documents…" autoFocus />
				{enabled === 0 && !temporary && (
					<Button variant="secondary" icon={<IconUpload size={16} />} onClick={() => store.navigate({ name: 'library' })}>Add PDFs to your library</Button>
				)}
				{enabled > 0 && (
					<ul className="suggestions" aria-label="Suggested questions">
						{SUGGESTIONS.map(s => (
							<li key={s.question}>
								<button type="button" className="suggestion" disabled={!ready || store.busy} onClick={() => store.ask(s.question)}>
									<span className="suggestion-label">{s.label}</span>
									<span className="suggestion-q">{s.question}</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
