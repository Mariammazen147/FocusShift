const execSyncMock = jest.fn();

jest.mock('child_process', () => ({
  execSync: (...args: any[]) => execSyncMock(...args),
}));

import { isOllamaInstalled, isModelInstalled, getOllamaStatus, MODEL_NAME } from '../setup/ollamastatus';

describe('isOllamaInstalled', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
  });

  test('returns true when `ollama --version` succeeds', () => {
    execSyncMock.mockReturnValue('ollama version 0.1.0');
    expect(isOllamaInstalled()).toBe(true);
  });

  test('returns false when the command throws (ollama not on PATH)', () => {
    execSyncMock.mockImplementation(() => { throw new Error('command not found'); });
    expect(isOllamaInstalled()).toBe(false);
  });
});

describe('isModelInstalled', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
  });

  test('returns true when `ollama list` output includes the model name', () => {
    execSyncMock.mockReturnValue(`NAME                          SIZE\n${MODEL_NAME}    1.2 GB\n`);
    expect(isModelInstalled()).toBe(true);
  });

  test('returns false when the model is not in the list', () => {
    execSyncMock.mockReturnValue('NAME                SIZE\nsome-other-model    3 GB\n');
    expect(isModelInstalled()).toBe(false);
  });

  test('returns false when the command throws', () => {
    execSyncMock.mockImplementation(() => { throw new Error('ollama not found'); });
    expect(isModelInstalled()).toBe(false);
  });
});

describe('getOllamaStatus caching', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
    jest.useFakeTimers();
    // Reset the module-level cache between tests since it's not exposed —
    // forceRefresh:true on the first call in each test achieves this.
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('only shells out once for repeated calls within the 30s cache window', () => {
    execSyncMock.mockReturnValue('ollama version 0.1.0'); // used for both --version and list calls

    const first = getOllamaStatus(true); // force a clean read to start
    const callsAfterFirst = execSyncMock.mock.calls.length;

    const second = getOllamaStatus(); // within cache window — should NOT shell out again
    expect(execSyncMock.mock.calls.length).toBe(callsAfterFirst);
    expect(second).toEqual(first);
  });

  test('forceRefresh bypasses the cache even within the 30s window', () => {
    execSyncMock.mockReturnValue('ollama version 0.1.0');
    getOllamaStatus(true);
    const callsAfterFirst = execSyncMock.mock.calls.length;

    getOllamaStatus(true); // forced again — should shell out again
    expect(execSyncMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  test('re-checks automatically once the 30s cache TTL has elapsed', () => {
    execSyncMock.mockReturnValue('ollama version 0.1.0');
    getOllamaStatus(true);
    const callsAfterFirst = execSyncMock.mock.calls.length;

    jest.advanceTimersByTime(30_001);
    getOllamaStatus(); // no forceRefresh, but cache should now be stale
    expect(execSyncMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  test('modelReady is false when Ollama itself is not installed, without checking the model list', () => {
    execSyncMock.mockImplementation(() => { throw new Error('not found'); });
    const status = getOllamaStatus(true);
    expect(status.installed).toBe(false);
    expect(status.modelReady).toBe(false);
    // isOllamaInstalled's failed `--version` call is the only shell attempt —
    // isModelInstalled should be short-circuited, not attempted separately.
    expect(execSyncMock).toHaveBeenCalledTimes(1);
  });
});