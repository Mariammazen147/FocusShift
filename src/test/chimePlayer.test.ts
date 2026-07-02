jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'chimeEnabled') { return true; }
        return defaultVal;
      },
      update: jest.fn(),
    }),
  },
  window: {
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
  },
  ConfigurationTarget: { Global: 1 },
}), { virtual: true });

jest.mock('node-wav-player', () => ({
  play: jest.fn(() => Promise.resolve()),
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
    player = new ChimePlayer(mockContext as any);
  });

  test('instantiates without throwing', () => {
    expect(player).toBeDefined();
  });

  test('playChimeIfEnabled() does not throw when chime is enabled', async () => {
    await player.playChimeIfEnabled();
  });

  test('playChimeIfEnabled() does not throw when chime is disabled', async () => {
    const vscode = require('vscode');
    vscode.workspace.getConfiguration = () => ({
      get: (_: string, d: any) => false,
      update: jest.fn(),
    });
    await player.playChimeIfEnabled();
  });

  test('playChime() does not throw even when no chime file exists', async () => {
    await player.playChime();
  });

  test('toggleChime() does not throw', async () => {
    await player.toggleChime();
  });
});
