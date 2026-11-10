/*
 * Small accessible primitives, ported from prototypes/ui-revamp/src/ui/primitives.tsx.
 * Interaction behavior follows the WAI-ARIA patterns documented by Radix Primitives (switch,
 * tooltip, radio group); visual anatomy is inspired by shadcn/ui. No code was copied from either.
 * Classes are prefixed `ui-` so they never collide with upstream/unmigrated CSS.
 */
import {
	cloneElement, forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
	type ButtonHTMLAttributes, type FocusEvent as ReactFocusEvent, type KeyboardEvent, type MutableRefObject,
	type ReactElement, type ReactNode, type Ref
} from 'react';
import { createPortal } from 'react-dom';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: 'sm' | 'md';
	icon?: ReactNode;
	/** Shows a spinner, sets aria-busy and disables the button. */
	pending?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{ variant = 'secondary', size = 'md', icon, pending, children, className = '', disabled, type = 'button', ...rest }, ref
) {
	return (
		<button ref={ref} type={type} className={`ui-btn ui-btn-${variant} ui-btn-${size} ${className}`.trim()} disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
			{pending ? <Spinner size={14} /> : icon}
			{children != null && children !== false && <span>{children}</span>}
		</button>
	);
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	/** Accessible name; also the tooltip text. */
	label: string;
	icon: ReactNode;
	tooltip?: boolean;
	size?: 'sm' | 'md';
	side?: Side;
	shortcut?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
	{ label, icon, tooltip = true, size = 'md', side = 'bottom', shortcut, className = '', type = 'button', ...rest }, ref
) {
	const button = (
		<button ref={ref} type={type} aria-label={label} className={`ui-icon-btn ui-icon-btn-${size} ${className}`.trim()} {...rest}>
			{icon}
		</button>
	);
	return tooltip ? <Tooltip content={label} shortcut={shortcut} side={side}>{button}</Tooltip> : button;
});

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
	return (
		<svg className="ui-spinner" width={size} height={size} viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
			<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
			<path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
		</svg>
	);
}

/** Animated "…" for the single honest pending status (e.g. "Working on your answer"). */
export function PendingDots() {
	return <span className="ui-dots" aria-hidden="true"><span /><span /><span /></span>;
}

export interface SwitchProps {
	checked: boolean;
	onChange: (next: boolean) => void;
	label?: string;
	labelledBy?: string;
	describedBy?: string;
	disabled?: boolean;
	/** A save is in flight: thumb pulses and aria-busy is set. */
	pending?: boolean;
	id?: string;
	className?: string;
}

/** WAI-ARIA switch: a button with role="switch" and aria-checked. */
export function Switch({ checked, onChange, label, labelledBy, describedBy, disabled, pending, id, className = '' }: SwitchProps) {
	return (
		<button
			id={id}
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			aria-labelledby={labelledBy}
			aria-describedby={describedBy}
			aria-busy={pending || undefined}
			disabled={disabled}
			className={`ui-switch ${className}`.trim()}
			data-state={checked ? 'on' : 'off'}
			data-pending={pending || undefined}
			onClick={() => onChange(!checked)}
		>
			<span className="ui-switch-thumb" />
		</button>
	);
}

export interface SegmentedOption<T extends string> { value: T; label: string; icon?: ReactNode }

/** Radio group with roving tabindex; arrow keys move and select. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: readonly SegmentedOption<T>[]; label: string }) {
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const onKey = (e: KeyboardEvent, index: number) => {
		const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
		if (!delta) return;
		e.preventDefault();
		const next = (index + delta + options.length) % options.length;
		onChange(options[next].value);
		refs.current[next]?.focus();
	};
	return (
		<div role="radiogroup" aria-label={label} className="ui-segmented">
			{options.map((o, i) => (
				<button key={o.value} ref={el => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === o.value} tabIndex={value === o.value ? 0 : -1} onClick={() => onChange(o.value)} onKeyDown={e => onKey(e, i)}>
					{o.icon}
					{o.label}
				</button>
			))}
		</div>
	);
}

/* ------------------------------------------------------------------ positioning */

export type Side = 'top' | 'bottom' | 'right' | 'left';
export type Align = 'start' | 'center' | 'end';

