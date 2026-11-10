/*
 * Small accessible primitives. Interaction behavior follows the WAI-ARIA
 * patterns documented by Radix Primitives (switch, tooltip, radio group);
 * visual anatomy is inspired by shadcn/ui. No code was copied from either.
 */
import { cloneElement, forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: 'sm' | 'md';
	icon?: ReactNode;
	pending?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', icon, pending, children, className = '', disabled, ...rest }, ref) {
	return (
		<button ref={ref} type="button" className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
			{pending ? <Spinner size={14} /> : icon}
			{children && <span>{children}</span>}
		</button>
	);
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	label: string;
	icon: ReactNode;
	tooltip?: boolean;
	size?: 'sm' | 'md';
	side?: 'top' | 'bottom' | 'right';
	shortcut?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon, tooltip = true, size = 'md', side = 'bottom', shortcut, className = '', ...rest }, ref) {
	const button = (
		<button ref={ref} type="button" aria-label={label} className={`icon-btn icon-btn-${size} ${className}`} {...rest}>
			{icon}
		</button>
	);
	return tooltip ? <Tooltip content={label} shortcut={shortcut} side={side}>{button}</Tooltip> : button;
});

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
	return (
		<svg className="spinner" width={size} height={size} viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
			<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
			<path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
		</svg>
	);
}

export function Switch({ checked, onChange, label, labelledBy, describedBy, disabled, pending, id }: { checked: boolean; onChange: (next: boolean) => void; label?: string; labelledBy?: string; describedBy?: string; disabled?: boolean; pending?: boolean; id?: string }) {
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
			className="switch"
			data-state={checked ? 'on' : 'off'}
			data-pending={pending || undefined}
			onClick={() => onChange(!checked)}
		>
			<span className="switch-thumb" />
		</button>
	);
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: ReactNode }[]; label: string }) {
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
		<div role="radiogroup" aria-label={label} className="segmented">
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

/** Places a fixed-position floating element next to an anchor, flipping and clamping to the viewport. */
export function useAnchoredPosition(anchor: HTMLElement | null, floating: HTMLElement | null, open: boolean, side: Side = 'bottom', align: 'start' | 'center' | 'end' = 'center', gap = 8) {
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
		const ro = new ResizeObserver(place);
		ro.observe(floating);
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		return () => { ro.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
	}, [anchor, floating, open, side, align, gap]);
	return pos;
}

/* ------------------------------------------------------------------ tooltip */

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
	const childRef = (children.props as { ref?: React.Ref<HTMLElement> }).ref;
	const mergedRef = useCallback((el: HTMLElement | null) => {
		setAnchor(el);
		if (typeof childRef === 'function') childRef(el);
		else if (childRef && typeof childRef === 'object') (childRef as React.MutableRefObject<HTMLElement | null>).current = el;
	}, [childRef]);
	const child = cloneElement(children, {
		ref: mergedRef,
		'aria-describedby': open && shortcut ? id : undefined,
		onPointerEnter: () => show(450),
		onPointerLeave: hide,
		onFocus: (e: React.FocusEvent<HTMLElement>) => { if (e.currentTarget.matches(':focus-visible')) show(150); },
		onBlur: hide,
		onPointerDown: hide,
	});
	return (
		<>
			{child}
			{open && createPortal(
				<div ref={setFloating} id={id} role="tooltip" className="tooltip" data-side={pos?.side} style={{ top: pos?.top ?? -999, left: pos?.left ?? -999, visibility: pos ? 'visible' : 'hidden' }}>
					{content}
					{shortcut && <kbd>{shortcut}</kbd>}
				</div>,
				document.body,
			)}
		</>
	);
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
	return <span className="sr-only">{children}</span>;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelative(ts: number): string {
	const diff = Date.now() - ts;
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

export function dateGroup(ts: number): string {
	const start = new Date(); start.setHours(0, 0, 0, 0);
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
