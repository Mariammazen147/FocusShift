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
 * active EditorContext, and shows the welcome popup directly.
 */
function showPopupIfStateExists(context: vscode.ExtensionContext): void {
  const raw = context.globalState.get<string>('focusshift.lastState');

  if (!raw) {
    return;
  }

  let state: EditorContext;
  try {
    const parsed = JSON.parse(raw);

    let editorCtx: any;
    if (parsed.editors && Array.isArray(parsed.editors)) {
      editorCtx = parsed.editors.find(
        (e: any) => e.fileUri === parsed.activeEditorUri
      ) ?? parsed.editors[0];
    } else {
      editorCtx = parsed;
    }

    if (!editorCtx) {
      console.warn('FocusShift: No editor context found in saved state.');
      return;
    }

    const now = Date.now();
    const capturedAt = editorCtx.timestamp ?? parsed.timestamp ?? 0;
    const awaySeconds = capturedAt ? Math.floor((now - capturedAt) / 1000) : 0;

    const minAwayMinutes = vscode.workspace.getConfiguration('focusshift').get<number>('minAwayMinutes', 0.5);
    if (awaySeconds < minAwayMinutes * 60) {
      return;
    }

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

  setTimeout(() => {
    WelcomePanel.show(context, state);
  }, 400);
}