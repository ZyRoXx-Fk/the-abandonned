import { z } from "zod";
import {
  boundedText,
  businessCategorySchema,
  contactInfoSchema,
  currencySchema,
  draftContactInfoSchema,
  isoDateTimeSchema,
  localDateSchema,
  metadataEntrySchema,
  moneySchema,
  nonNegativeSafeIntegerSchema,
  openingHoursSchema,
  positiveSafeIntegerSchema,
  relayIdSchema,
  serviceHoursSchema,
  shortCodeSchema,
  timeOfDaySchema,
  timeRangeSchema,
  timeZoneSchema,
  urlSchema,
} from "./relay.schema.js";
import { proposalViewSchema } from "./action.schema.js";

const amenitySchema = shortCodeSchema;
const policySchema = boundedText(500);
const priceDescriptionSchema = boundedText(280);
const timestampedAvailabilityUpdatedAtSchema = isoDateTimeSchema;

const restaurantCategoryConfigSchema = z.object({
  kind: z.literal("restaurant"),
  cuisine: boundedText(80),
  amenities: z.array(amenitySchema).max(20).default([]),
  reservationPolicy: policySchema.optional(),
}).strict();

const hotelCategoryConfigSchema = z.object({
  kind: z.literal("hotel"),
  amenities: z.array(amenitySchema).max(20).default([]),
  checkInWindow: timeRangeSchema.optional(),
  checkOutWindow: timeRangeSchema.optional(),
}).strict();

const shopCategoryConfigSchema = z.object({
  kind: z.literal("shop"),
  amenities: z.array(amenitySchema).max(20).default([]),
  pickupNotes: boundedText(500).optional(),
}).strict();

const categoryConfigSchema = z.discriminatedUnion("kind", [
  restaurantCategoryConfigSchema,
  hotelCategoryConfigSchema,
  shopCategoryConfigSchema,
]);

const draftRestaurantCategoryConfigSchema = z.object({
  kind: z.literal("restaurant"),
  cuisine: boundedText(80).optional(),
  amenities: z.array(amenitySchema).max(20).optional(),
  reservationPolicy: policySchema.optional(),
}).strict();

const draftHotelCategoryConfigSchema = z.object({
  kind: z.literal("hotel"),
  amenities: z.array(amenitySchema).max(20).optional(),
  checkInWindow: timeRangeSchema.optional(),
  checkOutWindow: timeRangeSchema.optional(),
}).strict();

const draftShopCategoryConfigSchema = z.object({
  kind: z.literal("shop"),
  amenities: z.array(amenitySchema).max(20).optional(),
  pickupNotes: boundedText(500).optional(),
}).strict();

const draftCategoryConfigSchema = z.discriminatedUnion("kind", [
  draftRestaurantCategoryConfigSchema,
  draftHotelCategoryConfigSchema,
  draftShopCategoryConfigSchema,
]);

const businessProfileSchemaBase = z.object({
  name: boundedText(120),
  address: boundedText(240),
  description: boundedText(2000),
  contact: contactInfoSchema,
  timezone: timeZoneSchema,
  currency: currencySchema,
  openingHours: openingHoursSchema.min(1),
  serviceHours: serviceHoursSchema.min(1),
  finalPriceDescription: priceDescriptionSchema,
  policies: z.array(policySchema).min(1).max(20),
  categoryConfig: categoryConfigSchema,
}).strict();

const draftBusinessProfileSchema = z.object({
  name: boundedText(120).optional(),
  address: boundedText(240).optional(),
  description: boundedText(2000).optional(),
  contact: draftContactInfoSchema.optional(),
  timezone: timeZoneSchema.optional(),
  currency: currencySchema.optional(),
  openingHours: openingHoursSchema.optional(),
  serviceHours: serviceHoursSchema.optional(),
  finalPriceDescription: priceDescriptionSchema.optional(),
  policies: z.array(policySchema).max(20).optional(),
  categoryConfig: draftCategoryConfigSchema.optional(),
}).strict();

