export interface HostError { code: string; message: string; hint: string }
export interface HealthStatus {
	api_version: string;
	status: 'ok' | 'degraded';
	ready: boolean;
	answering: { ready: boolean; error?: HostError | null; stub?: boolean };
	library: { ready: boolean; document_count: number; chunk_count: number; active_version: string | null; embedding_model: string | null };
}
export interface Citation {
	citation_id: string; document_title: string; source_filename: string | null;
	page_start: number; page_end: number; quote: string;
}
export interface Answer {
	schema_version: '1.0.0'; request_id: string; question: string;
	status: 'answered' | 'insufficient_evidence' | 'failed';
	evidence_mode: 'text' | 'visual' | 'none';
	documents: { text: string; citation_ids: string[] }[];
	general_knowledge: string | null; limitations: string[]; citations: Citation[];
	warnings: { code: string; message: string }[]; error: HostError | null;
}
/** The answering feature's public seam; adapters own transport and wire types. */
export interface AnsweringClient {
	health(): Promise<HealthStatus>;
	ask(question: string, generalKnowledge: boolean): Promise<Answer>;
}
