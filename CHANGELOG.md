# Changelog

All notable changes to FocusShift will be documented in this file.

## [0.2.1]

### Fixed
- Removed a stray auto-close timer that had accidentally leaked into the Context History panel — it was silently closing after 15 seconds, even mid-browse. The History panel now stays open until you close it.
- Fixed a test-isolation bug where a disabled-chime test permanently mutated a shared mock, silently affecting other tests run after it.

### Changed
- Synced the `minAwayMinutes` default between `popupManager.ts` and `detection.ts`, which had drifted out of sync (0.5 vs. 1 minute).

## [0.2.0]

### Changed
- The welcome popup now auto-dismisses after 15 seconds of no interaction, so it behaves like a transient notification rather than a tab you have to remember to close. Any interaction with the popup resets the timer.
- Renamed the `focusshift.minAwaySeconds` setting to `focusshift.minAwayMinutes` for consistency with `inactivityMinutes` (accepts decimals, e.g. `0.5` = 30 seconds).
- The "away time" shown in the popup now displays in minutes, switching to hours + minutes once past 60 minutes, instead of always showing minutes and seconds.
- Consolidated the Ollama model name (`qwen2.5-coder:1.5b-instruct`) into a single exported constant instead of duplicating the string across four files.

### Fixed
- `restoreState()` no longer aborts the entire restore if one file fails to reopen (e.g. deleted or moved while away) — it now isolates each file's reopen attempt and still restores everything else.
- `restoreState()` no longer redundantly reopens editors that are already open — it only reopens files that were actually closed, and only refocuses the previously active one.
- Added error handling around the window-blur and inactivity-timer listeners in `detection.ts`, which previously had no try/catch at all.
- Chime playback failures now show a status bar message instead of failing silently with only a console log.
- The Ollama setup command now verifies installation actually succeeded (via a terminal-close listener) instead of assuming success once the terminal opens.
- Fixed the heuristic summarizer's method-name detection for typed languages (Java, C#, C++) — it previously failed on methods with an explicit return type (e.g. `public int calculate(...)`), mistaking the return type for the method name.
- Deduplicated the `escapeHtml` helper, which had separately existed in both `welcomePanel.ts` and `HistoryPanel.ts`, into a single shared export in `renderSummary.ts`.

## [0.1.1]

### Added
- Publishing metadata for the VS Code Marketplace: `repository`, `icon`, and `keywords` fields in `package.json`.

### Fixed
- Resolved a version mismatch between `engines.vscode` and `@types/vscode` that blocked packaging.

## [0.1.0]

### Added
- Initial release: automatic interruption detection (window blur + configurable inactivity timer), instant context restore, audio chime on return, a two-tier summarization engine (instant heuristic + optional local AI via Ollama), a searchable Context History panel, and a sidebar for quick access to Settings, History, and Ollama setup.