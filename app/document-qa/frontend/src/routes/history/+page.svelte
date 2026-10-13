<script lang="ts">
	import HistoryView from '$lib/features/history/HistoryView.svelte';
	import { createHistoryClient } from '$lib/features/history/historyClient';
	const client = createHistoryClient();
</script>
<HistoryView {client} />
