import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const AUFGABE_STATUS = ['offen', 'in Bearbeitung', 'erledigt'] as const;
export type AufgabeStatus = (typeof AUFGABE_STATUS)[number];

export interface JagdeinrichtungAufgabe {
   id: string;
   revierId: string;
   jagdeinrichtungId: string;
   titel: string;
   beschreibung?: string;
   status: AufgabeStatus;
   assignedTo?: string;
   assignedBy: string;
   createdAt: string;
   updatedAt: string;
   completedAt?: string;
}

export interface CreateAufgabeInput {
   revierId: string;
   jagdeinrichtungId: string;
   titel: string;
   beschreibung?: string;
   status: AufgabeStatus;
   assignedTo?: string;
   assignedBy: string;
}

interface AufgabenData { aufgaben: JagdeinrichtungAufgabe[] }
const emptyData = (): AufgabenData => ({ aufgaben: [] });

export class JagdeinrichtungAufgabenStore {
   private data: AufgabenData = emptyData();
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'jagdeinrichtung-aufgaben.json');
   }

   async initialize() {
      await mkdir(dirname(this.filePath), { recursive: true });
      try {
         const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AufgabenData>;
         this.data = { aufgaben: Array.isArray(stored.aufgaben) ? stored.aufgaben : [] };
      } catch (error: unknown) {
         if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
         await this.persist();
      }
   }

   async getByRevierId(revierId: string) {
      return this.data.aufgaben.filter((aufgabe) => aufgabe.revierId === revierId);
   }

   async getById(id: string) {
      return this.data.aufgaben.find((aufgabe) => aufgabe.id === id) ?? null;
   }

   async create(input: CreateAufgabeInput) {
      return this.enqueue(async () => {
         const now = new Date().toISOString();
         const aufgabe: JagdeinrichtungAufgabe = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
         this.data.aufgaben.push(aufgabe);
         return aufgabe;
      });
   }

   async update(id: string, input: Partial<Pick<JagdeinrichtungAufgabe, 'titel' | 'beschreibung' | 'status'>> & { assignedTo?: string | null }) {
      return this.enqueue(async () => {
         const aufgabe = this.data.aufgaben.find((entry) => entry.id === id);
         if (!aufgabe) return null;
         const normalizedInput = { ...input, assignedTo: input.assignedTo ?? undefined };
         Object.assign(aufgabe, normalizedInput, {
            updatedAt: new Date().toISOString(),
            completedAt: input.status === 'erledigt' ? new Date().toISOString() : undefined,
         });
         return aufgabe;
      });
   }

   async delete(id: string) {
      return this.enqueue(async () => {
         const index = this.data.aufgaben.findIndex((entry) => entry.id === id);
         if (index < 0) return false;
         this.data.aufgaben.splice(index, 1);
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