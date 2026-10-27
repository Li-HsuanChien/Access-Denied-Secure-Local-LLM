import { writable } from 'svelte/store';

/** Shared current preference; durable storage is owned by the settings workflow. */
export const secureQaGeneralKnowledge = writable(true);
