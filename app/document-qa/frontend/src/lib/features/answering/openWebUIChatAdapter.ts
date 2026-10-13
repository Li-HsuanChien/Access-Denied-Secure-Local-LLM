import { createAnsweringClient } from './answeringClient';
import type { Answer, AnsweringClient } from './types';

export const SECURE_QA_MODEL_ID = 'secure-qa-local';

/** Turn the validated workflow result into Markdown rendered by Open WebUI's Messages view. */
export function formatAnswerForChat(answer: Answer): string {
	const sections: string[] = [];
	const citations = new Map(answer.citations.map((citation) => [citation.citation_id, citation]));

	if (answer.status === 'failed') {
		sections.push(`> **The answer could not be completed.** ${answer.error?.message ?? 'The local workflow failed.'}`);
		if (answer.error?.hint) sections.push(`_${answer.error.hint}_`);
	}
	if (answer.status === 'insufficient_evidence') {
		sections.push('> **There is not enough evidence in this library to answer this question.**');
	}

	if (answer.documents.length > 0) {
		sections.push(`### From your documents\n\n${answer.documents.map((claim) => {
			const refs = claim.citation_ids.map((id) => {
				const citation = citations.get(id);
				return citation ? `[^${id}]` : '';
			}).filter(Boolean).join(' ');
			return `${claim.text}${refs ? ` ${refs}` : ''}`;
		}).join('\n\n')}`);
	}

	if (answer.general_knowledge) {
		sections.push(`### General model knowledge\n\n${answer.general_knowledge}\n\n_Not verified against your documents._`);
	}

	if (answer.limitations.length > 0) {
		sections.push(`### Limitations\n\n${answer.limitations.map((item) => `- ${item}`).join('\n')}`);
	}

	if (answer.warnings.length > 0) {
		sections.push(`> **Warnings**\n> ${answer.warnings.map((warning) => warning.message).join('\n> ')}`);
	}

	return sections.join('\n\n') || 'The local workflow returned no answer content.';
}

/** Shape checked citations for Open WebUI's native expandable source panel. */
export function toOpenWebUICitations(answer: Answer) {
	return answer.citations.map((citation) => ({
		source: { id: citation.citation_id, name: citation.document_title },
		document: [citation.quote],
		metadata: [{
			source: citation.citation_id,
			name: `${citation.document_title} · ${citation.page_start === citation.page_end ? `p. ${citation.page_start}` : `pp. ${citation.page_start}–${citation.page_end}`}`,
			page: citation.page_start - 1,
			page_end: citation.page_end
		}]
	}));
}

export function createOpenWebUIAnsweringAdapter(client: AnsweringClient = createAnsweringClient()) {
	return {
		ask: (question: string, generalKnowledge: boolean) => client.ask(question, generalKnowledge)
	};
}

export { createAnsweringClient };
