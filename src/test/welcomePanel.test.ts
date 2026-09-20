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

const mockGenerateLLMSummary = jest.fn();

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

jest.mock('../summary/SummaryService', () => ({
  SummaryService: jest.fn().mockImplementation(() => ({
    generateLLMSummary: mockGenerateLLMSummary,
  })),
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
    mockGenerateLLMSummary.mockReset();
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

  test('does not close before the minimum 10s clamp, regardless of content', () => {
    WelcomePanel.show(mockContext as any, mockState() as any);
    jest.advanceTimersByTime(9_999);
    expect(mockPanel.dispose).not.toHaveBeenCalled();
  });

  test('closes by the maximum 40s clamp even for very long content', () => {
    WelcomePanel.show(mockContext as any, {
      ...mockState(),
      snippet: 'line of code '.repeat(200), // deliberately huge, to hit the upper clamp
    } as any);
    jest.advanceTimersByTime(40_000);
    expect(mockPanel.dispose).toHaveBeenCalledTimes(1);
  });

  test('an interaction resets the auto-close timer instead of letting it fire immediately', () => {
    WelcomePanel.show(mockContext as any, mockState() as any);

    // Some time passes, then the user clicks something that doesn't close the panel
    jest.advanceTimersByTime(5_000);
    expect((mockWebview as any)._cb).toBeDefined();
    (mockWebview as any)._cb({ command: 'openSettings' });

    // Immediately after the interaction, well under even the minimum clamp — should not have fired yet
    jest.advanceTimersByTime(5_000);
    expect(mockPanel.dispose).not.toHaveBeenCalled();

    // Advance well past the maximum possible delay from the moment of interaction — must have fired by now
    jest.advanceTimersByTime(40_000);
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
  describe('WelcomePanel — waiting for the LLM summary before starting auto-close', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    llmEnabledOverride = true;
    mockGenerateLLMSummary.mockReset();
    (WelcomePanel as any).current = undefined;
    (mockWebview as any)._cb = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not auto-close while the LLM summary is still pending, even past the max clamp', async () => {
    let resolveLLM: (v: string | undefined) => void;
    mockGenerateLLMSummary.mockReturnValue(new Promise(res => { resolveLLM = res; }));

    WelcomePanel.show(mockContext as any, mockState() as any);

    await jest.advanceTimersByTimeAsync(40_000);
    expect(mockPanel.dispose).not.toHaveBeenCalled();

    resolveLLM!(undefined);
  });

  test('an interaction while the LLM summary is pending does not prematurely arm the timer', async () => {
    let resolveLLM: (v: string | undefined) => void;
    mockGenerateLLMSummary.mockReturnValue(new Promise(res => { resolveLLM = res; }));

    WelcomePanel.show(mockContext as any, mockState() as any);
    (mockWebview as any)._cb({ command: 'openSettings' });

    await jest.advanceTimersByTimeAsync(40_000);
    expect(mockPanel.dispose).not.toHaveBeenCalled();

    resolveLLM!(undefined);
  });

  test('starts the countdown once the LLM summary resolves successfully', async () => {
    mockGenerateLLMSummary.mockResolvedValue('a rich AI-generated summary of what you were doing');

    WelcomePanel.show(mockContext as any, mockState() as any);
    await jest.advanceTimersByTimeAsync(0);

    await jest.advanceTimersByTimeAsync(9_999);
    expect(mockPanel.dispose).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(40_000);
    expect(mockPanel.dispose).toHaveBeenCalledTimes(1);
  });

  test('starts the countdown using the heuristic content if the LLM call fails', async () => {
    mockGenerateLLMSummary.mockRejectedValue(new Error('Ollama not running'));

    WelcomePanel.show(mockContext as any, mockState() as any);
    await jest.advanceTimersByTimeAsync(0);

    await jest.advanceTimersByTimeAsync(9_999);
    expect(mockPanel.dispose).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(40_000);
    expect(mockPanel.dispose).toHaveBeenCalledTimes(1);
  });

  test('starts the countdown if the LLM call resolves with no usable content', async () => {
    mockGenerateLLMSummary.mockResolvedValue(undefined);

    WelcomePanel.show(mockContext as any, mockState() as any);
    await jest.advanceTimersByTimeAsync(0);

    await jest.advanceTimersByTimeAsync(40_000);
    expect(mockPanel.dispose).toHaveBeenCalledTimes(1);
  });
});
});