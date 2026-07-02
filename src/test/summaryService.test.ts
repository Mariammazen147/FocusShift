import { SummaryService } from '../summary/SummaryService';

global.fetch = jest.fn();

const mockCtx = {
  fileUri: 'file:///home/dev/project/auth.ts',
  position: { line: 41, character: 0 },
  snippet: 'function validateToken(token: string) {',
  timestamp: Date.now(),
  language: 'typescript',
  editHistory: [{ time: '12:00', change: 'inserted validateToken' }],
  cursorHistory: [],
  scrollHistory: [],
  tabHistory: [],
  awayDuration: 120,
  errors: [],
};

describe('SummaryService', () => {
  let service: SummaryService;

  beforeEach(() => {
    service = new SummaryService();
    jest.clearAllMocks();
  });

  test('returns undefined when Ollama is not running (fetch throws)', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Connection refused'));
    const result = await service.generateLLMSummary(mockCtx as any);
    expect(result).toBeUndefined();
  });

  test('returns undefined when Ollama returns non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });
    const result = await service.generateLLMSummary(mockCtx as any);
    expect(result).toBeUndefined();
  });

  test('returns a string when Ollama responds successfully', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: 'assistant',
          content: '**Where You Were**\n- You were editing auth.ts at line 42.\n\n**Context**\n- You were validating JWT tokens.\n\n**Suggestion**\n- Run the token validation test next.',
        },
        done: true,
      }),
    });
    const result = await service.generateLLMSummary(mockCtx as any);
    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  test('returns undefined when Ollama response has empty content', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: 'assistant', content: '' }, done: true }),
    });
    const result = await service.generateLLMSummary(mockCtx as any);
    expect(result).toBeUndefined();
  });

  test('returns undefined when Ollama response has whitespace-only content', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: 'assistant', content: '   \n  ' }, done: true }),
    });
    const result = await service.generateLLMSummary(mockCtx as any);
    expect(result).toBeUndefined();
  });
});
