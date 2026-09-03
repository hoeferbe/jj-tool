import { z } from 'zod';
import { AUFGABE_STATUS } from '../jagdeinrichtung-aufgaben-store.js';

export const aufgabeSchema = z.object({
   jagdeinrichtungId: z.string().uuid(),
   titel: z.string().trim().min(2).max(160),
   beschreibung: z.string().trim().max(2000).optional(),
   status: z.enum(AUFGABE_STATUS).default('offen'),
   assignedTo: z.string().uuid().optional(),
});
export const aufgabeUpdateSchema = z.object({
   titel: z.string().trim().min(2).max(160).optional(),
   beschreibung: z.string().trim().max(2000).optional(),
   status: z.enum(AUFGABE_STATUS).optional(),
   assignedTo: z.string().uuid().nullable().optional(),
});
