import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface KillEntryPosition {
   lat: number;
   lng: number;
}

export type KillEntryGender = 'maennlich' | 'weiblich' | 'unbekannt';
export type KillEntryUtilization = 'eigenverwertung' | 'verkauf_gemeinde' | 'verkauf_ausserhalb_gemeinde' | 'jagdgemeinschaft_verkauf' | 'keine_verwertung';
export type KillEntryFeeExemption = 'verkehrsopfer' | 'hegeabschuss';

export interface KillEntry {
   id: string;
   revierId: string;
   datum: string;
   uhrzeit?: string;
   wildart: string;
   unterart?: string;
   geschlecht?: KillEntryGender;
   verwertung?: KillEntryUtilization;
   kostenfreiArt?: KillEntryFeeExemption;
   istVerkehrsopfer?: boolean;
   bescheinigung?: boolean;
   ortName?: string;
   position?: KillEntryPosition;
   gewicht?: number;
   geschaetztesAlter?: string;
   notiz?: string;
   createdBy: string;
   createdAt: string;
   updatedAt: string;
}

export interface CreateKillEntryInput {
   revierId: string;
   datum: string;
   uhrzeit?: string;
   wildart: string;
   unterart?: string;
   geschlecht?: KillEntryGender;
   verwertung: KillEntryUtilization;
   kostenfreiArt?: KillEntryFeeExemption;
   istVerkehrsopfer?: boolean;
   bescheinigung?: boolean;
   ortName?: string;
   position?: KillEntryPosition;
   gewicht?: number;
   geschaetztesAlter?: string;
   notiz?: string;
   createdBy: string;
}

export type UpdateKillEntryInput = Partial<Omit<CreateKillEntryInput, 'revierId' | 'createdBy'>>;

interface KillEntryData {
   streckeneintraege: KillEntry[];
}

const emptyData = (): KillEntryData => ({ streckeneintraege: [] });

/**
 * In-memory store for Streckeneinträge (kill entries) backed by a single JSON file.
 * All writes go through a serial queue so concurrent requests never corrupt the file.
 */
export class KillEntryStore {
   private data: KillEntryData = emptyData();
   /** Serialises all write operations to prevent race conditions. */
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'streckeneintraege.json');
   }

   /**
    * Loads streckeneintraege.json from disk into memory.
    * Creates the file if it does not exist yet.
    */
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

   /** Returns all kill entries of one hunting district, sorted by date/time/creation descending. */
   async getByHuntingDistrictId(revierId: string) {
      return this.data.streckeneintraege
         .filter((entry) => entry.revierId === revierId)
         .sort((first, second) => second.datum.localeCompare(first.datum) || (second.uhrzeit ?? '').localeCompare(first.uhrzeit ?? '') || second.createdAt.localeCompare(first.createdAt));
   }

   /** Finds a kill entry by id, scoped to one hunting district. Returns `null` if not found. */
   async getById(id: string, revierId: string) {
      return this.data.streckeneintraege.find((entry) => entry.id === id && entry.revierId === revierId) ?? null;
   }

   /** Creates a new kill entry with a fresh UUID and timestamps. */
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

   /** Applies a partial update to a kill entry, scoped to one hunting district. Returns `null` if not found. */
   async update(id: string, revierId: string, input: UpdateKillEntryInput) {
      return this.enqueue(async () => {
         const index = this.data.streckeneintraege.findIndex((entry) => entry.id === id && entry.revierId === revierId);
         if (index === -1) return null;
         const existing = this.data.streckeneintraege[index]!;
         const updated: KillEntry = {
            ...existing,
            ...input,
            updatedAt: new Date().toISOString(),
         };
         this.data.streckeneintraege[index] = updated;
         return updated;
      });
   }

   /** Deletes one kill entry by id, scoped to one hunting district. Returns whether a matching entry was found. */
   async delete(id: string, revierId: string) {
      return this.enqueue(async () => {
         const index = this.data.streckeneintraege.findIndex((entry) => entry.id === id && entry.revierId === revierId);
         if (index === -1) return false;
         this.data.streckeneintraege.splice(index, 1);
         return true;
      });
   }

   /** Deletes all kill entries of one hunting district (e.g. when the district itself is deleted). Returns the number removed. */
   async deleteByHuntingDistrictId(revierId: string) {
      return this.enqueue(async () => {
         const initialLength = this.data.streckeneintraege.length;
         this.data.streckeneintraege = this.data.streckeneintraege.filter((entry) => entry.revierId !== revierId);
         return initialLength - this.data.streckeneintraege.length;
      });
   }

   /**
    * Serialises all write operations so they execute one at a time.
    * Each operation modifies in-memory state and then flushes it to disk.
    */
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

   /**
    * Atomically writes streckeneintraege.json by first writing to a temp file then renaming it.
    * This prevents corrupt files if the process is killed mid-write.
    */
   private async persist() {
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
   }
}
