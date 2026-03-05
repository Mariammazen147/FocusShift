import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface EditorContext {
  fileUri: string;
  position: vscode.Position;
  snippet: string;
  timestamp: number;
  editHistory: { time: string; change: string }[];
  cursorHistory: { time: string; action: string }[];
  scrollHistory: { time: string; action: string }[];
  tabHistory: { time: string; action: string }[];
  awayDuration?: number;
}

export class StateManager {
  private storage: vscode.Memento;

  private editHistory: { time: string; change: string }[] = [];
  private cursorHistory: { time: string; action: string }[] = [];
  private scrollHistory: { time: string; action: string }[] = [];
  private tabHistory: { time: string; action: string }[] = [];

  private lastCaptureTime: number | null = null;

  constructor(storage: vscode.Memento) {
    this.storage = storage;

    // --- Track edits ---
    vscode.workspace.onDidChangeTextDocument(event => {
      const changeSummary = event.contentChanges.map(change =>
        `Line ${change.range.start.line}, Col ${change.range.start.character} → "${change.text}"`
      ).join(', ');
      this.editHistory.push({
        time: new Date().toLocaleTimeString(),
        change: changeSummary
      });
    });

    // --- Track cursor moves ---
    vscode.window.onDidChangeTextEditorSelection(event => {
      const pos = event.selections[0].active;
      this.cursorHistory.push({
        time: new Date().toLocaleTimeString(),
        action: `Cursor → line ${pos.line}, col ${pos.character}`
      });
    });

    // --- Track scrolls ---
    vscode.window.onDidChangeTextEditorVisibleRanges(event => {
      const range = event.visibleRanges[0];
      this.scrollHistory.push({
        time: new Date().toLocaleTimeString(),
        action: `Scrolled → lines ${range.start.line}–${range.end.line}`
      });
    });

    // --- Track tab switches ---
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        this.tabHistory.push({
          time: new Date().toLocaleTimeString(),
          action: `Switched → ${editor.document.fileName}`
        });
      }
    });
  }

  // --- Capture current editor state ---
  public captureState() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      console.warn("FocusShift: No active editor, cannot capture state.");
      return;
    }

    const doc = editor.document;
    const pos = editor.selection.active;

    const snippet = this.extractEnclosingBlock(doc, pos);

    const now = Date.now();
    this.lastCaptureTime = now;

    const context: EditorContext = {
      fileUri: doc.uri.toString(),
      position: pos,
      snippet,
      timestamp: now,
      editHistory: this.editHistory,
      cursorHistory: this.cursorHistory,
      scrollHistory: this.scrollHistory,
      tabHistory: this.tabHistory
    };

    this.storage.update('focusshift.lastState', JSON.stringify(context));
    console.log('FocusShift: State captured');
  }

  // --- Restore saved editor state ---
  public async restoreState() {
    const raw = this.storage.get<string>('focusshift.lastState');
    if (!raw) {
      console.warn("FocusShift: No saved state found to restore.");
      return;
    }

    let state: EditorContext;
    try {
      state = JSON.parse(raw) as EditorContext;
    } catch (err) {
      console.error("FocusShift: Failed to parse saved state:", err);
      return;
    }

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(state.fileUri));
      const editor = await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(state.position, state.position);
    } catch (err) {
      console.error("FocusShift: Failed to restore editor state:", err);
      return;
    }

    await this.storage.update('focusshift.lastState', undefined);

    const now = Date.now();
    const awayDuration = this.lastCaptureTime ? Math.floor((now - this.lastCaptureTime) / 1000) : 0;
    state.awayDuration = awayDuration;

    console.log(`FocusShift: State restored after ${awayDuration} seconds away`);
    this.writeLog(state);
  }

  // --- Save histories to a JSON log file (per day) ---
  private writeLog(state: EditorContext) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        console.error("FocusShift: No workspace folder open. Cannot save log.");
        return;
      }

      const dateStr = new Date().toISOString().split('T')[0];
      const logFileName = `focusshift-${dateStr}.json`;
      const logPath = path.join(workspaceFolders[0].uri.fsPath, logFileName);

      console.log("FocusShift: Attempting to save log at:", logPath);

      const logEntry = {
        timestamp: new Date().toLocaleString(),
        file: state.fileUri,
        awayDuration: state.awayDuration,
        snippet: state.snippet,
        edits: state.editHistory,
        cursorMoves: state.cursorHistory,
        scrolls: state.scrollHistory,
        tabSwitches: state.tabHistory
      };

      let existing: any[] = [];
      if (fs.existsSync(logPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        } catch (err) {
          console.error("FocusShift: Failed to parse existing log file:", err);
          existing = [];
        }
      }
      existing.push(logEntry);

      fs.writeFileSync(logPath, JSON.stringify(existing, null, 2), 'utf8');
      console.log(`FocusShift: JSON log saved to ${logPath}`);
    } catch (err) {
      console.error("FocusShift: Failed to write log:", err);
    }
  }

  // --- Helper: extract nearest enclosing function/method/arrow ---
  private extractEnclosingBlock(doc: vscode.TextDocument, pos: vscode.Position): string {
    const text = doc.getText();
    const offset = doc.offsetAt(pos);

    const patterns = [
      /function\s+[\w$]+\s*\([^)]*\)\s*\{[^}]*\}/g,
      /[\w$]+\s*=\s*\([^)]*\)\s*=>\s*\{[^}]*\}/g,
      /[\w$]+\s*\([^)]*\)\s*\{[^}]*\}/g
    ];

    for (const regex of patterns) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;
        if (offset >= start && offset <= end) {
          return match[0];
        }
      }
    }

    const startLine = Math.max(0, pos.line - 5);
    const endLine = Math.min(doc.lineCount - 1, pos.line + 5);
    return doc.getText(new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, 0)));
  }
}