/** Places a fixed-position floating element next to an anchor, flipping and clamping to the viewport. */
export function useAnchoredPosition(anchor: HTMLElement | null, floating: HTMLElement | null, open: boolean, side: Side = 'bottom', align: Align = 'center', gap = 8) {
	const [pos, setPos] = useState<{ top: number; left: number; side: Side } | null>(null);
	useLayoutEffect(() => {
		if (!open || !anchor || !floating) { setPos(null); return; }
		const place = () => {
			const a = anchor.getBoundingClientRect();
			// offset sizes ignore the entry animation's transform, so clamping stays exact.
			const f = { width: floating.offsetWidth, height: floating.offsetHeight };
			const vw = window.innerWidth, vh = window.innerHeight, m = 8;
			let s = side;
			if (s === 'bottom' && a.bottom + gap + f.height > vh - m && a.top - gap - f.height > m) s = 'top';
			else if (s === 'top' && a.top - gap - f.height < m && a.bottom + gap + f.height < vh - m) s = 'bottom';
			else if (s === 'right' && a.right + gap + f.width > vw - m) s = 'left';
			else if (s === 'left' && a.left - gap - f.width < m) s = 'right';
			let top: number, left: number;
			if (s === 'bottom' || s === 'top') {
				top = s === 'bottom' ? a.bottom + gap : a.top - gap - f.height;
				left = align === 'start' ? a.left : align === 'end' ? a.right - f.width : a.left + a.width / 2 - f.width / 2;
			} else {
				left = s === 'right' ? a.right + gap : a.left - gap - f.width;
				top = a.top + a.height / 2 - f.height / 2;
			}
			left = Math.max(m, Math.min(left, vw - f.width - m));
			top = Math.max(m, Math.min(top, vh - f.height - m));
			setPos({ top, left, side: s });
		};
		place();
		const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
		ro?.observe(floating);
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		return () => { ro?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
	}, [anchor, floating, open, side, align, gap]);
	return pos;
}

/* ------------------------------------------------------------------ tooltip */

function isFocusVisible(el: HTMLElement) {
	try { return el.matches(':focus-visible'); } catch { return true; }
}

/** Hover/focus-visible tooltip. Escape hides it. The child must accept a ref and DOM handlers. */
export function Tooltip({ content, children, side = 'bottom', shortcut }: { content: string; children: ReactElement<Record<string, unknown>>; side?: Side; shortcut?: string }) {
	const [open, setOpen] = useState(false);
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const [floating, setFloating] = useState<HTMLElement | null>(null);
	const timer = useRef<number | undefined>(undefined);
	const id = useId();
	const pos = useAnchoredPosition(anchor, floating, open, side, 'center', 6);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
		document.addEventListener('keydown', onKey, true);
		return () => document.removeEventListener('keydown', onKey, true);
	}, [open]);
	const show = (delay: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(true), delay); };
	const hide = () => { window.clearTimeout(timer.current); setOpen(false); };
	const props = children.props as { ref?: Ref<HTMLElement>; onFocus?: (e: ReactFocusEvent<HTMLElement>) => void; onBlur?: (e: ReactFocusEvent<HTMLElement>) => void };
	const childRef = props.ref;
	const mergedRef = useCallback((el: HTMLElement | null) => {
		setAnchor(el);
		if (typeof childRef === 'function') childRef(el);
		else if (childRef && typeof childRef === 'object') (childRef as MutableRefObject<HTMLElement | null>).current = el;
	}, [childRef]);
	const child = cloneElement(children, {
		ref: mergedRef,
		'aria-describedby': open && shortcut ? id : undefined,
		onPointerEnter: () => show(450),
		onPointerLeave: hide,
		onFocus: (e: ReactFocusEvent<HTMLElement>) => { props.onFocus?.(e); if (isFocusVisible(e.currentTarget)) show(150); },
		onBlur: (e: ReactFocusEvent<HTMLElement>) => { props.onBlur?.(e); hide(); },
		onPointerDown: hide,
	});
	return (
		<>
			{child}
			{open && createPortal(
				<div ref={setFloating} id={id} role="tooltip" className="ui-tooltip" data-side={pos?.side} style={{ top: pos?.top ?? -999, left: pos?.left ?? -999, visibility: pos ? 'visible' : 'hidden' }}>
					{content}
					{shortcut && <kbd>{shortcut}</kbd>}
				</div>,
				document.body,
			)}
		</>
	);
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
	return <span className="ui-sr-only">{children}</span>;
}

/* ------------------------------------------------------------------ formatting helpers */

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Reads a host timestamp. SQLite CURRENT_TIMESTAMP values ("2026-11-10 09:30:00") carry no zone but are
 * UTC, so they are read as UTC; ISO strings with a zone parse as given. Unreadable values return 0.
 */
export function parseTimestamp(value: string): number {
	const sqlite = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value);
	const stamp = Date.parse(sqlite ? `${value.replace(' ', 'T')}Z` : value);
	return Number.isNaN(stamp) ? 0 : stamp;
}

export function formatRelative(ts: number, now = Date.now()): string {
	const diff = now - ts;
	const min = Math.round(diff / 60_000);
	if (min < 1) return 'Just now';
	if (min < 60) return `${min} min ago`;
	const hours = Math.round(min / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.round(hours / 24);
	if (days === 1) return 'Yesterday';
	if (days < 7) return `${days} days ago`;
	return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export type DateGroup = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Previous 30 days' | 'Older';
/** English group keys (also present in the bundled i18n catalogs except "Older"). */
export function dateGroup(ts: number, now = Date.now()): DateGroup {
	const start = new Date(now); start.setHours(0, 0, 0, 0);
	const day = 86_400_000;
	if (ts >= start.getTime()) return 'Today';
	if (ts >= start.getTime() - day) return 'Yesterday';
	if (ts >= start.getTime() - 7 * day) return 'Previous 7 days';
	if (ts >= start.getTime() - 30 * day) return 'Previous 30 days';
	return 'Older';
}

export function pageLabel(start: number, end: number): string {
	return end > start ? `Pages ${start}–${end}` : `Page ${start}`;
}

/** Platform modifier label for shortcuts: "⌘" on Apple platforms, "Ctrl+" elsewhere. */
export function modifierLabel(): string {
	return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
}

/** Subscribes to a media query (SSR/jsdom safe). */
export function useMediaQuery(query: string): boolean {
	const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !!window.matchMedia(query)?.matches;
	const [match, setMatch] = useState(read);
	useEffect(() => {
		if (typeof window.matchMedia !== 'function') return;
		const mq = window.matchMedia(query);
		if (!mq) return;
		const on = () => setMatch(!!mq.matches);
		on();
		mq.addEventListener?.('change', on);
		return () => mq.removeEventListener?.('change', on);
	}, [query]);
	return match;
}

/** True while window.innerWidth >= `px`. Tracks resize; uses the viewport width so tests can drive it. */
export function useViewportAtLeast(px: number): boolean {
	const read = () => typeof window === 'undefined' ? true : window.innerWidth >= px;
	const [match, setMatch] = useState(read);
	useEffect(() => {
		const on = () => setMatch(window.innerWidth >= px);
		on();
		window.addEventListener('resize', on);
		return () => window.removeEventListener('resize', on);
	}, [px]);
	return match;
}
