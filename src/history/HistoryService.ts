import * as vscode from 'vscode';
import { HistoryEntry } from './HistoryEntry';

const HISTORY_KEY = 'focusshift.history';
const MAX_ENTRIES = 50;

export class HistoryService {
  private storage: vscode.Memento;

  constructor(storage: vscode.Memento) {
    this.storage = storage;
  }

  /** Get all history entries, newest first */
  getAll(): HistoryEntry[] {
    const raw = this.storage.get<string>(HISTORY_KEY);
    if (!raw) { return []; }
    try {
      return JSON.parse(raw) as HistoryEntry[];
    } catch (err) {
      console.error('FocusShift: Failed to parse history:', err);
      return [];
    }
  }

  /** Append a new entry, trim to MAX_ENTRIES */
  add(entry: HistoryEntry): void {
    const history = this.getAll();
    history.unshift(entry); // newest first
    const trimmed = history.slice(0, MAX_ENTRIES);
    this.storage.update(HISTORY_KEY, JSON.stringify(trimmed));
  }

  /** Delete a single entry by ID */
  delete(entryId: string): void {
    const updated = this.getAll().filter(e => e.id !== entryId);
    this.storage.update(HISTORY_KEY, JSON.stringify(updated));
  }

  /** Delete all entries */
  clearAll(): void {
    this.storage.update(HISTORY_KEY, JSON.stringify([]));
  }
}