const sellableVariantSchema = z.object({
  id: relayIdSchema,
  name: boundedText(120),
  description: boundedText(500).optional(),
  unitPrice: moneySchema,
  metadata: z.array(metadataEntrySchema).max(20).default([]),
}).strict();

const menuItemOfferingSchema = z.object({
  kind: z.literal("menu_item"),
  id: relayIdSchema,
  active: z.boolean(),
  name: boundedText(120),
  description: boundedText(2000).optional(),
  variants: z.array(sellableVariantSchema).min(1).max(50),
  metadata: z.array(metadataEntrySchema).max(20).default([]),
}).strict();

const roomTypeOfferingSchema = z.object({
  kind: z.literal("room_type"),
  id: relayIdSchema,
  active: z.boolean(),
  name: boundedText(120),
  description: boundedText(2000).optional(),
  maxGuests: positiveSafeIntegerSchema.max(12),
  nightlyRate: moneySchema,
  metadata: z.array(metadataEntrySchema).max(20).default([]),
}).strict();

const productOfferingSchema = z.object({
  kind: z.literal("product"),
  id: relayIdSchema,
  active: z.boolean(),
  name: boundedText(120),
  description: boundedText(2000).optional(),
  variants: z.array(sellableVariantSchema).min(1).max(50),
  metadata: z.array(metadataEntrySchema).max(20).default([]),
}).strict();

export const offeringInputSchema = z.discriminatedUnion("kind", [
  menuItemOfferingSchema,
  roomTypeOfferingSchema,
  productOfferingSchema,
]);

const sellableVariantInventorySchema = z.object({
  kind: z.literal("sellable_variant"),
  id: relayIdSchema,
  offeringId: relayIdSchema,
  variantId: relayIdSchema,
  remainingUnits: nonNegativeSafeIntegerSchema,
  expectedRevision: nonNegativeSafeIntegerSchema.optional(),
  metadata: z.array(metadataEntrySchema).max(20).default([]),
}).strict();

const restaurantSlotInventorySchema = z.object({
  kind: z.literal("restaurant_slot"),
  id: relayIdSchema,
  slotDate: localDateSchema,
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  totalSeats: positiveSafeIntegerSchema.max(500),
  minPartySize: positiveSafeIntegerSchema.max(100),
  maxPartySize: positiveSafeIntegerSchema.max(100),
  expectedRevision: nonNegativeSafeIntegerSchema.optional(),
  metadata: z.array(metadataEntrySchema).max(20).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.endTime <= value.startTime) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "endTime must be after startTime" });
  }
  if (value.maxPartySize < value.minPartySize) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxPartySize"], message: "maxPartySize must be at least minPartySize" });
  }
  if (value.totalSeats < value.maxPartySize) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalSeats"], message: "totalSeats must cover the largest party size" });
  }
});

const roomNightInventorySchema = z.object({
  kind: z.literal("room_night"),
  id: relayIdSchema,
  roomTypeId: relayIdSchema,
  localNight: localDateSchema,
  totalRooms: nonNegativeSafeIntegerSchema.max(1000),
  expectedRevision: nonNegativeSafeIntegerSchema.optional(),
  metadata: z.array(metadataEntrySchema).max(20).default([]),
}).strict();

export const inventoryInputSchema = z.discriminatedUnion("kind", [
  sellableVariantInventorySchema,
  restaurantSlotInventorySchema,
  roomNightInventorySchema,
]);

const suggestedValueSchema = z.union([
  boundedText(500),
  z.boolean(),
  nonNegativeSafeIntegerSchema,
  z.array(boundedText(120)).max(20),
]);

const missingFieldSchema = z.object({
  path: boundedText(160),
  question: boundedText(280),
}).strict();

const auditTrailEntrySchema = z.object({
  sourceUrl: urlSchema.optional(),
  observedAt: isoDateTimeSchema,
  notes: z.array(boundedText(500)).max(20).default([]),
  missingFields: z.array(missingFieldSchema).max(50).default([]),
  suggestedValues: z.array(z.object({
    path: boundedText(160),
    value: suggestedValueSchema,
  }).strict()).max(50).default([]),
}).strict();

