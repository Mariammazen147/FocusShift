function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInline(line: string): string {
  return escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Renders FocusShift's summary markdown (**bold** headlines, "- "/"• " bullet
 * lists, blank-line-separated paragraphs) into safe HTML for a webview.
 */
export function renderSummaryHtml(text: string): string {
  const html: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) { html.push('</ul>'); inList = false; }
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }

    const bullet = line.match(/^[-•]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${formatInline(bullet[1])}</li>`);
    } else {
      closeList();
      html.push(`<p>${formatInline(line)}</p>`);
    }
  }
  closeList();
  return html.join('');
}

/** Collapses summary markdown down to a single-line plain-text preview. */
export function stripSummaryMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}