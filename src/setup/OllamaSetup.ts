import * as vscode from 'vscode';
import { exec, spawn }  from 'child_process';

const MODEL = 'qwen2.5-coder:7b-instruct';

export class OllamaSetup {

  /**
   * Entry point called once from extension.ts activate().
   * Checks whether Ollama is installed and the model is pulled,
   * and guides the developer through anything that is missing.
   */
  public static async checkAndSetup(): Promise<void> {
    const installed = await this.isOllamaInstalled();

    if (!installed) {
      const choice = await vscode.window.showInformationMessage(
        'FocusShift needs Ollama for AI summaries. ' +
        'It will be installed now — this takes about 1–2 minutes.',
        'Install', 'Skip'
      );
      if (choice !== 'Install') { return; }

      const password = await vscode.window.showInputBox({
        prompt: 'Enter your sudo password to install Ollama',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'sudo password'
      });
      if (!password) { return; }

      const ok = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'FocusShift: Installing Ollama (this may take a minute or two) …',
          cancellable: false
        },
        () => this.installOllama(password)
      );

      if (!ok) {
        vscode.window.showErrorMessage(
          'FocusShift: Ollama installation failed. ' +
          'Please install it manually from https://ollama.com and then reload VS Code.'
        );
        return;
      }

      // Give the ollama daemon a moment to start after install
      await this.startOllamaService(password);
    }

    // Ollama is installed — make sure the model is present
    const modelReady = await this.isModelAvailable();
    if (modelReady) { return; }

    vscode.window.showInformationMessage(
      'FocusShift: Downloading the AI model (~4 GB). ' +
      'This will take a few minutes — you can keep coding!'
    );

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `FocusShift: Pulling ${MODEL} …`,
        cancellable: false
      },
      () => this.pullModel()
    );

    vscode.window.showInformationMessage('FocusShift: AI model is ready!');
  }

  // ─── private helpers ────────────────────────────────────────────────────────

  /** Returns true if the `ollama` binary exists on PATH. */
  private static isOllamaInstalled(): Promise<boolean> {
    return new Promise(resolve => {
      exec('which ollama', err => resolve(!err));
    });
  }

  /**
   * Asks the local Ollama API for the list of downloaded models
   * and checks whether MODEL (or its base name) is present.
   */
  private static isModelAvailable(): Promise<boolean> {
    return fetch('http://localhost:11434/api/tags')
      .then(r => r.json())
      .then((data: any) => {
        const names: string[] = (data?.models ?? []).map((m: any) => m.name as string);
        const base = MODEL.split(':')[0];
        return names.some(n => n.startsWith(base));
      })
      .catch(() => false);
  }

  /**
   * Runs the official Ollama install script as root.
   * The sudo password is piped via stdin so it never appears
   * in the process list or shell history.
   */
  private static installOllama(password: string): Promise<boolean> {
    return new Promise(resolve => {
      // sudo -S reads the password from stdin
      const child = spawn(
        'sudo',
        ['-S', 'bash', '-c', 'curl -fsSL https://ollama.com/install.sh | bash'],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );

      child.stdin!.write(password + '\n');
      child.stdin!.end();

      child.on('close', code => resolve(code === 0));
      child.on('error', ()   => resolve(false));
    });
  }

  /**
   * Starts the ollama systemd service after installation.
   * Falls back silently — the install script usually auto-starts it.
   */
  private static startOllamaService(password: string): Promise<void> {
    return new Promise(resolve => {
      const child = spawn(
        'sudo',
        ['-S', 'systemctl', 'start', 'ollama'],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
      child.stdin!.write(password + '\n');
      child.stdin!.end();
      child.on('close', () => setTimeout(resolve, 2_000)); // 2 s for daemon to be ready
      child.on('error', () => setTimeout(resolve, 2_000));
    });
  }

  /**
   * Pulls the model. exec timeout is 10 minutes — large models can be slow.
   */
  private static pullModel(): Promise<void> {
    return new Promise(resolve => {
      exec(`ollama pull ${MODEL}`, { timeout: 600_000 }, () => resolve());
    });
  }
}
