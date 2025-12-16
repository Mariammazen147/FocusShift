FocusShift - VS Code Extension
Graduation Project - December 2025

Never lose your coding context again.

FocusShift is a Visual Studio Code extension that helps developers quickly resume work after interruptions.
When you step away (window blur or inactivity), it saves your exact editor state.
When you return — a subtle chime + smart welcome popup instantly re-anchors you to where you left off.

FEATURES
- Automatic interruption detection (window blur + configurable inactivity timer, default 5 minutes)
- Instant context restore (opens the same file, jumps to exact line & column)
- Subtle audio chime (customizable: enable/disable, volume, multiple sounds)
- Smart welcome popup ("Welcome back! You were editing calculateExchange() in utils.ts line 142")
- Heuristic + custom-trained NLP summaries (fast fallback + advanced natural language option)
- 100% local & private — no data ever leaves your machine
- Lightweight (<2MB, minimal performance impact)

QUICK START (Development Setup)

1. Clone the repository
   git clone https://github.com/Mariammazen147/FocusShift.git
   cd focusshift

2. Install dependencies
   npm install

3. Compile the code (keep this running)
   npm run watch

4. Launch the extension
   Press F5
   → A new VS Code window opens ("[Extension Development Host]")
   → FocusShift is now active

5. Test it
   - Open any file
   - Step away (alt-tab or wait for inactivity timer)
   - Come back → you should hear the chime and see the welcome popup
   - Click "Jump there" → cursor returns to exact position

IMPORTANT NOTES

- Chime format: Use .wav files only (MP3 often doesn't work in VS Code)
  Place your chime in /media/chime.wav (or add more sounds later)

- To test the chime manually:
  Ctrl+Shift+P → type "FocusShift: Test Chime" → run it

- Commands for testing:
  FocusShift: Test Chime
  FocusShift: Show Last Context
  FocusShift: Hello (basic check) this one doesn't work yet

FOLDER STRUCTURE

src/
  core/              → blur detection, inactivity timer, save/restore logic
  audio/             → chime player, volume control
  ui/                → welcome popup, Webview design
  summary/           → heuristic summary + custom NLP model
  extension.ts       → main activation file (registers all modules)

media/               → put chime.wav here

nlp-model/           → training scripts and exported model (TensorFlow.js)

TEAM RESPONSIBILITIES

- Person 1: Core detection & state management
- Person 2: Audio chime system
- Person 3: Welcome popup UI
- Person 4: Heuristic summary engine
- Person 5: Custom NLP model training & integration

CONTRIBUTING

1. Work in your assigned folder
2. Keep npm run watch running
3. Test with F5 often
4. Commit regularly with clear messages
5. Pull latest changes before pushing

TROUBLESHOOTING

- "Cannot find module out/extension.js" → run npm run compile or npm run watch
- Chime not playing → use .wav file + run "Test Chime" command first (unlocks audio)

LICENSE
MIT License — see LICENSE file

Made with love for developers who hate losing their flow.

Team FocusShift - December 2025