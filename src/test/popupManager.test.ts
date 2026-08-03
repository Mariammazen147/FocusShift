let windowStateHandler: ((state: { focused: boolean }) => void) | undefined;
let minAwayMinutesOverride: number | undefined;

const configGetSpy = jest.fn((key: string, defaultVal: any) => {
  if (key === 'minAwayMinutes' && minAwayMinutesOverride !== undefined) {
    return minAwayMinutesOverride;
  }
  return defaultVal;
});

jest.mock('vscode', () => ({
  window: {
    onDidChangeWindowState: jest.fn((cb: any) => {
      windowStateHandler = cb;
      return { dispose: jest.fn() };
    }),
  },
  workspace: {
    getConfiguration: () => ({ get: configGetSpy }),
  },
  Uri: { parse: (s: string) => ({ toString: () => s, fsPath: s }) },
  Position: class { constructor(public line: number, public character: number) {} },
}), { virtual: true });

jest.mock('../ui/welcomePanel', () => ({
  WelcomePanel: { show: jest.fn() },
}));

import { activatePopup } from '../ui/popupManager';
import { WelcomePanel } from '../ui/welcomePanel';

const mockContext = (lastState?: string) => ({
  globalState: {
    get: jest.fn((key: string) => (key === 'focusshift.lastState' ? lastState : undefined)),
  },
  subscriptions: [] as any[],
});

const savedState = (overrides: Partial<any> = {}, capturedSecondsAgo = 120) => JSON.stringify({
  editors: [{
    fileUri: 'file:///home/dev/project/auth.ts',
    position: { line: 10, character: 2 },
    snippet: 'function validateToken() {}',
    timestamp: Date.now() - capturedSecondsAgo * 1000,
    ...overrides,
  }],
  activeEditorUri: 'file:///home/dev/project/auth.ts',
  timestamp: Date.now() - capturedSecondsAgo * 1000,
});

describe('popupManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    windowStateHandler = undefined;
    minAwayMinutesOverride = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does nothing if there is no saved state', () => {
    activatePopup(mockContext(undefined) as any);
    windowStateHandler!({ focused: true });
    jest.advanceTimersByTime(1000);
    expect(WelcomePanel.show).not.toHaveBeenCalled();
  });

  test('does nothing on a blur event (only fires on focus)', () => {
    activatePopup(mockContext(savedState()) as any);
    windowStateHandler!({ focused: false });
    jest.advanceTimersByTime(1000);
    expect(WelcomePanel.show).not.toHaveBeenCalled();
  });

  test('shows the panel after the 400ms delay once away past minAwayMinutes', () => {
    activatePopup(mockContext(savedState({}, 120)) as any); // captured 2 minutes ago
    windowStateHandler!({ focused: true });

    jest.advanceTimersByTime(399);
    expect(WelcomePanel.show).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(WelcomePanel.show).toHaveBeenCalledTimes(1);
  });

  test('defaults to requiring 1 minute away when minAwayMinutes is unset', () => {
    activatePopup(mockContext(savedState({}, 50)) as any); // 50s away — under 1 min
    windowStateHandler!({ focused: true });
    jest.advanceTimersByTime(1000);
    expect(WelcomePanel.show).not.toHaveBeenCalled();
  });

  test('does not show the panel if away time is under minAwayMinutes', () => {
    minAwayMinutesOverride = 5; // require 5 minutes away
    activatePopup(mockContext(savedState({}, 60)) as any); // only 1 minute away
    windowStateHandler!({ focused: true });
    jest.advanceTimersByTime(1000);
    expect(WelcomePanel.show).not.toHaveBeenCalled();
  });

  test('passes the away duration in seconds to WelcomePanel.show', () => {
    activatePopup(mockContext(savedState({}, 120)) as any); // ~120s ago
    windowStateHandler!({ focused: true });
    jest.advanceTimersByTime(1000);

    const [, state] = (WelcomePanel.show as jest.Mock).mock.calls[0];
    expect(state.awayDuration).toBeGreaterThanOrEqual(119);
    expect(state.awayDuration).toBeLessThanOrEqual(121);
  });

  test('handles corrupted JSON in storage without throwing', () => {
    activatePopup(mockContext('{ this is not valid json') as any);
    expect(() => {
      windowStateHandler!({ focused: true });
      jest.advanceTimersByTime(1000);
    }).not.toThrow();
    expect(WelcomePanel.show).not.toHaveBeenCalled();
  });

  test('falls back to the flat legacy state shape if no editors[] array is present', () => {
    const legacyState = JSON.stringify({
      fileUri: 'file:///home/dev/project/legacy.ts',
      position: { line: 3, character: 0 },
      timestamp: Date.now() - 120_000,
    });
    activatePopup(mockContext(legacyState) as any);
    windowStateHandler!({ focused: true });
    jest.advanceTimersByTime(1000);

    expect(WelcomePanel.show).toHaveBeenCalledTimes(1);
    const [, state] = (WelcomePanel.show as jest.Mock).mock.calls[0];
    expect(state.fileUri).toBe('file:///home/dev/project/legacy.ts');
  });
});