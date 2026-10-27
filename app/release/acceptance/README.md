# Packaged offline acceptance tests

`smoke.py` exercises the frozen demo host from a temporary working directory:
grounded answering, PDF upload/ingestion, publication, and persistence across
restarts. `--desktop <exe>` additionally renders the native chat, checks webview
HTTP calls, verifies service cleanup and rejects occupied service ports.
`--installer <setup.exe>` installs into a temporary directory, runs that native
test against the installed executable, and uninstalls it afterwards.

See the [release commands](../README.md). These are development smoke checks.
Network-disabled VM acceptance, DNS/outbound capture, real-model performance and
macOS/Linux qualification remain required for a production release under the
[SDD](../../../docs/architecture/SDD.md).
