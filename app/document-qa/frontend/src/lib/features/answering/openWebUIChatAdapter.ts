import { createAnsweringClient } from './answeringClient';
import type { Answer, AnsweringClient } from './types';
import { createHistoryClient, type ConversationHistoryClient } from '../history/historyClient';
import { workspaceVoice } from '../personality/presentation';

export const SECURE_QA_MODEL_ID = 'secure-qa-local';

/** Turn the validated workflow result into Markdown rendered by Open WebUI's Messages view. */
export function formatAnswerForChat(answer: Answer): string {
	const sections: string[] = [];
	const citations = new Map(answer.citations.map((citation, index) => [citation.citation_id, index + 1]));

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
				return citation ? `[${citation}]` : '';
			}).filter(Boolean).join(' ');
			return `${claim.text}${refs ? ` ${refs}` : ''}`;
		}).join('\n\n')}`);
	}

	if (answer.general_knowledge) {
		sections.push(`### General model knowledge\n\n${answer.general_knowledge}\n\n_${workspaceVoice.generalKnowledgeNotice}_`);
	}

	if (answer.limitations.length > 0) {
		sections.push(`### ${workspaceVoice.uncertaintyLabel}\n\n${answer.limitations.map((item) => `- ${item}`).join('\n')}`);
	}

	if (answer.warnings.length > 0) {
		sections.push(`> **Warnings**\n> ${answer.warnings.map((warning) => warning.message).join('\n> ')}`);
	}

	return sections.join('\n\n') || 'The local workflow returned no answer content.';
}

/** Shape checked citations for Open WebUI's native expandable source panel.
 *  Carries our source locators (document id, version, page, highlight geometry) so the
 *  citation modal can open the cached PDF at the cited page and box the sentence (ADR 0006). */
export function toOpenWebUICitations(answer: Answer) {
	return answer.citations.map((citation) => {
		const page = citation.pages?.find((p) => p.page_number === citation.page_start) ?? citation.pages?.[0];
		return {
			source: { id: citation.citation_id, name: citation.document_title },
			document: [citation.quote],
			metadata: [{
				source: citation.citation_id,
				name: `${citation.document_title} · ${citation.page_start === citation.page_end ? `p. ${citation.page_start}` : `pp. ${citation.page_start}–${citation.page_end}`}`,
				page: citation.page_start - 1,
				page_end: citation.page_end,
				document_id: citation.document_id,
				version: answer.collection_version,
				highlight: {
					page: page?.page_number ?? citation.page_start,
					rects: page?.highlight_rects ?? [],
					page_width: page?.page_width ?? 0,
					page_height: page?.page_height ?? 0,
					reliable: page?.coordinates_reliable ?? false,
					quote: citation.quote
				}
			}]
		};
	});
}

/** Answer first; history failure must never discard an already validated answer. */
export function createOpenWebUIAnsweringAdapter(
    client: AnsweringClient = createAnsweringClient(),
    history: Pick<ConversationHistoryClient, 'save'> = createHistoryClient()
) {
    return {
        async ask(question: string, generalKnowledge: boolean, conversationId?: string) {
            const answer = await client.ask(question, generalKnowledge, conversationId);
            let historyWarning: string | null = null;
            // With a conversation id the host appends the turns itself (thread memory);
            // only the legacy one-off path saves from here.
            if (!conversationId) {
                try {
                    await history.save(answer.request_id, question, answer as unknown as Record<string, unknown>);
                } catch {
                    historyWarning = 'This answer is available here, but could not be saved to local history.';
                }
            }
            return { answer, historyWarning };
        }
    };
}
