import { zValidator } from '@hono/zod-validator';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { type RevierStore } from '../revier-store.js';
import { revierSchema } from '../schemas/revier.schemas.js';

interface RevierRouteDependencies {
   authStore: AuthStore;
   revierStore: RevierStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   requireAdmin: MiddlewareHandler;
   canAdministerRevier: (user: User, revierId: string) => boolean;
}

export function registerRevierRoutes(app: Hono, dependencies: RevierRouteDependencies) {
   const { authStore, revierStore, getAuthenticatedPayload, requireAuth, requireAdmin, canAdministerRevier } = dependencies;

   app.get('/reviere', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const reviere = await revierStore.getReviere();
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (user?.accountType === 'systemAdmin') return context.json({ reviere });
      const assignedIds = new Set(user?.memberships.filter((membership) => membership.status === 'active').map((membership) => membership.revierId) ?? []);
      return context.json({ reviere: reviere.filter((revier) => assignedIds.has(revier.id)) });
   });

   app.get('/reviere/:id/members', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('id');
      if (!revierId) return context.json({ message: 'Revier-ID fehlt.' }, 400);
      const mayView = user?.accountType === 'systemAdmin' || user?.memberships.some((membership) => membership.revierId === revierId && membership.status === 'active');
      if (!mayView) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const viewerMembership = user?.memberships.find((membership) => membership.revierId === revierId && membership.status === 'active');
      const members = authStore.getMemberDirectory(revierId).map((member) => ({
         ...member,
         memberType: viewerMembership?.memberType === 'guest' ? member.memberType === 'guest' ? 'guest' : 'member' : member.memberType,
      }));
      return context.json({ members });
   });

   app.post('/reviere', requireAuth, zValidator('json', revierSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const input = context.req.valid('json');
      const revier = await revierStore.createRevier({ ...input, createdBy: payload?.sub ?? 'unknown' });
      const creator = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (creator?.accountType === 'member') {
         await authStore.upsertMembership(creator.id, { revierId: revier.id, status: 'active', memberType: 'paechter', isAdmin: true });
      }
      return context.json({ revier }, 201);
   });

   app.put('/reviere/:id', requireAdmin, zValidator('json', revierSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const id = context.req.param('id');
      if (!user || !canAdministerRevier(user, id)) return context.json({ message: 'Dieses Revier darf nicht administriert werden.' }, 403);
      const revier = await revierStore.updateRevier(id, { ...context.req.valid('json'), createdBy: payload?.sub ?? 'unknown' });
      if (!revier) return context.json({ message: 'Revier nicht gefunden.' }, 404);
      return context.json({ revier });
   });

   app.get('/municipalities/search', requireAuth, async (context) => {
      const municipalityName = context.req.query('name');
      const latitude = context.req.query('lat');
      const longitude = context.req.query('lng');
      const bkgBaseUrl = process.env.BKG_WFS_URL ?? 'https://sgx.geodatenzentrum.de/wfs_vg25';
      if (!municipalityName && (!latitude || !longitude)) return context.json({ message: 'Fehlende Suchparameter.' }, 400);
      const url = new URL(bkgBaseUrl);
      const searchParams = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 'vg25:vg25_gem', outputFormat: 'application/json', srsName: 'EPSG:4326' });
      if (municipalityName) {
         searchParams.set('cql_filter', `gen = '${municipalityName.replace(/'/g, "''")}'`);
      } else {
         const lat = Number(latitude);
         const lng = Number(longitude);
         if (!Number.isFinite(lat) || !Number.isFinite(lng)) return context.json({ message: 'Koordinaten sind ungültig.' }, 400);
         const tolerance = 0.00005;
         searchParams.set('bbox', `${lng - tolerance},${lat - tolerance},${lng + tolerance},${lat + tolerance},EPSG:4326`);
      }
      url.search = searchParams.toString();
      const response = await fetch(url.toString());
      if (!response.ok) {
         const text = await response.text();
         console.error('BKG WFS failed', response.status, text.slice(0, 400));
         return context.json({ message: 'Gemeinde konnte nicht vom BKG geladen werden.' }, 502);
      }
      const data = await response.json() as { features?: Array<{ properties?: Record<string, unknown>; geometry?: unknown }> };
      const features = data.features ?? [];
      if (!features.length) return context.json({ message: 'Keine Gemeinde unter diesen Kriterien gefunden.' }, 404);
      const clickedPoint = latitude && longitude ? point([Number(longitude), Number(latitude)]) : null;
      const firstFeature = (clickedPoint ? features.find((feature) => {
         const geometry = feature.geometry as { type?: string } | undefined;
         if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return false;
         return booleanPointInPolygon(clickedPoint, feature as Feature<Polygon | MultiPolygon>);
      }) ?? features[0] : features[0])!;
      const municipality = String(firstFeature.properties?.gen ?? municipalityName ?? 'Gemeinde');
      const code = firstFeature.properties?.ags ?? firstFeature.properties?.ars;
      return context.json({ municipalityName: municipality, municipalityCode: typeof code === 'string' ? code : undefined, boundary: { type: 'FeatureCollection', features: [firstFeature] } });
   });

   app.delete('/reviere/:id', requireAdmin, async (context) => {
      const id = context.req.param('id');
      if (!id) return context.json({ message: 'Revier-ID fehlt.' }, 400);
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!user || !canAdministerRevier(user, id)) return context.json({ message: 'Dieses Revier darf nicht administriert werden.' }, 403);
      if (authStore.getAllUsers().some((candidate) => candidate.id !== user.id && candidate.memberships.some((membership) => membership.revierId === id))) return context.json({ message: 'Das Revier kann erst gelöscht werden, wenn keine Mitglieder mehr zugeordnet sind.' }, 409);
      const deleted = await revierStore.deleteRevier(id);
      if (!deleted) return context.json({ message: 'Revier nicht gefunden.' }, 404);
      await authStore.removeRevierAssignments(id);
      return context.json({ message: 'Revier gelöscht.' });
   });
}
