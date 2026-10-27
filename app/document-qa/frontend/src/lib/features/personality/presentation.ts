/** Shared voice and status labels for the local document research workspace. */
export const workspaceVoice = {
	brand: 'Access Denied',
	chatTitle: 'Chat · Access Denied',
	privateWorkspace: 'Private workspace',
	askPlaceholder: 'Ask a question about your library…',
	emptyTitle: 'Start with a question',
	emptyDescription: 'Ask about a document, a figure, or a detail in your library.',
	loading: 'Checking your library and preparing an answer…',
	answerReady: 'Answer ready.',
	insufficientEvidence: 'The library does not contain enough evidence to answer this.',
	generalKnowledgeLabel: 'General model knowledge',
	generalKnowledgeNotice: 'Not checked against your library.',
	uncertaintyLabel: 'Limits and uncertainty',
	serviceUnavailable: 'The local service is unavailable. Start it, then try again.',
	answerFailed: 'The answer could not be completed. Your question is still here; check the local service and retry.',
} as const;

export type EvidenceKind = 'document' | 'general' | 'uncertain' | 'warning' | 'error';

/** Stable semantic hook for color and icon treatment; meaning never depends on color alone. */
export function evidenceKindLabel(kind: EvidenceKind): string {
	return {
		document: 'From your documents',
		general: workspaceVoice.generalKnowledgeLabel,
		uncertain: workspaceVoice.uncertaintyLabel,
		warning: 'Review this warning',
		error: 'Action needed',
	}[kind];
}
