import * as vscode from 'vscode';
import * as path from 'path';

// Generic names that don't tell you anything useful when reported back to
// the user (e.g. "you were near `i`" is meaningless) — so we skip them
// when looking for a variable to describe.
const SKIP_VARS = new Set([
  'i', 'j', 'k', 'x', 'y', 'z', 'm', 'n', 'e', 'r', 't',
  'err', 'res', 'req', 'ctx', 'msg', 'tmp', 'val', 'key',
  'data', 'item', 'line', 'text', 'node', 'root', 'temp',
  'result', 'match', 'value', 'error', 'index', 'count',
  'method', 'fn', 'cb', 'resolve', 'reject', 'response'
]);

// editCount / scrollCount come from the EditorContext tracked in stateManager.ts
function pickVerb(editCount: number, scrollCount: number): string {
  if (scrollCount > editCount * 2 && scrollCount > 3) { return 'reading through'; }
  if (editCount > 5) { return 'writing in'; }
  return 'working in';
}

export function getHeuristicSummary(
  document: vscode.TextDocument,
  position: vscode.Position,
  editCount: number   = 0,
  scrollCount: number = 0
): string {
  const fileName = path.basename(document.fileName);
  const verb = pickVerb(editCount, scrollCount);

  // Config/markup files don't have functions or classes, so they get their
  // own matchers instead of falling through the class/function logic below.
  const langId = document.languageId;
  if (langId === 'yaml' || langId === 'dockercompose') { return matchYaml(document, position, verb); }
  if (langId === 'dockerfile')                          { return matchDockerfile(document, position, verb); }
  if (langId === 'groovy')                              { return matchJenkinsfile(document, position, verb); }
  if (langId === 'toml')                                { return matchToml(document, position, verb); }
  if (langId === 'json' || langId === 'jsonc')          { return matchJson(document, position, verb); }
  if (langId === 'makefile')                            { return matchMakefile(document, position, verb); }

  // Grab a window of lines around the cursor (20 lines back, 3 lines ahead)
  // to scan for the nearest class/function/variable.
  const startLine = Math.max(0, position.line - 20);
  const endLine   = Math.min(document.lineCount - 1, position.line + 3);
  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    lines.push(document.lineAt(i).text);
  }

  // Cursor's row within the `lines` window above.
  const cursorIndex = position.line - startLine;

  // --- regex matchers for the constructs we care about ---

  function matchClass(line: string): string | null {
    const m = line.trim().match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
    return m ? m[1] : null;
  }

  function matchInterface(line: string): string | null {
    const m = line.trim().match(/^(?:export\s+)?interface\s+(\w+)/);
    return m ? m[1] : null;
  }

  function matchPyClass(line: string): string | null {
    const m = line.trim().match(/^class\s+(\w+)\s*[:(]/);
    return m ? m[1] : null;
  }

  function matchEnum(line: string): string | null {
    const m = line.trim().match(/^(?:export\s+)?enum\s+(\w+)/);
    return m ? m[1] : null;
  }

  function matchDecorator(line: string): string | null {
    const m = line.trim().match(/^@(\w+)/);
    return m ? m[1] : null;
  }

  function matchMethod(line: string): string | null {
    const cleaned = line
      .replace(/\b(public|private|protected|static|async|abstract|override|readonly)\b/g, '')
      .trim();
    const m = cleaned.match(/^(\w+)\s*\([^)]*\)[^{]*\{?/);
    if (m && !['if', 'for', 'while', 'switch', 'catch'].includes(m[1])) {
      return m[1];
    }
    return null;
  }

  function matchFunction(line: string): string | null {
    const m = line.trim().match(/function\s+(\w+)\s*[(<]/);
    return m ? m[1] : null;
  }

  function matchArrow(line: string): string | null {
    const m = line.trim().match(/^(?:(?:const|let|var)\s+)?(\w+)\s*=\s*(?:async\s+)?\(.*\)\s*=>/);
    return m ? m[1] : null;
  }

  function matchPyFunction(line: string): string | null {
    const m = line.trim().match(/def\s+(\w+)\s*\(/);
    return m ? m[1] : null;
  }

  // Matches a variable declaration. The `[^>]` after `=` stops this from
  // also matching arrow functions (`const x = () =>`), which are handled
  // by matchArrow instead.
  function matchVariable(line: string): string | null {
    const m = line.trim().match(/(?:const|let|var)\s+(\w+)\s*=[^>]/);
    if (m && !SKIP_VARS.has(m[1]) && m[1].length > 2) { return m[1]; }
    return null;
  }

  function isContainerLine(line: string): boolean {
    return matchClass(line) !== null ||
           matchInterface(line) !== null ||
           matchPyClass(line) !== null ||
           matchEnum(line) !== null;
  }

  // Walks forward from a candidate container line, counting braces, to
  // confirm the cursor is actually still inside that class/interface/enum
  // body and not just below it in the file.
  function isCursorInside(containerIndex: number): boolean {
    let depth = 0;
    let foundOpen = false;
    for (let i = containerIndex; i <= cursorIndex; i++) {
      for (const char of (lines[i] || '')) {
        if (char === '{') { depth++; foundOpen = true; }
        if (char === '}') {
          depth--;
          if (foundOpen && depth === 0 && i < cursorIndex) { return false; }
        }
      }
    }
    return foundOpen && depth > 0;
  }

  // Python has no braces, so containment is based on indentation instead:
  // as long as every line down to the cursor is indented deeper than the
  // `class` line, the cursor is still inside it.
  function isCursorInsidePython(containerIndex: number): boolean {
    const containerIndent = (lines[containerIndex].match(/^(\s*)/) || ['', ''])[1].length;
    for (let i = containerIndex + 1; i <= cursorIndex; i++) {
      const line = lines[i];
      if (line.trim() === '') { continue; }
      const lineIndent = (line.match(/^(\s*)/) || ['', ''])[1].length;
      if (lineIndent <= containerIndent) { return false; }
    }
    return true;
  }

  // Look upward from the cursor for the nearest enclosing class/interface/enum.
  let containerName: string | null = null;
  let containerType: string | null = null;
  let containerIndex: number = -1;

  for (let i = cursorIndex; i >= 0; i--) {
    const line  = lines[i];
    const cls   = matchClass(line);
    if (cls)   { if (isCursorInside(i)) { containerName = cls;   containerType = 'class';        containerIndex = i; } break; }
    const iface = matchInterface(line);
    if (iface) { if (isCursorInside(i)) { containerName = iface; containerType = 'interface';    containerIndex = i; } break; }
    const pyCls = matchPyClass(line);
    if (pyCls) { if (isCursorInsidePython(i)) { containerName = pyCls; containerType = 'Python class'; containerIndex = i; } break; }
    const en = matchEnum(line);
    if (en) { if (isCursorInside(i)) { containerName = en; containerType = 'enum'; containerIndex = i; } break; }
  }

  if (containerName && containerIndex !== -1) {
    // Cursor is inside a class/interface/enum — look for the nearest
    // method/function/decorator between the container and the cursor.
    for (let i = cursorIndex; i > containerIndex; i--) {
      const line = lines[i];

      const decorator = matchDecorator(line);
      if (decorator) {
        return `You were ${verb} near \`@${decorator}\` in ${containerType} \`${containerName}\` — \`${fileName}\` line ${position.line + 1}`;
      }

      const method = matchMethod(line);
      if (method) {
        return `You were ${verb} \`${method}()\` in ${containerType} \`${containerName}\` — \`${fileName}\` line ${position.line + 1}`;
      }
      const fn = matchFunction(line);
      if (fn) {
        return `You were ${verb} \`${fn}()\` in ${containerType} \`${containerName}\` — \`${fileName}\` line ${position.line + 1}`;
      }
      const arrow = matchArrow(line);
      if (arrow) {
        return `You were ${verb} \`${arrow}()\` in ${containerType} \`${containerName}\` — \`${fileName}\` line ${position.line + 1}`;
      }
      const pyFn = matchPyFunction(line);
      if (pyFn) {
        return `You were ${verb} \`${pyFn}()\` in ${containerType} \`${containerName}\` — \`${fileName}\` line ${position.line + 1}`;
      }
    }

    // No method/function nearby — fall back to the nearest variable.
    for (let i = cursorIndex; i > containerIndex; i--) {
      const variable = matchVariable(lines[i]);
      if (variable) {
        return `You were ${verb} ${containerType} \`${containerName}\` near \`${variable}\` — \`${fileName}\` line ${position.line + 1}`;
      }
    }

    // Nothing more specific found — just report the container itself.
    return `You were ${verb} ${containerType} \`${containerName}\` — \`${fileName}\` line ${position.line + 1}`;
  }

  // Cursor isn't inside any class/interface/enum — look for a standalone
  // function/method/decorator instead.
  for (let i = cursorIndex; i >= 0; i--) {
    const line = lines[i];
    if (isContainerLine(line)) { break; }

    const decorator = matchDecorator(line);
    if (decorator) {
      return `You were ${verb} near \`@${decorator}\` — \`${fileName}\` line ${position.line + 1}`;
    }

    const method = matchMethod(line);
    if (method) {
      return `You were ${verb} \`${method}()\` — \`${fileName}\` line ${position.line + 1}`;
    }
    const fn = matchFunction(line);
    if (fn) {
      return `You were ${verb} \`${fn}()\` — \`${fileName}\` line ${position.line + 1}`;
    }
    const arrow = matchArrow(line);
    if (arrow) {
      return `You were ${verb} \`${arrow}()\` — \`${fileName}\` line ${position.line + 1}`;
    }
    const pyFn = matchPyFunction(line);
    if (pyFn) {
      return `You were ${verb} \`${pyFn}()\` — \`${fileName}\` line ${position.line + 1}`;
    }
  }

  // Still nothing — fall back to the nearest variable declaration.
  for (let i = cursorIndex; i >= 0; i--) {
    const variable = matchVariable(lines[i]);
    if (variable) {
      return `You were ${verb} \`${fileName}\` near \`${variable}\` — line ${position.line + 1}`;
    }
  }

  // Absolute fallback — just the file and line number.
  return `You were ${verb} \`${fileName}\` — line ${position.line + 1}`;
}

// --- matchers for non-code file formats (YAML, Dockerfile, TOML, JSON, Makefile, Jenkinsfile) ---

function matchYaml(doc: vscode.TextDocument, pos: vscode.Position, verb: string): string {
  const fileName  = path.basename(doc.fileName);
  let bestKey: string | null = null;
  let bestIndent  = Infinity;
  // Walk upward tracking the shallowest-indented key seen — that's the
  // top-level YAML block the cursor is nested under.
  for (let i = pos.line; i >= 0; i--) {
    const line = doc.lineAt(i).text;
    const m    = line.match(/^(\s*)([\w-]+)\s*:/);
    if (m) {
      const indent = m[1].length;
      if (indent < bestIndent) { bestIndent = indent; bestKey = m[2]; }
      if (indent === 0) { break; }
    }
  }
  return bestKey
    ? `You were ${verb} YAML block \`${bestKey}\` — \`${fileName}\` line ${pos.line + 1}`
    : `You were ${verb} \`${fileName}\` — line ${pos.line + 1}`;
}

function matchDockerfile(doc: vscode.TextDocument, pos: vscode.Position, verb: string): string {
  const fileName = path.basename(doc.fileName);
  for (let i = pos.line; i >= 0; i--) {
    const line = doc.lineAt(i).text.trim();
    const m    = line.match(/^(FROM|RUN|COPY|ADD|CMD|ENTRYPOINT|ENV|EXPOSE|WORKDIR|ARG)\b/);
    if (m) {
      return `You were ${verb} \`${fileName}\` near \`${m[1]}\` instruction — line ${pos.line + 1}`;
    }
  }
  return `You were ${verb} \`${fileName}\` — line ${pos.line + 1}`;
}

function matchJenkinsfile(doc: vscode.TextDocument, pos: vscode.Position, verb: string): string {
  const fileName = path.basename(doc.fileName);
  for (let i = pos.line; i >= 0; i--) {
    const line = doc.lineAt(i).text;
    const m    = line.match(/stage\s*\(\s*['"](.+?)['"]/);
    if (m) {
      return `You were ${verb} Jenkins stage \`${m[1]}\` — \`${fileName}\` line ${pos.line + 1}`;
    }
  }
  return `You were ${verb} \`${fileName}\` — line ${pos.line + 1}`;
}

function matchToml(doc: vscode.TextDocument, pos: vscode.Position, verb: string): string {
  const fileName = path.basename(doc.fileName);
  for (let i = pos.line; i >= 0; i--) {
    const line = doc.lineAt(i).text.trim();
    const m    = line.match(/^\[(.+?)\]/);
    if (m) {
      return `You were ${verb} TOML section \`[${m[1]}]\` — \`${fileName}\` line ${pos.line + 1}`;
    }
  }
  return `You were ${verb} \`${fileName}\` — line ${pos.line + 1}`;
}

function matchJson(doc: vscode.TextDocument, pos: vscode.Position, verb: string): string {
  const fileName = path.basename(doc.fileName);
  for (let i = pos.line; i >= 0; i--) {
    const line = doc.lineAt(i).text.trim();
    const m    = line.match(/^"([\w-]+)"\s*:/);
    if (m) {
      return `You were ${verb} \`${fileName}\` near key \`${m[1]}\` — line ${pos.line + 1}`;
    }
  }
  return `You were ${verb} \`${fileName}\` — line ${pos.line + 1}`;
}

function matchMakefile(doc: vscode.TextDocument, pos: vscode.Position, verb: string): string {
  const fileName = path.basename(doc.fileName);
  for (let i = pos.line; i >= 0; i--) {
    const line = doc.lineAt(i).text;
    const m    = line.match(/^([\w-]+)\s*:/);
    if (m && !m[1].startsWith('.')) {
      return `You were ${verb} Makefile target \`${m[1]}\` — \`${fileName}\` line ${pos.line + 1}`;
    }
  }
  return `You were ${verb} \`${fileName}\` — line ${pos.line + 1}`;
}

/** Registers the "FocusShift: Test Heuristic" debug command. */
export function activateHeuristic(context: vscode.ExtensionContext) {
  const testCmd = vscode.commands.registerCommand('focusshift.testHeuristic', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open a file first!');
      return;
    }

    const result = getHeuristicSummary(editor.document, editor.selection.active, 0, 0);
    vscode.window.showInformationMessage(`FocusShift: ${result}`);
  });

  context.subscriptions.push(testCmd);
}
