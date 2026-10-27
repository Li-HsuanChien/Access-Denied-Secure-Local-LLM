export interface HostError { code: string; message: string; hint: string }
export interface HealthStatus {
	api_version: string;
	status: 'ok' | 'degraded';
	ready: boolean;
	answering: { ready: boolean; error?: HostError | null; stub?: boolean };
	library: { ready: boolean; document_count: number; chunk_count: number; active_version: string | null; embedding_model: string | null };
}
/** One page a citation touches, with the geometry needed to highlight the sentence (PDF points, top-left origin). */
export interface CitationPage {
	page_number: number;
	highlight_rects: number[][];
	coordinates_reliable: boolean;
	page_width: number;
	page_height: number;
}
export interface Citation {
	citation_id: string; document_id: string; document_title: string; source_filename: string | null;
	page_start: number; page_end: number; pages: CitationPage[]; quote: string;
}
export interface Answer {
	schema_version: '1.0.0'; request_id: string; question: string;
	status: 'answered' | 'insufficient_evidence' | 'failed';
	evidence_mode: 'text' | 'visual' | 'none';
	documents: { text: string; citation_ids: string[] }[];
	general_knowledge: string | null; limitations: string[]; citations: Citation[];
	warnings: { code: string; message: string }[]; error: HostError | null;
	collection_version: string | null;
}
/** The answering feature's public seam; adapters own transport and wire types. */
export interface AnsweringClient {
	health(): Promise<HealthStatus>;
	/** `conversationId` threads the turn into a chat room's memory; omit it for a one-off question. */
	ask(question: string, generalKnowledge: boolean, conversationId?: string): Promise<Answer>;
	/** Cached source PDF bytes for a cited document, for the in-app viewer (ADR 0006). */
	fetchSource(documentId: string, version?: string | null): Promise<ArrayBuffer>;
}
