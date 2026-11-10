import type { Answer } from '../../react-contracts';
import { readAnswer, readSavedAnswer } from '../../../../react/providers/history';
import { ClientError } from '../../answering/answeringClient';
import { parseTimestamp } from '../../design-system/react/primitives';

/**
 * History preview model built from the existing `history.open` result (no new host operation).
 * Every stored answer is validated against the backend answer schema before it is shown.
 */
export type AnswerBasis = 'documents' | 'general' | 'none';
export type PreviewTurn =
	| { kind: 'question'; text: string }
	| { kind: 'answer'; answer: Answer | null; text: string };
export interface HistoryPreview {
	conversation_id: string;
	title: string;
	updated_at: string;
	turns: PreviewTurn[];
	/** Lower-cased plain text of questions and answers, for client-side search. */
	searchText: string;
}

const invalid = () => new ClientError('invalid_response', 'The local service returned an incompatible response.');

/** Single-answer selection: document claims win; general knowledge only when no claim; otherwise none. */
export function basisOf(answer: Pick<Answer, 'documents' | 'general_knowledge'> | null): AnswerBasis {
	if (answer?.documents.length) return 'documents';
	if (answer?.general_knowledge) return 'general';
	return 'none';
}

/** Plain body text for the selected basis (never both document claims and general knowledge). */
export function answerText(answer: Answer | null, fallback = ''): string {
	if (!answer) return fallback;
	const basis = basisOf(answer);
	if (basis === 'documents') return answer.documents.map((claim) => claim.text).join(' ');
	if (basis === 'general') return answer.general_knowledge ?? '';
	return answer.error?.message || 'I couldn’t find enough evidence in your documents to answer this question.';
}

export function excerpt(text: string, n = 150): string {
	const plain = text.replace(/\s+/g, ' ').trim();
	return plain.length > n ? `${plain.slice(0, n).trimEnd()}…` : plain;
}

/** Validates an opened record. Threads use `messages`; legacy single-answer records use `answer`. */
export function readPreview(record: Record<string, unknown> | null): HistoryPreview | null {
	if (record === null) return null;
	let turns: PreviewTurn[];
	if (Array.isArray(record.messages)) {
		if (typeof record.conversation_id !== 'string' || typeof record.title !== 'string' || typeof record.updated_at !== 'string') throw invalid();
		if (record.answer != null) readAnswer(record.answer);
		turns = record.messages.map((value): PreviewTurn => {
			if (!value || typeof value !== 'object') throw invalid();
			const turn = value as Record<string, unknown>;
			if (typeof turn.content !== 'string') throw invalid();
			if (turn.role === 'user') return { kind: 'question', text: turn.content };
			if (turn.role !== 'assistant') throw invalid();
			return { kind: 'answer', answer: turn.answer == null ? null : readAnswer(turn.answer), text: turn.content };
		});
	} else {
		const saved = readSavedAnswer(record);
		if (!saved) return null;
		const answer = readAnswer(record.answer);
		turns = [{ kind: 'question', text: answer.question }, { kind: 'answer', answer, text: '' }];
	}
	const searchText = turns.map((turn) => turn.kind === 'question' ? turn.text : answerText(turn.answer, turn.text)).join('\n').toLowerCase();
	return {
		conversation_id: record.conversation_id as string, title: record.title as string,
		updated_at: record.updated_at as string, turns, searchText
	};
}

/** SQLite CURRENT_TIMESTAMP is UTC without a zone ("YYYY-MM-DD HH:MM:SS"); read it as UTC. */
/** History timestamps are SQLite UTC values; shared with the sidebar via the kit helper. */
export const parseStamp = parseTimestamp;

export function firstAnswerExcerpt(preview: HistoryPreview | undefined, n = 90): string {
	const turn = preview?.turns.find((t) => t.kind === 'answer');
	return turn && turn.kind === 'answer' ? excerpt(answerText(turn.answer, turn.text), n) : '';
}

/** Search hit snippet from loaded content, or '' when only the title matched / nothing is loaded. */
export function searchSnippet(preview: HistoryPreview | undefined, query: string): string | null {
	if (!preview) return null;
	const q = query.toLowerCase();
	for (const turn of preview.turns) {
		const text = turn.kind === 'question' ? turn.text : answerText(turn.answer, turn.text);
		const i = text.toLowerCase().indexOf(q);
		if (i >= 0) {
			const start = i > 40 ? text.indexOf(' ', i - 40) + 1 : 0;
			return `${start > 0 ? '…' : ''}${excerpt(text.slice(start), 110)}`;
		}
	}
	return null;
}
