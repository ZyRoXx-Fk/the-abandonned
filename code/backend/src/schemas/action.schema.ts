import { z } from "zod";
import { enumerateNights } from "../utils/local-date.js";
import {
  boundedText,
  checkedAddMinorUnits,
  checkedMultiplyMinorUnits,
  isoDateTimeSchema,
  localDateSchema,
  moneySchema,
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
  principalSchema,
  relayIdSchema,
  timeOfDaySchema,
} from "./relay.schema.js";

const proposalKindSchema = z.enum(["publication", "order", "restaurant_booking", "hotel_booking", "reservation_amendment"]);
const proposalStateSchema = z.enum(["pending", "committed"]);
const paymentStatusSchema = z.enum(["not_collected_demo", "not_applicable"]);
const confirmedStatusSchema = z.literal("confirmed");
const policySchema = boundedText(500);
const paymentNoticeSchema = boundedText(280);
const chargeDescriptionSchema = boundedText(280);

const orderItemInputSchema = z.object({
  offeringId: relayIdSchema,
  variantId: relayIdSchema,
  quantity: positiveSafeIntegerSchema.max(1000),
}).strict();

const orderActionSchema = z.object({
  kind: z.literal("order"),
  businessId: relayIdSchema,
  items: z.array(orderItemInputSchema).min(1).max(100),
  pickupAt: isoDateTimeSchema,
}).strict();

const restaurantBookingActionSchema = z.object({
  kind: z.literal("restaurant_booking"),
  businessId: relayIdSchema,
  slotId: relayIdSchema,
  partySize: positiveSafeIntegerSchema.max(100),
}).strict();

const hotelBookingActionSchema = z.object({
  kind: z.literal("hotel_booking"),
  businessId: relayIdSchema,
  roomTypeId: relayIdSchema,
  checkIn: localDateSchema,
  checkOut: localDateSchema,
  guests: positiveSafeIntegerSchema.max(12),
}).strict().superRefine((value, ctx) => {
  if (value.checkOut <= value.checkIn) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checkOut"], message: "checkOut must be after checkIn" });
  }
});

export const customerActionSchema = z.discriminatedUnion("kind", [
  orderActionSchema,
  restaurantBookingActionSchema,
  hotelBookingActionSchema,
]);

const restaurantAmendmentSchema = z.object({
  kind: z.literal("restaurant_booking"),
  reservationId: relayIdSchema,
  expectedReservationRevision: nonNegativeSafeIntegerSchema,
  slotId: relayIdSchema,
  partySize: positiveSafeIntegerSchema.max(100),
}).strict();

const hotelAmendmentSchema = z.object({
  kind: z.literal("hotel_booking"),
  reservationId: relayIdSchema,
  expectedReservationRevision: nonNegativeSafeIntegerSchema,
  checkIn: localDateSchema,
  checkOut: localDateSchema,
  guests: positiveSafeIntegerSchema.max(12),
}).strict().superRefine((value, ctx) => {
  if (value.checkOut <= value.checkIn) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checkOut"], message: "checkOut must be after checkIn" });
  }
});

export const amendmentSchema = z.discriminatedUnion("kind", [
  restaurantAmendmentSchema,
  hotelAmendmentSchema,
]);

export const approvalSchema = z.object({
  proposalId: relayIdSchema,
  revision: nonNegativeSafeIntegerSchema,
  approved: z.literal(true),
}).strict();

const orderSummaryLineSchema = z.object({
  offeringId: relayIdSchema,
  variantId: relayIdSchema,
  name: boundedText(120),
  quantity: positiveSafeIntegerSchema.max(1000),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
}).strict().superRefine((value, ctx) => {
  if (value.unitPrice.currency !== value.lineTotal.currency) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lineTotal", "currency"], message: "lineTotal currency must match unitPrice currency" });
    return;
  }

  let expectedTotal: number;
  try {
    expectedTotal = checkedMultiplyMinorUnits(value.unitPrice.amountMinor, value.quantity);
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lineTotal", "amountMinor"], message: error instanceof Error ? error.message : "Invalid line total" });
    return;
  }

  if (value.lineTotal.amountMinor !== expectedTotal) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lineTotal", "amountMinor"], message: "lineTotal.amountMinor must equal unitPrice.amountMinor × quantity" });
  }
});

