import * as vscode from 'vscode';
import { StateManager } from './stateManager';
import { HistoryService } from '../history/HistoryService';


// sets up detection for interruptions (blur + inactivity).
export function activateDetection(context: vscode.ExtensionContext, historyService: HistoryService): StateManager {
  // StateManager instance to handle saving/restoring editor state.
  const stateManager = new StateManager(context.globalState, historyService);

  // // --- Window blur detection ---
  // vscode.window.onDidChangeWindowState(state => {
  //   if (!state.focused) {
  //     stateManager.captureState();
  //   } else {
  //     stateManager.restoreState();
  //   }
  // });


let blurTime: number | null = null; //exactly when the window lost focus, when the window come back 

vscode.window.onDidChangeWindowState(state => {
  if (!state.focused) {
    blurTime = Date.now();
    stateManager.captureState();
  } else {
    const awayMs = blurTime ? Date.now() - blurTime : 0;
    const minAwaySeconds = vscode.workspace.getConfiguration('focusshift')
      .get<number>('minAwaySeconds', 30); //user can change it in config
    if (awayMs >= minAwaySeconds * 1000) {
      stateManager.restoreState();
    } else {
      console.log(`FocusShift: away only ${Math.floor(awayMs/1000)}s — skipping popup`);
    }
    blurTime = null;
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

  return stateManager;
}