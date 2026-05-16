import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SummaryService } from '../summary/SummaryService';

export interface EditorContext {
  fileUri: string;
  position: vscode.Position;
  snippet: string;
  timestamp: number;
  language: string;
  editHistory: { time: string; change: string }[];
  cursorHistory: { time: string; action: string }[];
  scrollHistory: { time: string; action: string }[];
  tabHistory: { time: string; action: string }[];
  awayDuration?: number;
  errors: { line: number; severity: string; message: string }[];
}

export interface WorkspaceContext {
  editors: EditorContext[];
  activeEditorUri?: string;
  timestamp: number;
}

export class StateManager {
  private storage: vscode.Memento;
  private summaryService = new SummaryService();

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
      const diagnostics = vscode.languages.getDiagnostics(doc.uri);

      return {
        fileUri: doc.uri.toString(),
        position: pos,
        snippet,
        timestamp: now,
        language: doc.languageId,
        editHistory: [...this.editHistory],
        cursorHistory: [...this.cursorHistory],
        scrollHistory: [...this.scrollHistory],
        tabHistory: [...this.tabHistory],
        errors: diagnostics.map(d => ({
          line: d.range.start.line + 1,
          severity: vscode.DiagnosticSeverity[d.severity],
          message: d.message
        }))
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

  // --- Test command: run LLM on current editor state without blur/refocus ---
  public async testLLMNow() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('FocusShift: Open a file first!');
      return;
    }

    const doc = editor.document;
    const pos = editor.selection.active;
    const snippet = this.extractEnclosingBlock(doc, pos);

    const language = doc.languageId;
    const diagnostics = vscode.languages.getDiagnostics(doc.uri);

    const ctx: EditorContext = {
      fileUri: doc.uri.toString(),
      position: pos,
      snippet,
      timestamp: Date.now(),
      language,
      editHistory:   this.editHistory,
      cursorHistory: this.cursorHistory,
      scrollHistory: this.scrollHistory,
      tabHistory:    this.tabHistory,
      awayDuration:  0,
      errors: diagnostics.map(d => ({
        line: d.range.start.line + 1,
        severity: vscode.DiagnosticSeverity[d.severity],
        message: d.message
      }))
    };

    console.log('FocusShift [test]: edits:', ctx.editHistory.length, 'cursors:', ctx.cursorHistory.length);
    vscode.window.showInformationMessage('FocusShift: Asking Ollama, check the summary file in ~5s...');

    const summary = await this.summaryService.generateLLMSummary(ctx);
    console.log('FocusShift [test] LLM result:', summary ?? 'undefined');

    if (summary) {
      this.writeSummaryFile(ctx, summary);
      vscode.window.showInformationMessage(`FocusShift: ${summary}`);
    } else {
      vscode.window.showWarningMessage('FocusShift: Ollama returned nothing — check the Debug Console for details.');
    }
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

    // Use the active editor's context for the LLM summary
    const activeCtx = state.editors.find(e => e.fileUri === state.activeEditorUri) ?? state.editors[0];
    if (activeCtx) {
      console.log('FocusShift: Calling LLM summary...');
      console.log('FocusShift: edits:', activeCtx.editHistory.length, 'cursors:', activeCtx.cursorHistory.length, 'scrolls:', activeCtx.scrollHistory.length);
      const summary = await this.summaryService.generateLLMSummary(activeCtx);
      console.log('FocusShift: LLM summary result:', summary ?? 'undefined (Ollama unreachable or returned nothing)');
      if (summary) {
        this.writeSummaryFile(activeCtx, summary);
      }
    }
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

  // --- Write LLM summary to a text file ---
  private writeSummaryFile(state: EditorContext, summary: string) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) { return; }

      const dateStr = new Date().toISOString().split('T')[0];
      const summaryPath = path.join(workspaceFolders[0].uri.fsPath, `focusshift-summary-${dateStr}.txt`);

      const entry =
        `[${new Date().toLocaleString()}]\n` +
        `File: ${state.fileUri}\n` +
        `Away: ${state.awayDuration ?? 0}s\n` +
        `Summary: ${summary}\n` +
        `${'─'.repeat(60)}\n`;

      fs.appendFileSync(summaryPath, entry, 'utf8');
      console.log(`FocusShift: LLM summary saved to ${summaryPath}`);
    } catch (err) {
      console.error('FocusShift: Failed to write summary file:', err);
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
