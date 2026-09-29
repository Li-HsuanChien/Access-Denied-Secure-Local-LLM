# Frontend guidance

Follow the [PRD](../../../../docs/product/PRD.md) and [SDD](../../../../docs/architecture/SDD.md), including answer sections, citation expansion, Library publication states, History/settings behavior, accessibility, and one-question-at-a-time interaction.

The frontend uses Open WebUI's SvelteKit structure. Put user-facing code by feature under `lib/features/<feature>/` and keep `routes/` entry points thin. Keep components focused on presentation and interaction; evidence classification, publication safety, citation validity, and persistence decisions belong to backend workflow interfaces.

Keep UI tests beside or within the feature they cover. Test visible states, keyboard access, focus, semantic labels, contrast, and progress/error announcements. Do not introduce remote assets, telemetry, or network-backed behavior.
