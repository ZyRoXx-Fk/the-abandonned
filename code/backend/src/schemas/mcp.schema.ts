import { z } from 'zod';
// Strict parsing matters: caller-supplied session IDs/IPs must never override transport context.
export const pairSessionSchema = z.strictObject({ token: z.string().min(1).max(128) });
