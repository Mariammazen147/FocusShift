import * as vscode from "vscode";

import { activateDetection } from "./core/detection";
import { activateChime } from "./audio/chimePlayer";
import { activatePopup } from "./ui/popupManager";
import { activateHeuristic } from "./summary/heuristic";
import { HistoryService } from "./history/HistoryService";
import { HistoryPanel } from "./history/HistoryPanel";
import { SidebarProvider } from "./ui/Sidebarprovider";
import { isOllamaInstalled, getOllamaStatus } from "./setup/ollamastatus";

export function activate(context: vscode.ExtensionContext) {
  console.log("FocusShift is now active!");

  const historyService = new HistoryService(context.globalState);
  const stateManager = activateDetection(context, historyService);
  activateChime(context);
  activatePopup(context);
  activateHeuristic(context);

  // Sidebar: lets the user reach Settings / History / Setup Ollama
  // at any time, not just when the popup happens to be showing.
  const sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider,
    ),
  );

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

  // First-run nudge: point new users at Ollama setup once, then never again.
  // Also auto-detects whether Ollama is already present and adjusts the
  // enableLLMSummary default accordingly, so a fresh install never pays the
  // cost of a failed Ollama call before the user has had a chance to set it up.
  const hasSeenOllamaPrompt = context.globalState.get<boolean>(
    "focusshift.hasSeenOllamaPrompt",
    false,
  );

  if (!hasSeenOllamaPrompt) {
    const status = getOllamaStatus(true);
    const config = vscode.workspace.getConfiguration("focusshift");

    // If Ollama + the model aren't ready yet, turn AI summaries off for now —
    // package.json's declared default stays `true` for anyone who already has
    // Ollama running, but first-run users without it get a clean, fast,
    // heuristic-only experience until they opt in via Setup Ollama.
    if (!status.installed || !status.modelReady) {
      config.update("enableLLMSummary", false, vscode.ConfigurationTarget.Global);
    }

    vscode.window
      .showInformationMessage(
        "FocusShift is active! For AI-powered summaries, install Ollama. Click to learn more.",
        "Continue",
        "Dismiss",
      )
      .then((selection) => {
        if (selection === "Continue") {
          vscode.commands.executeCommand("focusshift.setupOllama");
        }
        // Mark as seen regardless of which button they clicked
        context.globalState.update("focusshift.hasSeenOllamaPrompt", true);
      });
  }

  const setupOllama = vscode.commands.registerCommand("focusshift.setupOllama", async () => {
    const platform = process.platform;

    // Step 1 — tell the user what's about to happen before we touch anything
    const choice = await vscode.window.showInformationMessage(
      "FocusShift will open a terminal and install Ollama + the required AI model (qwen2.5-coder:1.5b-instruct). This may take a few minutes depending on your internet speed.",
      "Continue",
      "Cancel",
    );

    if (choice !== "Continue") {
      return;
    }

    // Windows doesn't have a one-line curl installer like Linux/macOS, so it
    // gets its own terminal-less branch that just opens the download page.
    if (platform === "win32") {
      if (isOllamaInstalled()) {
        const terminal = vscode.window.createTerminal("FocusShift Setup");
        terminal.show();
        terminal.sendText("ollama pull qwen2.5-coder:1.5b-instruct");
        vscode.window.showInformationMessage(
          "Downloading AI model (~1GB). Keep the terminal open until it finishes."
        );

        // Verify the pull actually finished once the user closes this terminal.
        const closeListener = vscode.window.onDidCloseTerminal(closedTerminal => {
          if (closedTerminal !== terminal) { return; }
          closeListener.dispose();

          const status = getOllamaStatus(true); // force a fresh check, bypass the 30s cache
          if (status.installed && status.modelReady) {
            vscode.window.showInformationMessage("FocusShift: Ollama setup complete — AI summaries are ready!");
            // Setup succeeded — turn AI summaries back on automatically.
            vscode.workspace.getConfiguration("focusshift")
              .update("enableLLMSummary", true, vscode.ConfigurationTarget.Global);
          } else {
            vscode.window.showWarningMessage(
              'FocusShift: Ollama setup may not have finished. Run "FocusShift: Setup Ollama" again if AI summaries aren\'t working.'
            );
          }
        });
        context.subscriptions.push(closeListener);

      } else {
        vscode.env.openExternal(
          vscode.Uri.parse("https://ollama.com/download/windows")
        );
        vscode.window.showInformationMessage(
          'Download and run the Ollama installer for Windows. Once installed, run "FocusShift: Setup Ollama" again to pull the AI model automatically.'
        );
        // No terminal was created in this branch (just opens a browser page),
        // so there's nothing to attach a close-listener to here.
      }
      return;
    }

    // Step 2 — Linux/macOS: same terminal handles both installing Ollama
    // (if missing) and pulling the model.
    const terminal = vscode.window.createTerminal("FocusShift Setup");
    terminal.show();

    if (!isOllamaInstalled()) {
      terminal.sendText(
        'curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen2.5-coder:1.5b-instruct'
      );
      vscode.window.showInformationMessage(
        'Installing Ollama and downloading AI model (~1GB). Keep the terminal open until it finishes.'
      );
    } else {
      terminal.sendText('ollama pull qwen2.5-coder:1.5b-instruct');
      vscode.window.showInformationMessage(
        'Downloading AI model (~1GB). Keep the terminal open until it finishes.'
      );
    }

    // Verify setup actually succeeded once the user closes this terminal.
    const closeListener = vscode.window.onDidCloseTerminal(closedTerminal => {
      if (closedTerminal !== terminal) { return; }
      closeListener.dispose();

      const status = getOllamaStatus(true);
      if (status.installed && status.modelReady) {
        vscode.window.showInformationMessage("FocusShift: Ollama setup complete — AI summaries are ready!");
        vscode.workspace.getConfiguration("focusshift")
          .update("enableLLMSummary", true, vscode.ConfigurationTarget.Global);
      } else {
        vscode.window.showWarningMessage(
          'FocusShift: Ollama setup may not have finished. Run "FocusShift: Setup Ollama" again if AI summaries aren\'t working.'
        );
      }
    });
    context.subscriptions.push(closeListener);
  });

  const captureStateCmd = vscode.commands.registerCommand('focusshift.capture', () => {
    stateManager.captureState();
  });

  const restoreStateCmd = vscode.commands.registerCommand('focusshift.restore', (skipLLM: boolean = false) => {
    stateManager.restoreState(skipLLM);
  });

  context.subscriptions.push(
    testLLMCmd,
    testPopup,
    showHistoryCmd,
    setupOllama,
    captureStateCmd,
    restoreStateCmd,
  );
}

export function deactivate() {
  console.log("FocusShift deactivated");
}