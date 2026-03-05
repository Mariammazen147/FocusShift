import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/*
 ChimePlayer class => handles audio playback for FocusShift
 & uses PowerShell for volume-controlled audio on Windows
 */
export class ChimePlayer {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /*
   playChimeIfEnabled => function that plays the chime if enabled in settings
   This is the main function other modules will call
   */
  public async playChimeIfEnabled(): Promise<void> {
    const config = vscode.workspace.getConfiguration('focusshift');
    const enabled = config.get<boolean>('chimeEnabled', true);

    if (!enabled) {
      console.log('🔇 Chime is disabled in settings');
      return;
    }

    await this.playChime();
  }

  /*
   playChime function => plays the chime sound with volume control
   */
  public async playChime(): Promise<void> {
    try {
      console.log('🎵 [ChimePlayer] Starting playChime()...');
      
      const config = vscode.workspace.getConfiguration('focusshift');
      const volume = config.get<number>('chimeVolume', 0.6);
      const enabled = config.get<boolean>('chimeEnabled', true);

      //Check if chime is enabled
      if (!enabled) {
        console.log('🔇 [ChimePlayer] Chime is disabled - skipping playback');
        return;
      }

      const chimeFile = this.getChimeFilePath();
      
      if (!chimeFile) {
        console.error('❌ [ChimePlayer] No chime file found!');
        vscode.window.showWarningMessage(
          'FocusShift: No chime.wav file found in /media folder'
        );
        return;
      }

      console.log(`🎵 [ChimePlayer] Playing: ${chimeFile}`);
      console.log(`🔊 [ChimePlayer] Volume: ${Math.round(volume * 100)}%`);
      console.log(`✅ [ChimePlayer] Enabled: ${enabled}`);

      //use PowerShell to play with volume control (Windows only)
      const volumePercent = Math.round(volume * 100);
      
      //escape the path for PowerShell
      const escapedPath = chimeFile.replace(/\\/g, '\\\\');
      
      const psCommand = `
        $player = New-Object System.Media.SoundPlayer
        $player.SoundLocation = "${escapedPath}"
        $player.Load()
        $player.Play()
      `;

      await execPromise(`powershell -Command "${psCommand.replace(/\n/g, ' ')}"`);
      
      console.log('✅ [ChimePlayer] Chime played successfully');

    } catch (error) {
      console.error('❌ [ChimePlayer] Error:', error);
      //fallback: try simple playback without volume control
      this.playChimeFallback();
    }
  }

  /*
   playChimeFallback function => Fallback: Play without volume control
   */
  private async playChimeFallback(): Promise<void> {
    try {
      const chimeFile = this.getChimeFilePath();
      if (!chimeFile) return;

      const player = require('node-wav-player');
      await player.play({
        path: chimeFile,
        sync: false
      });
    } catch (error) {
      console.error('❌ Fallback playback also failed:', error);
    }
  }

  /*
   getChimeFilePath function => gets the path to the chime file
   & looks for chime.wav in the /media folder
   */
  private getChimeFilePath(): string | null {
    const mediaFolder = path.join(this.context.extensionPath, 'media');
    const chimeFile = path.join(mediaFolder, 'chime.wav');

    console.log('📁 [ChimePlayer] Media folder:', mediaFolder);
    console.log('📁 [ChimePlayer] Looking for:', chimeFile);

    if (fs.existsSync(chimeFile)) {
      console.log('✅ [ChimePlayer] Chime file found!');
      return chimeFile;
    }

    //try to find any .wav file in media folder
    if (fs.existsSync(mediaFolder)) {
      const files = fs.readdirSync(mediaFolder);
      console.log('📁 [ChimePlayer] Files in media folder:', files);
      const wavFile = files.find(f => f.toLowerCase().endsWith('.wav'));
      if (wavFile) {
        console.log('✅ [ChimePlayer] Found WAV file:', wavFile);
        return path.join(mediaFolder, wavFile);
      }
    } else {
      console.error('❌ [ChimePlayer] Media folder does not exist!');
    }

    return null;
  }

  /*
   setVolume function => sets the volume (0.0 to 1.0)
   Note: Actual volume control requires system-level changes
   */
  public async setVolume(volume: number): Promise<void> {
    const config = vscode.workspace.getConfiguration('focusshift');
    await config.update('chimeVolume', volume, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      `FocusShift: Volume set to ${Math.round(volume * 100)}%\n(Note: Volume control is limited on some systems)`
    );
  }

  /*
   toggleChime function => toggles chime on/off
   */
  public async toggleChime(): Promise<void> {
    const config = vscode.workspace.getConfiguration('focusshift');
    const current = config.get<boolean>('chimeEnabled', true);
    await config.update('chimeEnabled', !current, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      `FocusShift: Chime ${!current ? 'enabled ✅' : 'disabled 🔇'}`
    );
  }
}

