import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconAlert, IconCheck, IconX } from './icons';

export interface Toast { id: number; tone: 'success' | 'error' | 'info'; text: string; action?: { label: string; run: () => void } }
type Push = (toast: Omit<Toast, 'id'>) => void;

const ToastContext = createContext<Push>(() => undefined);
export const useToast = () => useContext(ToastContext);

/* Inspired by RareUI's toast idea: a quiet pill near the composer, auto-dismissed, paused on hover or focus. */
export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const next = useRef(1);
	const push = useCallback<Push>(toast => {
		setToasts(list => [...list.slice(-2), { ...toast, id: next.current++ }]);
	}, []);
	const dismiss = (id: number) => setToasts(list => list.filter(t => t.id !== id));
	return (
		<ToastContext.Provider value={push}>
			{children}
			{createPortal(
				<div className="toast-region" role="region" aria-label="Notifications">
					<div aria-live="polite" aria-atomic="false" className="toast-stack">
						{toasts.map(t => <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
					</div>
				</div>,
				document.body,
			)}
		</ToastContext.Provider>
	);
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
	const [paused, setPaused] = useState(false);
	useEffect(() => {
		if (paused) return;
		const timer = window.setTimeout(onDismiss, toast.tone === 'error' ? 7000 : 4200);
		return () => window.clearTimeout(timer);
	}, [paused, onDismiss, toast.tone]);
	return (
		<div className={`toast toast-${toast.tone}`} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
			<span className="toast-icon">{toast.tone === 'error' ? <IconAlert size={16} /> : <IconCheck size={16} />}</span>
			<span className="toast-text">{toast.text}</span>
			{toast.action && <button type="button" className="toast-action" onClick={() => { toast.action?.run(); onDismiss(); }}>{toast.action.label}</button>}
			<button type="button" className="toast-close" aria-label="Dismiss notification" onClick={onDismiss}><IconX size={14} /></button>
		</div>
	);
}