const orderSummarySchema = z.object({
  kind: z.literal("order"),
  businessId: relayIdSchema,
  items: z.array(orderSummaryLineSchema).min(1).max(100),
  totalPrice: moneySchema,
  pickupAt: isoDateTimeSchema,
  chargeDescription: chargeDescriptionSchema,
  policies: z.array(policySchema).max(20),
  paymentNotice: paymentNoticeSchema,
}).strict().superRefine((value, ctx) => {
  const [firstItem] = value.items;
  if (!firstItem) {
    return;
  }

  if (value.totalPrice.currency !== firstItem.unitPrice.currency) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalPrice", "currency"], message: "totalPrice currency must match the line item currency" });
    return;
  }

  if (value.items.some((item) => item.unitPrice.currency !== value.totalPrice.currency || item.lineTotal.currency !== value.totalPrice.currency)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "All order money values must share the same currency" });
    return;
  }

  let expectedTotal: number;
  try {
    expectedTotal = checkedAddMinorUnits(value.items.map((item) => item.lineTotal.amountMinor));
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalPrice", "amountMinor"], message: error instanceof Error ? error.message : "Invalid total price" });
    return;
  }

  if (value.totalPrice.amountMinor !== expectedTotal) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalPrice", "amountMinor"], message: "totalPrice.amountMinor must equal the sum of line totals" });
  }
});

const restaurantBookingSummarySchema = z.object({
  kind: z.literal("restaurant_booking"),
  businessId: relayIdSchema,
  slotId: relayIdSchema,
  slotDate: localDateSchema,
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  partySize: positiveSafeIntegerSchema.max(100),
  // Up to 20 common policies plus the separately published reservation policy.
  policies: z.array(policySchema).max(21),
  paymentNotice: paymentNoticeSchema,
}).strict().superRefine((value, ctx) => {
  if (value.endTime <= value.startTime) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "endTime must be after startTime" });
  }
});

const hotelStaySummaryFields = {
  checkIn: localDateSchema,
  checkOut: localDateSchema,
  nights: z.array(localDateSchema).min(1).max(60),
  guests: positiveSafeIntegerSchema.max(12),
  nightlyRate: moneySchema,
  totalPrice: moneySchema,
  chargeDescription: chargeDescriptionSchema,
  policies: z.array(policySchema).max(20),
  paymentNotice: paymentNoticeSchema,
} as const;

type HotelStaySummary = {
  checkIn: string;
  checkOut: string;
  nights: string[];
  guests: number;
  nightlyRate: z.infer<typeof moneySchema>;
  totalPrice: z.infer<typeof moneySchema>;
  chargeDescription: string;
  policies: string[];
  paymentNotice: string;
};

function refineHotelStaySummary(value: HotelStaySummary, ctx: z.RefinementCtx): void {
  let expectedNights: string[];
  try {
    expectedNights = enumerateNights(value.checkIn, value.checkOut);
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checkOut"], message: error instanceof Error ? error.message : "Invalid stay" });
    return;
  }

  if (value.nightlyRate.currency !== value.totalPrice.currency) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalPrice", "currency"], message: "totalPrice currency must match nightlyRate currency" });
    return;
  }

  if (value.nights.length !== expectedNights.length || value.nights.some((night, index) => night !== expectedNights[index])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nights"], message: "nights must enumerate each local calendar night from checkIn to checkOut" });
  }

  let expectedTotal: number;
  try {
    expectedTotal = checkedMultiplyMinorUnits(value.nightlyRate.amountMinor, expectedNights.length);
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalPrice", "amountMinor"], message: error instanceof Error ? error.message : "Invalid total price" });
    return;
  }

  if (value.totalPrice.amountMinor !== expectedTotal) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalPrice", "amountMinor"], message: "totalPrice.amountMinor must equal nightlyRate.amountMinor × number of nights" });
  }
}

