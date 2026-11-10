/*
 * SAMPLE DATA — fictional documents, answers and conversations for UI review.
 * Answers are typed with the production wire schema (`Answer`, `Citation`) so the
 * prototype exercises the same fields the backend already returns.
 */
import type { Answer, Citation } from '$lib/features/answering/types';
import manifest from './sample-manifest.json';

export type Basis = 'documents' | 'general' | 'none';

export interface LibraryDoc {
	id: string;
	title: string;
	filename: string;
	pages: number;
	size: number;
	addedAt: number;
	enabled: boolean;
	/** Where the bytes come from: a bundled sample URL or an in-memory file chosen in this session. */
	source: { kind: 'url'; url: string } | { kind: 'memory'; data: ArrayBuffer };
	isNew?: boolean;
}

export interface Reply {
	basis: Basis;
	/** Presentation text with [n] citation markers; the validated payload stays in `answer`. */
	text: string;
	citations: Citation[];
	warnings: { code: string; message: string }[];
	answer: Answer;
}

export type Phase = 'searching' | 'reading' | 'writing';

export type Message =
	| { id: string; role: 'user'; text: string }
	| {
			id: string;
			role: 'assistant';
			question: string;
			state: 'pending' | 'done' | 'failed';
			phase?: Phase;
			passages?: number;
			reply?: Reply;
			error?: string;
			save?: 'saved' | 'failed' | 'off' | 'temporary';
	  };

export interface Conversation {
	id: string;
	title: string;
	updatedAt: number;
	temporary: boolean;
	saved: boolean;
	messages: Message[];
}

export const MODEL = { model_id: 'qwen3-4b-q4_k_m', name: 'Qwen3-4B', quant: 'Q4_K_M', api_version: '2026-09-v1', runtime_version: 'b6431', stub: false };
export const COLLECTION_VERSION = 'lib-2026-10-21';

type ManifestCitation = (typeof manifest.citations)[keyof typeof manifest.citations];
const citationData = manifest.citations as Record<string, ManifestCitation>;
const documentData = manifest.documents as Record<string, { title: string; file: string; pages: number; size: number }>;

const DAY = 86_400_000;
const now = Date.now();

const ADDED: Record<string, number> = {
	'maintenance-handbook': now - 38 * DAY,
	'radiation-protection-guide': now - 38 * DAY,
	'annual-report-2024': now - 20 * DAY,
	'spent-fuel-checklist': now - 20 * DAY,
	'emergency-plan-2019': now - 59 * DAY,
};

export function sampleLibrary(): LibraryDoc[] {
	return Object.entries(documentData).map(([id, doc]) => ({
		id,
		title: doc.title,
		filename: doc.file,
		pages: doc.pages,
		size: doc.size,
		addedAt: ADDED[id] ?? now,
		enabled: id !== 'emergency-plan-2019',
		source: { kind: 'url', url: `./samples/${doc.file}` },
	}));
}

function cite(key: string, index: number): Citation {
	const c = citationData[key];
	const doc = documentData[c.document];
	return {
		citation_id: `c${index}-${key}`,
		document_title: doc.title,
		source_filename: doc.file,
		page_start: c.page_start,
		page_end: c.page_end,
		quote: c.quote,
		document_id: c.document,
		chunk_ids: [`${c.document}:p${c.page_start}:${key}`],
		char_start: 0,
		char_end: c.quote.length,
		text_checksum_sha256: '',
		evidence_type: 'text',
		score: Math.max(0.4, 0.86 - index * 0.06),
		rank: index,
		pages: c.pages.map(page => ({
			...page,
			highlight_rects: page.highlight_rects as [number, number, number, number][],
			page_char_start: 0,
			page_char_end: c.quote.length,
		})),
	};
}

interface Script {
	basis: Basis;
	text: string;
	cites?: string[];
	warnings?: { code: string; message: string }[];
	seconds: number;
}

