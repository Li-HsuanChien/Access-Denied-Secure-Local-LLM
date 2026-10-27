import { expect, it } from 'vitest';
import { isLocalTemporaryChat } from './localChatMode';

it.each([
 ['/', false], ['/?local-temporary=true', true], ['/qa?local-temporary=true', true],
 ['/?local-temporary=false', false], ['/conversation/saved?local-temporary=true', false],
 ['/c/saved?local-temporary=true', false], ['/library?local-temporary=true', false],
 ['/history?local-temporary=true', false], ['/settings?local-temporary=true', false],
])('derives temporary mode for %s', (path, expected) => {
 expect(isLocalTemporaryChat(new URL(path, 'http://127.0.0.1:5173'))).toBe(expected);
});
