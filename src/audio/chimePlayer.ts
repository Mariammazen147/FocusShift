import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Handles audio playback for FocusShift's "welcome back" chime.
 * Uses node-wav-player for playback.
 */
export class ChimePlayer {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /** Entry point for other modules — plays the chime only if the user has it enabled. */
  public async playChimeIfEnabled(): Promise<void> {
    const config = vscode.workspace.getConfiguration('focusshift');
    const enabled = config.get<boolean>('chimeEnabled', true);

    if (!enabled) {
      console.log('[ChimePlayer] Chime is disabled in settings');
      return;
    }

    await this.playChime();
  }

  /** Plays the chime sound, regardless of the enabled setting. */
  public async playChime(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('focusshift');
      const enabled = config.get<boolean>('chimeEnabled', true);

      if (!enabled) {
        console.log('[ChimePlayer] Chime is disabled - skipping playback');
        return;
      }

      const chimeFile = this.getChimeFilePath();

      if (!chimeFile) {
        console.error('[ChimePlayer] No chime file found');
        vscode.window.showWarningMessage(
          'FocusShift: No chime.wav file found in /media folder'
        );
        return;
      }

      // node-wav-player has no bundled type definitions, so require() it directly
      const player = require('node-wav-player');
      await player.play({
        path: chimeFile,
        sync: false
      });
    } catch (error) {
      console.error('[ChimePlayer] Error:', error);
    }
  }

  /** Locates the chime file: prefers chime.wav, falls back to any .wav in /media. */
  private getChimeFilePath(): string | null {
    const mediaFolder = path.join(this.context.extensionPath, 'media');
    const chimeFile = path.join(mediaFolder, 'chime.wav');

    if (fs.existsSync(chimeFile)) {
      return chimeFile;
    }

    if (fs.existsSync(mediaFolder)) {
      const files = fs.readdirSync(mediaFolder);
      const wavFile = files.find(f => f.toLowerCase().endsWith('.wav'));
      if (wavFile) {
        return path.join(mediaFolder, wavFile);
      }
    } else {
      console.error('[ChimePlayer] Media folder does not exist');
    }

    return null;
  }

  /** Flips the chimeEnabled setting and notifies the user of the new state. */
  public async toggleChime(): Promise<void> {
    const config = vscode.workspace.getConfiguration('focusshift');
    const current = config.get<boolean>('chimeEnabled', true);
    await config.update('chimeEnabled', !current, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      `FocusShift: Chime ${!current ? 'enabled' : 'disabled'}`
    );
  }
}

let chimePlayer: ChimePlayer | null = null;

/** Creates the singleton ChimePlayer and registers its commands. Called from extension.ts. */
export function activateChime(context: vscode.ExtensionContext) {
  chimePlayer = new ChimePlayer(context);

  const testChimeCmd = vscode.commands.registerCommand(
    'focusshift.testChime',
    async () => {
      if (!chimePlayer) { return; }

      const config = vscode.workspace.getConfiguration('focusshift');
      const enabled = config.get<boolean>('chimeEnabled', true);

      if (!enabled) {
        vscode.window.showWarningMessage(
          'FocusShift: Chime is currently disabled!\n\nEnable it in settings or use "Toggle Chime On/Off" command.'
        );
        return;
      }

      vscode.window.showInformationMessage('FocusShift: Playing test chime...');
      await chimePlayer.playChime();
    }
  );

  const toggleCmd = vscode.commands.registerCommand(
    'focusshift.toggleChime',
    async () => {
      if (chimePlayer) {
        await chimePlayer.toggleChime();
      }
    }
  );

  // Debugging aid — reports what's in /media so users can diagnose a missing chime file
  const checkFileCmd = vscode.commands.registerCommand(
    'focusshift.checkChimeFile',
    () => {
      const mediaFolder = path.join(context.extensionPath, 'media');

      if (!fs.existsSync(mediaFolder)) {
        vscode.window.showErrorMessage('Media folder does not exist!');
        return;
      }

      const files = fs.readdirSync(mediaFolder);

      const chimeFile = path.join(mediaFolder, 'chime.wav');
      const chimeWavExists = fs.existsSync(chimeFile);

      const wavFiles = files.filter(f => f.toLowerCase().endsWith('.wav'));
      const anyWavExists = wavFiles.length > 0;

      let message: string;
      if (chimeWavExists) {
        message = 'Perfect! chime.wav found!\n\n';
      } else if (anyWavExists) {
        message = `chime.wav not found, but using:\n${wavFiles[0]} successfully\n\n`;
      } else {
        message = 'No .wav files found!\n\n';
      }

      message += `Files in media folder:\n${files.join('\n')}`;

      vscode.window.showInformationMessage(message);
    }
  );

  context.subscriptions.push(testChimeCmd, toggleCmd, checkFileCmd);
}

/**
 * Plays the chime if enabled, for use by other modules.
 * Usage: import { playChimeIfEnabled } from './audio/chimePlayer';
 */
export async function playChimeIfEnabled(): Promise<void> {
  if (chimePlayer) {
    await chimePlayer.playChimeIfEnabled();
  } else {
    console.warn('[ChimePlayer] Not initialized');
  }
}
