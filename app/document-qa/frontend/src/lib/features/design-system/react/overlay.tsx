/*
 * Overlays, ported from prototypes/ui-revamp/src/ui/overlay.tsx. Behavior follows the WAI-ARIA
 * dialog, alert-dialog and menu patterns as documented by Radix Primitives: Escape dismisses, focus
 * moves in on open and returns to the trigger on close, modal dialogs trap focus and make the rest of
 * the page inert. Popovers are non-modal. Dialogs never stack: opening one while another is open is a
 * caller bug; use inline confirmation instead.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button, useAnchoredPosition, type Align, type Side } from './primitives';
import { IconX } from './icons';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visible(el: HTMLElement) {
	if (el.closest('[hidden]')) return false;
	const check = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
	if (typeof check === 'function') return check.call(el);
	// Engines without checkVisibility (and jsdom, which has no layout): use the computed style.
	const style = window.getComputedStyle(el);
	return style.display !== 'none' && style.visibility !== 'hidden';
}

/** Tabbable descendants in DOM order, excluding inert and hidden content. */
export function focusables(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.closest('[inert]') && visible(el));
}

/* ------------------------------------------------------------------ inert management */

/** Elements that stay interactive while a modal is open (e.g. the toast live region). */
export const MODAL_EXEMPT_ATTRIBUTE = 'data-ui-modal-exempt';
const inerted: HTMLElement[][] = [];

/** Make every other top-level body child inert while `layer` (a body child) is modal. */
function lockOutside(layer: HTMLElement) {
	const changed: HTMLElement[] = [];
	for (const el of Array.from(document.body.children) as HTMLElement[]) {
		if (el === layer || el.contains(layer) || el.hasAttribute('inert') || el.hasAttribute(MODAL_EXEMPT_ATTRIBUTE)) continue;
		if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
		el.setAttribute('inert', '');
		changed.push(el);
	}
	inerted.push(changed);
	return () => {
		const index = inerted.indexOf(changed);
		if (index >= 0) inerted.splice(index, 1);
		for (const el of changed) el.removeAttribute('inert');
	};
}

/** True while any modal Dialog is open (shell shortcuts and drawers should stand down). */
export function isModalOpen(): boolean {
	return inerted.length > 0;
}

function restoreFocus(target: HTMLElement | null | undefined) {
	window.setTimeout(() => { if (target && document.contains(target)) target.focus({ preventScroll: true }); }, 0);
}

/* ------------------------------------------------------------------ popover */

export type PopoverCloseReason = 'escape' | 'outside' | 'action';

export interface PopoverProps {
	/** Trigger element; focus returns here on Escape. */
	anchor: HTMLElement | null;
	open: boolean;
	onClose: (reason: PopoverCloseReason) => void;
	side?: Side;
	align?: Align;
	labelledBy?: string;
	label?: string;
	className?: string;
	children: ReactNode;
	/** Move focus into the popover on open (default) or leave it on the trigger. */
	autoFocus?: boolean;
}

/** Non-modal anchored dialog. Escape closes and refocuses the anchor; outside pointer or focus leaving closes. */
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
			className={`ui-popover ${className}`.trim()}
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
	/** Accessible name (visible heading unless hideTitle or variant="full"). */
	title: string;
	description?: ReactNode;
	hideTitle?: boolean;
	/** center: compact dialog; full: full-screen (e.g. document viewer on small screens); sheet: tall side sheet. */
	variant?: 'center' | 'full' | 'sheet';
	role?: 'dialog' | 'alertdialog';
	initialFocus?: RefObject<HTMLElement | null>;
	className?: string;
	children: ReactNode;
	footer?: ReactNode;
	closeLabel?: string;
	/** Hide the built-in close button (role="dialog" only). */
	hideClose?: boolean;
	dismissOnScrim?: boolean;
	/** Element to focus on close instead of the element focused when the dialog opened. */
	returnFocus?: HTMLElement | null;
	/** Element to focus on close if the original trigger no longer exists. */
	fallbackFocus?: () => HTMLElement | null;
}

