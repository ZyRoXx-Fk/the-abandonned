import { z } from "zod";

export const auditWebsiteInputShape = {
  url: z
    .string()
    .min(3, "URL or domain name is required")
    .describe("Website URL of the restaurant to audit (e.g. 'https://restaurant-basel.ch' or demo domain)"),
  businessName: z
    .string()
    .optional()
    .describe("Optional known business/restaurant name"),
};

export const auditWebsiteSchema = z.object(auditWebsiteInputShape);

export type AuditWebsiteDTO = z.infer<typeof auditWebsiteSchema>;

export interface DraftMcpProfile {
  name: string;
  category: string;
  cuisine: string;
  address: string;
  baseCapacity: number;
  amenities: string[];
}

export interface AuditReportDTO {
  isWebsiteLegacy: boolean;
  seoScore: number;
  agentReadinessScore: number;
  missingData: string[];
  detectedData: {
    title?: string;
    description?: string;
    hasSchemaOrg: boolean;
    hasOpenGraph: boolean;
    hasViewport: boolean;
    detectedKeywords: string[];
  };
  recommendations: string[];
  suggestedQuestionsForOwner: string[];
  draftMcpProfile: DraftMcpProfile;
}

export interface AuditResultDTO {
  success: boolean;
  url: string;
  report: AuditReportDTO;
  summaryMessage: string;
}
