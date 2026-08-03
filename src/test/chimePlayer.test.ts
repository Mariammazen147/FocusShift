// Use a mutable flag rather than reassigning vscode.workspace.getConfiguration
// directly in a test — the old approach permanently mutated the shared mock
// with no reset, silently leaking "chime disabled" into every test that ran
// after it in this file.
let chimeEnabledFlag = true;

jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'chimeEnabled') { return chimeEnabledFlag; }
        return defaultVal;
      },
      update: jest.fn(),
    }),
  },
  window: {
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    setStatusBarMessage: jest.fn(),
  },
  ConfigurationTarget: { Global: 1 },
}), { virtual: true });

const wavPlayerMock = { play: jest.fn(() => Promise.resolve()) };
jest.mock('node-wav-player', () => wavPlayerMock);

// getChimeFilePath checks the real filesystem — mock it so tests can control
// whether a chime file is "found" without depending on the actual /media folder.
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  readdirSync: jest.fn(() => ['chime.wav']),
}));

import { ChimePlayer } from '../audio/chimePlayer';

const mockContext = {
  extensionPath: '/mock/extension',
  extensionUri: { fsPath: '/mock/extension' },
  globalState: {
    get: jest.fn(() => true),
    update: jest.fn(),
    keys: jest.fn(() => []),
  },
  subscriptions: [] as any[],
};

describe('ChimePlayer', () => {
  let player: ChimePlayer;

  beforeEach(() => {
    jest.clearAllMocks();
    chimeEnabledFlag = true; // reset before every test — no leakage between tests
    player = new ChimePlayer(mockContext as any);
  });

  test('instantiates without throwing', () => {
    expect(player).toBeDefined();
  });

  test('playChimeIfEnabled() does not throw when chime is enabled', async () => {
    await player.playChimeIfEnabled();
  });

  test('playChimeIfEnabled() does nothing (and does not throw) when chime is disabled', async () => {
    chimeEnabledFlag = false;
    await player.playChimeIfEnabled();
    expect(wavPlayerMock.play).not.toHaveBeenCalled();
  });

  test('playChime() does not throw even when no chime file exists', async () => {
    await player.playChime();
  });

  test('toggleChime() does not throw', async () => {
    await player.toggleChime();
  });

  test('shows a status bar message (not just a console log) when playback fails', async () => {
    const vscode = require('vscode');
    wavPlayerMock.play.mockRejectedValueOnce(new Error('no audio device'));

    await player.playChime();

    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
      expect.stringContaining('chime failed to play'),
      expect.any(Number)
    );
  });

  test('does not show a failure status bar message when playback succeeds', async () => {
    const vscode = require('vscode');
    wavPlayerMock.play.mockResolvedValueOnce(undefined);

    await player.playChime();

    expect(vscode.window.setStatusBarMessage).not.toHaveBeenCalled();
  });
});