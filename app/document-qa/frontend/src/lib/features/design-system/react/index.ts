/**
 * Reading-room design system: the shared UI kit for every feature.
 * Import from '@/lib/features/design-system/react' (never from prototypes/).
 * Importing this module also loads the `ui-` component CSS; tokens live in personality/personality.css.
 */
import './design-system.css';

export {
	Button, IconButton, Spinner, PendingDots, Switch, Segmented, Tooltip, VisuallyHidden,
	useAnchoredPosition, useMediaQuery, useViewportAtLeast,
	formatBytes, formatRelative, dateGroup, pageLabel, modifierLabel, parseTimestamp
} from './primitives';
export type { ButtonProps, ButtonVariant, IconButtonProps, SwitchProps, SegmentedOption, Side, Align, DateGroup } from './primitives';

export { Popover, Dialog, ConfirmDialog, Menu, focusables, isModalOpen, MODAL_EXEMPT_ATTRIBUTE } from './overlay';
export type { PopoverProps, PopoverCloseReason, DialogProps, ConfirmDialogProps, MenuItem, MenuProps } from './overlay';

export { ToastProvider, useToast } from './toast';
export type { Toast, ToastTone, PushToast } from './toast';

export * from './icons';
