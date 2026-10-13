<script lang="ts">
	import LibraryView from '$lib/features/library/LibraryView.svelte';
	import { createLibraryClient } from '$lib/features/library/libraryClient';
	const client = createLibraryClient();
</script>
<LibraryView {client} />
