import * as vscode from 'vscode';
import { StateManager } from './stateManager';
import { HistoryService } from '../history/HistoryService';

/** Sets up interruption detection (window blur and inactivity) and returns the shared StateManager. */
export function activateDetection(context: vscode.ExtensionContext, historyService: HistoryService): StateManager {
  const stateManager = new StateManager(context.globalState, historyService);

  // Only show the "welcome back" popup if the user was away for at least
  // minAwaySeconds — a quick alt-tab shouldn't trigger it.
  let blurTime: number | null = null;

  vscode.window.onDidChangeWindowState(state => {
    try {
      if (!state.focused) {
        blurTime = Date.now();
        stateManager.captureState();
        return;
      }

      const awayMs = blurTime ? Date.now() - blurTime : 0;
      const minAwaySeconds = vscode.workspace.getConfiguration('focusshift')
        .get<number>('minAwaySeconds', 30);

      if (awayMs >= minAwaySeconds * 1000) {
        stateManager.restoreState();
      } else {
        console.log(`FocusShift: away only ${Math.floor(awayMs / 1000)}s - skipping popup`);
      }
      blurTime = null;
    } catch (err) {
      console.error("FocusShift: Error handling window focus change:", err);
    }
  });

  // Inactivity detection: capture state if the user stops interacting
  // with the editor for `threshold` seconds without necessarily switching windows.
  let inactivityTimer: NodeJS.Timeout | null = null;

  function getThresholdMs(): number {
    const minutes = vscode.workspace.getConfiguration('focusshift')
      .get<number>('inactivityMinutes', 5);
    return minutes * 60 * 1000;
  }

function resetTimer() {
    try {
      if (inactivityTimer) { clearTimeout(inactivityTimer); }
      inactivityTimer = setTimeout(() => {
        try {
          stateManager.captureState();
        } catch (err) {
          console.error("FocusShift: Error during inactivity capture:", err);
        }
      }, getThresholdMs());
    } catch (err) {
      console.error("FocusShift: Error resetting inactivity timer:", err);
    }
  }
  vscode.workspace.onDidChangeTextDocument(resetTimer);
  vscode.window.onDidChangeTextEditorSelection(resetTimer);
  vscode.window.onDidChangeTextEditorVisibleRanges(resetTimer);
  vscode.window.onDidChangeActiveTextEditor(resetTimer);

  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('focusshift.inactivityMinutes')) {
      resetTimer();
    }
  });

  resetTimer();

  return stateManager;
}