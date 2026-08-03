const mockWebview = {
  html: '',
  onDidReceiveMessage: jest.fn((cb) => { (mockWebview as any)._cb = cb; return { dispose: jest.fn() }; }),
  postMessage: jest.fn(),
};

const mockPanel = {
  webview: mockWebview,
  reveal: jest.fn(),
  onDidDispose: jest.fn((cb) => { (mockPanel as any)._disposeCb = cb; return { dispose: jest.fn() }; }),
  dispose: jest.fn(),
};

let llmEnabledOverride = false; // keep tests synchronous by default — no fetch/network involved

jest.mock('vscode', () => ({
  window: {
    createWebviewPanel: jest.fn(() => mockPanel),
  },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, d: any) => llmEnabledOverride ?? d }),
    textDocuments: [],
  },
  commands: { executeCommand: jest.fn() },
  ViewColumn: { Beside: 2 },
  Uri: { parse: (s: string) => ({ toString: () => s, fsPath: s }) },
  Position: class { constructor(public line: number, public character: number) {} },
}), { virtual: true });

// Real chimePlayer.ts pulls in vscode + node-wav-player — mock the whole
// module so these tests only assert *that* the chime was triggered, not how.
jest.mock('../audio/chimePlayer', () => ({
  playChimeIfEnabled: jest.fn(),
}));

// Real ollamastatus.ts shells out via execSync — mock it so tests don't
// depend on whether Ollama happens to be installed on the machine running them.
jest.mock('../setup/ollamastatus', () => ({
  getOllamaStatus: jest.fn(() => ({ installed: true, modelReady: true })),
}));

import { WelcomePanel } from '../ui/welcomePanel';
import { playChimeIfEnabled } from '../audio/chimePlayer';

const mockState = () => ({
  fileUri: 'file:///home/dev/project/auth.ts',
  position: { line: 10, character: 0 },
  snippet: 'function validateToken() {}',
  timestamp: Date.now(),
  language: 'typescript',
  editHistory: [],
  cursorHistory: [],
  scrollHistory: [],
  tabHistory: [],
  awayDuration: 90,
  errors: [],
});

const mockContext = { subscriptions: [] as any[] };

describe('WelcomePanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    llmEnabledOverride = false;
    (WelcomePanel as any).current = undefined;
    (mockWebview as any)._cb = undefined;
    (mockPanel as any)._disposeCb = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('show() creates a panel without throwing', () => {
    expect(() => WelcomePanel.show(mockContext as any, mockState() as any)).not.toThrow();
  });

  test('show() plays the chime once', () => {
    WelcomePanel.show(mockContext as any, mockState() as any);
    expect(playChimeIfEnabled).toHaveBeenCalledTimes(1);
  });

  test('show() called twice reuses the same panel and only plays the chime once', () => {
    WelcomePanel.show(mockContext as any, mockState() as any);
    WelcomePanel.show(mockContext as any, mockState() as any);
    const { createWebviewPanel } = require('vscode').window;
    expect(createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(mockPanel.reveal).toHaveBeenCalledTimes(1);
    expect(playChimeIfEnabled).toHaveBeenCalledTimes(1);
  });

  test('auto-closes at 15 seconds, not a moment before', () => {
    WelcomePanel.show(mockContext as any, mockState() as any);

    jest.advanceTimersByTime(14_999);
    expect(mockPanel.dispose).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(mockPanel.dispose).toHaveBeenCalledTimes(1);
  });

  test('an interaction resets the auto-close timer instead of letting it fire', () => {
    WelcomePanel.show(mockContext as any, mockState() as any);

    // 10s in, the user clicks something that doesn't close the panel (e.g. opens Settings)
    jest.advanceTimersByTime(10_000);
    expect((mockWebview as any)._cb).toBeDefined();
    (mockWebview as any)._cb({ command: 'openSettings' });

    // 10 more seconds (20s total from creation) — still under the *reset* 15s window, so no dispose yet
    jest.advanceTimersByTime(10_000);
    expect(mockPanel.dispose).not.toHaveBeenCalled();

    // 5 more seconds — now 15s since the interaction — should fire
    jest.advanceTimersByTime(5_000);
    expect(mockPanel.dispose).toHaveBeenCalledTimes(1);
  });

  test('manually dismissing clears the auto-close timer (no double-dispose later)', () => {
    WelcomePanel.show(mockContext as any, mockState() as any);
    (mockWebview as any)._cb({ command: 'dismiss' });
    expect(mockPanel.dispose).toHaveBeenCalledTimes(1);

    // If the timer weren't cleared, this would try to fire dispose() again.
    jest.advanceTimersByTime(20_000);
    expect(mockPanel.dispose).toHaveBeenCalledTimes(1);
  });

  test('"jump" message triggers focusshift.restore and disposes the panel', () => {
    const { commands } = require('vscode');
    WelcomePanel.show(mockContext as any, mockState() as any);
    (mockWebview as any)._cb({ command: 'jump' });

    expect(commands.executeCommand).toHaveBeenCalledWith('focusshift.restore', true);
    expect(mockPanel.dispose).toHaveBeenCalledTimes(1);
  });
});