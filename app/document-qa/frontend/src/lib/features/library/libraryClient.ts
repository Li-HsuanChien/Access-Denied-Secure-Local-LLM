import { workflowRequest } from '../workflowTransport';

export interface FileReview { review_id: string; accepted: { name: string; size: number }[]; rejected: { name: string; reason: string }[]; warning: string | null; requires_confirmation: boolean }
export interface CollectionVersion { version_id: string; status: string; created_at: string; document_count: number; chunk_count: number; documents: { document_id: string; source_filename: string | null; display_title: string | null; page_count: number | null; enabled: boolean }[] }
/** A named set of active documents. Its on/off status is derived: on only when every member is on. */
export interface DocumentGroup { group_id: string; name: string; document_ids: string[] }
export interface LibraryClient {
	review(files: { name: string; data: string }[]): Promise<FileReview>;
	publish(reviewId: string, confirmed: boolean, requestId: string): Promise<{ version_id: string; document_count: number; chunk_count: number }>;
	cancel(requestId: string): Promise<boolean>;
	status(requestId: string): Promise<{ status: string; stage: string; done: number; total: number; error?: string } | null>;
	versions(): Promise<{ active: string | null; versions: CollectionVersion[]; groups?: DocumentGroup[] }>;
	setDocumentEnabled(versionId: string, documentId: string, enabled: boolean): Promise<{ enabled: boolean }>;
	deleteDocument(versionId: string, documentId: string, confirmed: boolean): Promise<{ deleted: boolean; version_id: string }>;
	rollback(): Promise<{ version_id: string }>;
	setDocumentsEnabled(versionId: string, documentIds: string[], enabled: boolean): Promise<{ enabled: boolean }>;
	saveGroup(groupId: string | null, name: string, documentIds: string[]): Promise<{ group: DocumentGroup }>;
	deleteGroup(groupId: string): Promise<{ deleted: boolean }>;
}
export function createLibraryClient(): LibraryClient {
	return {
		review: (files) => workflowRequest('library.review', { files }),
		publish: (reviewId, confirmed, requestId) => workflowRequest('library.publish', { review_id: reviewId, confirmed }, requestId),
		cancel: async (requestId) => (await workflowRequest<{ cancelled: boolean }>('library.cancel', { target_request_id: requestId })).cancelled,
		status: (requestId) => workflowRequest('library.status', { target_request_id: requestId }),
		versions: () => workflowRequest('library.versions'),
		setDocumentEnabled: (versionId, documentId, enabled) => workflowRequest('library.set_document_enabled', { version_id: versionId, document_id: documentId, enabled }),
		deleteDocument: (versionId, documentId, confirmed) => workflowRequest('library.delete_document', { version_id: versionId, document_id: documentId, confirmed }),
		rollback: () => workflowRequest('library.rollback'),
		setDocumentsEnabled: (versionId, documentIds, enabled) => workflowRequest('library.set_documents_enabled', { version_id: versionId, document_ids: documentIds, enabled }),
		saveGroup: (groupId, name, documentIds) => workflowRequest('library.save_group', { ...(groupId ? { group_id: groupId } : {}), name, document_ids: documentIds }),
		deleteGroup: (groupId) => workflowRequest('library.delete_group', { group_id: groupId })
	};
}
