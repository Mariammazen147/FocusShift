import { StateManager } from '../core/stateManager';

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

jest.mock('vscode', () => ({
  window: {
    activeTextEditor: null,
    visibleTextEditors: [],
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showTextDocument: jest.fn(),
    onDidChangeTextEditorSelection: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeTextEditorVisibleRanges: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
  },
  workspace: {
    getConfiguration: () => ({ get: (_: string, d: any) => d }),
    openTextDocument: jest.fn(),
    onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
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

describe('StateManager', () => {
  let manager: StateManager;

  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
    jest.clearAllMocks();
    manager = new StateManager(mockMemento as any, mockHistoryService as any);
  });

  test('instantiates without throwing', () => {
    expect(manager).toBeDefined();
  });

  test('captureState() does not throw when no active editor', () => {
    expect(() => manager.captureState()).not.toThrow();
  });

  test('captureState() does not write to storage when there are no open editors', () => {
    manager.captureState();
    expect(mockMemento.get('focusshift.lastState', null)).toBeNull();
  });

  test('restoreState() resolves without error when nothing is saved', async () => {
    await manager.restoreState();
  });

  test('restoreState(skipLLM=true) resolves without error', async () => {
    await manager.restoreState(true);
  });
});
