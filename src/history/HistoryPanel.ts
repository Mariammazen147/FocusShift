import * as vscode from 'vscode';
import { HistoryService } from './HistoryService';
import { HistoryEntry } from './HistoryEntry';
import { renderSummaryHtml, stripSummaryMarkdown } from '../summary/renderSummary';

/**
 * Lean shape sent to the webview for rendering + client-side search/filter.
 * fileName/dateStr/title/summaryHtml are pre-escaped/rendered on the extension
 * side and are safe to inject as-is. searchText is plain lowercase text used
 * ONLY for matching — it is never injected into the page as HTML.
 */
interface RenderableEntry {
  id: string;
  fileName: string;
  line: number;
  dateStr: string;
  title: string;
  summaryHtml: string;
  searchText: string;
}

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

  /** Convert one raw HistoryEntry into the pre-escaped shape the webview renders/filters. */
  private toRenderable(e: HistoryEntry): RenderableEntry {
    const date = new Date(e.timestamp).toLocaleString();
    const summary = e.llmSummary ?? e.heuristicSummary;
    const title = this.buildTitle(summary);
    return {
      id: e.id,
      fileName: this.escapeHtml(e.fileName),
      line: e.line,
      dateStr: this.escapeHtml(date),
      title: this.escapeHtml(title),
      summaryHtml: renderSummaryHtml(summary),
      searchText: `${e.fileName} ${summary}`.toLowerCase()
    };
  }

  /** Generate the full HTML for the history panel */
  private getHtml(entries: HistoryEntry[]): string {
    const renderable: RenderableEntry[] = entries.map(e => this.toRenderable(e));

    // Escaping "</" stops a filename/summary that happens to contain that
    // sequence from prematurely closing the <script> tag below.
    const entriesJson = JSON.stringify(renderable).replace(/<\//g, '<\\/');

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
    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .search-input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-size: 13px;
    }
    .filter-select {
      padding: 6px 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-size: 13px;
    }
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
  <h1>FocusShift History</h1>
  <div class="toolbar">
    <input class="search-input" id="searchInput" type="text" placeholder="Search by filename or summary...">
    <select class="filter-select" id="fileFilter">
      <option value="">All files</option>
    </select>
  </div>
  ${entries.length > 0 ? `<button class="clear-all danger" onclick="clearAll()">Clear All</button>` : ''}
  <div id="rows"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const allEntries = ${entriesJson};

    const searchInput     = document.getElementById('searchInput');
    const fileFilterSelect = document.getElementById('fileFilter');
    const rowsEl           = document.getElementById('rows');

    function renderRows(list) {
      if (list.length === 0) {
        rowsEl.innerHTML = allEntries.length === 0
          ? '<p class="empty">No interruptions recorded yet.</p>'
          : '<p class="empty">No matching interruptions.</p>';
        return;
      }
      rowsEl.innerHTML = list.map(e => \`
        <div class="entry">
          <div class="entry-header" onclick="toggleEntry('\${e.id}')">
            <div class="title">\${e.title}</div>
            <div class="entry-meta">
              <span class="file">\${e.fileName}</span>
              <span class="line">Line \${e.line}</span>
              <span class="date">\${e.dateStr}</span>
              <button class="danger" onclick="event.stopPropagation(); deleteEntry('\${e.id}')">Delete</button>
            </div>
          </div>
          <div class="entry-body" id="body-\${e.id}">
            <div class="summary">\${e.summaryHtml}</div>
          </div>
        </div>
      \`).join('');
    }

    function populateFileFilter() {
      const uniqueFiles = [...new Set(allEntries.map(e => e.fileName))].sort();
      for (const name of uniqueFiles) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        fileFilterSelect.appendChild(opt);
      }
    }

    function applyFilters() {
      const query = searchInput.value.trim().toLowerCase();
      const fileFilter = fileFilterSelect.value;
      const filtered = allEntries.filter(e => {
        if (fileFilter && e.fileName !== fileFilter) { return false; }
        if (query && !e.searchText.includes(query)) { return false; }
        return true;
      });
      renderRows(filtered);
    }

    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilters, 150);
    });
    fileFilterSelect.addEventListener('change', applyFilters);

    function toggleEntry(id)  { document.getElementById('body-' + id).classList.toggle('expanded'); }
    function deleteEntry(id)  { vscode.postMessage({ command: 'delete',   entryId: id }); }
    function clearAll()       { vscode.postMessage({ command: 'clearAll'              }); }

    populateFileFilter();
    renderRows(allEntries);
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