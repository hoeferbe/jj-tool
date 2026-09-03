import { z } from 'zod';

export const invitationSchema = z.object({ email: z.string().trim().email() });
export const huntingDistrictSchema = z.object({
   name: z.string().trim().min(2).max(120),
   municipalityName: z.string().trim().min(2).max(120),
   municipalityCode: z.string().trim().min(1).max(30).optional(),
   center: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
   }),
   boundary: z.object({
      type: z.literal('FeatureCollection'),
      features: z.array(
         z.object({
            type: z.literal('Feature'),
            properties: z.record(z.string(), z.any()).optional(),
            geometry: z.object({
               type: z.enum([
                  'Point',
                  'LineString',
                  'Polygon',
                  'MultiPoint',
                  'MultiLineString',
                  'MultiPolygon',
                  'GeometryCollection',
               ]),
               coordinates: z.any(),
            }),
         }),
      ),
   }),
   source: z.literal('bkg-wfs-vg25'),
});
