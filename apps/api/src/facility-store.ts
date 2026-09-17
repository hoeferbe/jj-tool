import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const FACILITY_TYPES = [
   'Kanzel',
   'Bock',
   'Leiter',
   'Roehrenfalle',
   'Kirrung',
] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const FACILITY_STATUSES = ['aktiv', 'defekt', 'ausser Betrieb'] as const;
export type FacilityStatus = (typeof FACILITY_STATUSES)[number];

export interface FacilityCoordinates {
   lat: number;
   lng: number;
}

export interface Facility {
   id: string;
   revierId: string;
   name: string;
   typ: FacilityType;
   position: FacilityCoordinates;
   status: FacilityStatus;
   zustandsInfo?: string;
   notiz?: string;
   createdBy: string;
   createdAt: string;
   updatedAt: string;
}

export interface UpsertFacilityInput {
   revierId: string;
   name: string;
   typ: FacilityType;
   position: FacilityCoordinates;
   status: FacilityStatus;
   zustandsInfo?: string;
   notiz?: string;
   createdBy: string;
}

interface FacilityData {
   jagdeinrichtungen: Facility[];
}

const emptyData = (): FacilityData => ({ jagdeinrichtungen: [] });

/**
 * In-memory store for all Jagdeinrichtungen (hunting facilities) backed by a single JSON file.
 * All writes go through a serial queue so concurrent requests never corrupt the file.
 */
export class FacilityStore {
   private data: FacilityData = emptyData();
   /** Serialises all write operations to prevent race conditions. */
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'jagdeinrichtungen.json');
   }

   /**
    * Loads jagdeinrichtungen.json from disk into memory.
    * Creates the file if it does not exist yet.
    */
   async initialize() {
      await mkdir(dirname(this.filePath), { recursive: true });
      try {
         const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<FacilityData>;
         this.data = {
            jagdeinrichtungen: Array.isArray(stored.jagdeinrichtungen)
               ? stored.jagdeinrichtungen
               : [],
         };
      } catch (error: unknown) {
         if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
         await this.persist();
      }
   }

   /** Returns all facilities belonging to one hunting district. */
   async getByHuntingDistrictId(revierId: string) {
      return this.data.jagdeinrichtungen.filter((entry) => entry.revierId === revierId);
   }

   /** Finds a facility by its UUID, or `null` if it does not exist. */
   async getById(id: string) {
      return this.data.jagdeinrichtungen.find((entry) => entry.id === id) ?? null;
   }

   /** Creates a new facility with a fresh UUID and timestamps. */
   async create(input: UpsertFacilityInput) {
      return this.enqueue(async () => {
         const now = new Date().toISOString();
         const entry: Facility = {
            id: randomUUID(),
            ...input,
            createdAt: now,
            updatedAt: now,
         };
         this.data.jagdeinrichtungen.push(entry);
         return entry;
      });
   }

   /** Replaces an existing facility's editable fields, keeping its id and createdAt. Returns `null` if not found. */
   async update(id: string, input: UpsertFacilityInput) {
      return this.enqueue(async () => {
         const index = this.data.jagdeinrichtungen.findIndex((entry) => entry.id === id);
         if (index < 0) return null;
         const existing = this.data.jagdeinrichtungen[index]!;
         const updated: Facility = {
            ...existing,
            ...input,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
         };
         this.data.jagdeinrichtungen[index] = updated;
         return updated;
      });
   }

   /** Deletes one facility by id. Returns whether a matching entry was found. */
   async delete(id: string) {
      return this.enqueue(async () => {
         const index = this.data.jagdeinrichtungen.findIndex((entry) => entry.id === id);
         if (index < 0) return false;
         this.data.jagdeinrichtungen.splice(index, 1);
         return true;
      });
   }

   /** Deletes all facilities of one hunting district (e.g. when the district itself is deleted). Returns the number removed. */
   async deleteByHuntingDistrictId(revierId: string) {
      return this.enqueue(async () => {
         const initialLength = this.data.jagdeinrichtungen.length;
         this.data.jagdeinrichtungen = this.data.jagdeinrichtungen.filter((entry) => entry.revierId !== revierId);
         return initialLength - this.data.jagdeinrichtungen.length;
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
    * Atomically writes jagdeinrichtungen.json by first writing to a temp file then renaming it.
    * This prevents corrupt files if the process is killed mid-write.
    */
   private async persist() {
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
   }
}