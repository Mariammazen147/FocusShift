// TEMP TEST — remove before commit
// const FORCE_OLLAMA_STATE: OllamaStatus | null = { installed: false, modelReady: false };

import { execSync } from 'child_process';

// The exact model FocusShift depends on for AI summaries.
const MODEL_NAME = 'qwen2.5-coder:1.5b-instruct';

/** Is the `ollama` CLI installed and on PATH at all? */
export function isOllamaInstalled(): boolean {
  try {
    execSync('ollama --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Is Ollama installed AND has it already pulled our specific model? */
export function isModelInstalled(): boolean {
  try {
    const output = execSync('ollama list', { encoding: 'utf8' });
    return output.includes(MODEL_NAME);
  } catch {
    return false;
  }
}

export interface OllamaStatus {
  installed: boolean;
  modelReady: boolean;
}

let cachedStatus: OllamaStatus | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Single entry point the UI (sidebar + popup) calls to decide whether to
 * show "Setup Ollama" as clickable or as a greyed-out "already ready" state.
 *
 * Cached for 30s — this used to run 2 blocking `execSync` calls on every
 * popup render (up to 4 times per popup appearance), which was the real
 * cause of the popup feeling slow to show up. Pass `forceRefresh: true`
 * only when the user explicitly asks to recheck (e.g. the sidebar's
 * refresh button).
 */


export function getOllamaStatus(forceRefresh = false): OllamaStatus {
  // if (FORCE_OLLAMA_STATE) { return FORCE_OLLAMA_STATE; }
  const now = Date.now();
  if (!forceRefresh && cachedStatus && now - cachedAt < CACHE_TTL_MS) {
    return cachedStatus;
  }
  const installed = isOllamaInstalled();
  const modelReady = installed ? isModelInstalled() : false;
  // const installed = false;
  // const modelReady = false;
  cachedStatus = { installed, modelReady };
  cachedAt = now;
  return cachedStatus;
}