import { renderSummaryHtml, stripSummaryMarkdown, escapeHtml, formatInline } from '../summary/renderSummary';

describe('renderSummaryHtml', () => {
  test('returns a non-empty HTML string', () => {
    const result = renderSummaryHtml('**Where You Were**\n- You were editing auth.ts\n\n**Context**\n- Fixing a bug\n\n**Suggestion**\n- Run the tests');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('output contains HTML tags', () => {
    const result = renderSummaryHtml('Some summary text');
    expect(result).toMatch(/<[a-z]/i);
  });

  test('wraps bullet lines in a <ul>', () => {
    const result = renderSummaryHtml('- first\n- second');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
  });

  test('does not throw on empty string', () => {
    expect(() => renderSummaryHtml('')).not.toThrow();
  });

  test('does not throw on very long input', () => {
    const long = 'word '.repeat(500);
    expect(() => renderSummaryHtml(long)).not.toThrow();
  });
});

describe('stripSummaryMarkdown', () => {
  test('removes ** bold markers', () => {
    const result = stripSummaryMarkdown('**hello** world');
    expect(result).not.toContain('**');
    expect(result).toContain('hello');
  });

  test('removes * italic markers', () => {
    const result = stripSummaryMarkdown('*italic* text');
    expect(result).not.toContain('*');
    expect(result).toContain('italic');
  });

  test('removes code blocks', () => {
    const result = stripSummaryMarkdown('text ```code block``` more');
    expect(result).not.toContain('```');
  });

  test('returns plain text unchanged', () => {
    const input = 'You were editing auth.ts at line 42.';
    expect(stripSummaryMarkdown(input)).toBe(input);
  });

  test('does not throw on empty string', () => {
    expect(() => stripSummaryMarkdown('')).not.toThrow();
  });
});

describe('escapeHtml', () => {
  test('escapes < and >', () => {
    const result = escapeHtml('<div>hello</div>');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).not.toContain('<div>');
  });

  test('escapes & ampersand', () => {
    expect(escapeHtml('cats & dogs')).toContain('&amp;');
  });

  test('escapes double quotes', () => {
    expect(escapeHtml('"quoted"')).toContain('&quot;');
  });

  test('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('formatInline', () => {
  test('returns a string', () => {
    expect(typeof formatInline('some text')).toBe('string');
  });

  test('converts **bold** to <strong>', () => {
    expect(formatInline('**bold**')).toContain('<strong>');
  });

  test('does not throw on empty string', () => {
    expect(() => formatInline('')).not.toThrow();
  });
});
