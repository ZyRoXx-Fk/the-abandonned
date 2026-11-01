import { z, ZodError } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { relayErrorCodeSchema } from '../schemas/relay.schema.js';
import { RelayError } from '../utils/relay-error.js';

// SDK skips output validation for isError; tests explicitly validate both envelope branches.
export const toolResultSchema = z.object({
  ok: z.boolean(), data: z.unknown().optional(),
  error: z.object({ code: relayErrorCodeSchema, message: z.string(), details: z.unknown().optional() }).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.ok ? value.error !== undefined || !('data' in value) : value.error === undefined || 'data' in value) {
    ctx.addIssue({ code: 'custom', message: 'Expected success data or safe error, exclusively.' });
  }
});
export async function toToolResult(work: () => Promise<unknown>): Promise<CallToolResult> {
  let envelope: z.infer<typeof toolResultSchema>;
  try {
    // Serialization failures are unknown failures too, never SDK-visible internal messages.
    envelope = JSON.parse(JSON.stringify({ ok: true, data: (await work()) ?? null }));
  }
  catch (error) {
    envelope = { ok: false, error: error instanceof RelayError
      ? { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) }
      : error instanceof ZodError ? { code: 'VALIDATION_ERROR', message: 'Invalid request fields.' }
      : { code: 'UNAVAILABLE', message: 'Request could not be completed. Please retry safely.' } };
  }
  // Normalize Dates/undefined identically in both protocol representations.
  const text = JSON.stringify(envelope);
  return { ...(envelope.ok ? {} : { isError: true }), structuredContent: JSON.parse(text), content: [{ type: 'text', text }] };
}
