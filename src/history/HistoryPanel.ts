import * as vscode from 'vscode';
import { HistoryService } from './HistoryService';
import { HistoryEntry } from './HistoryEntry';
import { renderSummaryHtml, stripSummaryMarkdown } from '../summary/renderSummary';

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

    // Handle messages from the webview (delete, clearAll)
    this.panel.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
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

  /** Generate the full HTML for the history panel */
  private getHtml(entries: HistoryEntry[]): string {
    const rows = entries.length === 0
      ? `<p class="empty">No interruptions recorded yet.</p>`
      : entries.map(e => {
          const date = new Date(e.timestamp).toLocaleString();
          const summary = e.llmSummary ?? e.heuristicSummary;
          const title = this.buildTitle(summary);
          return `
            <div class="entry">
              <div class="entry-header" onclick="toggleEntry('${e.id}')">
                <div class="title">${this.escapeHtml(title)}</div>
                <div class="entry-meta">
                  <span class="file">${this.escapeHtml(e.fileName)}</span>
                  <span class="line">Line ${e.line}</span>
                  <span class="date">${this.escapeHtml(date)}</span>
                  <button class="danger" onclick="event.stopPropagation(); deleteEntry('${e.id}')">🗑 Delete</button>
                </div>
              </div>
              <div class="entry-body" id="body-${e.id}">
                <div class="summary">${renderSummaryHtml(summary)}</div>
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
      margin-bottom: 12px;
      overflow: hidden;
    }
    .entry-header {
      cursor: pointer;
      padding: 12px;
    }
    .entry-header:hover { background: var(--vscode-list-hoverBackground); }
    .title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .entry-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      opacity: 0.8;
    }
    .entry-meta .danger { margin-left: auto; }
    .file { font-weight: bold; }
    .entry-body {
      display: none;
      padding: 0 12px 12px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .entry-body.expanded { display: block; }
    .summary { margin: 10px 0 0 0; font-size: 13px; }
    .summary p { margin: 0 0 8px 0; }
    .summary p:last-child { margin-bottom: 0; }
    .summary ul { margin: 0 0 10px 18px; padding: 0; }
    .summary ul:last-child { margin-bottom: 0; }
    .summary li { margin-bottom: 4px; }
    .summary strong { font-weight: 700; }
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
    function toggleEntry(id)  { document.getElementById('body-' + id).classList.toggle('expanded'); }
    function deleteEntry(id)  { vscode.postMessage({ command: 'delete',   entryId: id }); }
    function clearAll()       { vscode.postMessage({ command: 'clearAll'              }); }
  </script>
</body>
</html>`;
  }

  /** Collapse a summary down to a single-line preview for the entry header */
  private buildTitle(summary: string): string {
    const oneLine = stripSummaryMarkdown(summary);
    const maxLen = 80;
    return oneLine.length > maxLen ? oneLine.slice(0, maxLen).trimEnd() + '…' : oneLine;
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