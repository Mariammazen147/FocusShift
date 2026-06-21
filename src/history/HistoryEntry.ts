import { EditorContext } from '../core/stateManager';

export interface HistoryEntry {
  id: string;                  // unique ID — Date.now().toString()
  timestamp: number;           // when the interruption happened (Date.now())
  fileUri: string;             // full URI of the file
  fileName: string;            // just the filename for display (e.g. "Main.java")
  line: number;                // cursor line number (1-indexed)
  heuristicSummary: string;    // always available
  llmSummary?: string;         // optional — only if Ollama was running
  snapshot: EditorContext;     // full context needed to restore
}
