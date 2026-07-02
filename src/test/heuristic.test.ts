import { getHeuristicSummary } from '../summary/heuristic';

const mockDocument = (lines: string[], languageId = 'typescript') => ({
  lineCount: lines.length,
  lineAt: (n: number) => ({ text: lines[n] ?? '' }),
  getText: () => lines.join('\n'),
  languageId,
  fileName: '/home/dev/project/auth.ts',
});

const mockPosition = (line: number, character = 0) => ({ line, character });

describe('getHeuristicSummary', () => {
  test('returns a non-empty string for a basic TypeScript function', () => {
    const doc = mockDocument([
      'function validateToken(token: string): boolean {',
      '  if (!token) return false;',
      '  return token.length > 10;',
      '}',
    ]);
    const result = getHeuristicSummary(doc as any, mockPosition(1) as any);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns a non-empty string for an empty file', () => {
    const doc = mockDocument(['']);
    const result = getHeuristicSummary(doc as any, mockPosition(0) as any);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns a non-empty string for a class definition', () => {
    const doc = mockDocument([
      'class AuthService {',
      '  private token: string;',
      '  constructor(token: string) {',
      '    this.token = token;',
      '  }',
      '}',
    ]);
    const result = getHeuristicSummary(doc as any, mockPosition(2) as any);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('identifies a method inside a class', () => {
    const doc = mockDocument([
      'class AuthService {',
      '  validateToken(token: string): boolean {',
      '    return token.length > 10;',
      '  }',
      '}',
    ]);
    const result = getHeuristicSummary(doc as any, mockPosition(2) as any);
    expect(result).toContain('validateToken');
  });

  test('identifies a standalone function', () => {
    const doc = mockDocument([
      'function parseJwt(token: string) {',
      '  return JSON.parse(atob(token.split(".")[1]));',
      '}',
    ]);
    const result = getHeuristicSummary(doc as any, mockPosition(1) as any);
    expect(result).toContain('parseJwt');
  });

  test('does not throw for any cursor position', () => {
    const doc = mockDocument(['const authToken = "abc";', 'const userId = 42;']);
    expect(() => getHeuristicSummary(doc as any, mockPosition(0) as any)).not.toThrow();
    expect(() => getHeuristicSummary(doc as any, mockPosition(1) as any)).not.toThrow();
  });

  test('returns a string mentioning the filename', () => {
    const doc = mockDocument(['const x = 1;']);
    const result = getHeuristicSummary(doc as any, mockPosition(0) as any);
    expect(result).toContain('auth.ts');
  });

  test('picks "reading through" verb when scrolls dominate edits', () => {
    const doc = mockDocument(['function read() {', '  return true;', '}']);
    const result = getHeuristicSummary(doc as any, mockPosition(1) as any, 1, 10);
    expect(result).toContain('reading through');
  });

  test('picks "writing in" verb when many edits', () => {
    const doc = mockDocument(['function write() {', '  return true;', '}']);
    const result = getHeuristicSummary(doc as any, mockPosition(1) as any, 6, 0);
    expect(result).toContain('writing in');
  });
});
