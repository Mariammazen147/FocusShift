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

describe('StateManager.restoreState() reopening logic', () => {
  let manager: StateManager;
  const vscode = require('vscode');

  const savedState = (editorUris: string[]) => JSON.stringify({
    editors: editorUris.map(uri => ({
      fileUri: uri,
      position: { line: 3, character: 0 },
      snippet: '',
      timestamp: Date.now(),
      language: 'typescript',
      editHistory: [], cursorHistory: [], scrollHistory: [], tabHistory: [],
      errors: [],
    })),
    activeEditorUri: editorUris[0],
    timestamp: Date.now(),
  });

  // getHeuristicSummary needs a real-shaped TextDocument (fileName, lineCount,
  // lineAt, languageId, getText) — an empty {} would crash it, not fall back
  // gracefully, and getText() needs enough lines to cover the saved cursor
  // position (our saved state uses position.line: 3) or its internal
  // lines[cursorIndex] lookup goes out of bounds.
  const docLines = ['line0', 'line1', 'line2', 'line3', 'line4', 'line5'];
  const makeDoc = (name = 'file.ts') => ({
    fileName: name,
    languageId: 'typescript',
    lineCount: docLines.length,
    lineAt: (n: number) => ({ text: docLines[n] ?? '' }),
    getText: () => docLines.join('\n'),
  });

  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
    jest.clearAllMocks();
    vscode.window.visibleTextEditors = [];
    vscode.workspace.openTextDocument = jest.fn().mockResolvedValue(makeDoc());
    vscode.window.showTextDocument = jest.fn().mockResolvedValue({ selection: undefined });
    manager = new StateManager(mockMemento as any, mockHistoryService as any);
  });

  test('skips the reopen loop for a file that is already visible', async () => {
    const uri = 'file:///already/open.ts';
    store['focusshift.lastState'] = savedState([uri]);
    vscode.window.visibleTextEditors = [{ document: { uri: { toString: () => uri } } }];

    await manager.restoreState(true);

    // The reopen loop should skip it entirely — but openTextDocument is still
    // called once separately to focus/reveal the active editor (cheap and
    // correct, since it's just revealing an already-open doc, not creating a
    // new tab). showTextDocument (the actual focus/reveal call) should fire.
    expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
    expect(vscode.window.showTextDocument).toHaveBeenCalled();
  });

  test('reopens a file that is not currently visible', async () => {
    const uri = 'file:///was/closed.ts';
    store['focusshift.lastState'] = savedState([uri]);
    vscode.window.visibleTextEditors = [];

    await manager.restoreState(true);

    expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
  });

  test('one file failing to reopen does not stop the rest of the restore or add a history entry', async () => {
    const badUri = 'file:///deleted/gone.ts';
    const goodUri = 'file:///still/here.ts';
    store['focusshift.lastState'] = savedState([badUri, goodUri]);
    vscode.window.visibleTextEditors = [];

    let call = 0;
    vscode.workspace.openTextDocument = jest.fn().mockImplementation((_uri: any) => {
      call++;
      // Only the very first attempt (reopening badUri in the loop) fails —
      // every later call (the second file, and any later active-doc lookups)
      // should still succeed with a valid document shape.
      if (call === 1) {
        return Promise.reject(new Error('file not found'));
      }
      return Promise.resolve(makeDoc());
    });

    await expect(manager.restoreState(true)).resolves.not.toThrow();

    // At least both saved files should have been attempted — one failure shouldn't abort the loop.
    expect(vscode.workspace.openTextDocument.mock.calls.length).toBeGreaterThanOrEqual(2);
    // A history entry should still be recorded even though one file failed.
    expect(mockHistoryService.add).toHaveBeenCalled();
  });

  test('clears the saved state after a restore attempt, even when reopening fails', async () => {
    const uri = 'file:///was/closed.ts';
    store['focusshift.lastState'] = savedState([uri]);
    vscode.window.visibleTextEditors = [];

    // Reopening the file itself fails (e.g. deleted while away), but the later
    // lookup for building the history/summary entry should still succeed.
    let call = 0;
    vscode.workspace.openTextDocument = jest.fn().mockImplementation(() => {
      call++;
      return call === 1 ? Promise.reject(new Error('gone')) : Promise.resolve(makeDoc());
    });

    await manager.restoreState(true);

    expect(mockMemento.get('focusshift.lastState', null)).toBeNull();
  });
});