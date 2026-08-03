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

jest.mock('vscode', () => ({
  window: {
    createWebviewPanel: jest.fn(() => mockPanel),
  },
  ViewColumn: { One: 1 },
  Uri: { parse: (s: string) => s },
}), { virtual: true });

import { HistoryPanel } from '../history/HistoryPanel';

const mockHistoryService = {
  getAll: jest.fn(() => []),
  add: jest.fn(),
  delete: jest.fn(),
  clearAll: jest.fn(),
};

const mockContext = {
  globalState: {
    get: jest.fn(),
    update: jest.fn(),
    keys: jest.fn(() => []),
  },
  extensionUri: { fsPath: '/mock' },
  subscriptions: [] as any[],
};

describe('HistoryPanel', () => {
  // Regression test: an auto-close timer (meant only for WelcomePanel's
  // transient popup) briefly leaked into this file's createOrShow, silently
  // closing the Context History panel after 15s even mid-browse. It should
  // never auto-close — the user opens it deliberately and browses it for as
  // long as they want.
  test('never auto-closes, even after 15+ seconds with no interaction', () => {
    jest.useFakeTimers();
    HistoryPanel.createOrShow(mockContext as any, mockHistoryService as any);

    jest.advanceTimersByTime(20_000);

    expect(mockPanel.dispose).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
    (HistoryPanel as any).currentPanel = undefined;
    mockContext.subscriptions = [];
    (mockWebview as any)._cb = undefined;
  });

  test('createOrShow() creates a panel without throwing', () => {
    expect(() => {
      HistoryPanel.createOrShow(mockContext as any, mockHistoryService as any);
    }).not.toThrow();
  });

  test('createOrShow() calls getAll() to load history', () => {
    HistoryPanel.createOrShow(mockContext as any, mockHistoryService as any);
    expect(mockHistoryService.getAll).toHaveBeenCalled();
  });

  test('createOrShow() called twice reuses the same panel (createWebviewPanel called once)', () => {
    HistoryPanel.createOrShow(mockContext as any, mockHistoryService as any);
    HistoryPanel.createOrShow(mockContext as any, mockHistoryService as any);
    const { createWebviewPanel } = require('vscode').window;
    expect(createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  test('delete message triggers historyService.delete()', () => {
    HistoryPanel.createOrShow(mockContext as any, mockHistoryService as any);
    const cb = (mockWebview as any)._cb;
    if (cb) { cb({ command: 'delete', entryId: 'test-id-123' }); }
    expect(mockHistoryService.delete).toHaveBeenCalledWith('test-id-123');
  });

  test('clearAll message triggers historyService.clearAll()', () => {
    HistoryPanel.createOrShow(mockContext as any, mockHistoryService as any);
    const cb = (mockWebview as any)._cb;
    if (cb) { cb({ command: 'clearAll' }); }
    expect(mockHistoryService.clearAll).toHaveBeenCalled();
  });
});
