# Settings frontend

`SettingsPage` and `SettingsClient` persist the general-knowledge default, own the history persistence switch and clear-all (through the History interface), offer a System/Light/Dark theme choice stored in the app's existing `theme` frontend preference, show live host/model/library readiness, and carry the "Built on Open WebUI" credit in About. It does not expose remote model connections, web search, plugins, autonomous tools, or runtime downloads. See the [offline controls](../../../../../../../docs/architecture/SDD.md#10-security-and-offline-operation).
