import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const TASK_STATUSES = ['offen', 'in Bearbeitung', 'erledigt'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ['niedrig', 'normal', 'hoch'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface FacilityTask {
   id: string;
   revierId: string;
   jagdeinrichtungId?: string;
   titel: string;
   beschreibung?: string;
   faelligAm?: string;
   prioritaet: TaskPriority;
   status: TaskStatus;
   assignedTo?: string;
   assignedBy: string;
   createdAt: string;
   updatedAt: string;
   completedAt?: string;
}

export interface CreateTaskInput {
   revierId: string;
   jagdeinrichtungId?: string;
   titel: string;
   beschreibung?: string;
   faelligAm?: string;
   prioritaet: TaskPriority;
   status: TaskStatus;
   assignedTo?: string;
   assignedBy: string;
}

interface TaskData { aufgaben: FacilityTask[] }
const emptyData = (): TaskData => ({ aufgaben: [] });

/**
 * In-memory store for facility tasks and general district tasks (facility tasks omit `jagdeinrichtungId`)
 * backed by a single JSON file. All writes go through a serial queue so concurrent requests never corrupt the file.
 */
export class FacilityTasksStore {
   private data: TaskData = emptyData();
   /** Serialises all write operations to prevent race conditions. */
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'jagdeinrichtung-aufgaben.json');
   }

   /**
    * Loads jagdeinrichtung-aufgaben.json from disk into memory.
    * Creates the file if it does not exist yet and backfills a default priority on older tasks.
    */
   async initialize() {
      await mkdir(dirname(this.filePath), { recursive: true });
      try {
         const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<TaskData>;
         this.data = { aufgaben: Array.isArray(stored.aufgaben) ? stored.aufgaben : [] };
         const needsMigration = this.data.aufgaben.some((task) => !task.prioritaet);
         for (const task of this.data.aufgaben) task.prioritaet ??= 'normal';
         if (needsMigration) await this.persist();
      } catch (error: unknown) {
         if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
         await this.persist();
      }
   }

   /** Returns all tasks (facility-specific and general) belonging to one hunting district. */
   async getByHuntingDistrictId(revierId: string) {
      return this.data.aufgaben.filter((aufgabe) => aufgabe.revierId === revierId);
   }

   /** Finds a task by its UUID, or `null` if it does not exist. */
   async getById(id: string) {
      return this.data.aufgaben.find((aufgabe) => aufgabe.id === id) ?? null;
   }

   /** Creates a new task with a fresh UUID and timestamps. */
   async create(input: CreateTaskInput) {
      return this.enqueue(async () => {
         const now = new Date().toISOString();
         const aufgabe: FacilityTask = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
         this.data.aufgaben.push(aufgabe);
         return aufgabe;
      });
   }

   /**
    * Applies a partial update to a task. `null` values for `beschreibung`/`assignedTo`/`faelligAm` clear the field.
    * Sets or clears `completedAt` when the status changes to/from `erledigt`. Returns `null` if not found.
    */
   async update(id: string, input: Partial<Pick<FacilityTask, 'titel' | 'prioritaet' | 'status'>> & { beschreibung?: string | null; assignedTo?: string | null; faelligAm?: string | null }) {
      return this.enqueue(async () => {
         const aufgabe = this.data.aufgaben.find((entry) => entry.id === id);
         if (!aufgabe) return null;
         const { assignedTo, beschreibung, faelligAm, ...changes } = input;
         const normalizedInput: Partial<FacilityTask> = { ...changes };
         if ('assignedTo' in input) normalizedInput.assignedTo = assignedTo ?? undefined;
         if ('beschreibung' in input) normalizedInput.beschreibung = beschreibung ?? undefined;
         if ('faelligAm' in input) normalizedInput.faelligAm = faelligAm ?? undefined;
         Object.assign(aufgabe, normalizedInput, { updatedAt: new Date().toISOString() });
         if ('status' in input) {
            aufgabe.completedAt = input.status === 'erledigt'
               ? aufgabe.completedAt ?? new Date().toISOString()
               : undefined;
         }
         return aufgabe;
      });
   }

   /** Deletes one task by id. Returns whether a matching entry was found. */
   async delete(id: string) {
      return this.enqueue(async () => {
         const index = this.data.aufgaben.findIndex((entry) => entry.id === id);
         if (index < 0) return false;
         this.data.aufgaben.splice(index, 1);
         return true;
      });
   }

   /** Deletes all tasks of one hunting district (e.g. when the district itself is deleted). Returns the number removed. */
   async deleteByHuntingDistrictId(revierId: string) {
      return this.enqueue(async () => {
         const initialLength = this.data.aufgaben.length;
         this.data.aufgaben = this.data.aufgaben.filter((entry) => entry.revierId !== revierId);
         return initialLength - this.data.aufgaben.length;
      });
   }

   /** Deletes all tasks linked to one facility (e.g. when the facility itself is deleted). Returns the number removed. */
   async deleteByFacilityId(jagdeinrichtungId: string) {
      return this.enqueue(async () => {
         const initialLength = this.data.aufgaben.length;
         this.data.aufgaben = this.data.aufgaben.filter((entry) => entry.jagdeinrichtungId !== jagdeinrichtungId);
         return initialLength - this.data.aufgaben.length;
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
    * Atomically writes jagdeinrichtung-aufgaben.json by first writing to a temp file then renaming it.
    * This prevents corrupt files if the process is killed mid-write.
    */
   private async persist() {
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
   }
}