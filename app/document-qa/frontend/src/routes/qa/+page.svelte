<script lang="ts">
	import { page } from '$app/stores';
	import AnsweringView from '$lib/features/answering/AnsweringView.svelte';
	import { createAnsweringClient } from '$lib/features/answering/answeringClient';
	import { createFixtureAnsweringClient } from '$lib/features/answering/fixtureAnsweringClient';
	import { createHistoryClient } from '$lib/features/history/historyClient';
	import { createSettingsClient } from '$lib/features/settings/settingsClient';
	const historyClient = createHistoryClient();
	const settingsClient = createSettingsClient();

	$: client = $page.url.searchParams.get('fixture') === '1'
		? createFixtureAnsweringClient()
		: createAnsweringClient({ baseUrl: 'http://127.0.0.1:8765' });
</script>

{#key client}<AnsweringView {client} {historyClient} {settingsClient} />{/key}
