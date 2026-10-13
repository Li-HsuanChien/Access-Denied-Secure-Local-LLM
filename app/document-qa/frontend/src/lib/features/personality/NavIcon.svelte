<script lang="ts">
	/** Outline icons for the product-owned sidebar destinations. */
	export let name: 'library' | 'history' | 'settings';
	export let className = 'size-4';
</script>

<svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	{#if name === 'library'}
		<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM9 4h4.5v16H9M15.2 6.3l3.4-.9 3 11.6-3.4.9-3-11.6Z" />
	{:else if name === 'history'}
		<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v3.9h3.9M12 7.5V12l3 2" />
	{:else}
		<path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
	{/if}
</svg>
