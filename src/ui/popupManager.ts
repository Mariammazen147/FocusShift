import * as vscode from 'vscode';
import * as path from 'path';
import { WelcomePanel } from './welcomePanel';
import { EditorContext } from '../core/stateManager';
import { playChimeIfEnabled } from '../audio/chimePlayer';
import { formatDuration } from '../summary/renderSummary';

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
 * active EditorContext, and shows a lightweight toast notification with
 * quick actions — rather than immediately opening the full detail panel.
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
    showToast(context, state);
  }, 400);
}

/** Shows a lightweight native notification instead of immediately opening the full panel. */
function showToast(context: vscode.ExtensionContext, state: EditorContext): void {
  playChimeIfEnabled();

  const fileName = state.fileUri
    ? path.basename(decodeURIComponent(vscode.Uri.parse(state.fileUri).fsPath))
    : 'unknown file';
  const away = formatDuration(state.awayDuration ?? 0);

  vscode.window
    .showInformationMessage(
      `Welcome back — away ${away}. ${fileName}`,
      'Show Context',
      'Jump to Code'
    )
    .then(choice => {
      if (choice === 'Show Context') {
        WelcomePanel.show(context, state);
      } else if (choice === 'Jump to Code') {
        jumpToCode(state);
      }
      // No choice (dismissed / timed out) — do nothing, matches a quick dismiss.
    });
}

/** Focuses the file and cursor position directly, without depending on saved state still existing. */
async function jumpToCode(state: EditorContext): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(state.fileUri));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    editor.selection = new vscode.Selection(state.position, state.position);
    editor.revealRange(new vscode.Range(state.position, state.position));
  } catch (err) {
    console.warn('FocusShift: Could not jump to code:', err);
  }
}