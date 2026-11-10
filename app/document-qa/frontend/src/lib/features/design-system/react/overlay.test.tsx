import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Button, ConfirmDialog, Dialog, Menu, Popover, Segmented, Switch, ToastProvider, isModalOpen, useToast } from './index';

afterEach(cleanup);

function DialogHarness({ onClose }: { onClose?: () => void }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>Open settings</button>
			<button type="button">Behind</button>
			<Dialog open={open} onClose={() => { onClose?.(); setOpen(false); }} title="Settings" description="Plain-language switches.">
				<button type="button">First</button>
				<button type="button">Last</button>
			</Dialog>
		</>
	);
}

it('Dialog moves focus in, traps Tab, makes the page inert, and Escape restores focus to the trigger', async () => {
	render(<DialogHarness />);
	const trigger = screen.getByRole('button', { name: 'Open settings' });
	trigger.focus(); fireEvent.click(trigger);
	const dialog = screen.getByRole('dialog', { name: 'Settings' });
	expect(dialog.getAttribute('aria-modal')).toBe('true');
	expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
	expect(isModalOpen()).toBe(true);
	// The app content (everything outside the dialog layer) is inert.
	expect(trigger.closest('[inert]')).toBeTruthy();
	// Initial focus skips the header close button and lands on the first content control.
	expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'First' }));
	const items = Array.from(dialog.querySelectorAll('button'));
	items[items.length - 1].focus();
	fireEvent.keyDown(items[items.length - 1], { key: 'Tab' });
	expect(document.activeElement).toBe(items[0]);
	fireEvent.keyDown(items[0], { key: 'Tab', shiftKey: true });
	expect(document.activeElement).toBe(items[items.length - 1]);
	items[0].focus();
	fireEvent.keyDown(items[0], { key: 'Tab', shiftKey: true });
	expect(document.activeElement).toBe(items[items.length - 1]);
	fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
	expect(screen.queryByRole('dialog')).toBeNull();
	expect(isModalOpen()).toBe(false);
	expect(document.querySelector('[inert]')).toBeNull();
	await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('Dialog close button and scrim dismiss', () => {
	const onClose = vi.fn();
	render(<DialogHarness onClose={onClose} />);
	fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
	fireEvent.click(screen.getByRole('button', { name: 'Close' }));
	expect(onClose).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
	fireEvent.click(document.querySelector('.ui-dialog-scrim')!);
	expect(onClose).toHaveBeenCalledTimes(2);
});

it('ConfirmDialog focuses Cancel, ignores the scrim, and keeps itself open with an error when confirm fails', async () => {
	const onCancel = vi.fn();
	const onConfirm = vi.fn(async () => { throw new Error('Disk is busy.'); });
	render(<ConfirmDialog open title="Delete this document?" description="It will be removed." confirmLabel="Delete" onCancel={onCancel} onConfirm={onConfirm} />);
	const dialog = screen.getByRole('alertdialog', { name: 'Delete this document?' });
	expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
	fireEvent.click(document.querySelector('.ui-dialog-scrim')!);
	expect(onCancel).not.toHaveBeenCalled();
	fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
	expect((await within(dialog).findByRole('alert')).textContent).toBe('Disk is busy. Nothing was changed. Try again.');
	fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
	expect(onCancel).toHaveBeenCalledTimes(1);
});

function PopoverHarness() {
	const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
	const [open, setOpen] = useState(false);
	return (
		<>
			<button ref={setAnchor} type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}>Citation 1</button>
			<button type="button">Elsewhere</button>
			<Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Source quote">
				<p>Exact quote</p>
				<button type="button">Show document page</button>
			</Popover>
		</>
	);
}

it('Popover is non-modal, focuses its first control, and Escape closes it and restores focus to the anchor', async () => {
	render(<PopoverHarness />);
	const anchor = screen.getByRole('button', { name: 'Citation 1' });
	anchor.focus(); fireEvent.click(anchor);
	const popover = screen.getByRole('dialog', { name: 'Source quote' });
	expect(popover.getAttribute('aria-modal')).toBeNull();
	expect(document.querySelector('[inert]')).toBeNull();
	await waitFor(() => expect(document.activeElement).toBe(within(popover).getByRole('button', { name: 'Show document page' })));
	fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
	expect(screen.queryByRole('dialog')).toBeNull();
	expect(document.activeElement).toBe(anchor);
});

it('Popover closes on an outside pointer press', () => {
	render(<PopoverHarness />);
	fireEvent.click(screen.getByRole('button', { name: 'Citation 1' }));
	expect(screen.getByRole('dialog')).toBeTruthy();
	fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
	expect(screen.queryByRole('dialog')).toBeNull();
});

