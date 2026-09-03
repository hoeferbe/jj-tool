import { z } from 'zod';
import { TASK_STATUSES } from '../facility-tasks-store.js';

export const taskSchema = z.object({
   jagdeinrichtungId: z.string().uuid(),
   titel: z.string().trim().min(2).max(160),
   beschreibung: z.string().trim().max(2000).optional(),
   status: z.enum(TASK_STATUSES).default('offen'),
   assignedTo: z.string().uuid().optional(),
});
export const taskUpdateSchema = z.object({
   titel: z.string().trim().min(2).max(160).optional(),
   beschreibung: z.string().trim().max(2000).optional(),
   status: z.enum(TASK_STATUSES).optional(),
   assignedTo: z.string().uuid().nullable().optional(),
});