function offeringMatchesCategory(category: z.infer<typeof businessCategorySchema>, offeringKind: z.infer<typeof offeringInputSchema>["kind"]): boolean {
  if (category === "restaurant") {
    return offeringKind === "menu_item";
  }
  if (category === "hotel") {
    return offeringKind === "room_type";
  }
  return offeringKind === "product";
}

function inventoryMatchesCategory(category: z.infer<typeof businessCategorySchema>, inventoryKind: z.infer<typeof inventoryInputSchema>["kind"]): boolean {
  if (category === "restaurant") {
    return inventoryKind === "sellable_variant" || inventoryKind === "restaurant_slot";
  }
  if (category === "hotel") {
    return inventoryKind === "room_night";
  }
  return inventoryKind === "sellable_variant";
}

function refineOfferingCurrencies(
  businessCurrency: string | undefined,
  offerings: z.infer<typeof offeringInputSchema>[],
  ctx: z.RefinementCtx,
): void {
  if (!businessCurrency) {
    return;
  }

  offerings.forEach((offering, offeringIndex) => {
    if (offering.kind === "room_type") {
      if (offering.nightlyRate.currency !== businessCurrency) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["offerings", offeringIndex, "nightlyRate", "currency"],
          message: "Offering prices must match the business currency",
        });
      }
      return;
    }

    offering.variants.forEach((variant, variantIndex) => {
      if (variant.unitPrice.currency !== businessCurrency) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["offerings", offeringIndex, "variants", variantIndex, "unitPrice", "currency"],
          message: "Offering prices must match the business currency",
        });
      }
    });
  });
}

export const businessDraftSchema = z.object({
  id: relayIdSchema,
  businessId: relayIdSchema,
  ownerId: relayIdSchema,
  category: businessCategorySchema,
  revision: nonNegativeSafeIntegerSchema,
  // Frozen when the draft is created; profile edits must not rebase competing publications.
  baseBusinessRevision: nonNegativeSafeIntegerSchema.default(0),
  profile: draftBusinessProfileSchema,
  offerings: z.array(offeringInputSchema).max(200),
  inventoryEdits: z.array(inventoryInputSchema).max(1000),
  auditTrail: z.array(auditTrailEntrySchema).max(50),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict().superRefine((draft, ctx) => {
  if (draft.profile.categoryConfig && draft.profile.categoryConfig.kind !== draft.category) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["profile", "categoryConfig", "kind"],
      message: "Draft category configuration must match the draft category",
    });
  }

  draft.offerings.forEach((offering, index) => {
    if (!offeringMatchesCategory(draft.category, offering.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offerings", index, "kind"],
        message: `Offering kind ${offering.kind} is not valid for ${draft.category}`,
      });
    }
  });

  refineOfferingCurrencies(draft.profile.currency, draft.offerings, ctx);

  draft.inventoryEdits.forEach((inventory, index) => {
    if (!inventoryMatchesCategory(draft.category, inventory.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inventoryEdits", index, "kind"],
        message: `Inventory kind ${inventory.kind} is not valid for ${draft.category}`,
      });
    }
  });
});

export const draftPatchSchema = z.object({
  profile: draftBusinessProfileSchema.optional(),
  offeringEdits: z.object({
    upsert: z.array(offeringInputSchema).max(200).default([]),
    removeIds: z.array(relayIdSchema).max(200).default([]),
  }).strict().optional(),
  inventoryEdits: z.object({
    upsert: z.array(inventoryInputSchema).max(1000).default([]),
    removeIds: z.array(relayIdSchema).max(1000).default([]),
  }).strict().optional(),
}).strict().refine(
  (value) => value.profile !== undefined || value.offeringEdits !== undefined || value.inventoryEdits !== undefined,
  { message: "Draft patch must change at least one allowlisted field" },
);

export const draftPreviewSchema = z.object({
  draft: businessDraftSchema,
  missingFields: z.array(missingFieldSchema).max(50),
  proposal: proposalViewSchema.nullable(),
}).strict();

