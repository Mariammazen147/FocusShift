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
 * Reads the last saved EditorContext from globalState.
 * If one exists, passes it to WelcomePanel to render the popup.
 */
function showPopupIfStateExists(context: vscode.ExtensionContext): void {
  const raw = context.globalState.get<string>('focusshift.lastState');

  if (!raw) {
    // Nothing was captured before the user left — nothing to show
    return;
  }

  let state: EditorContext;
  try {
    const parsed = JSON.parse(raw);
    // vscode.Position doesn't survive JSON round-trip — reconstruct it
    state = {
      ...parsed,
      position: new vscode.Position(
        parsed.position?.line ?? 0,
        parsed.position?.character ?? 0
      )
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
