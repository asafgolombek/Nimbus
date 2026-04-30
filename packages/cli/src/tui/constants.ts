/**
 * Shared tuning constants for the Nimbus Rich TUI.
 *
 * Every time one of these needs a new value, reach for this file first —
 * not a per-component magic number.
 */

/** Below this terminal width, App.tsx collapses to a single-column layout. */
export const NARROW_LAYOUT_COLUMN_THRESHOLD = 100;

/**
 * Below this terminal height, we abandon Ink and fall back to the REPL.
 * Rationale: 5-pane layout cannot fit legibly below ~20 rows; honest fallback
 * beats a broken render.
 */
export const MIN_HEIGHT_THRESHOLD = 20;

/** Poll interval for ConnectorHealth + WatcherPane. Tunable if 30 s proves noisy. */
export const STATUS_POLL_INTERVAL_MS = 30_000;

/** Query history cap — last N entries kept in `tui-query-history.json`. */
export const QUERY_HISTORY_CAP = 100;

/** Time window for the "press again to exit" double-Ctrl+C gesture. */
export const DOUBLE_CTRL_C_WINDOW_MS = 2_000;

/** Duration the `^C Press again within 2s to exit` hint remains visible. */
export const CANCEL_HINT_DURATION_MS = 1_500;

/** Reconnect backoff schedule in milliseconds; last entry repeats indefinitely. */
export const RECONNECT_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

/** Progress-bar fill width (characters), excluding brackets. */
export const PROGRESS_BAR_WIDTH = 5;

/** Maximum firing-watcher names rendered in WatcherPane before silent truncation. */
export const WATCHER_PANE_NAME_LIMIT = 5;

/** Maximum sub-tasks rendered in SubTaskPane before truncation + "…N more" summary. */
export const SUBTASK_PANE_ROW_LIMIT = 8;
