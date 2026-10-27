/** Product privacy is URL-derived, scoped to a new chat, and never persisted. */
export function isLocalTemporaryChat(url: URL): boolean {
 return (url.pathname === '/' || url.pathname === '/qa') &&
  url.searchParams.get('local-temporary') === 'true';
}
