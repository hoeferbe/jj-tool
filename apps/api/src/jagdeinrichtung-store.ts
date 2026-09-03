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

interface JagdeinrichtungData {
   jagdeinrichtungen: Facility[];
}

const emptyData = (): JagdeinrichtungData => ({ jagdeinrichtungen: [] });

export class FacilityStore {
   private data: JagdeinrichtungData = emptyData();
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'jagdeinrichtungen.json');
   }

   async initialize() {
      await mkdir(dirname(this.filePath), { recursive: true });
      try {
         const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<JagdeinrichtungData>;
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

   async getByRevierId(revierId: string) {
      return this.data.jagdeinrichtungen.filter((entry) => entry.revierId === revierId);
   }

   async getById(id: string) {
      return this.data.jagdeinrichtungen.find((entry) => entry.id === id) ?? null;
   }

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

   async delete(id: string) {
      return this.enqueue(async () => {
         const index = this.data.jagdeinrichtungen.findIndex((entry) => entry.id === id);
         if (index < 0) return false;
         this.data.jagdeinrichtungen.splice(index, 1);
         return true;
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