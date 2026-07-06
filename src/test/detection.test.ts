import { activateDetection } from '../core/detection';

const store: Record<string, any> = {};
const mockMemento = {
  get: (key: string, defaultVal?: any) => store[key] ?? defaultVal,
  update: async (key: string, value: any) => { store[key] = value; },
  keys: () => Object.keys(store),
};

const mockHistoryService = {
  add: jest.fn(),
  getAll: jest.fn(() => []),
  delete: jest.fn(),
  clearAll: jest.fn(),
};

// Captured event handlers so tests can fire them manually, the same way
// VS Code would when a document changes, the window blurs, or a setting
// is edited in the Settings UI.
let windowStateHandler: ((state: { focused: boolean }) => void) | undefined;
let configChangeHandler: ((e: { affectsConfiguration: (s: string) => boolean }) => void) | undefined;
let textDocumentHandler: (() => void) | undefined;

// getConfiguration() is called fresh each time in detection.ts, so rather
// than track calls on one shared object we track them on the mock function
// itself — this lets us assert on the exact (key, default) pairs used.
const configGetSpy = jest.fn((key: string, defaultVal: any) => {
  const overrides: Record<string, any> = {
    inactivityMinutes: (mockMemento as any).__inactivityMinutesOverride,
  };
  const val = overrides[key];
  return val !== undefined ? val : defaultVal;
});

jest.mock('vscode', () => ({
  window: {
    activeTextEditor: null,
    visibleTextEditors: [],
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showTextDocument: jest.fn(),
    onDidChangeWindowState: jest.fn((cb: any) => {
      windowStateHandler = cb;
      return { dispose: jest.fn() };
    }),
    onDidChangeTextEditorSelection: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeTextEditorVisibleRanges: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
  },
  workspace: {
    getConfiguration: () => ({ get: configGetSpy }),
    openTextDocument: jest.fn(),
    onDidChangeTextDocument: jest.fn((cb: any) => {
      textDocumentHandler = cb;
      return { dispose: jest.fn() };
    }),
    onDidChangeConfiguration: jest.fn((cb: any) => {
      configChangeHandler = cb;
      return { dispose: jest.fn() };
    }),
    workspaceFolders: [],
  },
  languages: {
    getDiagnostics: jest.fn(() => []),
  },
  Uri: { parse: (s: string) => ({ toString: () => s, fsPath: s }) },
  Position: class { constructor(public line: number, public character: number) {} },
  Range: class { constructor(public start: any, public end: any) {} },
  Selection: class { constructor(public anchor: any, public active: any) {} },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
}), { virtual: true });

describe('activateDetection inactivity threshold', () => {
  const context = { globalState: mockMemento } as any;

  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
    delete (mockMemento as any).__inactivityMinutesOverride;
    configGetSpy.mockClear();
    windowStateHandler = undefined;
    configChangeHandler = undefined;
    textDocumentHandler = undefined;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads inactivityMinutes from config, not inactivityThresholdSeconds', () => {
    activateDetection(context, mockHistoryService as any);

    expect(configGetSpy).toHaveBeenCalledWith('inactivityMinutes', 5);
    expect(configGetSpy).not.toHaveBeenCalledWith('inactivityThresholdSeconds', expect.anything());
  });

  it('captures state after inactivityMinutes elapses with no activity', () => {
    const stateManager = activateDetection(context, mockHistoryService as any);
    const captureSpy = jest.spyOn(stateManager, 'captureState').mockImplementation(() => {});

    // Default is 5 minutes — advancing by exactly that should fire the capture.
    jest.advanceTimersByTime(5 * 60 * 1000);

    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('reschedules the timer when inactivityMinutes changes', () => {
    const stateManager = activateDetection(context, mockHistoryService as any);
    const captureSpy = jest.spyOn(stateManager, 'captureState').mockImplementation(() => {});

    // Simulate the user changing the setting to 1 minute in Settings UI.
    (mockMemento as any).__inactivityMinutesOverride = 1;
    expect(configChangeHandler).toBeDefined();
    configChangeHandler!({ affectsConfiguration: (key: string) => key === 'focusshift.inactivityMinutes' });

    // Only 1 minute should now be needed to trigger a capture, not 5.
    jest.advanceTimersByTime(60 * 1000);
    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('does not reschedule when an unrelated setting changes', () => {
    const stateManager = activateDetection(context, mockHistoryService as any);
    const captureSpy = jest.spyOn(stateManager, 'captureState').mockImplementation(() => {});

    (mockMemento as any).__inactivityMinutesOverride = 1;
    configChangeHandler!({ affectsConfiguration: (key: string) => key === 'focusshift.chimeEnabled' });

    // Old 5-minute timer is still the one running, so 1 minute alone
    // should not have triggered a capture yet.
    jest.advanceTimersByTime(60 * 1000);
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('activity events reset the inactivity timer', () => {
    const stateManager = activateDetection(context, mockHistoryService as any);
    const captureSpy = jest.spyOn(stateManager, 'captureState').mockImplementation(() => {});

    // Almost reach the 5-minute default, then simulate a keystroke.
    jest.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);
    expect(textDocumentHandler).toBeDefined();
    textDocumentHandler!();

    // The reset should push the deadline out — the remaining 1 second
    // from the old countdown should NOT fire a capture.
    jest.advanceTimersByTime(1000);
    expect(captureSpy).not.toHaveBeenCalled();

    // A full 5 minutes after the reset, it should fire.
    jest.advanceTimersByTime(5 * 60 * 1000 - 1000);
    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('shows the popup restore path only after minAwaySeconds', () => {
    const stateManager = activateDetection(context, mockHistoryService as any);
    const restoreSpy = jest.spyOn(stateManager, 'restoreState').mockImplementation(async () => {});
    const captureSpy = jest.spyOn(stateManager, 'captureState').mockImplementation(() => {});

    expect(windowStateHandler).toBeDefined();

    windowStateHandler!({ focused: false });
    expect(captureSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(10 * 1000); // 10s away — below default 30s minAwaySeconds
    windowStateHandler!({ focused: true });
    expect(restoreSpy).not.toHaveBeenCalled();
  });
});