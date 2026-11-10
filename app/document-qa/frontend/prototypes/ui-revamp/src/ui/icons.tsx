/* Original line icons drawn for this prototype (24px grid, 1.75 stroke). */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: React.ReactNode, displayName: string) {
	const Icon = ({ size = 18, ...rest }: IconProps) => (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
			{paths}
		</svg>
	);
	Icon.displayName = displayName;
	return Icon;
}

export const IconPlus = make(<path d="M12 5v14M5 12h14" />, 'IconPlus');
export const IconSearch = make(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>, 'IconSearch');
export const IconLibrary = make(<><rect x="4" y="4.5" width="4" height="15" rx="1" /><rect x="10" y="4.5" width="4" height="15" rx="1" /><path d="m16.4 6.2 3.2-.8 3 13.6-3.2.8z" /></>, 'IconLibrary');
export const IconSliders = make(<><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>, 'IconSliders');
export const IconSidebar = make(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></>, 'IconSidebar');
export const IconArrowUp = make(<path d="M12 19V5M6 11l6-6 6 6" />, 'IconArrowUp');
export const IconArrowLeft = make(<path d="M19 12H5M11 6l-6 6 6 6" />, 'IconArrowLeft');
export const IconCopy = make(<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>, 'IconCopy');
export const IconRefresh = make(<><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5V9H15" /></>, 'IconRefresh');
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />, 'IconX');
export const IconChevronLeft = make(<path d="m15 6-6 6 6 6" />, 'IconChevronLeft');
export const IconChevronRight = make(<path d="m9 6 6 6-6 6" />, 'IconChevronRight');
export const IconChevronDown = make(<path d="m6 9 6 6 6-6" />, 'IconChevronDown');
export const IconMinus = make(<path d="M5 12h14" />, 'IconMinus');
export const IconFile = make(<><path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" /><path d="M14 3.5V8h4.5" /></>, 'IconFile');
export const IconTrash = make(<><path d="M4.5 7h15M9.5 7V5h5v2" /><path d="m6.5 7 .8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7" /></>, 'IconTrash');
export const IconMore = make(<><circle cx="6" cy="12" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /><circle cx="18" cy="12" r="1.1" fill="currentColor" /></>, 'IconMore');
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />, 'IconCheck');
export const IconAlert = make(<><path d="M10.3 5.2a2 2 0 0 1 3.4 0l6.5 11.3a2 2 0 0 1-1.7 3H5.5a2 2 0 0 1-1.7-3z" /><path d="M12 10v3.5" /><circle cx="12" cy="16.6" r=".6" fill="currentColor" /></>, 'IconAlert');
export const IconInfo = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><circle cx="12" cy="8" r=".6" fill="currentColor" /></>, 'IconInfo');
export const IconUpload = make(<><path d="M12 15V4.5M7.5 9 12 4.5 16.5 9" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></>, 'IconUpload');
export const IconTemporary = make(<path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5z" strokeDasharray="2.6 2.4" />, 'IconTemporary');
export const IconChat = make(<path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5z" />, 'IconChat');
export const IconSparkle = make(<path d="m12 4 1.7 4.6L18.5 10.5l-4.8 1.8L12 17l-1.7-4.7L5.5 10.5l4.8-1.9z" />, 'IconSparkle');
export const IconBook = make(<><path d="M3.5 6.5c2.8-1 5.8-1 8.5 1 2.7-2 5.7-2 8.5-1V18c-2.8-1-5.8-1-8.5 1-2.7-2-5.7-2-8.5-1z" /><path d="M12 7.5V19" /></>, 'IconBook');
export const IconLock = make(<><rect x="5.5" y="10.5" width="13" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>, 'IconLock');
export const IconOpenPage = make(<><path d="M14 4.5h5.5V10M19.5 4.5 12 12" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>, 'IconOpenPage');
export const IconFitWidth = make(<path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3" />, 'IconFitWidth');
export const IconFlask = make(<path d="M9.5 4h5M10.5 4v5.5L5.8 17.6A1.6 1.6 0 0 0 7.2 20h9.6a1.6 1.6 0 0 0 1.4-2.4L13.5 9.5V4" />, 'IconFlask');
export const IconSun = make(<><circle cx="12" cy="12" r="3.8" /><path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3" /></>, 'IconSun');
export const IconMoon = make(<path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z" />, 'IconMoon');
export const IconMonitor = make(<><rect x="3.5" y="5" width="17" height="11" rx="2" /><path d="M9 20h6M12 16v4" /></>, 'IconMonitor');
export const IconCompose = make(<><path d="M12 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /><path d="m17.5 4.5 2 2L13 13l-2.7.7.7-2.7z" /></>, 'IconCompose');
export const IconClock = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>, 'IconClock');
export const IconEye = make(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>, 'IconEye');

/** Brand mark: a page with a folded corner and a saffron highlight stroke. */
export function BrandMark({ size = 26 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
			<rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
			<path d="M10 8.5h8.5L23 13v10.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 9 23.5v-13.5A1.5 1.5 0 0 1 10.5 8.5z" fill="var(--accent-ink)" opacity=".96" />
			<path d="M18.5 8.5V13H23" fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeLinejoin="round" />
			<rect x="11.5" y="16.2" width="9" height="3" rx="1.2" fill="#f2c25a" />
			<path d="M11.8 21.6h6.4" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
		</svg>
	);
}
