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
	/* Reading-room revamp copy. The host returns one result, so there is exactly one honest pending status. */
	homeTitle: 'What would you like to find out?',
	answerPending: 'Working on your answer…',
	basisDocuments: 'Based on your documents',
	basisGeneral: 'General knowledge · no supporting documents',
	basisNone: 'No supporting documents',
	localNote: 'Private and offline',
	localNoteDetail: 'Everything runs on this computer. Nothing is sent over a network.',
	openWebUiCredit: 'Built on Open WebUI',
	showDocumentPage: 'Show document page',
} as const;

export type AnswerBasis = 'documents' | 'general' | 'none';
/** The one basis label a response carries. */
export function answerBasisLabel(basis: AnswerBasis): string {
	return { documents: workspaceVoice.basisDocuments, general: workspaceVoice.basisGeneral, none: workspaceVoice.basisNone }[basis];
}

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
