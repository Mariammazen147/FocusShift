// OllamaSetup.isOllamaInstalled uses exec (async callback), not execSync
// OllamaSetup.isModelAvailable uses fetch, not exec
import { exec } from 'child_process';

jest.mock('child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn(),
}));

jest.mock('vscode', () => ({
  window: {
    showInformationMessage: jest.fn(() => Promise.resolve(undefined)),
    showErrorMessage: jest.fn(),
    showInputBox: jest.fn(),
    withProgress: jest.fn((_opts: any, task: () => any) => task()),
  },
  ProgressLocation: { Notification: 15 },
  Uri: { parse: jest.fn((s: string) => s) },
}), { virtual: true });

global.fetch = jest.fn();

import { OllamaSetup } from '../setup/OllamaSetup';

describe('OllamaSetup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('isOllamaInstalled returns true when exec succeeds', async () => {
    (exec as jest.Mock).mockImplementation((_cmd: string, cb: Function) => cb(null));
    const result = await (OllamaSetup as any).isOllamaInstalled();
    expect(result).toBe(true);
  });

  test('isOllamaInstalled returns false when exec reports error', async () => {
    (exec as jest.Mock).mockImplementation((_cmd: string, cb: Function) => cb(new Error('not found')));
    const result = await (OllamaSetup as any).isOllamaInstalled();
    expect(result).toBe(false);
  });

  test('isModelAvailable returns true when model appears in Ollama API response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ models: [{ name: 'qwen2.5-coder:7b-instruct' }] }),
    });
    const result = await (OllamaSetup as any).isModelAvailable();
    expect(result).toBe(true);
  });

  test('isModelAvailable returns false when model is not in the list', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ models: [{ name: 'llama3:latest' }] }),
    });
    const result = await (OllamaSetup as any).isModelAvailable();
    expect(result).toBe(false);
  });

  test('isModelAvailable returns false when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('connection refused'));
    const result = await (OllamaSetup as any).isModelAvailable();
    expect(result).toBe(false);
  });

  test('checkAndSetup does not throw when ollama and model are already ready', async () => {
    (exec as jest.Mock).mockImplementation((_cmd: string, cb: Function) => cb(null));
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ models: [{ name: 'qwen2.5-coder:7b-instruct' }] }),
    });
    await OllamaSetup.checkAndSetup();
  });
});
