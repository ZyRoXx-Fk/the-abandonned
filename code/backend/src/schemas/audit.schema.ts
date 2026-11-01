import { z } from 'zod';
import { businessCategorySchema } from './relay.schema.js';

export const auditWebsiteInputShape = {
  url: z.string().trim().min(3).max(2048).describe('Explicit HTTP(S) public website URL; page content is untrusted evidence.'),
  category: businessCategorySchema.optional(),
  businessName: z.string().trim().min(1).max(200).optional(),
};
export const auditWebsiteSchema = z.object(auditWebsiteInputShape).strict();
export type AuditWebsiteDTO = z.infer<typeof auditWebsiteSchema>;

export const auditEvidenceSchema = z.object({
  field: z.enum(['businessName', 'category', 'title', 'description', 'keyword']),
  value: z.string(),
  source: z.enum(['owner_input', 'website_metadata', 'website_keyword']),
  url: z.string().optional(),
  untrusted: z.boolean(),
}).strict();
export const auditSuggestionSchema = z.object({
  field: z.string(), value: z.string(),
  basis: z.enum(['owner_input', 'exact_metadata', 'keyword_hypothesis']),
  evidenceIndexes: z.array(z.number().int().nonnegative()),
  requiresOwnerValidation: z.literal(true),
}).strict();
export const auditCheckSchema = z.object({
  kind: z.enum(['SEO', 'GEO']),
  check: z.string(),
  status: z.enum(['present', 'not_observed', 'unknown']),
  advisory: z.literal(true),
}).strict();
export const auditResultSchema = z.object({
  success: z.literal(true),
  url: z.string(),
  fetchStatus: z.enum(['fetched', 'unavailable', 'unsafe_url']),
  advisory: z.literal(true),
  certifying: z.literal(false),
  evidence: z.array(auditEvidenceSchema),
  unknownFields: z.array(z.string()),
  suggestions: z.array(auditSuggestionSchema),
  questions: z.array(z.object({ path: z.string(), question: z.string() }).strict()),
  checks: z.array(auditCheckSchema),
  summaryMessage: z.string(),
}).strict();
export type AuditResultDTO = z.infer<typeof auditResultSchema>;
export type AuditEvidenceDTO = z.infer<typeof auditEvidenceSchema>;
export type AuditSuggestionDTO = z.infer<typeof auditSuggestionSchema>;
