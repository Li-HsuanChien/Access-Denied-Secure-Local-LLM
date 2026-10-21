# Routed workflow integration

These assertions operate the real React routes and public clients. Every browser request to the production API origin is intercepted. Fixture mode answers locally; host mode forwards only `/health` and `/v1/requests` to the explicit disposable `http://127.0.0.1:8766`. Unexpected API paths fail and other origins are blocked and reported. Port 8765 is never contacted. No production fixture switch is installed.

Run from `app/document-qa/frontend`, with React already running on 5176 and installed Playwright/Chrome. Both scripts explicitly launch full Chrome through `chromium.executablePath()`; they do not use implicit headless shell. Results include request IDs, payloads, timings, counts, response outcomes, browser errors and blocked requests. Outputs default to a fresh OS temporary directory; use a path outside Vite's watched tree when overriding it.

```sh
node migration-parity/integration/fixture.browser.mjs
```

Host mode mutates disposable history/preferences and publishes then rolls back a locally generated PDF. Start the unchanged deterministic Python host with `SECURE_QA_DATA_DIR=/private/tmp/secure-qa-react-migration-baseline`, `--port 8766 --runtime fake --embedding fake` and a store inside that disposable directory. It must contain the seeded golden collection. Host mode refuses any other endpoint and checks that the model is a deterministic stub before writes.

```sh
REACT_INTEGRATION_MODE=host SECURE_QA_TEST_HOST_URL=http://127.0.0.1:8766 \
  node migration-parity/integration/host.browser.mjs
SECURE_QA_TEST_HOST_URL=http://127.0.0.1:8766 npm run test:host
```

`REACT_INTEGRATION_ORIGIN` can select another frontend loopback port. `REACT_INTEGRATION_OUTPUT` chooses an output directory. Run under a source write freeze to avoid development HMR replacing the mounted application during a case. These checks establish behavior, not pixel parity or real model qualification.

Fixture cases cover keyboard/IME, actual copy/edit/branch/regenerate/delete/source actions, duplicate dispatch, queue order, late answers/navigation/New Chat, save failure, committed preferences/failures, stale History results and publication identity/cancel/transport loss. The host case covers all four workflows through the unchanged API, including opening an existing full answer, disabled persistence, actual publication/rollback and actual cancellation refusal after completion. Successful cancellation and uncertain transport are deterministic fixture cases; host response delays occur only in the browser test transport.
