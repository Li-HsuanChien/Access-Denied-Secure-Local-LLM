import { useId, useState } from 'react';
import type { Citation } from '$lib/features/answering/types';
import { COLLECTION_VERSION, type Conversation, type Message } from '../../data/samples';
import { useStore } from '../../store';
import { IconAlert, IconBook, IconCheck, IconCopy, IconInfo, IconRefresh, IconSparkle } from '../../ui/icons';
import { Popover } from '../../ui/overlay';
import { Button, IconButton, pageLabel } from '../../ui/primitives';
import { CitationPopover } from './CitationPopover';
import { Prose, plainText } from './Prose';

type Assistant = Extract<Message, { role: 'assistant' }>;

export function UserMessage({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="msg msg-user">
			<div className="bubble">{text}</div>
			<div className="msg-actions msg-actions-user">
				<IconButton size="sm" label={copied ? 'Copied' : 'Copy question'} icon={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={() => copy(text, setCopied)} />
			</div>
		</div>
	);
}

function copy(text: string, done: (v: boolean) => void) {
	void navigator.clipboard?.writeText(text).catch(() => undefined);
	done(true);
	window.setTimeout(() => done(false), 1600);
}

const PHASE_TEXT = {
	searching: 'Searching your documents',
	reading: (n?: number) => `Reading ${n ?? 'the most relevant'} passages`,
	writing: 'Writing the answer',
};

export function AssistantMessage({ message, conversation, isLast }: { message: Assistant; conversation: Conversation; isLast: boolean }) {
	const store = useStore();
	const [open, setOpen] = useState<{ index: number; anchor: HTMLElement } | null>(null);
	const [sourcesOpen, setSourcesOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const [detailsAnchor, setDetailsAnchor] = useState<HTMLElement | null>(null);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const sourcesId = useId();
	const detailsTitle = useId();

	if (message.state === 'pending') {
		const text = message.phase === 'reading' ? PHASE_TEXT.reading(message.passages) : PHASE_TEXT[message.phase ?? 'searching'];
		return (
			<div className="msg msg-assistant">
				<div className="thinking" role="status" aria-live="polite">
					<span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
					<span className="thinking-text">{text}…</span>
				</div>
			</div>
		);
	}

	if (message.state === 'failed') {
		return (
			<div className="msg msg-assistant">
				<div className="callout callout-error" role="alert">
					<IconAlert size={18} />
					<div>
						<p><strong>No answer this time.</strong> {message.error} Your question is still above.</p>
						<Button size="sm" variant="secondary" icon={<IconRefresh size={15} />} onClick={() => store.retry(conversation.id, message.id)} disabled={store.busy}>Try again</Button>
					</div>
				</div>
			</div>
		);
	}

	const reply = message.reply!;
	const citations = reply.citations;
	const cite = (index: number, key: string) => {
		const c = citations[index];
		if (!c) return null;
		const expanded = open?.index === index;
		return (
			<button
				key={key}
				type="button"
				className="cite"
				aria-haspopup="dialog"
				aria-expanded={expanded}
				aria-label={`Source ${index + 1}: ${c.document_title}, ${pageLabel(c.page_start, c.page_end)}`}
				data-open={expanded || undefined}
				onClick={e => {
					const anchor = e.currentTarget;
					setOpen(o => (o?.index === index && o.anchor === anchor ? null : { index, anchor }));
				}}
			>
				{index + 1}
			</button>
		);
	};

	const basis = {
		documents: { icon: <IconBook size={16} />, label: 'Based on your documents' },
		general: { icon: <IconSparkle size={16} />, label: 'General knowledge · no supporting documents' },
		none: { icon: <IconInfo size={16} />, label: 'No supporting documents' },
	}[reply.basis];

	const offerGeneral = reply.basis === 'none' && isLast && !store.settings.generalKnowledge;

	return (
		<article className="msg msg-assistant" data-basis={reply.basis} aria-label={basis.label}>
			<p className="basis">{basis.icon}<span>{basis.label}</span></p>
			<Prose text={reply.text} renderCitation={cite} />

			{reply.warnings.map(w => (
				<p key={w.code} className="callout callout-warn"><IconAlert size={16} /><span>{w.message}</span></p>
			))}

			{offerGeneral && (
				<Button size="sm" variant="secondary" icon={<IconSparkle size={15} />} disabled={store.busy} onClick={async () => {
					if (await store.updateSetting('generalKnowledge', true)) store.retry(conversation.id, message.id);
				}}>Turn on general knowledge and ask again</Button>
			)}

			{message.save === 'failed' && (
				<p className="callout callout-warn" role="status">
					<IconAlert size={16} />
					<span>This answer wasn’t saved to history. It stays here until you leave this chat.</span>
					<button type="button" className="link-btn" onClick={() => void store.retrySave(conversation.id, message.id)}>Save again</button>
				</p>
			)}

			<div className="msg-foot" data-visible={isLast || undefined}>
				<div className="msg-actions">
					<IconButton size="sm" label={copied ? 'Copied' : 'Copy answer'} icon={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={() => copy(plainText(reply.text, citations), setCopied)} />
					<IconButton size="sm" label="Ask again" icon={<IconRefresh size={16} />} disabled={store.busy || store.scenario.model !== 'ready'} onClick={() => store.retry(conversation.id, message.id)} />
					<IconButton size="sm" ref={setDetailsAnchor} label="Answer details" icon={<IconInfo size={16} />} aria-haspopup="dialog" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(o => !o)} />
				</div>
				{citations.length > 0 && (
					<button type="button" className="sources-toggle" aria-expanded={sourcesOpen} aria-controls={sourcesId} onClick={() => setSourcesOpen(o => !o)}>
						<IconBook size={15} />
						{sourceSummary(citations)}
					</button>
				)}
			</div>

			{citations.length > 0 && sourcesOpen && (
				<ol id={sourcesId} className="sources-list">
					{citations.map((c, i) => (
						<li key={c.citation_id}>
							<button type="button" className="source-row" aria-haspopup="dialog" onClick={e => { const anchor = e.currentTarget; setOpen({ index: i, anchor }); }}>
								<span className="cite cite-static" aria-hidden="true">{i + 1}</span>
								<span className="source-row-title">{c.document_title}</span>
								<span className="source-row-pages">{pageLabel(c.page_start, c.page_end)}</span>
							</button>
						</li>
					))}
				</ol>
			)}

			<CitationPopover key={open ? `${open.index}` : "closed"} citation={open ? citations[open.index] : null} index={open?.index ?? 0} anchor={open?.anchor ?? null} onClose={() => setOpen(null)} />

			<Popover anchor={detailsAnchor} open={detailsOpen} onClose={() => setDetailsOpen(false)} labelledBy={detailsTitle} side="top" align="start" className="details-popover">
				<h2 id={detailsTitle} className="popover-title">Answer details</h2>
				<dl className="status-list">
					<div><dt>Model</dt><dd>{reply.answer.model?.name} · {reply.answer.model?.quant}</dd></div>
					<div><dt>Time</dt><dd>{(reply.answer.timing.total_ms / 1000).toFixed(1)} seconds</dd></div>
					<div><dt>Passages used</dt><dd>{reply.answer.evidence.length || 'None'}</dd></div>
					<div><dt>Library version</dt><dd>{reply.answer.collection_version ?? COLLECTION_VERSION}</dd></div>
					<div><dt>Saved</dt><dd>{saveLabel(message.save)}</dd></div>
				</dl>
			</Popover>
		</article>
	);
}

function sourceSummary(citations: Citation[]): string {
	const docs = new Set(citations.map(c => c.document_id)).size;
	return `${citations.length} ${citations.length === 1 ? 'source' : 'sources'} · ${docs} ${docs === 1 ? 'document' : 'documents'}`;
}

function saveLabel(save: Assistant['save']): string {
	switch (save) {
		case 'saved': return 'In history on this computer';
		case 'failed': return 'Not saved';
		case 'off': return 'No, history is off';
		case 'temporary': return 'No, temporary chat';
		default: return '—';
	}
}
