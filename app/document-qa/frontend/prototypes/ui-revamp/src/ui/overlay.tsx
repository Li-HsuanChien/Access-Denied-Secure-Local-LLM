/*
 * Overlays. Behavior follows the WAI-ARIA dialog, alert-dialog and menu
 * patterns as documented by Radix Primitives: Escape dismisses, focus moves
 * in on open and returns to the trigger on close, modal dialogs trap focus
 * and make the rest of the app inert. Popovers are non-modal.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, useAnchoredPosition, type Side } from './primitives';
import { IconX } from './icons';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.closest('[inert]') && el.offsetParent !== null);
}

/* ------------------------------------------------------------------ inert management */

let modalCount = 0;
function setAppInert(on: boolean) {
	const root = document.getElementById('root');
	if (!root) return;
	modalCount += on ? 1 : -1;
	if (modalCount > 0) root.setAttribute('inert', '');
	else root.removeAttribute('inert');
}

/* ------------------------------------------------------------------ popover */

export interface PopoverProps {
	anchor: HTMLElement | null;
	open: boolean;
	onClose: (reason: 'escape' | 'outside' | 'action') => void;
	side?: Side;
	align?: 'start' | 'center' | 'end';
	labelledBy?: string;
	label?: string;
	className?: string;
	children: ReactNode;
	/** Move focus into the popover on open (default) or leave it on the trigger. */
	autoFocus?: boolean;
}

export function Popover({ anchor, open, onClose, side = 'bottom', align = 'center', labelledBy, label, className = '', children, autoFocus = true }: PopoverProps) {
	const [floating, setFloating] = useState<HTMLDivElement | null>(null);
	const pos = useAnchoredPosition(anchor, floating, open, side, align, 8);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	// Focus only once the popover is positioned and visible; hidden elements can't take focus.
	const focused = useRef(false);
	useEffect(() => { if (!open) focused.current = false; }, [open]);
	useEffect(() => {
		if (!open || !floating || !pos || focused.current) return;
		focused.current = true;
		if (autoFocus) (focusables(floating)[0] ?? floating).focus({ preventScroll: true });
	}, [open, floating, pos, autoFocus]);

	useEffect(() => {
		if (!open || !floating) return;
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.stopPropagation();
			closeRef.current('escape');
			anchor?.focus({ preventScroll: true });
		};
		const onPointer = (e: PointerEvent) => {
			const t = e.target as Node;
			if (floating.contains(t) || anchor?.contains(t)) return;
			closeRef.current('outside');
		};
		document.addEventListener('keydown', onKey, true);
		document.addEventListener('pointerdown', onPointer, true);
		return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onPointer, true); };
	}, [open, floating, anchor]);

	if (!open) return null;
	return createPortal(
		<div
			ref={setFloating}
			role="dialog"
			aria-labelledby={labelledBy}
			aria-label={label}
			tabIndex={-1}
			className={`popover ${className}`}
			data-side={pos?.side}
			style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
			onBlur={e => {
				const next = e.relatedTarget as Node | null;
				if (next && !floating?.contains(next) && !anchor?.contains(next)) closeRef.current('outside');
			}}
		>
			{children}
		</div>,
		document.body,
	);
}

/* ------------------------------------------------------------------ dialog */

export interface DialogProps {
	open: boolean;
	onClose: () => void;
	title: string;
	description?: ReactNode;
	hideTitle?: boolean;
	variant?: 'center' | 'full' | 'sheet';
	role?: 'dialog' | 'alertdialog';
	initialFocus?: React.RefObject<HTMLElement | null>;
	className?: string;
	children: ReactNode;
	footer?: ReactNode;
	closeLabel?: string;
	dismissOnScrim?: boolean;
	/** Element to focus on close if the original trigger no longer exists. */
	fallbackFocus?: () => HTMLElement | null;
}

