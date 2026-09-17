import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const IMAGE_ENTITY_TYPES = ['jagdeinrichtung', 'streckeneintrag'] as const;
export type ImageEntityType = (typeof IMAGE_ENTITY_TYPES)[number];
export const MAX_IMAGES_PER_ENTITY = 3;

export interface ImageRecord {
   id: string;
   revierId: string;
   entityType: ImageEntityType;
   entityId: string;
   fileName: string;
   mimeType: string;
   size: number;
   createdBy: string;
   createdAt: string;
}

export interface CreateImageInput {
   revierId: string;
   entityType: ImageEntityType;
   entityId: string;
   mimeType: string;
   extension: string;
   buffer: Uint8Array;
   createdBy: string;
}

interface ImageData { bilder: ImageRecord[] }
const emptyData = (): ImageData => ({ bilder: [] });

/**
 * In-memory store for image metadata (the "Bild" data model), backed by a single JSON file.
 * The actual image bytes live as files under `<dataDirectory>/bilder/`; this store only tracks
 * which file belongs to which facility/kill entry. All writes go through a serial queue so
 * concurrent requests never corrupt the file.
 */
export class ImageStore {
   private data: ImageData = emptyData();
   /** Serialises all write operations to prevent race conditions. */
   private writeQueue = Promise.resolve();
   private readonly filePath: string;
   readonly imagesDirectory: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'bilder.json');
      this.imagesDirectory = join(dataDirectory, 'bilder');
   }

   /** Loads bilder.json from disk and ensures the image directory exists. Creates the file if needed. */
   async initialize() {
      await mkdir(dirname(this.filePath), { recursive: true });
      await mkdir(this.imagesDirectory, { recursive: true });
      try {
         const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<ImageData>;
         this.data = { bilder: Array.isArray(stored.bilder) ? stored.bilder : [] };
      } catch (error: unknown) {
         if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
         await this.persist();
      }
   }

   /** Returns all images attached to one entity, in upload order. */
   async getByEntity(entityType: ImageEntityType, entityId: string) {
      return this.data.bilder
         .filter((entry) => entry.entityType === entityType && entry.entityId === entityId)
         .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
   }

   /** Finds an image by id, or `null` if it does not exist. */
   async getById(id: string) {
      return this.data.bilder.find((entry) => entry.id === id) ?? null;
   }

   /**
    * Saves an uploaded image's bytes to disk and records its metadata.
    * Throws `TOO_MANY_IMAGES` if the entity already has `MAX_IMAGES_PER_ENTITY` images.
    */
   async create(input: CreateImageInput) {
      return this.enqueue(async () => {
         const existingCount = this.data.bilder.filter(
            (entry) => entry.entityType === input.entityType && entry.entityId === input.entityId,
         ).length;
         if (existingCount >= MAX_IMAGES_PER_ENTITY) throw new Error('TOO_MANY_IMAGES');
         const id = randomUUID();
         const fileName = `${id}${input.extension}`;
         await writeFile(join(this.imagesDirectory, fileName), input.buffer);
         const record: ImageRecord = {
            id,
            revierId: input.revierId,
            entityType: input.entityType,
            entityId: input.entityId,
            fileName,
            mimeType: input.mimeType,
            size: input.buffer.byteLength,
            createdBy: input.createdBy,
            createdAt: new Date().toISOString(),
         };
         this.data.bilder.push(record);
         return record;
      });
   }

   /** Deletes one image (metadata + file on disk). Returns whether it existed. */
   async delete(id: string) {
      return this.enqueue(async () => {
         const index = this.data.bilder.findIndex((entry) => entry.id === id);
         if (index < 0) return false;
         const [removed] = this.data.bilder.splice(index, 1);
         await rm(join(this.imagesDirectory, removed!.fileName), { force: true });
         return true;
      });
   }

   /** Deletes all images of one entity (e.g. when the facility/kill entry itself is deleted). Returns the number removed. */
   async deleteByEntity(entityType: ImageEntityType, entityId: string) {
      return this.enqueue(async () => {
         const removed = this.data.bilder.filter((entry) => entry.entityType === entityType && entry.entityId === entityId);
         this.data.bilder = this.data.bilder.filter((entry) => !(entry.entityType === entityType && entry.entityId === entityId));
         await Promise.all(removed.map((entry) => rm(join(this.imagesDirectory, entry.fileName), { force: true })));
         return removed.length;
      });
   }

   /**
    * Serialises all write operations so they execute one at a time.
    * Each operation modifies in-memory state (and possibly the filesystem) and then flushes the metadata to disk.
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
    * Atomically writes bilder.json by first writing to a temp file then renaming it.
    * This prevents corrupt files if the process is killed mid-write.
    */
   private async persist() {
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
   }
}
