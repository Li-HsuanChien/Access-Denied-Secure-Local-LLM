# Desktop shell tests

`lifecycle.rs` checks single-instance ownership, startup cancellation, port conflicts
and HTTP readiness through the native lifecycle interface. Run with
`cargo test --locked --manifest-path app/desktop/src-tauri/Cargo.toml --test lifecycle`.
Stage the payload first because Tauri's build script checks resources.

The mock HTTP server consumes the complete request headers before responding;
one TCP read may return a partial request, and closing with unread bytes can reset
the connection on Windows. Failure output includes the health-check error.

The native webview, frozen service, persistence and shutdown acceptance tests live
under `app/release/acceptance/`; see [release instructions](../../release/README.md).