export function Dialog({ open, onClose, title, description, hideTitle, variant = 'center', role = 'dialog', initialFocus, className = '', children, footer, closeLabel = 'Close', dismissOnScrim = true, fallbackFocus }: DialogProps) {
	const panel = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const descId = useId();
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	const fallbackRef = useRef(fallbackFocus);
	fallbackRef.current = fallbackFocus;

	useLayoutEffect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		setAppInert(true);
		const el = panel.current;
		if (el) (initialFocus?.current ?? focusables(el).find(f => !f.classList.contains('dialog-close')) ?? el).focus({ preventScroll: true });
		return () => {
			setAppInert(false);
			const target = previous && previous !== document.body && document.contains(previous) ? previous : fallbackRef.current?.();
			window.setTimeout(() => target?.focus({ preventScroll: true }), 0);
		};
	}, [open, initialFocus]);

	// Escape works even if focus was lost to the page body (e.g. a focused button unmounted).
	useEffect(() => {
		if (!open) return;
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key !== 'Escape' || e.defaultPrevented) return;
			if (panel.current?.contains(document.activeElement) || document.activeElement === document.body) { e.preventDefault(); closeRef.current(); }
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [open]);

	if (!open) return null;

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === 'Escape') return;
		if (e.key !== 'Tab' || !panel.current) return;
		const items = focusables(panel.current);
		if (!items.length) { e.preventDefault(); return; }
		const first = items[0], last = items[items.length - 1];
		if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	};

	return createPortal(
		<div className={`dialog-layer dialog-layer-${variant}`} onKeyDown={onKeyDown}>
			<div className="dialog-scrim" onClick={dismissOnScrim ? () => closeRef.current() : undefined} />
			<div ref={panel} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1} className={`dialog dialog-${variant} ${className}`}>
				{variant !== 'full' && (
					<header className={`dialog-header ${hideTitle ? 'sr-only' : ''}`}>
						<h2 id={titleId}>{title}</h2>
						{description && <p id={descId} className="dialog-description">{description}</p>}
					</header>
				)}
				{variant === 'full' && <h2 id={titleId} className="sr-only">{title}</h2>}
				{role === 'dialog' && variant !== 'full' && (
					<button type="button" className="icon-btn icon-btn-md dialog-close" aria-label={closeLabel} onClick={() => closeRef.current()}>
						<IconX />
					</button>
				)}
				<div className="dialog-body">{children}</div>
				{footer && <footer className="dialog-footer">{footer}</footer>}
			</div>
		</div>,
		document.body,
	);
}

/* ------------------------------------------------------------------ confirm */

export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onCancel, destructive = true, fallbackFocus }: {
	open: boolean;
	title: string;
	description: ReactNode;
	confirmLabel: string;
	onConfirm: () => Promise<void> | void;
	onCancel: () => void;
	destructive?: boolean;
	fallbackFocus?: () => HTMLElement | null;
}) {
	const cancelRef = useRef<HTMLButtonElement>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => { if (open) { setPending(false); setError(''); } }, [open]);
	const confirm = async () => {
		setPending(true); setError('');
		try { await onConfirm(); }
		catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong.'); setPending(false); }
	};
	return (
		<Dialog
			open={open}
			onClose={pending ? () => undefined : onCancel}
			title={title}
			description={description}
			role="alertdialog"
			initialFocus={cancelRef}
			className="dialog-confirm"
			dismissOnScrim={false}
			fallbackFocus={fallbackFocus}
			footer={
				<>
					<Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
					<Button variant={destructive ? 'danger' : 'primary'} onClick={confirm} pending={pending}>{confirmLabel}</Button>
				</>
			}
		>
			{error && <p className="form-error" role="alert">{error} Nothing was changed. Try again.</p>}
		</Dialog>
	);
}

/* ------------------------------------------------------------------ menu */

export interface MenuItem {
	label: string;
	icon?: ReactNode;
	onSelect: () => void;
	destructive?: boolean;
}

export function Menu({ anchor, open, onClose, items, side = 'bottom', align = 'end', label }: { anchor: HTMLElement | null; open: boolean; onClose: (refocus: boolean) => void; items: MenuItem[]; side?: Side; align?: 'start' | 'center' | 'end'; label: string }) {
	const [floating, setFloating] = useState<HTMLDivElement | null>(null);
	const pos = useAnchoredPosition(anchor, floating, open, side, align, 6);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	const focused = useRef(false);
	useEffect(() => { if (!open) focused.current = false; }, [open]);
	useEffect(() => {
		if (!open || !floating || !pos || focused.current) return;
		focused.current = true;
		floating.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
	}, [open, floating, pos]);

	useEffect(() => {
		if (!open || !floating) return;
		const onPointer = (e: PointerEvent) => {
			const t = e.target as Node;
			if (!floating.contains(t) && !anchor?.contains(t)) closeRef.current(false);
		};
		document.addEventListener('pointerdown', onPointer, true);
		return () => document.removeEventListener('pointerdown', onPointer, true);
	}, [open, floating, anchor]);

	if (!open) return null;
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const list = Array.from(floating?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
		const index = list.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'ArrowDown') { e.preventDefault(); list[(index + 1) % list.length]?.focus(); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); list[(index - 1 + list.length) % list.length]?.focus(); }
		else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
		else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
		else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(true); anchor?.focus(); }
		else if (e.key === 'Tab') { closeRef.current(false); }
	};
	return createPortal(
		<div ref={setFloating} role="menu" aria-label={label} className="menu" onKeyDown={onKeyDown} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
			{items.map(item => (
				<button key={item.label} type="button" role="menuitem" tabIndex={-1} className={item.destructive ? 'menu-item is-destructive' : 'menu-item'} onClick={() => { closeRef.current(false); anchor?.focus({ preventScroll: true }); item.onSelect(); }}>
					{item.icon}
					{item.label}
				</button>
			))}
		</div>,
		document.body,
	);
}
