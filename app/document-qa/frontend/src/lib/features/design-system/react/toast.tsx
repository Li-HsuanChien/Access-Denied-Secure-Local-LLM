/* Quiet toast, ported from prototypes/ui-revamp/src/ui/toast.tsx: a pill near the bottom, auto-dismissed, paused on hover or focus. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconAlert, IconCheck, IconInfo, IconX } from './icons';
import { MODAL_EXEMPT_ATTRIBUTE } from './overlay';

export type ToastTone = 'success' | 'error' | 'info';
export interface Toast { id: number; tone: ToastTone; text: string; action?: { label: string; run: () => void } }
export type PushToast = (toast: Omit<Toast, 'id'>) => void;

const ToastContext = createContext<PushToast>(() => undefined);
/** Returns `push({tone, text, action?})`. Without a ToastProvider it is a no-op. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const next = useRef(1);
	const push = useCallback<PushToast>(toast => {
		setToasts(list => [...list.slice(-2), { ...toast, id: next.current++ }]);
	}, []);
	const dismiss = useCallback((id: number) => setToasts(list => list.filter(t => t.id !== id)), []);
	return (
		<ToastContext.Provider value={push}>
			{children}
			{createPortal(
				<div className="ui-toast-region" role="region" aria-label="Notifications" {...{ [MODAL_EXEMPT_ATTRIBUTE]: '' }}>
					<div aria-live="polite" aria-atomic="false" className="ui-toast-stack">
						{toasts.map(t => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
					</div>
				</div>,
				document.body,
			)}
		</ToastContext.Provider>
	);
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
	const [paused, setPaused] = useState(false);
	useEffect(() => {
		if (paused) return;
		const timer = window.setTimeout(() => onDismiss(toast.id), toast.tone === 'error' ? 7000 : 4200);
		return () => window.clearTimeout(timer);
	}, [paused, onDismiss, toast.id, toast.tone]);
	return (
		<div className={`ui-toast ui-toast-${toast.tone}`} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
			<span className="ui-toast-icon">{toast.tone === 'error' ? <IconAlert size={16} /> : toast.tone === 'info' ? <IconInfo size={16} /> : <IconCheck size={16} />}</span>
			<span className="ui-toast-text">{toast.text}</span>
			{toast.action && <button type="button" className="ui-toast-action" onClick={() => { toast.action?.run(); onDismiss(toast.id); }}>{toast.action.label}</button>}
			<button type="button" className="ui-toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}><IconX size={14} /></button>
		</div>
	);
}
