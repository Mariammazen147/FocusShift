import * as vscode from 'vscode';
import { WelcomePanel } from './welcomePanel';
import { EditorContext } from '../core/stateManager';

/**
 * Registers the window-focus listener that triggers the welcome popup.
 * Called once from extension.ts during activation.
 */
export function activatePopup(context: vscode.ExtensionContext): void {

  vscode.window.onDidChangeWindowState(
    (event: vscode.WindowState) => {
      if (event.focused) {
        showPopupIfStateExists(context);
      }
    },
    null,
    context.subscriptions
  );
}

/**
 * Reads the last saved WorkspaceContext from globalState, extracts the
 * active EditorContext, and passes it to WelcomePanel.
 */
function showPopupIfStateExists(context: vscode.ExtensionContext): void {
  const raw = context.globalState.get<string>('focusshift.lastState');

  if (!raw) {
    return;
  }

  let state: EditorContext;
  try {
    const parsed = JSON.parse(raw);

    // StateManager now saves a WorkspaceContext { editors[], activeEditorUri }
    // Extract the active editor's context, falling back to the first one
    let editorCtx: any;
    if (parsed.editors && Array.isArray(parsed.editors)) {
      editorCtx = parsed.editors.find(
        (e: any) => e.fileUri === parsed.activeEditorUri
      ) ?? parsed.editors[0];
    } else {
      // Legacy flat format — use as-is
      editorCtx = parsed;
    }

    if (!editorCtx) {
      console.warn('FocusShift: No editor context found in saved state.');
      return;
    }

    // vscode.Position doesn't survive JSON round-trip — reconstruct it
    const now = Date.now();
    const capturedAt = editorCtx.timestamp ?? parsed.timestamp ?? 0;
    const awaySeconds = capturedAt ? Math.floor((now - capturedAt) / 1000) : 0;
    console.log('FocusShift popup: timestamp =', capturedAt, '| now =', now, '| away =', awaySeconds, 's');

    state = {
      ...editorCtx,
      position: new vscode.Position(
        editorCtx.position?.line ?? 0,
        editorCtx.position?.character ?? 0
      ),
      awayDuration: awaySeconds
    };
  } catch (err) {
    console.error('FocusShift: Failed to parse saved state for popup:', err);
    return;
  }

  // Small delay so VS Code finishes re-focusing before the panel appears
  setTimeout(() => {
    WelcomePanel.show(context, state);
  }, 400);
}
