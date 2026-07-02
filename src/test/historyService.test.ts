import { HistoryService } from '../history/HistoryService';
import { HistoryEntry } from '../history/HistoryEntry';

const store: Record<string, any> = {};
const mockMemento = {
  get: (key: string, defaultVal?: any) => store[key] ?? defaultVal,
  update: async (key: string, value: any) => { store[key] = value; },
  keys: () => Object.keys(store),
};

const mockEntry = (): HistoryEntry => ({
  id: Date.now().toString() + Math.random(),
  timestamp: Date.now(),
  fileUri: 'file:///test/main.ts',
  fileName: 'main.ts',
  line: 10,
  heuristicSummary: 'You were editing main.ts',
  snapshot: {} as any,
});

describe('HistoryService', () => {
  let service: HistoryService;

  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
    service = new HistoryService(mockMemento as any);
  });

  test('getAll() returns empty array when no history', () => {
    expect(service.getAll()).toEqual([]);
  });

  test('add() stores an entry and getAll() retrieves it', () => {
    const entry = mockEntry();
    service.add(entry);
    const all = service.getAll();
    expect(all.length).toBe(1);
    expect(all[0].fileName).toBe('main.ts');
  });

  test('add() stores newest entry first', () => {
    const entry1 = { ...mockEntry(), fileName: 'first.ts' };
    const entry2 = { ...mockEntry(), fileName: 'second.ts' };
    service.add(entry1);
    service.add(entry2);
    expect(service.getAll()[0].fileName).toBe('second.ts');
  });

  test('add() caps history at 50 entries', () => {
    for (let i = 0; i < 55; i++) {
      service.add(mockEntry());
    }
    expect(service.getAll().length).toBe(50);
  });

  test('delete() removes the correct entry by id', () => {
    const entry = mockEntry();
    service.add(entry);
    service.delete(entry.id);
    expect(service.getAll().length).toBe(0);
  });

  test('delete() does nothing if id does not exist', () => {
    service.add(mockEntry());
    service.delete('nonexistent-id');
    expect(service.getAll().length).toBe(1);
  });

  test('clearAll() removes all entries', () => {
    service.add(mockEntry());
    service.add(mockEntry());
    service.clearAll();
    expect(service.getAll()).toEqual([]);
  });
});
