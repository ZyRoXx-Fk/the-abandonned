import { z } from "zod";

export const saveBusinessProfileInputShape = {
  name: z
    .string()
    .min(2, "Business name must be at least 2 characters")
    .describe("Name of the restaurant or local business"),
  cuisine: z
    .string()
    .min(2, "Cuisine must be at least 2 characters")
    .describe("Primary cuisine type (e.g., Swiss, Italian, Brasserie, Japanese)"),
  address: z
    .string()
    .min(3, "Address must be at least 3 characters")
    .describe("Physical address of the restaurant in Basel"),
  baseCapacity: z
    .number()
    .min(1, "Base capacity must be at least 1")
    .describe("Maximum seating capacity of the restaurant"),
  amenities: z
    .array(z.string())
    .optional()
    .default([])
    .describe("List of amenities (e.g. ['terrace', 'dog_friendly', 'wifi', 'accessible'])"),
  category: z
    .string()
    .optional()
    .default("restaurant")
    .describe("Category of business (default: 'restaurant')"),
  businessId: z
    .string()
    .optional()
    .describe("Optional existing business ID if updating an already registered business"),
  sessionId: z
    .string()
    .optional()
    .describe("Optional session UUID to associate with"),
  isTerraceOpen: z
    .boolean()
    .optional()
    .describe("Initial opening state of the outdoor terrace (defaults to true if 'terrace' is in amenities)"),
  availableSeats: z
    .number()
    .optional()
    .describe("Initial available seats (defaults to baseCapacity)"),
};

export const saveBusinessProfileSchema = z.object(saveBusinessProfileInputShape);

export type SaveBusinessProfileDTO = z.infer<typeof saveBusinessProfileSchema>;

export interface SaveBusinessProfileResultDTO {
  success: boolean;
  business: {
    id: string;
    ownerId: string;
    name: string;
    trustStatus: string;
    mcpProfile: {
      category: string;
      cuisine: string;
      address: string;
      baseCapacity: number;
      amenities: string[];
    };
    realtimeStatus: {
      isTerraceOpen: boolean;
      availableSeats: number;
      activeAlert: string;
      lastUpdated: string;
    };
  };
  message: string;
}
