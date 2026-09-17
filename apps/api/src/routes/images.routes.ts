import type { Context, Hono, MiddlewareHandler } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type AuthStore, type User } from '../auth-store.js';
import { type FacilityStore } from '../facility-store.js';
import { type KillEntryStore } from '../kill-entry-store.js';
import { type ImageStore } from '../image-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';

// Client always converts to JPEG/PNG/WebP and compresses before upload; this is a generous
// ceiling above that target, only meant to reject abuse that skips the client-side compression.
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME_TYPES: Record<string, string> = {
   'image/jpeg': '.jpg',
   'image/png': '.png',
   'image/webp': '.webp',
};

interface ImageRouteDependencies {
   authStore: AuthStore;
   imageStore: ImageStore;
   facilityStore: FacilityStore;
   killEntryStore: KillEntryStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   canAccessHuntingDistrict: (user: User, revierId: string) => boolean;
   canAdministerHuntingDistrict: (user: User, revierId: string) => boolean;
}

/** Reads and validates the uploaded file from a multipart/form-data request's "bild" field. */
async function readUploadedImage(context: Context) {
   const body = await context.req.parseBody();
   const file = body['bild'];
   if (!(file instanceof File)) return { error: 'Bilddatei fehlt.' } as const;
   const extension = ALLOWED_MIME_TYPES[file.type];
   if (!extension) return { error: 'Nur JPEG-, PNG- oder WebP-Bilder sind erlaubt.' } as const;
   if (file.size > MAX_UPLOAD_BYTES) return { error: 'Bilddatei ist zu groß (maximal 3 MB).' } as const;
   const buffer = new Uint8Array(await file.arrayBuffer());
   return { buffer, mimeType: file.type, extension } as const;
}

/** Registers upload/list/delete/serve endpoints for images attached to facilities and kill entries. */
export function registerImageRoutes(app: Hono, dependencies: ImageRouteDependencies) {
   const { authStore, imageStore, facilityStore, killEntryStore, getAuthenticatedPayload, requireAuth, canAccessHuntingDistrict, canAdministerHuntingDistrict } = dependencies;

   const withUploaderName = <T extends { createdBy: string }>(record: T) => ({
      ...record,
      createdByName: authStore.findUserById(record.createdBy)?.displayName ?? 'Unbekanntes Mitglied',
   });

   // --- Jagdeinrichtungen ----------------------------------------------------

   app.get('/reviere/:revierId/jagdeinrichtungen/:id/bilder', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!user || !revierId || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const facility = await facilityStore.getById(id);
      if (!facility || facility.revierId !== revierId) return context.json({ message: 'Jagdeinrichtung nicht gefunden.' }, 404);
      return context.json({ bilder: (await imageStore.getByEntity('jagdeinrichtung', id)).map(withUploaderName) });
   });

   app.post('/reviere/:revierId/jagdeinrichtungen/:id/bilder', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!user || !revierId || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const facility = await facilityStore.getById(id);
      if (!facility || facility.revierId !== revierId) return context.json({ message: 'Jagdeinrichtung nicht gefunden.' }, 404);
      const upload = await readUploadedImage(context);
      if ('error' in upload) return context.json({ message: upload.error }, 400);
      try {
         const record = await imageStore.create({ ...upload, revierId, entityType: 'jagdeinrichtung', entityId: id, createdBy: user.id });
         return context.json({ bild: withUploaderName(record) }, 201);
      } catch (error) {
         if ((error as Error).message === 'TOO_MANY_IMAGES') return context.json({ message: 'Es sind bereits 3 Bilder hinterlegt. Bitte zuerst eines löschen.' }, 409);
         throw error;
      }
   });

   app.delete('/reviere/:revierId/jagdeinrichtungen/:id/bilder/:bildId', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const bildId = context.req.param('bildId');
      if (!user || !revierId || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const image = await imageStore.getById(bildId);
      if (!image || image.revierId !== revierId || image.entityId !== context.req.param('id')) return context.json({ message: 'Bild nicht gefunden.' }, 404);
      if (image.createdBy !== user.id && !canAdministerHuntingDistrict(user, revierId)) return context.json({ message: 'Dieses Bild darf nicht gelöscht werden.' }, 403);
      await imageStore.delete(bildId);
      return context.json({ message: 'Bild gelöscht.' });
   });

   app.get('/reviere/:revierId/jagdeinrichtungen/:id/bilder/:bildId/datei', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const bildId = context.req.param('bildId');
      if (!user || !revierId || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const image = await imageStore.getById(bildId);
      if (!image || image.revierId !== revierId || image.entityId !== context.req.param('id')) return context.json({ message: 'Bild nicht gefunden.' }, 404);
      const buffer = await readFile(join(imageStore.imagesDirectory, image.fileName));
      return context.body(buffer, 200, { 'Content-Type': image.mimeType, 'Cache-Control': 'private, max-age=86400' });
   });

   // --- Streckeneinträge ------------------------------------------------------

   app.get('/reviere/:revierId/streckeneintraege/:id/bilder', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!user || !revierId || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const entry = await killEntryStore.getById(id, revierId);
      if (!entry) return context.json({ message: 'Streckeneintrag nicht gefunden.' }, 404);
      return context.json({ bilder: (await imageStore.getByEntity('streckeneintrag', id)).map(withUploaderName) });
   });

   app.post('/reviere/:revierId/streckeneintraege/:id/bilder', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!user || !revierId || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const entry = await killEntryStore.getById(id, revierId);
      if (!entry) return context.json({ message: 'Streckeneintrag nicht gefunden.' }, 404);
      const upload = await readUploadedImage(context);
      if ('error' in upload) return context.json({ message: upload.error }, 400);
      try {
         const record = await imageStore.create({ ...upload, revierId, entityType: 'streckeneintrag', entityId: id, createdBy: user.id });
         return context.json({ bild: withUploaderName(record) }, 201);
      } catch (error) {
         if ((error as Error).message === 'TOO_MANY_IMAGES') return context.json({ message: 'Es sind bereits 3 Bilder hinterlegt. Bitte zuerst eines löschen.' }, 409);
         throw error;
      }
   });

   app.delete('/reviere/:revierId/streckeneintraege/:id/bilder/:bildId', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const bildId = context.req.param('bildId');
      if (!user || !revierId || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const image = await imageStore.getById(bildId);
      if (!image || image.revierId !== revierId || image.entityId !== context.req.param('id')) return context.json({ message: 'Bild nicht gefunden.' }, 404);
      if (image.createdBy !== user.id && !canAdministerHuntingDistrict(user, revierId)) return context.json({ message: 'Dieses Bild darf nicht gelöscht werden.' }, 403);
      await imageStore.delete(bildId);
      return context.json({ message: 'Bild gelöscht.' });
   });

   app.get('/reviere/:revierId/streckeneintraege/:id/bilder/:bildId/datei', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const bildId = context.req.param('bildId');
      if (!user || !revierId || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const image = await imageStore.getById(bildId);
      if (!image || image.revierId !== revierId || image.entityId !== context.req.param('id')) return context.json({ message: 'Bild nicht gefunden.' }, 404);
      const buffer = await readFile(join(imageStore.imagesDirectory, image.fileName));
      return context.body(buffer, 200, { 'Content-Type': image.mimeType, 'Cache-Control': 'private, max-age=86400' });
   });
}
