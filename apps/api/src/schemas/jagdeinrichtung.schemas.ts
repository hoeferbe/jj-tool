import { z } from 'zod';
import { JAGDEINRICHTUNG_STATUS, JAGDEINRICHTUNG_TYPEN } from '../jagdeinrichtung-store.js';

export const jagdeinrichtungSchema = z.object({
   name: z.string().trim().min(2).max(120),
   typ: z.enum(JAGDEINRICHTUNG_TYPEN),
   position: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
   }),
   status: z.enum(JAGDEINRICHTUNG_STATUS).default('aktiv'),
   zustandsInfo: z.string().trim().max(1000).optional(),
   notiz: z.string().trim().max(1000).optional(),
});
