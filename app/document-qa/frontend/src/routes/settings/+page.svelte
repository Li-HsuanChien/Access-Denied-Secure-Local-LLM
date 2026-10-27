<script lang="ts">
	import SettingsView from '$lib/features/settings/SettingsView.svelte';
	import { createSettingsClient } from '$lib/features/settings/settingsClient';
	import { createHistoryClient } from '$lib/features/history/historyClient';
	const client = createSettingsClient();
	const history = createHistoryClient();
</script>
<SettingsView {client} {history} />
