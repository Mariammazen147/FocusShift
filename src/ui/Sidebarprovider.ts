import * as vscode from 'vscode';
import { getOllamaStatus } from '../setup/ollamastatus';

/**
 * Renders the FocusShift sidebar (Activity Bar icon -> panel).
 * Lets the user reach Settings, History, and Setup Ollama at any time,
 * not just when the welcome-back popup happens to be showing.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'focusshift.sidebarView';

  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    this.render();

    // Re-check Ollama status every time the panel becomes visible again —
    // e.g. the user ran setup in a terminal, switched away, and comes back.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.render();
      }
    });

    webviewView.webview.onDidReceiveMessage((msg: { command: string }) => {
      switch (msg.command) {
        case 'openSettings':
          vscode.commands.executeCommand('workbench.action.openSettings', 'focusshift');
          break;
        case 'openHistory':
          vscode.commands.executeCommand('focusshift.showHistory');
          break;
        case 'setupOllama':
          vscode.commands.executeCommand('focusshift.setupOllama');
          break;
        case 'refresh':
          this.render(true);
          break;
      }
    });
  }

  /** Call this from extension.ts right after the setup command is dispatched,
   *  so the panel doesn't wait for the user to click away and back. */
  public refresh(): void {
    this.render(true);
  }

  private render(forceRefresh = false): void {
    if (!this.view) { return; }
    const status = getOllamaStatus(forceRefresh);
    this.view.webview.html = this.buildHtml(status);
  }

  private buildHtml(status: { installed: boolean; modelReady: boolean }): string {
    const ollamaReady = status.installed && status.modelReady;

    const ollamaRow = ollamaReady
      ? `<div class="row disabled">
           <span class="row-label">Setup Ollama</span>
           <span class="status-badge">✓ Ready</span>
         </div>`
      : `<button class="row" id="setupOllama">
           <span class="row-label">Setup Ollama</span>
           <span class="status-badge muted">${status.installed ? 'Model missing' : 'Not installed'}</span>
         </button>`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  body {
    font-family: var(--vscode-font-family, sans-serif);
    padding: 8px;
    color: var(--vscode-foreground);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 8px;
    margin-bottom: 6px;
    background: var(--vscode-list-hoverBackground, #2a2d2e);
    border: none;
    border-radius: 6px;
    color: var(--vscode-foreground);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .row:hover { background: var(--vscode-list-activeSelectionBackground, #094771); }
  .row.disabled {
    cursor: default;
    opacity: 0.7;
  }
  .row-icon { font-size: 15px; }
  .row-label { flex: 1; }
  .status-badge {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 10px;
    background: #16825d;
    color: #fff;
  }
  .status-badge.muted { background: #555; }
  .refresh {
    display: block;
    margin-top: 4px;
    font-size: 11px;
    background: none;
    border: none;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    padding: 4px;
  }
</style>
</head>
<body>
  <button class="row" id="openSettings">
    <span class="row-label">Settings</span>
  </button>
  <button class="row" id="openHistory">
    <span class="row-label">Context History</span>
  </button>
  ${ollamaRow}
  <button class="refresh" id="refresh">Refresh Ollama status</button>

  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('openSettings').addEventListener('click', () =>
      vscode.postMessage({ command: 'openSettings' }));
    document.getElementById('openHistory').addEventListener('click', () =>
      vscode.postMessage({ command: 'openHistory' }));
    const setupBtn = document.getElementById('setupOllama');
    if (setupBtn) {
      setupBtn.addEventListener('click', () =>
        vscode.postMessage({ command: 'setupOllama' }));
    }
    document.getElementById('refresh').addEventListener('click', () =>
      vscode.postMessage({ command: 'refresh' }));
  </script>
</body>
</html>`;
  }
}