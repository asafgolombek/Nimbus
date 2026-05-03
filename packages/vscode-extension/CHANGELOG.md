# Changelog

## 0.1.0 (Phase 4 release)

- Initial release.
- `Nimbus: Ask` — streaming chat in a persistent side panel.
- `Nimbus: Search` — Quick Pick over the local Nimbus index.
- `Nimbus: Run Workflow` — trigger a workflow from the palette.
- `Nimbus: Ask About Selection` / `Nimbus: Search Selection` — editor right-click menu commands with selection context.
- Status bar: profile name + connector health + HITL pending count (30 s poll).
- Context-sensitive HITL: inline in chat when visible+focused; non-modal toast otherwise (modal opt-in via `nimbus.hitlAlwaysModal`).
- Theme-synced Webview (Dark, Light, High Contrast).
- Gateway-backed transcript rehydration via `engine.getSessionTranscript`.
- `nimbus-item:` URI scheme for read-only structured search results.
