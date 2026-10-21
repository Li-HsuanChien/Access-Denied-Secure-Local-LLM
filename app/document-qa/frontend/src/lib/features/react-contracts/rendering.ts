import type { Answer, Citation, Immutable } from './wire';
import type { AppPath } from './application';
import type { AssistantMessage } from './chat';

export interface ChatAnswerProps {
	readonly messageId: string;
	readonly content: string;
	readonly citations: readonly Immutable<Citation>[];
	readonly onNavigate: (path: AppPath) => void;
	/** Code Save rewrites the corresponding fence in transient message content only. */
	readonly onSaveContent: (content: string) => void;
}
/** History keeps its plain claims/details markup; it does not reuse ChatAnswer. */
export interface HistoryAnswerProps { readonly answer: Immutable<Answer> }
export interface CodePresentation {
	readonly language: string;
	readonly original: string;
	readonly edited: string;
	readonly collapsed: boolean;
	readonly saved: boolean;
}
export type PreviewKind = 'html' | 'svg' | 'mermaid' | 'vega' | 'vega-lite';
/** Renderer-owned result; never accepts caller-supplied trust/sanitized flags. */
export interface InertPreview { readonly kind: PreviewKind; readonly source: string }
export interface SourcePanelProps {
	readonly citations: readonly Immutable<Citation>[];
	readonly expanded: boolean;
	readonly onExpandedChange: (expanded: boolean) => void;
}

/** 3C owns assistant chrome; 3B owns graph mutations, dispatch and clipboard effects. */
export interface AssistantMessageViewProps {
	readonly message: AssistantMessage;
	/** One-based visible branch index, matching the original numeric control. */
	readonly branch: { readonly index: number; readonly count: number };
	readonly onNavigate: (path: AppPath) => void;
	readonly onCopy: () => Promise<void>;
	readonly onSelectBranch: (index: number) => void;
	readonly onSaveEdit: (content: string, asCopy: boolean) => void;
	readonly onRegenerate: (suggestion?: string) => void;
	/** Called after the renderer-owned Delete message confirmation succeeds. */
	readonly onDelete: () => void;
	readonly canRegenerate: boolean;
	readonly canDelete: boolean;
}
