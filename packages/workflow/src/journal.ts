import type { StepJournalEntry } from "./types";
import { generateStepKey } from "./utils";

interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: any): Promise<void>;
}

export function createJournal(storage: StorageLike) {
  return {
    async writeEntry(index: number, entry: StepJournalEntry): Promise<void> {
      await storage.put(generateStepKey(index), entry);
    },

    async readEntry(index: number): Promise<StepJournalEntry | undefined> {
      return storage.get<StepJournalEntry>(generateStepKey(index));
    },

    async readAll(): Promise<StepJournalEntry[]> {
      const count = await this.getStepCount();
      const entries: StepJournalEntry[] = [];
      for (let i = 0; i < count; i++) {
        const entry = await this.readEntry(i);
        if (entry) entries.push(entry);
      }
      return entries;
    },

    async getStepCount(): Promise<number> {
      return (await storage.get<number>("wf:step:count")) ?? 0;
    },

    async setStepCount(n: number): Promise<void> {
      await storage.put("wf:step:count", n);
    },

    async writeMeta(meta: any): Promise<void> {
      await storage.put("wf:meta", meta);
    },

    async readMeta(): Promise<any | undefined> {
      return storage.get("wf:meta");
    },

    async writeInput(input: unknown): Promise<void> {
      await storage.put("wf:input", input);
    },

    async readInput(): Promise<unknown | undefined> {
      return storage.get("wf:input");
    },
  };
}
