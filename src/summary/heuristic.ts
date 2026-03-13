import * as vscode from 'vscode';
import * as path from 'path';

export function getHeuristicSummary(document: vscode.TextDocument, position: vscode.Position): string {
  const fileName = path.basename(document.fileName);

  // read 20 lines above cursor and 3 below into an array
  const startLine = Math.max(0, position.line - 20);
  const endLine = Math.min(document.lineCount - 1, position.line + 3);
  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    lines.push(document.lineAt(i).text);
  }

  // cursor position inside the lines[] array
  // lines[] has: 20 lines above + cursor line + 3 lines below
  // so cursor is at index: (total length) - 3 below - 1 = lines.length - 4
  const cursorIndex = lines.length - 4;

  // ── NAMED MATCHERS ─────────────────────────────────────────────────────────
  // each one checks ONE line and returns the name it found, or null

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

  function matchMethod(line: string): string | null {
    // \)[^{]*\{ allows TypeScript return types like ): boolean {
    const m = line.trim().match(/^(\w+)\s*\([^)]*\)[^{]*\{/);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(m[1])) {
      return m[1];
    }
    return null;
  }

  function matchFunction(line: string): string | null {
    const m = line.trim().match(/function\s+(\w+)\s*[(<]/);
    return m ? m[1] : null;
  }

  function matchArrow(line: string): string | null {
    const m = line.trim().match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(.*\)\s*=>/);
    return m ? m[1] : null;
  }

  function matchPyFunction(line: string): string | null {
    const m = line.trim().match(/def\s+(\w+)\s*\(/);
    return m ? m[1] : null;
  }

  function matchVariable(line: string): string | null {
    // [^>] at end excludes arrow functions
    const m = line.trim().match(/(?:const|let|var)\s+(\w+)\s*=[^>]/);
    return m ? m[1] : null;
  }

  function matchComment(line: string): string | null {
    const m = line.trim().match(/(?:\/\/|#)\s*(.+)/);
    // skip separator lines like // ══════ or // ------ (no letters/digits)
    if (m && /\w/.test(m[1])) {
      return m[1].substring(0, 40);
    }
    return null;
  }

  // returns true if this line is ANY kind of container declaration
  function isContainerLine(line: string): boolean {
    return matchClass(line) !== null ||
           matchInterface(line) !== null ||
           matchPyClass(line) !== null;
  }

  // ── SCOPE CHECK ────────────────────────────────────────────────────────────
  // count { and } between container declaration and cursor
  // if more } than { → container already closed → cursor is OUTSIDE
  function isCursorInside(containerIndex: number): boolean {
    let opens = 0;
    let closes = 0;
    for (let i = containerIndex + 1; i <= cursorIndex; i++) {
      for (const char of (lines[i] || '')) {
        if (char === '{') { opens++; }
        if (char === '}') { closes++; }
      }
    }
    return closes <= opens; // true = still inside
  }


  // ── STEP 1: find nearest class/interface and check if cursor is inside it ──
  let containerName: string | null = null;
  let containerType: string | null = null;
  let containerIndex: number = -1;

  for (let i = cursorIndex; i >= 0; i--) {
    const line = lines[i];

    const cls = matchClass(line);
    if (cls) {
      if (isCursorInside(i)) {
        containerName = cls;
        containerType = 'class';
        containerIndex = i;
      }
      break;
    }

    const iface = matchInterface(line);
    if (iface) {
      if (isCursorInside(i)) {
        containerName = iface;
        containerType = 'interface';
        containerIndex = i;
      }
      break;
    }

    const pyCls = matchPyClass(line);
    if (pyCls) {
      if (isCursorInside(i)) {
        containerName = pyCls;
        containerType = 'Python class';
        containerIndex = i;
      }
      break;
    }
  }


  // ── STEP 2a: cursor IS inside a container ──────────────────────────────────
  // search ONLY between container declaration and cursor — never above the class
  if (containerName && containerIndex !== -1) {

    // look for method or function inside the class first
    for (let i = cursorIndex; i > containerIndex; i--) {
      const line = lines[i];

      const method = matchMethod(line);
      if (method) {
        return `Where you left off: in ${containerType} \`${containerName}\` — editing method \`${method}()\` in \`${fileName}\` at line ${position.line + 1}`;
      }
      const fn = matchFunction(line);
      if (fn) {
        return `Where you left off: in ${containerType} \`${containerName}\` — editing function \`${fn}()\` in \`${fileName}\` at line ${position.line + 1}`;
      }
      const arrow = matchArrow(line);
      if (arrow) {
        return `Where you left off: in ${containerType} \`${containerName}\` — editing arrow function \`${arrow}()\` in \`${fileName}\` at line ${position.line + 1}`;
      }
    }

    //no method found — look for variable or comment inside the class
    for (let i = cursorIndex; i > containerIndex; i--) {
      const line = lines[i];

      const variable = matchVariable(line);
      if (variable) {
        return `Where you left off: in ${containerType} \`${containerName}\` — near variable \`${variable}\` in \`${fileName}\` at line ${position.line + 1}`;
      }
      const comment = matchComment(line);
      if (comment) {
        return `Where you left off: in ${containerType} \`${containerName}\` — near comment: "${comment}" in \`${fileName}\` at line ${position.line + 1}`;
      }
    }

    //inside container but nothing specific found at all
    return `Where you left off: in ${containerType} \`${containerName}\` in \`${fileName}\` at line ${position.line + 1}`;
  }


  //STEP 2: cursor is NOT inside any container
  // stop searching if we hit a class/interface boundary going upward
  for (let i = cursorIndex; i >= 0; i--) {
    const line = lines[i];

    if (isContainerLine(line)) {
      break;
    }

    const fn = matchFunction(line);
    if (fn) {
      return `Where you left off: Editing function \`${fn}()\` in \`${fileName}\` at line ${position.line + 1}`;
    }
    const arrow = matchArrow(line);
    if (arrow) {
      return `Where you left off: Editing arrow function \`${arrow}()\` in \`${fileName}\` at line ${position.line + 1}`;
    }
    const pyFn = matchPyFunction(line);
    if (pyFn) {
      return `Where you left off: Editing Python function \`${pyFn}()\` in \`${fileName}\` at line ${position.line + 1}`;
    }
  }



  // take 3: lao el hagat el t2ela msh mawgoda look for vars or comments

  for (let i = cursorIndex; i >= 0; i--) {
    const line = lines[i];

    const variable = matchVariable(line);
    if (variable) {
      return `Where you left off: near variable \`${variable}\` in \`${fileName}\` at line ${position.line + 1}`;
    }
    const comment = matchComment(line);
    if (comment) {
      return `Where you left off: near comment: "${comment}" in \`${fileName}\` at line ${position.line + 1}`;
    }
  }


  //THE fallback: if none of patterns match i still have a summary just not as informative
  return `Where you left off: in \`${fileName}\` at line ${position.line + 1}`;
}


//The activation function
export function activateHeuristic(context: vscode.ExtensionContext) {
  console.log('FocusShift: Heuristic summary engine ready');

  //test command
  const testCmd = vscode.commands.registerCommand('focusshift.testHeuristic', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open a file first!');
      return;
    }
    const result = getHeuristicSummary(editor.document, editor.selection.active);
    vscode.window.showInformationMessage(`FocusShift: ${result}`);
    console.log('Heuristic result:', result);
  });

  context.subscriptions.push(testCmd);
}

// for test purposes: added:
// {
//   "command": "focusshift.testHeuristic",
//   "title": "FocusShift: Test Heuristic Summary"
// } in package.json