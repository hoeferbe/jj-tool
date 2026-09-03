import { z } from 'zod';

export const killEntrySchema = z.object({
   datum: z.string().date(),
   wildart: z.string().trim().min(2).max(120),
   notiz: z.string().trim().max(2000).optional(),
});
