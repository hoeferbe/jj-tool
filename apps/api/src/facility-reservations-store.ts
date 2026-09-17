import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface FacilityReservation {
   id: string;
   revierId: string;
   jagdeinrichtungId: string;
   reservedBy: string;
   reservedAt: string;
   startAt?: string;
   endAt?: string;
   releasedAt?: string;
   checkedInBy?: string;
   checkedInAt?: string;
   checkedOutAt?: string;
}

interface ReservationsData { reservierungen: FacilityReservation[] }
const emptyData = (): ReservationsData => ({ reservierungen: [] });

/**
 * In-memory store for facility reservations and check-ins, backed by a single JSON file.
 * All writes go through a serial queue so concurrent requests never corrupt the file.
 */
export class FacilityReservationsStore {
   private data: ReservationsData = emptyData();
   /** Serialises all write operations to prevent race conditions. */
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'jagdeinrichtung-reservierungen.json');
   }

   /**
    * Loads jagdeinrichtung-reservierungen.json from disk into memory.
    * Creates the file if it does not exist yet.
    */
   async initialize() {
      await mkdir(dirname(this.filePath), { recursive: true });
      try {
         const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<ReservationsData>;
         this.data = { reservierungen: Array.isArray(stored.reservierungen) ? stored.reservierungen : [] };
      } catch (error: unknown) {
         if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
         await this.persist();
      }
   }

   /** Returns all active (not released/expired) reservations of one hunting district, soonest first. */
   async getActiveByHuntingDistrictId(revierId: string) {
      return this.data.reservierungen
         .filter((entry) => entry.revierId === revierId && this.isActive(entry))
         .sort((first, second) => this.reservationStart(first) - this.reservationStart(second));
   }

   /** Returns all past (released/expired) reservations of one hunting district, most recent first. */
   async getHistoryByHuntingDistrictId(revierId: string) {
      return this.data.reservierungen
         .filter((entry) => entry.revierId === revierId && !this.isActive(entry))
         .sort((first, second) => this.reservationStart(second) - this.reservationStart(first));
   }

   /** Returns the next active reservation of one facility, or `null` if there is none. */
   async getActiveByFacilityId(jagdeinrichtungId: string) {
      return this.data.reservierungen
         .filter((entry) => entry.jagdeinrichtungId === jagdeinrichtungId && this.isActive(entry))
         .sort((first, second) => this.reservationStart(first) - this.reservationStart(second))
         .at(0) ?? null;
   }

   /** Finds an active reservation by its id, or `null` if it does not exist or is no longer active. */
   async getActiveById(id: string) {
      return this.data.reservierungen.find((entry) => entry.id === id && this.isActive(entry)) ?? null;
   }

   /**
    * Checks a member into a facility, reusing an existing active reservation if present.
    * Throws `ALREADY_IN_USE` if the facility is already reserved or checked in by someone else.
    */
   async checkIn(input: { revierId: string; jagdeinrichtungId: string; reservedBy?: string; checkedInBy: string }) {
      return this.enqueue(async () => {
         const active = this.data.reservierungen.find((entry) => entry.jagdeinrichtungId === input.jagdeinrichtungId && this.isActive(entry));
         if (active) {
            if ((active.checkedInBy && active.checkedInBy !== input.checkedInBy) || (active.reservedBy && active.reservedBy !== input.checkedInBy)) {
               throw new Error('ALREADY_IN_USE');
            }
            active.checkedInBy = input.checkedInBy;
            active.checkedInAt ??= new Date().toISOString();
            active.reservedBy ??= input.reservedBy ?? input.checkedInBy;
            active.reservedAt ??= active.checkedInAt;
            active.checkedOutAt = undefined;
            return active;
         }

         const now = new Date().toISOString();
         const reservation: FacilityReservation = {
            id: randomUUID(),
            revierId: input.revierId,
            jagdeinrichtungId: input.jagdeinrichtungId,
            reservedBy: input.reservedBy ?? input.checkedInBy,
            reservedAt: now,
            checkedInBy: input.checkedInBy,
            checkedInAt: now,
         };
         this.data.reservierungen.push(reservation);
         return reservation;
      });
   }

   /** Checks out of the active reservation of one facility. Returns `null` if there is no active reservation. */
   async checkOut(jagdeinrichtungId: string) {
      return this.enqueue(async () => {
         const reservation = this.data.reservierungen.find((entry) => entry.jagdeinrichtungId === jagdeinrichtungId && this.isActive(entry));
         if (!reservation) return null;
         reservation.checkedOutAt = new Date().toISOString();
         reservation.releasedAt = reservation.checkedOutAt;
         reservation.checkedInBy = undefined;
         reservation.checkedInAt = undefined;
         return reservation;
      });
   }

   /**
    * Creates a new time-boxed reservation for a facility.
    * Throws `ALREADY_RESERVED` if the period overlaps an existing active reservation, or `INVALID_PERIOD` for an invalid time range.
    */
   async reserve(input: Omit<FacilityReservation, 'id' | 'reservedAt'>) {
      return this.enqueue(async () => {
         const { startAt, endAt } = this.createReservationPeriod(input.startAt, input.endAt);
         const overlaps = this.data.reservierungen.some((entry) =>
            entry.jagdeinrichtungId === input.jagdeinrichtungId && !entry.releasedAt
            && (!entry.endAt || new Date(entry.endAt).getTime() > Date.now())
            && this.periodsOverlap(entry.startAt, entry.endAt, startAt, endAt),
         );
         if (overlaps) throw new Error('ALREADY_RESERVED');
         const reservation: FacilityReservation = {
            id: randomUUID(), ...input, startAt, endAt, reservedAt: new Date().toISOString(),
         };
         this.data.reservierungen.push(reservation);
         return reservation;
      });
   }

   /**
    * Changes the time period of an existing reservation.
    * Throws `ALREADY_RESERVED` if the new period overlaps another active reservation, or `INVALID_PERIOD` for an invalid time range.
    */
   async updateReservation(id: string, input: { startAt: string; endAt?: string }) {
      return this.enqueue(async () => {
         const reservation = this.data.reservierungen.find((entry) => entry.id === id && !entry.releasedAt);
         if (!reservation) return null;
         const { startAt, endAt } = this.createReservationPeriod(input.startAt, input.endAt);
         const overlaps = this.data.reservierungen.some((entry) =>
            entry.id !== id && entry.jagdeinrichtungId === reservation.jagdeinrichtungId && !entry.releasedAt
            && (!entry.endAt || new Date(entry.endAt).getTime() > Date.now())
            && this.periodsOverlap(entry.startAt, entry.endAt, startAt, endAt),
         );
         if (overlaps) throw new Error('ALREADY_RESERVED');
         reservation.startAt = startAt;
         reservation.endAt = endAt;
         return reservation;
      });
   }

   /** Releases the active reservation of one facility (e.g. cancellation). Returns `null` if there is none. */
   async release(jagdeinrichtungId: string) {
      return this.enqueue(async () => {
         const reservation = this.data.reservierungen.find((entry) => entry.jagdeinrichtungId === jagdeinrichtungId && this.isActive(entry));
         if (!reservation) return null;
         reservation.releasedAt = new Date().toISOString();
         return reservation;
      });
   }

   /** Releases a reservation by its own id. Returns `null` if it does not exist or is already released. */
   async releaseById(id: string) {
      return this.enqueue(async () => {
         const reservation = this.data.reservierungen.find((entry) => entry.id === id && !entry.releasedAt);
         if (!reservation) return null;
         reservation.releasedAt = new Date().toISOString();
         return reservation;
      });
   }

   /** Deletes all reservations of one hunting district (e.g. when the district itself is deleted). Returns the number removed. */
   async deleteByHuntingDistrictId(revierId: string) {
      return this.enqueue(async () => {
         const initialLength = this.data.reservierungen.length;
         this.data.reservierungen = this.data.reservierungen.filter((entry) => entry.revierId !== revierId);
         return initialLength - this.data.reservierungen.length;
      });
   }

   /** Deletes all reservations linked to one facility (e.g. when the facility itself is deleted). Returns the number removed. */
   async deleteByFacilityId(jagdeinrichtungId: string) {
      return this.enqueue(async () => {
         const initialLength = this.data.reservierungen.length;
         this.data.reservierungen = this.data.reservierungen.filter((entry) => entry.jagdeinrichtungId !== jagdeinrichtungId);
         return initialLength - this.data.reservierungen.length;
      });
   }

   /** Sort key: the reservation's start time, or its creation time for immediate/check-in-only reservations. */
   private reservationStart(reservation: FacilityReservation) {
      return reservation.startAt ? new Date(reservation.startAt).getTime() : new Date(reservation.reservedAt).getTime();
   }

   /** A reservation is active while it hasn't been released and its end time (if any) hasn't passed. */
   private isActive(reservation: FacilityReservation) {
      return !reservation.releasedAt && (!reservation.endAt || new Date(reservation.endAt).getTime() >= Date.now());
   }

   /** Whether two optional time ranges overlap (open-ended bounds treated as -/+ infinity). */
   private periodsOverlap(firstStart?: string, firstEnd?: string, secondStart?: string, secondEnd?: string) {
      const firstFrom = firstStart ? new Date(firstStart).getTime() : 0;
      const firstTo = firstEnd ? new Date(firstEnd).getTime() : Number.POSITIVE_INFINITY;
      const secondFrom = secondStart ? new Date(secondStart).getTime() : 0;
      const secondTo = secondEnd ? new Date(secondEnd).getTime() : Number.POSITIVE_INFINITY;
      return firstFrom < secondTo && secondFrom < firstTo;
   }

   /**
    * Normalises and validates a reservation's start/end time: start defaults to now (rounded up to the
    * next 30-minute slot), end defaults to a 3-hour duration. Both bounds must align to 30-minute slots
    * and the duration must be between 30 minutes and 12 hours. Throws `INVALID_PERIOD` otherwise.
    */
   private createReservationPeriod(requestedStart?: string, requestedEnd?: string) {
      const start = requestedStart ? new Date(requestedStart) : new Date();
      if (Number.isNaN(start.getTime())) throw new Error('INVALID_PERIOD');
      if (requestedStart && (start.getUTCMinutes() % 30 !== 0 || start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0)) {
         throw new Error('INVALID_PERIOD');
      }
      if (!requestedStart) {
         start.setUTCMinutes(Math.ceil(start.getUTCMinutes() / 30) * 30, 0, 0);
      }
      const end = requestedEnd ? new Date(requestedEnd) : new Date(start.getTime() + 3 * 60 * 60 * 1000);
      const duration = end.getTime() - start.getTime();
      if (
         Number.isNaN(end.getTime()) ||
         end.getUTCMinutes() % 30 !== 0 ||
         end.getUTCSeconds() !== 0 ||
         end.getUTCMilliseconds() !== 0 ||
         duration < 30 * 60 * 1000 ||
         duration > 12 * 60 * 60 * 1000 ||
         duration % (30 * 60 * 1000) !== 0
      ) {
         throw new Error('INVALID_PERIOD');
      }
      return { startAt: start.toISOString(), endAt: end.toISOString() };
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
    * Atomically writes jagdeinrichtung-reservierungen.json by first writing to a temp file then renaming it.
    * This prevents corrupt files if the process is killed mid-write.
    */
   private async persist() {
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
   }
}