const SCRIPTS = {
	pumps: {
		basis: 'documents',
		cites: ['pump-30-day', 'pump-18-month', 'pump-log'],
		seconds: 11.4,
		text: `The primary coolant pumps are on two schedules:

- **Every 30 days** of normal operation: a visual and vibration check [1].
- **Every 18 months**: a full mechanical inspection, including seals and bearings, timed to the planned outage [2].

There's also a trigger outside the schedule. If vibration climbs more than 20% above the recorded baseline, the pump must be inspected within **72 hours** instead of waiting for the next check [1]. The monthly spent fuel pool checklist relies on this too: inspectors confirm the pump log was reviewed and signed in the past 30 days before they sign off [3].`,
	},
	training: {
		basis: 'documents',
		cites: ['training-course', 'dosimeter', 'visitors'],
		seconds: 13.2,
		text: `Three things need to be in place before someone's first entry into a controlled area:

- **The initial radiation safety course** — eight hours, with a written assessment passed at 80% or higher [1].
- **A current annual refresher.** The qualification lapses without it [1].
- **A personal dosimeter**, issued and logged at the access point before each entry [2].

Visitors are the exception. They can enter without the course, but only with a qualified escort the entire time and after a safety briefing at the access point [3].`,
	},
	dose: {
		basis: 'documents',
		cites: ['dose-rise', 'dose-limit', 'outage-extended'],
		seconds: 14.8,
		warnings: [{ code: 'citation_withheld', message: "One sentence was left out because its citation couldn't be matched to your documents." }],
		text: `Your documents confirm the rise, but they don't explain it.

According to the 2024 annual report, the average annual dose for monitored workers went from **0.42 mSv in 2023 to 0.61 mSv in 2024** — roughly a 45% increase [1]. Every individual dose stayed below the facility's administrative limit of 5 mSv [2].

I couldn't find a stated reason in any of your documents. The same report notes that the 2024 maintenance outage ran six weeks longer than planned [3]. More maintenance work could plausibly mean more exposure, but the report doesn't connect the two, so treat that as a lead to check rather than an answer.`,
	},
	cobalt: {
		basis: 'general',
		seconds: 6.1,
		text: `Cobalt-60 has a half-life of about **5.27 years**. It decays by beta emission to nickel-60, which then releases two gamma rays at roughly 1.17 and 1.33 MeV — the reason it's widely used for radiotherapy, industrial radiography and sterilisation.

None of your documents mention cobalt-60, so this comes from the model's general knowledge rather than your library. It's a well-established figure, but confirm it against an authoritative reference if you need it for a record.`,
	},
	pool: {
		basis: 'documents',
		cites: ['pool-monthly', 'pool-signoff'],
		seconds: 9.7,
		text: `The spent fuel pool checklist is completed **once a month**, and again after any event that could affect pool water level or chemistry [1].

If any item isn't satisfied, it has to be reported to the shift supervisor before the form is filed, and the supervisor records what was done about it [2].`,
	},
	summary: {
		basis: 'documents',
		cites: ['operating-days', 'outage-extended', 'no-events', 'dose-rise', 'dose-limit'],
		seconds: 16.3,
		text: `Here's the short version of the 2024 annual report:

- **Less operating time.** The reactor ran 214 days, down from 251 in 2023 [1], mostly because the maintenance outage was extended by six weeks to replace the secondary heat exchanger [2].
- **No reportable safety events.** Two minor equipment faults were fixed during scheduled maintenance [3].
- **Higher average worker dose** — 0.61 mSv, up from 0.42 mSv — but still well under the 5 mSv administrative limit [4] [5].`,
	},
	drills: {
		basis: 'documents',
		cites: ['drills'],
		seconds: 8.2,
		text: `According to the 2019 draft emergency plan, building evacuation drills happen **at least twice a year**, and one of them is unannounced [1].

That plan is marked as superseded pending revision, so check whether a newer version changes the schedule.`,
	},
	vibration: {
		basis: 'documents',
		cites: ['pump-30-day'],
		seconds: 7.9,
		text: `An extra inspection is triggered when pump vibration is **more than 20% above the recorded baseline**. When that happens, the pump has to be inspected within 72 hours [1].`,
	},
} satisfies Record<string, Script>;

type ScriptKey = keyof typeof SCRIPTS;

const NONE_TEXT = (topic: string) => `I couldn't find anything about ${topic} in your documents, and general knowledge is turned off, so I can't answer this one.

If you expected it to be covered, check that the right document is in your Library and switched on. Or turn on general knowledge to get an answer that's clearly labeled as not coming from your documents.`;

const PROTOTYPE_GENERAL = (question: string) => `*(Prototype placeholder)* None of the sample documents cover “${question.trim().slice(0, 80)}”, so the local model would answer here from its general knowledge, labeled exactly like this and without citations.

Try one of the suggested questions to see document-backed answers with citations.`;

export const SUGGESTIONS: { label: string; question: string; hint: string }[] = [
	{ label: 'Pump inspections', question: 'How often do the primary coolant pumps need to be inspected?', hint: 'Answer from documents' },
	{ label: 'Before entering', question: 'What training does someone need before entering a controlled area?', hint: 'Answer from documents' },
	{ label: 'Dose readings', question: 'Why did worker dose readings go up in 2024?', hint: 'Partial evidence' },
	{ label: 'Cobalt-60', question: 'What is the half-life of cobalt-60?', hint: 'General knowledge' },
];

const ROUTES: [RegExp, ScriptKey][] = [
	[/vibration/i, 'vibration'],
	[/pump|coolant/i, 'pumps'],
	[/train|controlled area|dosimet|visitor|escort/i, 'training'],
	[/dose|exposure|msv/i, 'dose'],
	[/cobalt|half[- ]life/i, 'cobalt'],
	[/pool|spent fuel|checklist/i, 'pool'],
	[/summar|annual report|2024 report/i, 'summary'],
	[/drill|evacuat|emergenc/i, 'drills'],
];

