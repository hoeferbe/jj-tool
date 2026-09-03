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

export class HuntingDistrictStore {
   private data: HuntingDistrictData = emptyData();
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'revier.json');
   }

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

   async getHuntingDistricts() {
      return [...this.data.reviere];
   }

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

   async deleteHuntingDistrict(id: string) {
      return this.enqueue(async () => {
         const index = this.data.reviere.findIndex((revier) => revier.id === id);
         if (index < 0) return false;
         this.data.reviere.splice(index, 1);
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
      await writeFile(
         temporaryPath,
         `${JSON.stringify(this.data, null, 2)}\n`,
         'utf8',
      );
      await rename(temporaryPath, this.filePath);
   }
}
