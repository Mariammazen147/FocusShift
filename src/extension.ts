import * as vscode from 'vscode';

import { activateDetection } from './core/detection';
import { activateChime } from './audio/chimePlayer';
import { activatePopup } from './ui/popupManager';
import { activateHeuristic } from './summary/heuristic';

export function activate(context: vscode.ExtensionContext) {
  console.log('FocusShift is now active!');

  const stateManager = activateDetection(context);
  activateChime(context);
  activatePopup(context);
  activateHeuristic(context);

  const testLLMCmd = vscode.commands.registerCommand('focusshift.testLLMSummary', () => {
    stateManager.testLLMNow();
  });

  const helloCmd = vscode.commands.registerCommand('focusshift.hello', () => {
    vscode.window.showInformationMessage('FocusShift is alive and waiting for your code!');
  });

  // Test command to force-show the welcome popup with fake data
  const testPopup = vscode.commands.registerCommand('focusshift.testPopup', () => {
    const { WelcomePanel } = require('./ui/welcomePanel');
    WelcomePanel.show(context, {
      fileUri: 'file:///test/utils.ts',
      position: { line: 141, character: 0 },
      snippet: 'function calculateExchange(amount, rate) {',
      timestamp: Date.now(),
      editHistory: [],
      cursorHistory: [],
      scrollHistory: [],
      tabHistory: [],
      awayDuration: 325
    });
  });

  context.subscriptions.push(testLLMCmd, helloCmd, testPopup);
}

export function deactivate() {
  console.log('FocusShift deactivated');
}