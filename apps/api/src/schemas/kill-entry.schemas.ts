import { z } from 'zod';

export const KILL_ENTRY_GENDERS = ['maennlich', 'weiblich', 'unbekannt'] as const;
export type KillEntryGender = (typeof KILL_ENTRY_GENDERS)[number];
export const KILL_ENTRY_UTILIZATIONS = ['eigenverwertung', 'verkauf_gemeinde', 'verkauf_ausserhalb_gemeinde', 'jagdgemeinschaft_verkauf', 'keine_verwertung'] as const;
export type KillEntryUtilization = (typeof KILL_ENTRY_UTILIZATIONS)[number];
export const KILL_ENTRY_FEE_EXEMPTIONS = ['verkehrsopfer', 'hegeabschuss'] as const;
export type KillEntryFeeExemption = (typeof KILL_ENTRY_FEE_EXEMPTIONS)[number];

export const killEntrySchema = z.object({
   datum: z.string().date(),
   uhrzeit: z.preprocess((val) => {
      if (typeof val === 'string') {
         const trimmed = val.trim();
         if (!trimmed) return undefined;
         const parts = trimmed.split(':');
         if (parts.length >= 2) {
            const hh = parts[0]!.padStart(2, '0');
            const mm = parts[1]!.padStart(2, '0');
            return `${hh}:${mm}`;
         }
         return trimmed;
      }
      return val;
   }, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit muss im Format HH:mm sein').optional()),
   wildart: z.string().trim().min(2).max(120),
   unterart: z.string().trim().max(100).optional(),
   geschlecht: z.enum(KILL_ENTRY_GENDERS).optional(),
   verwertung: z.enum(KILL_ENTRY_UTILIZATIONS),
   kostenfreiArt: z.enum(KILL_ENTRY_FEE_EXEMPTIONS).optional(),
   istVerkehrsopfer: z.boolean().default(false),
   bescheinigung: z.boolean().default(false),
   ortName: z.string().trim().max(200).optional(),
   position: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
   }).optional(),
   gewicht: z.number().min(0).max(1000).optional(),
   geschaetztesAlter: z.string().trim().max(100).optional(),
   notiz: z.string().trim().max(2000).optional(),
});

export const updateKillEntrySchema = killEntrySchema.partial();
