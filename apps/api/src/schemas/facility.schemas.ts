import { z } from 'zod';
import { FACILITY_STATUSES, FACILITY_TYPES } from '../facility-store.js';

export const facilitySchema = z.object({
   name: z.string().trim().min(2).max(120),
   typ: z.enum(FACILITY_TYPES),
   position: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
   }),
   status: z.enum(FACILITY_STATUSES).default('aktiv'),
   zustandsInfo: z.string().trim().max(1000).optional(),
   notiz: z.string().trim().max(1000).optional(),
});
