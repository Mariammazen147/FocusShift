import * as vscode from 'vscode';
import { HistoryService } from './HistoryService';
import { HistoryEntry } from './HistoryEntry';

export class HistoryPanel {
  private static currentPanel: HistoryPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly historyService: HistoryService;

  public static createOrShow(
    context: vscode.ExtensionContext,
    historyService: HistoryService
  ): void {
    if (HistoryPanel.currentPanel) {
      HistoryPanel.currentPanel.panel.reveal();
      HistoryPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'focusshiftHistory',
      'FocusShift History',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    HistoryPanel.currentPanel = new HistoryPanel(panel, historyService);
    context.subscriptions.push(panel);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    historyService: HistoryService
  ) {
    this.panel = panel;
    this.historyService = historyService;

    this.refresh();

    // Handle messages from the webview (restore, delete, clearAll)
    this.panel.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'restore':
          await this.restoreEntry(message.entryId);
          break;
        case 'delete':
          this.historyService.delete(message.entryId);
          this.refresh(); // re-render the list
          break;
        case 'clearAll':
          this.historyService.clearAll();
          this.refresh();
          break;
      }
    });

    this.panel.onDidDispose(() => {
      HistoryPanel.currentPanel = undefined;
    });
  }

  /** Re-render the panel with latest history */
  public refresh(): void {
    const entries = this.historyService.getAll();
    this.panel.webview.html = this.getHtml(entries);
  }

  /** Restore editor state from a history entry */
  private async restoreEntry(entryId: string): Promise<void> {
    const entries = this.historyService.getAll();
    const entry = entries.find(e => e.id === entryId);
    if (!entry) { return; }

    await vscode.commands.executeCommand('focusshift.restoreContext', entry.snapshot);
  }

  /** Generate the full HTML for the history panel */
  private getHtml(entries: HistoryEntry[]): string {
    const rows = entries.length === 0
      ? `<p class="empty">No interruptions recorded yet.</p>`
      : entries.map(e => {
          const date = new Date(e.timestamp).toLocaleString();
          const summary = e.llmSummary ?? e.heuristicSummary;
          return `
            <div class="entry">
              <div class="entry-header">
                <span class="file">${this.escapeHtml(e.fileName)}</span>
                <span class="line">Line ${e.line}</span>
                <span class="date">${this.escapeHtml(date)}</span>
              </div>
              <p class="summary">${this.escapeHtml(summary)}</p>
              <div class="actions">
                <button onclick="restore('${e.id}')">↩ Restore</button>
                <button class="danger" onclick="deleteEntry('${e.id}')">🗑 Delete</button>
              </div>
            </div>
          `;
        }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
    }
    h1 { font-size: 18px; margin-bottom: 16px; }
    .entry {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .entry-header {
      display: flex;
      gap: 12px;
      margin-bottom: 6px;
      font-size: 12px;
      opacity: 0.8;
    }
    .file { font-weight: bold; }
    .summary { margin: 6px 0 10px 0; font-size: 13px; }
    .actions { display: flex; gap: 8px; }
    button {
      padding: 4px 12px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      font-size: 12px;
    }
    button.danger {
      background: var(--vscode-inputValidation-errorBackground);
    }
    .clear-all {
      margin-bottom: 16px;
    }
    .empty { opacity: 0.6; }
  </style>
</head>
<body>
  <h1>📋 FocusShift History</h1>
  ${entries.length > 0 ? `<button class="clear-all danger" onclick="clearAll()">🗑 Clear All</button>` : ''}
  ${rows}
  <script>
    const vscode = acquireVsCodeApi();
    function restore(id)      { vscode.postMessage({ command: 'restore',  entryId: id }); }
    function deleteEntry(id)  { vscode.postMessage({ command: 'delete',   entryId: id }); }
    function clearAll()       { vscode.postMessage({ command: 'clearAll'              }); }
  </script>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
