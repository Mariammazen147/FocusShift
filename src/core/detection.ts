import * as vscode from 'vscode';
import { StateManager } from './stateManager';


// sets up detection for interruptions (blur + inactivity).
export function activateDetection(context: vscode.ExtensionContext) {
  // StateManager instance to handle saving/restoring editor state.
  const stateManager = new StateManager(context.workspaceState);

  // --- Window blur detection ---
  vscode.window.onDidChangeWindowState(state => {
    if (!state.focused) {
      stateManager.captureState();
    } else {
      stateManager.restoreState();
    }
  });

  // --- Inactivity detection ---
  let inactivityTimer: NodeJS.Timeout | null = null;

  // Read threshold from settings (default 300 seconds = 5 minutes).
  const threshold = vscode.workspace.getConfiguration('focusshift')
    .get<number>('inactivityThresholdSeconds', 300);

  // Reset inactivity timer whenever activity happens.
  function resetTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);

    // If no activity for threshold seconds → capture state.
    inactivityTimer = setTimeout(() => {
      stateManager.captureState();
    }, threshold * 1000);
  }

  // Activity events that reset the timer:
  vscode.workspace.onDidChangeTextDocument(resetTimer);          
  vscode.window.onDidChangeTextEditorSelection(resetTimer);      
  vscode.window.onDidChangeTextEditorVisibleRanges(resetTimer);  
  vscode.window.onDidChangeActiveTextEditor(resetTimer);         

  // Start the inactivity timer.
  resetTimer();
}