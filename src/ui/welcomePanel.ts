import * as vscode from 'vscode';
import * as path from 'path';
import { EditorContext } from '../core/stateManager';
import { playChimeIfEnabled } from '../audio/chimePlayer';
import { SummaryService } from '../summary/SummaryService';
import { getHeuristicSummary } from '../summary/heuristic';

/**
 * Manages the lifecycle of the FocusShift welcome-back webview panel.
 * Only one panel is shown at a time.
 */
export class WelcomePanel {
  private static current: WelcomePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly summaryService = new SummaryService();
  private disposables: vscode.Disposable[] = [];

  // ── Factory ──────────────────────────────────────────────────────────────

  public static show(
    extensionContext: vscode.ExtensionContext,
    state: EditorContext
  ): void {
    if (WelcomePanel.current) {
      WelcomePanel.current.update(state);
      WelcomePanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'focusshiftWelcome',
      'FocusShift',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: false }
    );

    // Play chime as the popup appears
    playChimeIfEnabled();

    WelcomePanel.current = new WelcomePanel(panel, extensionContext, state);
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    state: EditorContext
  ) {
    this.panel = panel;
    this.context = context;

    this.update(state);

    this.panel.webview.onDidReceiveMessage(
      (msg: { command: string }) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private handleMessage(msg: { command: string }): void {
    switch (msg.command) {
      case 'jump':
        // Pass skipLLM=true — the popup already called generateLLMSummary,
        // no need for stateManager to make a second concurrent Ollama request
        vscode.commands.executeCommand('focusshift.restore', true);
        this.dispose();
        break;
      case 'dismiss':
        this.dispose();
        break;
    }
  }

  // ── HTML builder ──────────────────────────────────────────────────────────

  /**
   * Show a loading state immediately, then kick off the async summary
   * and update the panel once the result is ready.
   */
  private update(state: EditorContext): void {
    // 1. Render instantly with heuristic so the popup never feels slow
    const heuristicDesc = this.getHeuristicDesc(state);
    this.panel.webview.html = this.renderHtml(state, heuristicDesc, false);

    // 2. Only attempt LLM upgrade if user hasn't disabled it
    const llmEnabled = vscode.workspace
      .getConfiguration('focusshift')
      .get<boolean>('enableLLMSummary', true);

    if (!llmEnabled) {
      // User disabled LLM — heuristic is the final result, nothing more to do
      return;
    }

    // 3. Try to upgrade with the LLM summary in the background
    this.summaryService.generateLLMSummary(state).then(llmDesc => {
      if (llmDesc && WelcomePanel.current) {
        this.panel.webview.html = this.renderHtml(state, llmDesc, true);
      }
    }).catch(() => {
      // Ollama not running — heuristic already shown, nothing to do
    });
  }

  /** Quick synchronous fallback using the heuristic engine */
  private getHeuristicDesc(state: EditorContext): string {
    try {
      // getHeuristicSummary needs a TextDocument — reconstruct a minimal one
      // from the saved URI if the file is still open, otherwise use snippet
      const openDoc = vscode.workspace.textDocuments.find(
        d => d.uri.toString() === state.fileUri
      );
      if (openDoc) {
        const pos = new vscode.Position(state.position?.line ?? 0, state.position?.character ?? 0);
        return getHeuristicSummary(openDoc, pos);
      }
    } catch { /* ignore */ }
    return this.buildContextDescription(state);
  }

  private renderHtml(state: EditorContext, contextDesc: string, isNlp: boolean): string {
    const llmEnabled = vscode.workspace
      .getConfiguration('focusshift')
      .get<boolean>('enableLLMSummary', true);
    const rawFile      = state.fileUri ? path.basename(decodeURIComponent(vscode.Uri.parse(state.fileUri).fsPath)) : 'unknown file';
    const col          = (state.position?.character ?? 0) + 1;
    const lineNumber   = (state.position?.line ?? 0) + 1;
    const fileDisplay  = this.escapeHtml(rawFile + '  Ln ' + lineNumber + ', Col ' + col);
    const awayDuration = this.escapeHtml(this.formatDuration(state.awayDuration ?? 0));
    const snippet      = this.escapeHtml(state.snippet ?? '// No snippet captured');
    const desc         = this.escapeHtml(contextDesc);
    const badge        = isNlp
      ? '<span class="nlp-badge">✨ AI</span>'
      : llmEnabled
        ? '<span class="nlp-badge heuristic">⚡ Quick</span>'
        : '<span class="nlp-badge heuristic">⚡ Heuristic</span>';

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>FocusShift</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--vscode-editor-background, #1e1e1e);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 14px;
    }

    /* ── Card ── */
    .card {
      background: #1e2130;
      border-radius: 14px;
      width: 100%;
      max-width: 480px;
      overflow: hidden;
      box-shadow: 0 16px 48px rgba(0,0,0,0.6);
      opacity: 0;
      transform: scale(0.96) translateY(12px);
      animation: popIn 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards;
    }

    @keyframes popIn  { to { opacity: 1; transform: scale(1) translateY(0); } }
    @keyframes popOut { to { opacity: 0; transform: scale(0.95) translateY(8px); } }
    .dismissing { animation: popOut 0.2s ease forwards; }

    /* ── Blue header ── */
    .card-header {
      background: linear-gradient(135deg, #2563eb, #3b82f6);
      padding: 20px 20px 18px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .header-icon {
      width: 44px; height: 44px;
      background: rgba(255,255,255,0.18);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px;
      flex-shrink: 0;
    }

    .header-text h2 {
      color: #fff;
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 2px;
    }

    .header-text p {
      color: rgba(255,255,255,0.75);
      font-size: 13px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      padding-top: 2px;
    }

    .btn-icon {
      background: rgba(255,255,255,0.18);
      border: none; cursor: pointer;
      color: #fff;
      width: 30px; height: 30px;
      border-radius: 6px;
      font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    .btn-icon:hover { background: rgba(255,255,255,0.3); }

    /* ── Body ── */
    .card-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* ── Info rows ── */
    .info-row {
      background: #252840;
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .info-icon {
      font-size: 18px;
      flex-shrink: 0;
      opacity: 0.85;
    }

    .info-label {
      color: #8b92b8;
      font-size: 12px;
      margin-bottom: 3px;
    }

    .info-value {
      color: #e2e8f0;
      font-size: 14px;
      font-weight: 600;
    }

    .info-value .mono {
      font-family: monospace;
      color: #a5b4fc;
    }

    /* ── Context analysis box ── */
    .context-box {
      background: #252840;
      border-radius: 10px;
      padding: 14px;
    }

    .context-title {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #e2e8f0;
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 10px;
    }

    /* NLP vs heuristic badge */
    .nlp-badge {
      margin-left: auto;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 20px;
      background: #2563eb;
      color: #fff;
      letter-spacing: 0.3px;
    }
    .nlp-badge.heuristic {
      background: #475569;
    }

    .context-desc {
      color: #94a3b8;
      font-size: 13px;
      line-height: 1.6;
      margin-bottom: 12px;
    }

    .code-block {
      background: #0f1117;
      border-radius: 7px;
      padding: 12px 14px;
      font-family: monospace;
      font-size: 12px;
      line-height: 1.6;
      overflow-x: auto;
      white-space: pre;
    }

    .code-comment { color: #4ec94e; }
    .code-text    { color: #e2e8f0; }

    /* ── Continue button ── */
    .btn-continue {
      width: 100%;
      padding: 13px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, transform 0.1s;
    }
    .btn-continue:hover  { background: #3b82f6; }
    .btn-continue:active { transform: scale(0.98); }
  </style>
</head>
<body>
  <div class="card" id="card">

    <!-- Blue header -->
    <div class="card-header">
      <div class="header-left">
        <div class="header-icon">🧠</div>
        <div class="header-text">
          <h2>Welcome Back!</h2>
          <p>Focus Shift restored your context</p>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn-icon" id="btnClose" title="Dismiss">✕</button>
      </div>
    </div>

    <!-- Body -->
    <div class="card-body">

      <!-- Away duration row -->
      <div class="info-row">
        <span class="info-icon">⏱️</span>
        <div>
          <div class="info-label">You were away for</div>
          <div class="info-value">${awayDuration}</div>
        </div>
      </div>

      <!-- File row -->
      <div class="info-row">
        <span class="info-icon">📄</span>
        <div>
          <div class="info-label">You were working in</div>
          <div class="info-value"><span class="mono">${fileDisplay}</span></div>
        </div>
      </div>

      <!-- Context analysis -->
      <div class="context-box">
        <div class="context-title">
          <span>🧠</span> Context Analysis ${badge}
        </div>
        <p class="context-desc">${desc}</p>
        <div class="code-block"><span class="code-comment">// Your last position:</span>
<span class="code-text">${snippet}</span></div>
      </div>

      <!-- Continue button -->
      <button class="btn-continue" id="btnJump">Continue Working</button>

    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function dismiss(action) {
      const card = document.getElementById('card');
      card.classList.add('dismissing');
      card.addEventListener('animationend', () => {
        vscode.postMessage({ command: action });
      }, { once: true });
    }

    document.getElementById('btnJump').addEventListener('click',  () => dismiss('jump'));
    document.getElementById('btnClose').addEventListener('click', () => dismiss('dismiss'));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') dismiss('dismiss'); });
  </script>
</body>
</html>`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Regex-based fallback when the document isn't open in the workspace */
  private buildContextDescription(state: EditorContext): string {
    const line    = (state.position?.line ?? 0) + 1;
    const snippet = state.snippet ?? '';
    if (/function\s+\w+/.test(snippet) || /=>\s*\{/.test(snippet)) {
      return 'You were editing a function definition on line ' + line + '.';
    }
    if (/class\s+\w+/.test(snippet)) {
      return 'You were working inside a class definition on line ' + line + '.';
    }
    if (/import\s+/.test(snippet)) {
      return 'You were managing imports on line ' + line + '.';
    }
    return 'You were editing on line ' + line + '. Pick up right where you left off.';
  }

  private formatDuration(seconds: number): string {
    if (seconds <= 0) { return 'a moment'; }
    if (seconds < 60) { return seconds + ' sec'; }
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? (m + ' min ' + s + ' sec') : (m + ' min');
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private dispose(): void {
    WelcomePanel.current = undefined;
    this.panel.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
