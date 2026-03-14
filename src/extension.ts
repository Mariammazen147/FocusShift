// src/extension.ts
import * as vscode from 'vscode';

// Team modules
import { activateDetection } from './core/detection';     // Person 1
import { activateChime } from './audio/chimePlayer';      // Person 2
import { activatePopup } from './ui/popupManager';        // Person 3
import { activateHeuristic } from './summary/heuristic';  // Person 4
// Import your StateManager
import { StateManager } from './core/stateManager';

export function activate(context: vscode.ExtensionContext) {
  console.log('FocusShift is now active!');

  activateDetection(context);     
  activateChime(context);         
  activatePopup(context);         
  activateHeuristic(context);     

  // --- Add StateManager for capture/restore ---
  const stateManager = new StateManager(context.globalState);

  // Automatic capture/restore based on window focus
  vscode.window.onDidChangeWindowState(event => {
    if (event.focused) {
      stateManager.restoreState();
    } else {
      stateManager.captureState();
    }
  });

  // Optional manual commands for testing
  const captureCmd = vscode.commands.registerCommand('focusshift.capture', () => {
    stateManager.captureState();
  });

  const restoreCmd = vscode.commands.registerCommand('focusshift.restore', () => {
    stateManager.restoreState();
  });

  context.subscriptions.push(captureCmd, restoreCmd);

  // Test command to check everything is loaded
  let disposable = vscode.commands.registerCommand('focusshift.hello', () => {
    vscode.window.showInformationMessage('FocusShift is alive and waiting for your code!');
  });
  context.subscriptions.push(disposable);
}

export function deactivate() {
  console.log('FocusShift deactivated');
}