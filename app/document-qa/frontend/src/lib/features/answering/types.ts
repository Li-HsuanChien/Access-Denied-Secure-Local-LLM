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
	document_id: string; chunk_ids: string[]; char_start: number; char_end: number;
	text_checksum_sha256: string; evidence_type: 'text' | 'visual'; score: number; rank: number;
	pages: {
		page_number: number; page_char_start: number; page_char_end: number;
		highlight_rects: [number, number, number, number][]; coordinates_reliable: boolean;
		page_width: number; page_height: number;
	}[];
}
export interface Answer {
	schema_version: '1.0.0'; request_id: string; question: string;
	status: 'answered' | 'insufficient_evidence' | 'failed';
	evidence_mode: 'text' | 'visual' | 'none';
	documents: { text: string; citation_ids: string[] }[];
	general_knowledge: string | null; limitations: string[]; citations: Citation[];
	warnings: { code: string; message: string }[]; error: HostError | null;
	evidence: {
		citation_id: string; chunk_id: string; document_id: string; page_start: number;
		page_end: number; score: number; rank: number; cited: boolean;
	}[];
	model: {
		model_id: string; name: string; quant: string | null; api_version: string | null;
		runtime_version: string | null; stub: boolean;
	} | null;
	collection_version: string | null; prompt_version: string;
	timing: {
		retrieval_ms: number; generation_ms: number; total_ms: number; attempts: number;
		prompt_tokens: number | null; completion_tokens: number | null;
	};
}
/** The answering feature's public seam; adapters own transport and wire types. */
export interface AnsweringClient {
	health(): Promise<HealthStatus>;
	ask(question: string, generalKnowledge: boolean): Promise<Answer>;
}
