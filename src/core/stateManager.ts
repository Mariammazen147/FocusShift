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

export interface WorkspaceContext {
  editors: EditorContext[];
  activeEditorUri?: string;
  timestamp: number;
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

  // --- Capture current workspace state ---
  public captureState() {
    const editors = vscode.window.visibleTextEditors;
    if (editors.length === 0) {
      console.warn("FocusShift: No open editors, cannot capture state.");
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    const now = Date.now();
    this.lastCaptureTime = now;

    const editorContexts: EditorContext[] = editors.map(editor => {
      const doc = editor.document;
      const pos = editor.selection.active;
      const snippet = this.extractEnclosingBlock(doc, pos);

      return {
        fileUri: doc.uri.toString(),
        position: pos,
        snippet,
        timestamp: now,
        editHistory: [...this.editHistory],
        cursorHistory: [...this.cursorHistory],
        scrollHistory: [...this.scrollHistory],
        tabHistory: [...this.tabHistory]
      };
    });

    const workspaceContext: WorkspaceContext = {
      editors: editorContexts,
      activeEditorUri: activeEditor ? activeEditor.document.uri.toString() : undefined,
      timestamp: now
    };

    this.storage.update('focusshift.lastState', JSON.stringify(workspaceContext));
    console.log(`FocusShift: State captured for ${editors.length} editors`);
  }

  // --- Restore saved workspace state ---
  public async restoreState() {
    const raw = this.storage.get<string>('focusshift.lastState');
    if (!raw) {
      console.warn("FocusShift: No saved state found to restore.");
      return;
    }

    let state: WorkspaceContext;
    try {
      state = JSON.parse(raw) as WorkspaceContext;
    } catch (err) {
      console.error("FocusShift: Failed to parse saved state:", err);
      return;
    }

    try {
      // Open all editors that were open
      for (const editorContext of state.editors) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(editorContext.fileUri));
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        editor.selection = new vscode.Selection(editorContext.position, editorContext.position);
      }

      // Make the previously active editor active again
      if (state.activeEditorUri) {
        const activeDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(state.activeEditorUri));
        await vscode.window.showTextDocument(activeDoc);
      }
    } catch (err) {
      console.error("FocusShift: Failed to restore workspace state:", err);
      return;
    }

    await this.storage.update('focusshift.lastState', undefined);

    const now = Date.now();
    const awayDuration = this.lastCaptureTime ? Math.floor((now - this.lastCaptureTime) / 1000) : 0;

    // Update away duration for all editors
    state.editors.forEach(editor => {
      editor.awayDuration = awayDuration;
    });

    console.log(`FocusShift: Workspace state restored after ${awayDuration} seconds away`);
    this.writeLog(state);
  }

  // --- Save histories to a JSON log file (per day) ---
  private writeLog(state: WorkspaceContext) {
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
        activeEditor: state.activeEditorUri,
        awayDuration: state.editors[0]?.awayDuration || 0,
        editors: state.editors.map(editor => ({
          file: editor.fileUri,
          position: editor.position,
          snippet: editor.snippet,
          edits: editor.editHistory,
          cursorMoves: editor.cursorHistory,
          scrolls: editor.scrollHistory,
          tabSwitches: editor.tabHistory
        }))
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