/** Modal dialog: focus trap, Escape, page inert while open, focus restored on close. */
export function Dialog({ open, onClose, title, description, hideTitle, variant = 'center', role = 'dialog', initialFocus, className = '', children, footer, closeLabel = 'Close', hideClose, dismissOnScrim = true, returnFocus, fallbackFocus }: DialogProps) {
	const layer = useRef<HTMLDivElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const descId = useId();
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	const fallbackRef = useRef(fallbackFocus);
	fallbackRef.current = fallbackFocus;
	const returnRef = useRef(returnFocus);
	returnRef.current = returnFocus;

	useLayoutEffect(() => {
		if (!open || !layer.current) return;
		const previous = document.activeElement as HTMLElement | null;
		const unlock = lockOutside(layer.current);
		const el = panel.current;
		if (el) (initialFocus?.current ?? focusables(el).find(f => !f.classList.contains('ui-dialog-close')) ?? el).focus({ preventScroll: true });
		return () => {
			unlock();
			const preferred = returnRef.current ?? (previous && previous !== document.body ? previous : null);
			restoreFocus(preferred && document.contains(preferred) ? preferred : fallbackRef.current?.());
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
		if (e.key !== 'Tab' || !panel.current) return;
		const items = focusables(panel.current);
		if (!items.length) { e.preventDefault(); panel.current.focus(); return; }
		const first = items[0], last = items[items.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && (active === first || active === panel.current)) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
	};

	return createPortal(
		<div ref={layer} className={`ui-dialog-layer ui-dialog-layer-${variant}`} onKeyDown={onKeyDown}>
			<div className="ui-dialog-scrim" aria-hidden="true" onClick={dismissOnScrim ? () => closeRef.current() : undefined} />
			<div ref={panel} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1} className={`ui-dialog ui-dialog-${variant} ${className}`.trim()}>
				{variant !== 'full' && (
					<header className={`ui-dialog-header ${hideTitle ? 'ui-sr-only' : ''}`.trim()}>
						<h2 id={titleId}>{title}</h2>
						{description && <div id={descId} className="ui-dialog-description">{description}</div>}
					</header>
				)}
				{variant === 'full' && <h2 id={titleId} className="ui-sr-only">{title}</h2>}
				{role === 'dialog' && variant !== 'full' && !hideClose && (
					<button type="button" className="ui-icon-btn ui-icon-btn-md ui-dialog-close" aria-label={closeLabel} onClick={() => closeRef.current()}>
						<IconX />
					</button>
				)}
				<div className="ui-dialog-body">{children}</div>
				{footer && <footer className="ui-dialog-footer">{footer}</footer>}
			</div>
		</div>,
		document.body,
	);
}

/* ------------------------------------------------------------------ confirm */

export interface ConfirmDialogProps {
	open: boolean;
	title: string;
	description: ReactNode;
	confirmLabel: string;
	cancelLabel?: string;
	/** May reject: the dialog stays open, shows the error and "Nothing was changed. Try again." */
	onConfirm: () => Promise<void> | void;
	onCancel: () => void;
	destructive?: boolean;
	fallbackFocus?: () => HTMLElement | null;
	returnFocus?: HTMLElement | null;
}

/** Alert dialog for consequential actions. Initial focus is Cancel; the scrim does not dismiss. */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel, destructive = true, fallbackFocus, returnFocus }: ConfirmDialogProps) {
	const cancelRef = useRef<HTMLButtonElement>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => { if (open) { setPending(false); setError(''); } }, [open]);
	const confirm = async () => {
		setPending(true); setError('');
		try { await onConfirm(); setPending(false); }
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
			className="ui-dialog-confirm"
			dismissOnScrim={false}
			fallbackFocus={fallbackFocus}
			returnFocus={returnFocus}
			footer={
				<>
					<Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={pending}>{cancelLabel}</Button>
					<Button variant={destructive ? 'danger' : 'primary'} onClick={() => void confirm()} pending={pending}>{confirmLabel}</Button>
				</>
			}
		>
			{error && <p className="ui-form-error" role="alert">{error} Nothing was changed. Try again.</p>}
		</Dialog>
	);
}

/* ------------------------------------------------------------------ menu */

export interface MenuItem {
	/** Visible text; also the React key, so labels must be unique within a menu. */
	label: string;
	icon?: ReactNode;
	onSelect: () => void;
	destructive?: boolean;
	disabled?: boolean;
}

export interface MenuProps {
	anchor: HTMLElement | null;
	open: boolean;
	/** `refocus` is true when Escape closed the menu (focus already returned to the anchor). */
	onClose: (refocus: boolean) => void;
	items: readonly MenuItem[];
	side?: Side;
	align?: Align;
	label: string;
}

/** WAI-ARIA menu: first item focused on open; Arrow/Home/End move; Escape closes to the trigger; Tab closes. */
export function Menu({ anchor, open, onClose, items, side = 'bottom', align = 'end', label }: MenuProps) {
	const [floating, setFloating] = useState<HTMLDivElement | null>(null);
	const pos = useAnchoredPosition(anchor, floating, open, side, align, 6);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	const focused = useRef(false);
	useEffect(() => { if (!open) focused.current = false; }, [open]);
	useEffect(() => {
		if (!open || !floating || !pos || focused.current) return;
		focused.current = true;
		floating.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
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
		const list = Array.from(floating?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
		const index = list.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'ArrowDown') { e.preventDefault(); list[(index + 1) % list.length]?.focus(); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); list[(index - 1 + list.length) % list.length]?.focus(); }
		else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
		else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
		else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(true); anchor?.focus(); }
		else if (e.key === 'Tab') { closeRef.current(false); }
	};
	return createPortal(
		<div ref={setFloating} role="menu" aria-label={label} className="ui-menu" onKeyDown={onKeyDown} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
			{items.map(item => (
				<button key={item.label} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} className={item.destructive ? 'ui-menu-item is-destructive' : 'ui-menu-item'} onClick={() => { closeRef.current(false); anchor?.focus({ preventScroll: true }); item.onSelect(); }}>
					{item.icon}
					{item.label}
				</button>
			))}
		</div>,
		document.body,
	);
}