//singleton instance
let chimePlayer: ChimePlayer | null = null;

/*
 activateChime function => activates the chime system
 & called from extension.ts
 */
export function activateChime(context: vscode.ExtensionContext) {
  console.log('🎵 Audio Chime System loaded');

  //create the chime player instance
  chimePlayer = new ChimePlayer(context);

  //register "Test Chime" command
  const testChimeCmd = vscode.commands.registerCommand(
    'focusshift.testChime',
    async () => {
      if (chimePlayer) {
        //check if chime is enabled before showing message
        const config = vscode.workspace.getConfiguration('focusshift');
        const enabled = config.get<boolean>('chimeEnabled', true);

        if(!enabled) {
          //show diabled message
          vscode.window.showWarningMessage(
            'FocusShift: Chime is Currently disabled!\n\nEnable it in settings or use "Toggle Chime On/Off" command.'
          );
          console.log('⚠️ Test chime blocked - chime is disabled in settings');
          return; //Don't play
        }

        //chime is enabled, proceed
        vscode.window.showInformationMessage('🎵 FocusShift: Playing test chime...');
        await chimePlayer.playChime();
      }
    }
  );

  //register volume control command
  const setVolumeCmd = vscode.commands.registerCommand(
    'focusshift.setVolume',
    async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter volume (0-100)',
        value: '60',
        validateInput: (value) => {
          const num = parseInt(value);
          if (isNaN(num) || num < 0 || num > 100) {
            return 'Please enter a number between 0 and 100';
          }
          return null;
        }
      });

      if (input && chimePlayer) {
        const volume = parseInt(input) / 100;
        await chimePlayer.setVolume(volume);
      }
    }
  );

  //register toggle command
  const toggleCmd = vscode.commands.registerCommand(
    'focusshift.toggleChime',
    async () => {
      if (chimePlayer) {
        await chimePlayer.toggleChime();
      }
    }
  );

  //register file check command (for debugging)
  const checkFileCmd = vscode.commands.registerCommand(
    'focusshift.checkChimeFile',
    () => {
      const mediaFolder = path.join(context.extensionPath, 'media');
      //const chimeFile = path.join(mediaFolder, 'chime.wav');
      
      console.log('📁 Extension path:', context.extensionPath);
      console.log('📁 Media folder:', mediaFolder);
      //console.log('📁 Chime file:', chimeFile);
      //console.log('📁 File exists?', fs.existsSync(chimeFile));


      if(!fs.existsSync(mediaFolder)) {
        console.log('❌ Media folder does not exist!');
        vscode.window.showErrorMessage('❌ Media folder does not exist!');
        return;
      }

      //get all files in media folder
      const files = fs.readdirSync(mediaFolder);
      console.log('📁 Files in media folder:', files);

      //look for chime.wav specifically
      const chimeFile = path.join(mediaFolder, 'chime.wav');
      const chimeWavExists = fs.existsSync(chimeFile);

      //look for any.wav file
      const wavFiles = files.filter(f => f.toLowerCase().endsWith('.wav'));
      const anyWavExists = wavFiles.length > 0;

      //create detailed message
      let message = '';

      if(chimeWavExists){
        message = '✅ Perfect! chime.wav found!\n\n';
      } else if (anyWavExists) {
        message = `⚠️ chime.wav not found, but using:\n${wavFiles[0]} successfully ✅\n\n`;
      } else {
        message = '❌ No .wav files found!\n\n';
      }

      message += `\nFiles in media folder:\n${files.join('\n')}`;

      console.log('📁 chime.wav exists?', chimeWavExists);
      console.log('📁 Any .wav files?', anyWavExists);
      console.log('📁 .wav files found:' , wavFiles);

      vscode.window.showInformationMessage(message);
      
      // if (fs.existsSync(mediaFolder)) {
      //   const files = fs.readdirSync(mediaFolder);
      //   console.log('📁 Files in media folder:', files);
        
      //   vscode.window.showInformationMessage(
      //     `Chime file ${fs.existsSync(chimeFile) ? 'EXISTS ✅' : 'NOT FOUND ❌'}\n\nFiles in media: ${files.join(', ')}`
      //   );
      // } else {
      //   console.log('❌ Media folder does not exist!');
      //   vscode.window.showErrorMessage('❌ Media folder does not exist!');
      // }
    }
  );

  context.subscriptions.push(testChimeCmd, setVolumeCmd, toggleCmd, checkFileCmd);
}

/*
 export function for other modules to play chime
 how to use it: import { playChimeIfEnabled } from './audio/chimePlayer';
 */
export async function playChimeIfEnabled(): Promise<void> {
  if (chimePlayer) {
    await chimePlayer.playChimeIfEnabled();
  } else {
    console.warn('⚠️ ChimePlayer not initialized');
  }
}