const hotelBookingSummarySchema = z.object({
  kind: z.literal("hotel_booking"),
  businessId: relayIdSchema,
  roomTypeId: relayIdSchema,
  ...hotelStaySummaryFields,
}).strict().superRefine(refineHotelStaySummary);

const actionSummarySchema = z.discriminatedUnion("kind", [
  orderSummarySchema,
  restaurantBookingSummarySchema,
  hotelBookingSummarySchema,
]);

const publicationSummarySchema = z.object({
  kind: z.literal("publication"),
  businessId: relayIdSchema,
  category: z.enum(["restaurant", "hotel", "shop"]),
  revision: nonNegativeSafeIntegerSchema,
  name: boundedText(120),
}).strict();

const reservationAmendmentSummarySchema = z.discriminatedUnion("kind", [
  restaurantBookingSummarySchema.extend({
    reservationId: relayIdSchema,
    expectedReservationRevision: nonNegativeSafeIntegerSchema,
  }),
  hotelBookingSummarySchema.extend({
    reservationId: relayIdSchema,
    expectedReservationRevision: nonNegativeSafeIntegerSchema,
  }),
]);

const termsRevisionSchema = z.object({
  businessRevision: nonNegativeSafeIntegerSchema,
  offeringRevisions: z.array(z.object({
    id: relayIdSchema,
    revision: nonNegativeSafeIntegerSchema,
  }).strict()).max(200).default([]),
  inventoryRevisions: z.array(z.object({
    key: relayIdSchema,
    revision: nonNegativeSafeIntegerSchema,
  }).strict()).max(1000).default([]),
}).strict();

const publicationProposalPayloadSchema = z.object({
  kind: z.literal("publication"),
  draftId: relayIdSchema,
  businessId: relayIdSchema,
}).strict();

const proposalPayloadSchema = z.discriminatedUnion("kind", [
  publicationProposalPayloadSchema,
  customerActionSchema,
  z.object({
    kind: z.literal("reservation_amendment"),
    amendment: amendmentSchema,
  }).strict(),
]);

const proposalSummarySchema = z.discriminatedUnion("kind", [
  publicationSummarySchema,
  actionSummarySchema,
  z.object({
    kind: z.literal("reservation_amendment"),
    summary: reservationAmendmentSummarySchema,
  }).strict(),
]);

const publicationProposalRecordSchema = z.object({
  id: relayIdSchema,
  principal: principalSchema,
  revision: nonNegativeSafeIntegerSchema,
  kind: z.literal("publication"),
  payload: publicationProposalPayloadSchema,
  summary: publicationSummarySchema,
  termsRevision: termsRevisionSchema,
  expiresAt: isoDateTimeSchema,
  state: proposalStateSchema,
  durableResultRef: relayIdSchema.nullable(),
}).strict();

const orderProposalRecordSchema = z.object({
  id: relayIdSchema,
  principal: principalSchema,
  revision: nonNegativeSafeIntegerSchema,
  kind: z.literal("order"),
  payload: orderActionSchema,
  summary: orderSummarySchema,
  termsRevision: termsRevisionSchema,
  expiresAt: isoDateTimeSchema,
  state: proposalStateSchema,
  durableResultRef: relayIdSchema.nullable(),
}).strict();

const restaurantProposalRecordSchema = z.object({
  id: relayIdSchema,
  principal: principalSchema,
  revision: nonNegativeSafeIntegerSchema,
  kind: z.literal("restaurant_booking"),
  payload: restaurantBookingActionSchema,
  summary: restaurantBookingSummarySchema,
  termsRevision: termsRevisionSchema,
  expiresAt: isoDateTimeSchema,
  state: proposalStateSchema,
  durableResultRef: relayIdSchema.nullable(),
}).strict();

const hotelProposalRecordSchema = z.object({
  id: relayIdSchema,
  principal: principalSchema,
  revision: nonNegativeSafeIntegerSchema,
  kind: z.literal("hotel_booking"),
  payload: hotelBookingActionSchema,
  summary: hotelBookingSummarySchema,
  termsRevision: termsRevisionSchema,
  expiresAt: isoDateTimeSchema,
  state: proposalStateSchema,
  durableResultRef: relayIdSchema.nullable(),
}).strict();

