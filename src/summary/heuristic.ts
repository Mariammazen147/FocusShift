import * as vscode from 'vscode';
import * as path from 'path';

const SKIP_VARS = new Set([
  'i', 'j', 'k', 'x', 'y', 'z', 'm', 'n', 'e', 'r', 't',
  'err', 'res', 'req', 'ctx', 'msg', 'tmp', 'val', 'key',
  'data', 'item', 'line', 'text', 'node', 'root', 'temp',
  'result', 'match', 'value', 'error', 'index', 'count',
  'method', 'fn', 'cb', 'resolve', 'reject', 'response'
]);

//editCount and scrollCount come from EditorContext tracked in stateManager
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

//language routing
  const langId = document.languageId;
  if (langId === 'yaml' || langId === 'dockercompose') { return matchYaml(document, position, verb); }
  if (langId === 'dockerfile')                          { return matchDockerfile(document, position, verb); }
  if (langId === 'groovy')                              { return matchJenkinsfile(document, position, verb); }
  if (langId === 'toml')                                { return matchToml(document, position, verb); }
  if (langId === 'json' || langId === 'jsonc')          { return matchJson(document, position, verb); }
  if (langId === 'makefile')                            { return matchMakefile(document, position, verb); }

  //position line returns ex iu am on line 50, 50-20=30 ->therefore we start reading from line 30 
  const startLine = Math.max(0, position.line - 20);
  const endLine   = Math.min(document.lineCount - 1, position.line + 3);
  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    lines.push(document.lineAt(i).text);
  }

  //how far cursor is from lines[start]
  const cursorIndex = position.line - startLine;



  //matchers
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

  //matches variable name and skips the => in arrow function so it would only cmtch to var name not match an arrow function (edge case)
 
  function matchVariable(line: string): string | null {
    const m = line.trim().match(/(?:const|let|var)\s+(\w+)\s*=[^>]/);
    if (m && !SKIP_VARS.has(m[1]) && m[1].length > 2) { return m[1]; } //not in the block of useless var names,  name is longer than 2 chars so no fn
    return null;
  }

  function isContainerLine(line: string): boolean {
    return matchClass(line) !== null ||
           matchInterface(line) !== null ||
           matchPyClass(line) !== null ||
           matchEnum(line) !== null;
  }


  //depth tracking
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

  function isCursorInsidePython(containerIndex: number): boolean {
    const containerIndent = (lines[containerIndex].match(/^(\s*)/) || ['', ''])[1].length;
    for (let i = containerIndex + 1; i <= cursorIndex; i++) {
      const line = lines[i];
      if (line.trim() === '') { continue; } // blank lines don't count
      const lineIndent = (line.match(/^(\s*)/) || ['', ''])[1].length;
      if (lineIndent <= containerIndent) { return false; } // dedented back out — left the class
    }
    return true;
  }


  //find nearest class/interface above cursor
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

  
//if cursor is inside a conatiner
  if (containerName && containerIndex !== -1) {

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
    
    //var fallback
    for (let i = cursorIndex; i > containerIndex; i--) {
      const variable = matchVariable(lines[i]);
      if (variable) {
        return `You were ${verb} ${containerType} \`${containerName}\` near \`${variable}\` — \`${fileName}\` line ${position.line + 1}`;
      }
    }
    
    //scope fallback
    return `You were ${verb} ${containerType} \`${containerName}\` — \`${fileName}\` line ${position.line + 1}`;
  }


  //if cursor wasnt inside any container
  for (let i = cursorIndex; i >= 0; i--) {
    const line = lines[i]; 
    if (isContainerLine(line)) { break; }

    const decorator = matchDecorator(line);
    if (decorator) {
      return `You were ${verb} near \`@${decorator}\` — \`${fileName}\` line ${position.line + 1}`;
    }

    //check standalone functions
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
  
  //variables fallback
  for (let i = cursorIndex; i >= 0; i--) {
    const variable = matchVariable(lines[i]);
    if (variable) {
      return `You were ${verb} \`${fileName}\` near \`${variable}\` — line ${position.line + 1}`;
    }
  }

//absolute fallback
  return `You were ${verb} \`${fileName}\` — line ${position.line + 1}`;
}


//configs matchers

function matchYaml(doc: vscode.TextDocument, pos: vscode.Position, verb: string): string {
  const fileName  = path.basename(doc.fileName);
  let bestKey: string | null = null; 
  let bestIndent  = Infinity;
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




export function activateHeuristic(context: vscode.ExtensionContext) {
  console.log('FocusShift: Heuristic summary engine ready');

  const testCmd = vscode.commands.registerCommand('focusshift.testHeuristic', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open a file first!');
      return;
    }

    const result = getHeuristicSummary(editor.document, editor.selection.active, 0, 0);
    vscode.window.showInformationMessage(`FocusShift: ${result}`);
    console.log('Heuristic result:', result);
  });

  context.subscriptions.push(testCmd);
}