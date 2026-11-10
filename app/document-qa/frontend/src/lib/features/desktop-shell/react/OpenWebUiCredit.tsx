/**
 * Required Open WebUI attribution. The frontend is distributed under the Open WebUI License
 * (see frontend/LICENSE and static/BRANDING.md), which forbids removing Open WebUI branding; keep this
 * credit visible in the sidebar footer and in Settings/About. The logo is the unmodified bundled
 * Open WebUI favicon. https://docs.openwebui.com/license
 */
export function OpenWebUiCredit({ className = '' }: { className?: string }) {
	return (
		<p className={`shell-credit ${className}`.trim()}>
			<img src="/static/favicon.png" alt="Open WebUI logo" width={14} height={14} className="shell-credit-logo" />
			<span>Built on Open WebUI</span>
		</p>
	);
}