const amendmentProposalRecordSchema = z.object({
  id: relayIdSchema,
  principal: principalSchema,
  revision: nonNegativeSafeIntegerSchema,
  kind: z.literal("reservation_amendment"),
  payload: z.object({
    kind: z.literal("reservation_amendment"),
    amendment: amendmentSchema,
  }).strict(),
  summary: z.object({
    kind: z.literal("reservation_amendment"),
    summary: reservationAmendmentSummarySchema,
  }).strict(),
  termsRevision: termsRevisionSchema,
  expiresAt: isoDateTimeSchema,
  state: proposalStateSchema,
  durableResultRef: relayIdSchema.nullable(),
}).strict();

export const proposalRecordSchema = z.discriminatedUnion("kind", [
  publicationProposalRecordSchema,
  orderProposalRecordSchema,
  restaurantProposalRecordSchema,
  hotelProposalRecordSchema,
  amendmentProposalRecordSchema,
]);

export const proposalViewSchema = z.discriminatedUnion("kind", [
  publicationProposalRecordSchema.omit({ principal: true, durableResultRef: true }),
  orderProposalRecordSchema.omit({ principal: true, durableResultRef: true }),
  restaurantProposalRecordSchema.omit({ principal: true, durableResultRef: true }),
  hotelProposalRecordSchema.omit({ principal: true, durableResultRef: true }),
  amendmentProposalRecordSchema.omit({ principal: true, durableResultRef: true }),
]);

export const actionResultSchema = z.object({
  id: relayIdSchema,
  reference: boundedText(64),
  kind: z.enum(["order", "restaurant_booking", "hotel_booking"]),
  revision: nonNegativeSafeIntegerSchema,
  status: confirmedStatusSchema,
  paymentStatus: paymentStatusSchema,
  summary: actionSummarySchema,
}).strict().superRefine((value, ctx) => {
  if (value.kind !== value.summary.kind) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["summary", "kind"], message: "summary.kind must match the action result kind" });
  }

  if (value.kind === "restaurant_booking") {
    if (value.paymentStatus !== "not_applicable") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["paymentStatus"], message: "Free restaurant bookings must use paymentStatus:not_applicable" });
    }
  } else if (value.paymentStatus !== "not_collected_demo") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["paymentStatus"], message: "Priced actions must use paymentStatus:not_collected_demo" });
  }
});

export const allocationChangeSchema = z.object({
  key: relayIdSchema,
  delta: z.number().int().safe(),
}).strict().refine((value) => value.delta !== 0, { message: "delta must not be zero", path: ["delta"] });

export const actionRecordSchema = z.object({
  clientId: relayIdSchema,
  businessId: relayIdSchema,
  proposalId: relayIdSchema,
  result: actionResultSchema,
  allocations: z.array(allocationChangeSchema).max(1000),
}).strict();

const publicationCommitResultSchema = z.object({
  kind: z.literal("publication"),
  businessId: relayIdSchema,
  revision: nonNegativeSafeIntegerSchema,
}).strict();

export const commitResultSchema = z.discriminatedUnion("kind", [
  publicationCommitResultSchema,
  actionResultSchema,
]);

export type CustomerActionInput = z.infer<typeof customerActionSchema>;
export type AmendmentInput = z.infer<typeof amendmentSchema>;
export type ApprovalInput = z.infer<typeof approvalSchema>;
export type ProposalRecord = z.infer<typeof proposalRecordSchema>;
export type ProposalView = z.infer<typeof proposalViewSchema>;
export type ActionSummary = z.infer<typeof actionSummarySchema>;
export type ActionResult = z.infer<typeof actionResultSchema>;
export type AllocationChange = z.infer<typeof allocationChangeSchema>;
export type ActionRecord = z.infer<typeof actionRecordSchema>;
export type CommitResult = z.infer<typeof commitResultSchema>;
export type ProposalKind = z.infer<typeof proposalKindSchema>;
export type ProposalState = z.infer<typeof proposalStateSchema>;
export type ProposalPayload = z.infer<typeof proposalPayloadSchema>;
export type ProposalSummary = z.infer<typeof proposalSummarySchema>;
