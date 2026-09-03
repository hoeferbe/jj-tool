import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface JagdeinrichtungReservierung {
   id: string;
   revierId: string;
   jagdeinrichtungId: string;
   reservedBy: string;
   reservedAt: string;
   releasedAt?: string;
}

interface ReservierungenData { reservierungen: JagdeinrichtungReservierung[] }
const emptyData = (): ReservierungenData => ({ reservierungen: [] });

export class JagdeinrichtungReservierungenStore {
   private data: ReservierungenData = emptyData();
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'jagdeinrichtung-reservierungen.json');
   }

   async initialize() {
      await mkdir(dirname(this.filePath), { recursive: true });
      try {
         const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<ReservierungenData>;
         this.data = { reservierungen: Array.isArray(stored.reservierungen) ? stored.reservierungen : [] };
      } catch (error: unknown) {
         if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
         await this.persist();
      }
   }

   async getActiveByRevierId(revierId: string) {
      return this.data.reservierungen.filter((entry) => entry.revierId === revierId && !entry.releasedAt);
   }

   async getActiveByFacilityId(jagdeinrichtungId: string) {
      return this.data.reservierungen.find((entry) => entry.jagdeinrichtungId === jagdeinrichtungId && !entry.releasedAt) ?? null;
   }

   async reserve(input: Omit<JagdeinrichtungReservierung, 'id' | 'reservedAt'>) {
      return this.enqueue(async () => {
         const active = this.data.reservierungen.find((entry) => entry.jagdeinrichtungId === input.jagdeinrichtungId && !entry.releasedAt);
         if (active) throw new Error('ALREADY_RESERVED');
         const reservation: JagdeinrichtungReservierung = {
            id: randomUUID(), ...input, reservedAt: new Date().toISOString(),
         };
         this.data.reservierungen.push(reservation);
         return reservation;
      });
   }

   async release(jagdeinrichtungId: string) {
      return this.enqueue(async () => {
         const reservation = this.data.reservierungen.find((entry) => entry.jagdeinrichtungId === jagdeinrichtungId && !entry.releasedAt);
         if (!reservation) return null;
         reservation.releasedAt = new Date().toISOString();
         return reservation;
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