function build(question: string, basis: Basis, text: string, citations: Citation[], warnings: Reply['warnings'], seconds: number, limitations: string[] = []): Reply {
	const total = Math.round(seconds * 1000);
	const answer: Answer = {
		schema_version: '1.0.0',
		request_id: `req-${Math.random().toString(36).slice(2, 10)}`,
		question,
		status: basis === 'none' ? 'insufficient_evidence' : 'answered',
		evidence_mode: basis === 'documents' ? 'text' : 'none',
		documents: basis === 'documents' ? [{ text: text.replace(/\s*\[\d+\]/g, ''), citation_ids: citations.map(c => c.citation_id) }] : [],
		general_knowledge: basis === 'general' ? text : null,
		limitations,
		citations,
		warnings,
		error: null,
		evidence: citations.map(c => ({ citation_id: c.citation_id, chunk_id: c.chunk_ids[0], document_id: c.document_id, page_start: c.page_start, page_end: c.page_end, score: c.score, rank: c.rank, cited: true })),
		model: MODEL,
		collection_version: COLLECTION_VERSION,
		prompt_version: 'answer-v7',
		timing: { retrieval_ms: Math.round(total * 0.08), generation_ms: Math.round(total * 0.92), total_ms: total, attempts: warnings.length ? 2 : 1, prompt_tokens: 1840, completion_tokens: 212 },
	};
	return { basis, text, citations, warnings, answer };
}

export function scripted(key: ScriptKey, question: string): Reply {
	const s: Script = SCRIPTS[key];
	const citations = (s.cites ?? []).map((k, i) => cite(k, i + 1));
	return build(question, s.basis, s.text, citations, s.warnings ?? [], s.seconds, key === 'dose' ? ['The documents do not state a cause for the increase.'] : []);
}

/** Simulated retrieval: a scripted answer is used only if every document it cites is enabled. */
export function route(question: string, generalKnowledge: boolean, enabledDocs: Set<string>): Reply {
	const match = ROUTES.find(([pattern]) => pattern.test(question));
	if (match) {
		const reply = scripted(match[1], question);
		const supported = reply.basis !== 'documents' || reply.citations.every(c => enabledDocs.has(c.document_id));
		if (supported && reply.basis === 'documents') return reply;
		if (supported && reply.basis === 'general' && generalKnowledge) return reply;
	}
	const topic = match?.[1] === 'cobalt' ? 'cobalt-60' : 'this';
	if (!generalKnowledge) return build(question, 'none', NONE_TEXT(topic), [], [], 4.2, ['No passage met the relevance threshold.']);
	if (match?.[1] === 'cobalt') return scripted('cobalt', question);
	return build(question, 'general', PROTOTYPE_GENERAL(question), [], [], 5.4);
}

let counter = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function thread(id: string, title: string, ago: number, turns: [string, ScriptKey][]): Conversation {
	const messages: Message[] = [];
	for (const [question, key] of turns) {
		messages.push({ id: uid('m'), role: 'user', text: question });
		messages.push({ id: uid('m'), role: 'assistant', question, state: 'done', reply: scripted(key, question), save: 'saved' });
	}
	return { id, title, updatedAt: now - ago, temporary: false, saved: true, messages };
}

const HOUR = 3_600_000;
export function sampleConversations(): Conversation[] {
	return [
		thread('c-pumps', 'Coolant pump inspection schedule', 1_500_000, [
			['How often do the primary coolant pumps need to be inspected?', 'pumps'],
			['What vibration level triggers an extra inspection?', 'vibration'],
		]),
		thread('c-training', 'Training before controlled-area entry', 3_000_000, [['What training does someone need before entering a controlled area?', 'training']]),
		thread('c-dose', 'Why worker dose went up in 2024', 1 * DAY + 3 * HOUR, [['Why did worker dose readings go up in 2024?', 'dose']]),
		thread('c-cobalt', 'Cobalt-60 half-life', 3 * DAY, [['What is the half-life of cobalt-60?', 'cobalt']]),
		thread('c-pool', 'Spent fuel pool checks', 5 * DAY, [['How often is the spent fuel pool checklist completed?', 'pool']]),
		thread('c-summary', '2024 annual report in brief', 12 * DAY, [['Summarize the 2024 annual report', 'summary']]),
		thread('c-drills', 'Evacuation drill frequency', 20 * DAY, [['How often are evacuation drills held?', 'drills']]),
		thread('c-vibration', 'Pump vibration limits', 41 * DAY, [['What vibration level triggers an extra pump inspection?', 'vibration']]),
	];
}

export function titleFrom(question: string): string {
	const clean = question.replace(/\s+/g, ' ').replace(/[?.!]+$/, '').trim();
	return clean.length > 48 ? `${clean.slice(0, 46).trimEnd()}…` : clean || 'New chat';
}
