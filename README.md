FocusShift - VS Code Extension
Graduation Project - December 2025

Never lose your coding context again.

FocusShift is a Visual Studio Code extension that helps developers quickly resume work after
interruptions. When you step away (window blur or inactivity), it saves your exact editor state.
When you return — a subtle chime + smart welcome popup instantly re-anchors you to where you left off.

---

FEATURES

- Automatic interruption detection (window blur + configurable inactivity timer, default 5 minutes)
- Instant context restore (reopens the same file, jumps to exact line & column)
- Subtle audio chime on return (toggle on/off via command or settings)
- Smart welcome popup ("You were working in validateToken() in auth.ts — line 42")
- Two-tier summaries:
    - Heuristic (always available, instant): identifies the nearest class, method, function, or
      variable from the cursor position
    - LLM via Ollama (optional, local): generates a richer "Where You Were / Context / Suggestion"
      summary using a local AI model — 100% offline, nothing leaves your machine
- Context history panel: sidebar view listing every interruption with timestamp, file, line, and
  the summary — entries can be deleted individually or cleared all at once
- Configurable minimum away time before the popup triggers (default 30 seconds)
- 100% local & private — no data ever leaves your machine

---

QUICK START (Development Setup)

1. Clone the repository
   git clone https://github.com/Mariammazen147/FocusShift.git
   cd FocusShift

2. Install dependencies
   npm install

3. Compile the code (keep this running in a terminal)
   npm run watch

4. Launch the extension
   Press F5
   A new VS Code window opens ("[Extension Development Host]")
   FocusShift is now active

5. Try it out
   - Open any file and edit something
   - Switch away (alt-tab or wait for the inactivity timer)
   - Switch back → you should hear the chime and see the welcome popup
   - Click "Jump there" to return the cursor to its exact position

---

RUNNING UNIT TESTS

npm test

This compiles the TypeScript first (via the pretest hook), then runs all Jest suites.

Test suites (8 total, 59 tests):
  historyService.test.ts    — add, delete, clearAll, 50-entry cap
  summaryService.test.ts    — Ollama reachable / unreachable / empty response
  heuristic.test.ts         — function/class/method detection, verb selection
  stateManager.test.ts      — instantiation, captureState, restoreState
  historyPanel.test.ts      — singleton, webview messages (delete / clearAll)
  chimePlayer.test.ts       — playChimeIfEnabled, toggle, disabled path
  renderSummary.test.ts     — HTML rendering, markdown stripping, escaping
  ollamaSetup.test.ts       — isOllamaInstalled, isModelAvailable, checkAndSetup

To run a single suite:
  npx jest src/test/historyService.test.ts

To run with verbose output (each test name):
  npx jest --verbose

---

COMMANDS (Ctrl+Shift+P)

  FocusShift: Capture State         — manually save current editor state
  FocusShift: Restore State         — manually trigger the restore + popup
  FocusShift: Test Popup            — show the welcome popup immediately (for testing)
  FocusShift: Toggle Chime On/Off   — enable or disable the return chime
  FocusShift: Show Heuristic Summary — display the heuristic summary for the current cursor position
  FocusShift: Show LLM Summary      — run the Ollama LLM on the current editor (requires Ollama running)
  FocusShift: Show Context History  — open the history panel in the sidebar
  FocusShift: Setup Ollama          — guided installer for Ollama + model download

---

SETTINGS (settings.json or VS Code UI)

  focusshift.inactivityMinutes   — minutes of inactivity before state is saved (default: 5)
  focusshift.chimeEnabled        — enable/disable the audio chime (default: true)
  focusshift.enableLLMSummary    — use Ollama for AI summaries (default: true)
  focusshift.minAwaySeconds      — minimum seconds away before the popup shows (default: 30)

---

OLLAMA SETUP (for LLM summaries)

FocusShift uses a local Ollama model (qwen2.5-coder:1.5b-instruct) for AI summaries.
Ollama runs entirely on your machine — no internet connection needed after setup.

Option A: Automatic
  Run the command: FocusShift: Setup Ollama
  The extension will guide you through installing Ollama and pulling the model.

Option B: Manual
  1. Install Ollama from https://ollama.com
  2. Run: ollama pull qwen2.5-coder:1.5b-instruct
  3. Reload VS Code

If Ollama is not running or the model is unavailable, FocusShift automatically falls back to
the heuristic summary — no configuration needed.

---

FOLDER STRUCTURE

src/
  extension.ts       → entry point — registers all modules on activation
  core/
    stateManager.ts  → captures & restores editor state, tracks edit/cursor/scroll/tab history
    detection.ts     → inactivity timer, window blur/focus listeners
  audio/
    chimePlayer.ts   → WAV playback via node-wav-player, toggle command
  history/
    HistoryService.ts → stores interruption entries in VS Code global state (up to 50)
    HistoryPanel.ts  → singleton webview panel showing the history list
    HistoryEntry.ts  → data interface for a single history record
  summary/
    SummaryService.ts → calls Ollama HTTP API to generate LLM summaries
    heuristic.ts     → regex-based fallback summary (class, method, function, variable detection)
    renderSummary.ts → converts summary markdown to safe HTML for webviews
  setup/
    OllamaSetup.ts   → static helpers for checking/installing Ollama and pulling the model
  ui/
    welcomePanel.ts  → the "Welcome back" webview popup
    popupManager.ts  → triggers the popup on window focus if a saved state exists
  test/
    __mocks__/
      vscode.ts      → VS Code API mock for Jest (required to run outside the extension host)
    historyService.test.ts
    summaryService.test.ts
    heuristic.test.ts
    stateManager.test.ts
    historyPanel.test.ts
    chimePlayer.test.ts
    renderSummary.test.ts
    ollamaSetup.test.ts

media/
  chime.wav          → audio file played on return (WAV format required)

docs/
  codebase-overview.md → full class/function reference for UML diagram generation

---

NOTES

- Chime format: WAV files only (.wav). Place your chime at media/chime.wav.
- To test the chime manually: Ctrl+Shift+P → "FocusShift: Toggle Chime On/Off"
- The popup only appears if you were away for at least focusshift.minAwaySeconds (default 30s).
- LLM summaries time out after 2 minutes if Ollama is unresponsive — the heuristic runs instead.

---

TROUBLESHOOTING

"Cannot find module out/extension.js"
  → Run npm run compile or keep npm run watch running

Chime not playing
  → Confirm media/chime.wav exists
  → Confirm focusshift.chimeEnabled is true in settings

LLM summaries not appearing
  → Run: ollama list — check that qwen2.5-coder:1.5b-instruct appears
  → Run: ollama serve — start the Ollama daemon if it's not running
  → Check the VS Code Output panel (FocusShift channel) for error details

Tests failing
  → Run npm install to ensure devDependencies (jest, ts-jest, @types/jest) are installed
  → Run npx jest --verbose for per-test failure details

---

LICENSE
MIT License — see LICENSE file

Made with love for developers who hate losing their flow.
Team FocusShift - December 2025
