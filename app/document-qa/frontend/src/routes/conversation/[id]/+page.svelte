<script lang="ts">
	import { page } from '$app/stores';
	import Chat from '$lib/components/chat/Chat.svelte';
</script>

{#key $page.params.id}<Chat chatIdProp={$page.params.id} />{/key}