const publicVariantAvailabilitySchema = z.object({
  kind: z.literal("sellable_variant"),
  offeringId: relayIdSchema,
  variantId: relayIdSchema,
  availableUnits: nonNegativeSafeIntegerSchema,
  updatedAt: timestampedAvailabilityUpdatedAtSchema,
}).strict();

const publicRestaurantSlotAvailabilitySchema = z.object({
  kind: z.literal("restaurant_slot"),
  slotId: relayIdSchema,
  slotDate: localDateSchema,
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  availableSeats: nonNegativeSafeIntegerSchema,
  minPartySize: positiveSafeIntegerSchema,
  maxPartySize: positiveSafeIntegerSchema,
  updatedAt: timestampedAvailabilityUpdatedAtSchema,
}).strict();

const publicRoomNightAvailabilitySchema = z.object({
  kind: z.literal("room_night"),
  roomTypeId: relayIdSchema,
  localNight: localDateSchema,
  availableRooms: nonNegativeSafeIntegerSchema,
  updatedAt: timestampedAvailabilityUpdatedAtSchema,
}).strict();

const publicAvailabilitySchema = z.discriminatedUnion("kind", [
  publicVariantAvailabilitySchema,
  publicRestaurantSlotAvailabilitySchema,
  publicRoomNightAvailabilitySchema,
]);

export const publicBusinessSchema = z.object({
  businessId: relayIdSchema,
  category: businessCategorySchema,
  revision: nonNegativeSafeIntegerSchema,
  profile: businessProfileSchemaBase,
  offerings: z.array(offeringInputSchema).min(1).max(200),
  availability: z.array(publicAvailabilitySchema).max(1000),
  publishedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict().superRefine((business, ctx) => {
  if (business.profile.categoryConfig.kind !== business.category) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["profile", "categoryConfig", "kind"],
      message: "Published business category configuration must match the business category",
    });
  }
  business.offerings.forEach((offering, index) => {
    if (!offeringMatchesCategory(business.category, offering.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offerings", index, "kind"],
        message: `Offering kind ${offering.kind} is not valid for ${business.category}`,
      });
    }
  });

  refineOfferingCurrencies(business.profile.currency, business.offerings, ctx);
});

const publicBusinessSummarySchema = z.object({
  businessId: relayIdSchema,
  category: businessCategorySchema,
  name: boundedText(120),
  address: boundedText(240),
  description: boundedText(2000),
  currency: currencySchema,
  timezone: timeZoneSchema,
  amenities: z.array(amenitySchema).max(20),
  revision: nonNegativeSafeIntegerSchema,
  publishedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

export const businessQuerySchema = z.object({
  category: businessCategorySchema.optional(),
  text: boundedText(200).optional(),
  addressText: boundedText(200).optional(),
  amenities: z.array(amenitySchema).max(20).default([]),
  offset: nonNegativeSafeIntegerSchema.default(0),
  limit: positiveSafeIntegerSchema.max(50).default(10),
}).strict();

export const businessPageSchema = z.object({
  items: z.array(publicBusinessSummarySchema).max(50),
  offset: nonNegativeSafeIntegerSchema,
  limit: positiveSafeIntegerSchema.max(50),
  total: nonNegativeSafeIntegerSchema,
}).strict();

export type BusinessProfile = z.infer<typeof businessProfileSchemaBase>;
export type DraftBusinessProfile = z.infer<typeof draftBusinessProfileSchema>;
export type OfferingInput = z.infer<typeof offeringInputSchema>;
export type InventoryInput = z.infer<typeof inventoryInputSchema>;
export type BusinessDraft = z.infer<typeof businessDraftSchema>;
export type DraftPatch = z.infer<typeof draftPatchSchema>;
export type DraftPreview = z.infer<typeof draftPreviewSchema>;
export type PublicBusiness = z.infer<typeof publicBusinessSchema>;
export type BusinessQuery = z.infer<typeof businessQuerySchema>;
export type BusinessPage = z.infer<typeof businessPageSchema>;
