import { z } from 'zod';

export const ROLES = ['guest', 'paechter', 'bgs', 'admin'] as const;
export const POSITIONS = ['revierleiter', 'kassenwart', 'schriftfuehrer'] as const;

export const registrationSchema = z.object({
   username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
   email: z.string().trim().email(),
   displayName: z.string().trim().min(2).max(80),
   revierId: z.string().uuid().optional(),
   invitationToken: z.string().min(20).optional(),
});
export const loginSchema = z.object({
   identifier: z.string().trim().min(3),
   password: z.string().min(1),
});
export const emailSchema = z.object({ email: z.string().trim().email() });
export const passwordSchema = z.object({
   token: z.string().min(1),
   password: z.string().min(12).max(128),
});
export const approveSchema = z.object({
   role: z.enum(ROLES).default('paechter'),
   position: z.enum(POSITIONS).optional(),
   isAdmin: z.boolean().optional(),
   revierIds: z.array(z.string().uuid()).default([]),
});
export const updateRoleSchema = z.object({
   role: z.enum(ROLES),
   position: z.enum(POSITIONS).optional(),
   isAdmin: z.boolean().optional(),
   revierIds: z.array(z.string().uuid()).optional(),
});
export const updateUserStatusSchema = z.object({ blocked: z.boolean() });
export const membershipSchema = z.object({
   memberType: z.enum(['paechter', 'bgs', 'guest']),
   position: z.enum(POSITIONS).optional(),
   isAdmin: z.boolean().default(false),
   status: z.enum(['pending', 'active']).default('active'),
});
