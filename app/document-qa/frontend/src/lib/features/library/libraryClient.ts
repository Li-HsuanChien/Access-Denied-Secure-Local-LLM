import { workflowRequest } from '../workflowTransport';

export interface FileReview { review_id: string; accepted: { name: string; size: number }[]; rejected: { name: string; reason: string }[]; warning: string | null; requires_confirmation: boolean }
export interface CollectionVersion { version_id: string; status: string; created_at: string; document_count: number; chunk_count: number }
export interface LibraryClient {
	review(files: { name: string; data: string }[]): Promise<FileReview>;
	publish(reviewId: string, confirmed: boolean, requestId: string): Promise<{ version_id: string; document_count: number; chunk_count: number }>;
	cancel(requestId: string): Promise<boolean>;
	status(requestId: string): Promise<{ status: string; stage: string; done: number; total: number; error?: string } | null>;
	versions(): Promise<{ active: string | null; versions: CollectionVersion[] }>;
	rollback(): Promise<{ version_id: string }>;
}
export function createLibraryClient(): LibraryClient {
	return {
		review: (files) => workflowRequest('library.review', { files }),
		publish: (reviewId, confirmed, requestId) => workflowRequest('library.publish', { review_id: reviewId, confirmed }, requestId),
		cancel: async (requestId) => (await workflowRequest<{ cancelled: boolean }>('library.cancel', { target_request_id: requestId })).cancelled,
		status: (requestId) => workflowRequest('library.status', { target_request_id: requestId }),
		versions: () => workflowRequest('library.versions'),
		rollback: () => workflowRequest('library.rollback')
	};
}
