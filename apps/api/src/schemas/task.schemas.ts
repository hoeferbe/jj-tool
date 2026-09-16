import { z } from 'zod';
import { TASK_PRIORITIES, TASK_STATUSES } from '../facility-tasks-store.js';

export const taskSchema = z.object({
   jagdeinrichtungId: z.string().uuid().optional(),
   titel: z.string().trim().min(2).max(160),
   beschreibung: z.string().trim().max(2000).optional(),
   faelligAm: z.string().date().optional(),
   prioritaet: z.enum(TASK_PRIORITIES).default('normal'),
   status: z.enum(TASK_STATUSES).default('offen'),
   assignedTo: z.string().uuid().optional(),
});
export const taskUpdateSchema = z.object({
   titel: z.string().trim().min(2).max(160).optional(),
   beschreibung: z.string().trim().max(2000).nullable().optional(),
   faelligAm: z.string().date().nullable().optional(),
   prioritaet: z.enum(TASK_PRIORITIES).optional(),
   status: z.enum(TASK_STATUSES).optional(),
   assignedTo: z.string().uuid().nullable().optional(),
});
