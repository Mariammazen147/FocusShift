import * as vscode from "vscode";

import { activateDetection } from "./core/detection";
import { activateChime } from "./audio/chimePlayer";
import { activatePopup } from "./ui/popupManager";
import { activateHeuristic } from "./summary/heuristic";
import { HistoryService } from "./history/HistoryService";
import { HistoryPanel } from "./history/HistoryPanel";
import { EditorContext } from "./core/stateManager";
import { execSync } from 'child_process';

function isOllamaInstalled(): boolean {
  try {
    execSync('ollama --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isModelInstalled(): boolean {
  try {
    const output = execSync('ollama list', { encoding: 'utf8' });
    return output.includes('qwen2.5-coder:1.5b-instruct');
  } catch {
    return false;
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("FocusShift is now active!");

  const historyService = new HistoryService(context.globalState);
  const stateManager = activateDetection(context, historyService);
  activateChime(context);
  activatePopup(context);
  activateHeuristic(context);

  const showHistoryCmd = vscode.commands.registerCommand(
    "focusshift.showHistory",
    () => {
      HistoryPanel.createOrShow(context, historyService);
    },
  );

  const testLLMCmd = vscode.commands.registerCommand(
    "focusshift.testLLMSummary",
    () => {
      stateManager.testLLMNow();
    },
  );


  // Test command to force-show the welcome popup with fake data
  const testPopup = vscode.commands.registerCommand(
    "focusshift.testPopup",
    () => {
      const { WelcomePanel } = require("./ui/welcomePanel");
      WelcomePanel.show(context, {
        fileUri: "file:///test/utils.ts",
        position: { line: 141, character: 0 },
        snippet: "function calculateExchange(amount, rate) {",
        timestamp: Date.now(),
        editHistory: [],
        cursorHistory: [],
        scrollHistory: [],
        tabHistory: [],
        awayDuration: 325,
      });
    },
  );
  const hasSeenOllamaPrompt = context.globalState.get<boolean>(
    "focusshift.hasSeenOllamaPrompt",
    false,
  );

  if (!hasSeenOllamaPrompt) {
    vscode.window
      .showInformationMessage(
        "FocusShift is active! For AI-powered summaries, install Ollama. Click to learn more.",
        "Learn More",
        "Dismiss",
      )
      .then((selection) => {
        if (selection === "Learn More") {
          vscode.commands.executeCommand("focusshift.setupOllama");
        }
        // Mark as seen regardless of which button they clicked
        context.globalState.update("focusshift.hasSeenOllamaPrompt", true);
      });
  }
  const setupOllama = vscode.commands.registerCommand("focusshift.setupOllama", async () => {
      const platform = process.platform; 

      // Step 1 — Tell the user what's about to happen
      const choice = await vscode.window.showInformationMessage(
        "FocusShift will open a terminal and install Ollama + the required AI model (qwen2.5-coder:1.5b-instruct). This may take a few minutes depending on your internet speed.",
        "Continue",
        "Cancel",
      );

      if (choice !== "Continue") {
        return;
      }

      // Step 2 — Open a dedicated terminal
      const terminal = vscode.window.createTerminal("FocusShift Setup");
      terminal.show();

      // Step 3 — Run the right install command per OS
      if (platform === "linux" || platform === "darwin") {
        if (!isOllamaInstalled()) {
        terminal.sendText(
          'curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen2.5-coder:1.5b-instruct'
        );
        vscode.window.showInformationMessage(
          'Installing Ollama and downloading AI model (~1GB). Keep the terminal open until it finishes.'
        );
        } else {
          terminal.sendText(
            'ollama pull qwen2.5-coder:1.5b-instruct'
          );
          vscode.window.showInformationMessage(
            'Downloading AI model (~1GB). Keep the terminal open until it finishes.'
          );
        }
      } else if (platform === 'win32') {
        if (isOllamaInstalled()) {
          // Ollama already installed — just pull the model
          const terminal = vscode.window.createTerminal('FocusShift Setup');
          terminal.show();
          terminal.sendText('ollama pull qwen2.5-coder:1.5b-instruct');
          vscode.window.showInformationMessage(
            'Downloading AI model (~1GB). Keep the terminal open until it finishes.'
          );
        } else {
          // Not installed — show the link + existing message
          vscode.env.openExternal(
            vscode.Uri.parse('https://ollama.com/download/windows')
          );
          vscode.window.showInformationMessage(
            'Download and run the Ollama installer for Windows. Once installed, run "FocusShift: Setup Ollama" again to pull the AI model automatically.'
          );
        }
      }
    });

  context.subscriptions.push(
    testLLMCmd,
    testPopup,
    showHistoryCmd,
    setupOllama,
  );    
}

export function deactivate() {
  console.log("FocusShift deactivated");
}
