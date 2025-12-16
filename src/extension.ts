// src/extension.ts
import * as vscode from 'vscode';

// Placeholder for team members — replace with your module when ready
import { activateDetection } from './core/detection';     // Person 1
import { activateChime } from './audio/chimePlayer';       // Person 2
import { activatePopup } from './ui/popupManager';        // Person 3
import { activateHeuristic } from './summary/heuristic';   // Person 4
import { activateNLP } from './summary/customNLP';         // Person 5

export function activate(context: vscode.ExtensionContext) {
  console.log('FocusShift is now active!');

  // Each team member adds their activation here
  activateDetection(context);     // ← Person 1: blur + inactivity
  activateChime(context);         // ← Person 2: chime system
  activatePopup(context);         // ← Person 3: welcome popup
  activateHeuristic(context);     // ← Person 4: fast summary
  activateNLP(context);           // ← Person 5: custom NLP model

  // Optional: test command to check everything is loaded
  let disposable = vscode.commands.registerCommand('focusshift.hello', () => {
    vscode.window.showInformationMessage('FocusShift is alive and waiting for your code!');
  });
  context.subscriptions.push(disposable);
}

export function deactivate() {
  console.log('FocusShift deactivated');
}