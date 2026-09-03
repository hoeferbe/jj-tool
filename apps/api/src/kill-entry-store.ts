import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface KillEntry {
   id: string;
   revierId: string;
   datum: string;
   wildart: string;
   notiz?: string;
   createdBy: string;
   createdAt: string;
   updatedAt: string;
}

export interface CreateKillEntryInput {
   revierId: string;
   datum: string;
   wildart: string;
   notiz?: string;
   createdBy: string;
}

interface KillEntryData {
   streckeneintraege: KillEntry[];
}

const emptyData = (): KillEntryData => ({ streckeneintraege: [] });

export class KillEntryStore {
   private data: KillEntryData = emptyData();
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'streckeneintraege.json');
   }

   async initialize() {
      await mkdir(dirname(this.filePath), { recursive: true });
      try {
         const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<KillEntryData>;
         this.data = {
            streckeneintraege: Array.isArray(stored.streckeneintraege)
               ? stored.streckeneintraege
               : [],
         };
      } catch (error: unknown) {
         if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
         await this.persist();
      }
   }

   async getByHuntingDistrictId(revierId: string) {
      return this.data.streckeneintraege
         .filter((entry) => entry.revierId === revierId)
         .sort((first, second) => second.datum.localeCompare(first.datum) || second.createdAt.localeCompare(first.createdAt));
   }

   async create(input: CreateKillEntryInput) {
      return this.enqueue(async () => {
         const now = new Date().toISOString();
         const entry: KillEntry = {
            id: randomUUID(),
            ...input,
            createdAt: now,
            updatedAt: now,
         };
         this.data.streckeneintraege.push(entry);
         return entry;
      });
   }

   private async enqueue<T>(operation: () => Promise<T>) {
      let result: T;
      const operationPromise = this.writeQueue.then(async () => {
         result = await operation();
         await this.persist();
      });
      this.writeQueue = operationPromise.catch(() => undefined);
      await operationPromise;
      return result!;
   }

   private async persist() {
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
   }
}
