import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type GeoJsonGeometryType =
   | 'Point'
   | 'LineString'
   | 'Polygon'
   | 'MultiPoint'
   | 'MultiLineString'
   | 'MultiPolygon'
   | 'GeometryCollection';

export interface GeoJsonFeature {
   type: 'Feature';
   properties?: Record<string, unknown>;
   geometry: {
      type: GeoJsonGeometryType;
      coordinates: unknown;
   };
}

export interface GeoJsonFeatureCollection {
   type: 'FeatureCollection';
   features: GeoJsonFeature[];
}

export interface HuntingDistrictPoint {
   lat: number;
   lng: number;
}

export interface HuntingDistrict {
   id: string;
   name: string;
   municipalityName: string;
   municipalityCode?: string;
   center: HuntingDistrictPoint;
   boundary: GeoJsonFeatureCollection;
   source: 'bkg-wfs-vg25';
   createdBy: string;
   createdAt: string;
   updatedAt: string;
}

export interface UpsertHuntingDistrictInput {
   name: string;
   municipalityName: string;
   municipalityCode?: string;
   center: HuntingDistrictPoint;
   boundary: GeoJsonFeatureCollection;
   source: 'bkg-wfs-vg25';
   createdBy: string;
}

interface HuntingDistrictData {
   reviere: HuntingDistrict[];
}

interface LegacyHuntingDistrictData {
   revier?: HuntingDistrict | null;
}

const emptyData = (): HuntingDistrictData => ({
   reviere: [],
});

/**
 * In-memory store for all Reviere (hunting districts) backed by a single JSON file.
 * All writes go through a serial queue so concurrent requests never corrupt the file.
 */
export class HuntingDistrictStore {
   private data: HuntingDistrictData = emptyData();
   /** Serialises all write operations to prevent race conditions. */
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'revier.json');
   }

   /**
    * Loads revier.json from disk into memory.
    * Creates the file if it does not exist yet and migrates the legacy single-revier format.
    */
   async initialize() {
      await mkdir(dirname(this.filePath), { recursive: true });
      try {
         const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<HuntingDistrictData> & LegacyHuntingDistrictData;
         this.data = {
            reviere: Array.isArray(stored.reviere)
               ? stored.reviere
               : stored.revier
                 ? [stored.revier]
                 : [],
         };
         if (!Array.isArray(stored.reviere)) {
            await this.persist();
         }
      } catch (error: unknown) {
         if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
         }
         await this.persist();
      }
   }

   /** Returns a copy of all hunting districts. */
   async getHuntingDistricts() {
      return [...this.data.reviere];
   }

   /** Creates a new hunting district with a fresh UUID and timestamps. */
   async createHuntingDistrict(input: UpsertHuntingDistrictInput) {
      return this.enqueue(async () => {
         const now = new Date().toISOString();
         const revier: HuntingDistrict = {
            id: randomUUID(),
            ...input,
            createdAt: now,
            updatedAt: now,
         };
         this.data.reviere.push(revier);
         return revier;
      });
   }

   /** Replaces an existing hunting district's editable fields, keeping its id and createdAt. Returns `null` if not found. */
   async updateHuntingDistrict(id: string, input: UpsertHuntingDistrictInput) {
      return this.enqueue(async () => {
         const index = this.data.reviere.findIndex((revier) => revier.id === id);
         if (index < 0) return null;

         const existing = this.data.reviere[index]!;
         const updated: HuntingDistrict = {
            ...existing,
            ...input,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
         };
         this.data.reviere[index] = updated;
         return updated;
      });
   }

   /** Deletes one hunting district by id. Returns whether a matching entry was found. */
   async deleteHuntingDistrict(id: string) {
      return this.enqueue(async () => {
         const index = this.data.reviere.findIndex((revier) => revier.id === id);
         if (index < 0) return false;
         this.data.reviere.splice(index, 1);
         return true;
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
    * Atomically writes revier.json by first writing to a temp file then renaming it.
    * This prevents corrupt files if the process is killed mid-write.
    */
   private async persist() {
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(
         temporaryPath,
         `${JSON.stringify(this.data, null, 2)}\n`,
         'utf8',
      );
      await rename(temporaryPath, this.filePath);
   }
}