function MenuHarness({ onDelete }: { onDelete: () => void }) {
	const ref = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	return (
		<>
			<button ref={ref} type="button" aria-haspopup="menu" onClick={() => setOpen(true)}>More</button>
			<Menu anchor={ref.current} open={open} onClose={() => setOpen(false)} label="Options" items={[
				{ label: 'Rename', onSelect: () => undefined },
				{ label: 'Archive', onSelect: () => undefined, disabled: true },
				{ label: 'Delete…', onSelect: onDelete, destructive: true }
			]} />
		</>
	);
}

it('Menu supports Arrow/Home/End navigation (skipping disabled items), Escape back to the trigger, and selection', async () => {
	const onDelete = vi.fn();
	render(<MenuHarness onDelete={onDelete} />);
	const trigger = screen.getByRole('button', { name: 'More' });
	trigger.focus(); fireEvent.click(trigger);
	const menu = screen.getByRole('menu', { name: 'Options' });
	const [rename, , remove] = within(menu).getAllByRole('menuitem');
	await waitFor(() => expect(document.activeElement).toBe(rename));
	fireEvent.keyDown(rename, { key: 'ArrowDown' });
	expect(document.activeElement).toBe(remove);
	fireEvent.keyDown(remove, { key: 'ArrowDown' });
	expect(document.activeElement).toBe(rename);
	fireEvent.keyDown(rename, { key: 'ArrowUp' });
	expect(document.activeElement).toBe(remove);
	fireEvent.keyDown(remove, { key: 'Home' });
	expect(document.activeElement).toBe(rename);
	fireEvent.keyDown(rename, { key: 'End' });
	expect(document.activeElement).toBe(remove);
	fireEvent.keyDown(remove, { key: 'Escape' });
	expect(screen.queryByRole('menu')).toBeNull();
	expect(document.activeElement).toBe(trigger);
	fireEvent.click(trigger);
	fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
	expect(onDelete).toHaveBeenCalledTimes(1);
	expect(screen.queryByRole('menu')).toBeNull();
});

it('Switch exposes role="switch" with aria-checked and reports the next value', () => {
	const onChange = vi.fn();
	const { rerender } = render(<Switch label="Used in answers" checked={false} onChange={onChange} />);
	const toggle = screen.getByRole('switch', { name: 'Used in answers' });
	expect(toggle.getAttribute('aria-checked')).toBe('false');
	fireEvent.click(toggle);
	expect(onChange).toHaveBeenCalledWith(true);
	rerender(<Switch label="Used in answers" checked pending onChange={onChange} />);
	expect(toggle.getAttribute('aria-checked')).toBe('true');
	expect(toggle.getAttribute('aria-busy')).toBe('true');
	rerender(<Switch label="Used in answers" checked disabled onChange={onChange} />);
	expect((toggle as HTMLButtonElement).disabled).toBe(true);
});

it('Segmented is a radio group with roving focus', () => {
	function Harness() {
		const [value, setValue] = useState<'system' | 'light' | 'dark'>('system');
		return <Segmented label="Theme" value={value} onChange={setValue} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />;
	}
	render(<Harness />);
	const system = screen.getByRole('radio', { name: 'System' });
	expect(system.getAttribute('tabindex')).toBe('0');
	system.focus(); fireEvent.keyDown(system, { key: 'ArrowRight' });
	const light = screen.getByRole('radio', { name: 'Light' });
	expect(light.getAttribute('aria-checked')).toBe('true');
	expect(document.activeElement).toBe(light);
});

it('Button pending state is busy and disabled; toasts announce in a polite live region', async () => {
	function Push() { const push = useToast(); return <Button pending={false} onClick={() => push({ tone: 'success', text: 'Saved' })}>Save</Button>; }
	render(<ToastProvider><Push /><Button pending>Working</Button></ToastProvider>);
	const busy = screen.getByRole('button', { name: 'Working' }) as HTMLButtonElement;
	expect(busy.disabled).toBe(true);
	expect(busy.getAttribute('aria-busy')).toBe('true');
	fireEvent.click(screen.getByRole('button', { name: 'Save' }));
	const region = screen.getByRole('region', { name: 'Notifications' });
	expect(within(region).getByText('Saved')).toBeTruthy();
	expect(region.querySelector('[aria-live="polite"]')).toBeTruthy();
	fireEvent.click(within(region).getByRole('button', { name: 'Dismiss notification' }));
	expect(within(region).queryByText('Saved')).toBeNull();
});
