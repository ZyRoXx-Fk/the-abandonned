import { test } from "node:test";
import assert from "node:assert/strict";
import { RelayError } from "../src/utils/relay-error.js";
import { enumerateNights } from "../src/utils/local-date.js";
import { businessDraftSchema, businessQuerySchema, offeringInputSchema, inventoryInputSchema } from "../src/schemas/catalog.schema.js";
import { approvalSchema, actionResultSchema, amendmentSchema, customerActionSchema } from "../src/schemas/action.schema.js";

test("approval requires an explicit approved:true acknowledgement", () => {
  assert.equal(approvalSchema.safeParse({ proposalId: "p", revision: 1 }).success, false);
  assert.equal(approvalSchema.safeParse({ proposalId: "proposal_1", revision: 1, approved: false }).success, false);
  assert.equal(approvalSchema.safeParse({ proposalId: "proposal_1", revision: 1, approved: true }).success, true);
});

test("enumerateNights counts local calendar nights across Europe/Zurich DST changes", () => {
  assert.deepEqual(enumerateNights("2027-03-27", "2027-03-29"), ["2027-03-27", "2027-03-28"]);
  assert.throws(() => enumerateNights("2027-03-29", "2027-03-29"), /Check-out must be after check-in/);
});

test("offeringInputSchema allows zero-priced offerings but rejects invalid currencies and IDs", () => {
  const zeroPricedOffering = {
    kind: "menu_item",
    id: "pizza",
    active: true,
    name: "Pizza marinara",
    variants: [
      {
        id: "regular",
        name: "Regular",
        unitPrice: { amountMinor: 0, currency: "CHF" },
      },
    ],
  };
  assert.equal(offeringInputSchema.safeParse(zeroPricedOffering).success, true);
  assert.equal(
    offeringInputSchema.safeParse({
      ...zeroPricedOffering,
      variants: [{ ...zeroPricedOffering.variants[0], unitPrice: { amountMinor: 500, currency: "ZZZ" } }],
    }).success,
    false,
  );
  assert.equal(offeringInputSchema.safeParse({ ...zeroPricedOffering, id: "invalid id" }).success, false);
});

test("inventoryInputSchema rejects fractional quantities, negatives, impossible dates and unsafe integers", () => {
  assert.equal(
    inventoryInputSchema.safeParse({
      kind: "sellable_variant",
      id: "stock_1",
      offeringId: "burger",
      variantId: "single",
      remainingUnits: 3.5,
    }).success,
    false,
  );
  assert.equal(
    inventoryInputSchema.safeParse({
      kind: "sellable_variant",
      id: "stock_1",
      offeringId: "burger",
      variantId: "single",
      remainingUnits: -1,
    }).success,
    false,
  );
  assert.equal(
    inventoryInputSchema.safeParse({
      kind: "sellable_variant",
      id: "stock_1",
      offeringId: "burger",
      variantId: "single",
      remainingUnits: Number.MAX_SAFE_INTEGER + 1,
    }).success,
    false,
  );
  assert.equal(
    inventoryInputSchema.safeParse({
      kind: "room_night",
      id: "night_1",
      roomTypeId: "suite",
      localNight: "2027-02-30",
      totalRooms: 3,
    }).success,
    false,
  );
});

test("businessDraftSchema keeps category-specific configuration aligned while allowing partial hotel drafts", () => {
  const partialHotelDraft = {
    id: "draft_1",
    businessId: "business_1",
    ownerId: "owner_1",
    category: "hotel",
    revision: 0,
    profile: {
      name: "Alpine Stay",
      timezone: "Europe/Zurich",
      currency: "CHF",
      categoryConfig: {
        kind: "hotel",
        checkInWindow: { startTime: "15:00", endTime: "21:00" },
      },
    },
    offerings: [],
    inventoryEdits: [],
    auditTrail: [],
    createdAt: "2027-01-01T10:00:00.000Z",
    updatedAt: "2027-01-01T10:00:00.000Z",
  };
  assert.equal(businessDraftSchema.safeParse(partialHotelDraft).success, true);
  assert.equal(
    businessDraftSchema.safeParse({
      ...partialHotelDraft,
      profile: {
        ...partialHotelDraft.profile,
        categoryConfig: {
          kind: "restaurant",
          cuisine: "Swiss",
        },
      },
    }).success,
    false,
  );
  assert.equal(
    businessDraftSchema.safeParse({
      ...partialHotelDraft,
      offerings: [
        {
          kind: "menu_item",
          id: "soup",
          active: true,
          name: "Soup of the day",
          variants: [{ id: "cup", name: "Cup", unitPrice: { amountMinor: 900, currency: "CHF" } }],
        },
      ],
    }).success,
    false,
  );
});

test("customer and amendment inputs reject invalid IDs, impossible dates, injected totals and unsafe integers", () => {
  assert.equal(
    customerActionSchema.safeParse({
      kind: "order",
      businessId: "business_1",
      items: [{ offeringId: "burger", variantId: "single", quantity: 2 }],
      pickupAt: "2027-03-01T12:00:00.000Z",
      totalPrice: { amountMinor: 2000, currency: "CHF" },
    }).success,
    false,
  );
  assert.equal(
    customerActionSchema.safeParse({
      kind: "order",
      businessId: "business 1",
      items: [{ offeringId: "burger", variantId: "single", quantity: 2 }],
      pickupAt: "2027-03-01T12:00:00.000Z",
    }).success,
    false,
  );
  assert.equal(
    customerActionSchema.safeParse({
      kind: "order",
      businessId: "business_1",
      items: [{ offeringId: "burger", variantId: "single", quantity: Number.MAX_SAFE_INTEGER + 1 }],
      pickupAt: "2027-03-01T12:00:00.000Z",
    }).success,
    false,
  );
  assert.equal(
    customerActionSchema.safeParse({
      kind: "hotel_booking",
      businessId: "business_1",
      roomTypeId: "suite",
      checkIn: "2027-02-30",
      checkOut: "2027-03-02",
      guests: 2,
    }).success,
    false,
  );
  assert.equal(
    amendmentSchema.safeParse({
      kind: "hotel_booking",
      reservationId: "reservation_1",
      expectedReservationRevision: 1,
      checkIn: "2027-03-02",
      checkOut: "2027-03-01",
      guests: 2,
    }).success,
    false,
  );
});

test("actionResultSchema verifies authoritative totals and payment status contracts", () => {
  const validOrderResult = {
    id: "action_1",
    reference: "ORDER-001",
    kind: "order",
    revision: 1,
    status: "confirmed",
    paymentStatus: "not_collected_demo",
    summary: {
      kind: "order",
      businessId: "business_1",
      items: [
        {
          offeringId: "burger",
          variantId: "single",
          name: "Classic burger",
          quantity: 2,
          unitPrice: { amountMinor: 1250, currency: "CHF" },
          lineTotal: { amountMinor: 2500, currency: "CHF" },
        },
      ],
      totalPrice: { amountMinor: 2500, currency: "CHF" },
      pickupAt: "2027-03-01T12:00:00.000Z",
      chargeDescription: "Includes VAT.",
      policies: ["Pickup only."],
      paymentNotice: "Payment will be collected outside chat during the demo.",
    },
  };
  assert.equal(actionResultSchema.safeParse(validOrderResult).success, true);
  assert.equal(
    actionResultSchema.safeParse({
      ...validOrderResult,
      summary: {
        ...validOrderResult.summary,
        items: [
          {
            ...validOrderResult.summary.items[0],
            lineTotal: { amountMinor: 2600, currency: "CHF" },
          },
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    actionResultSchema.safeParse({
      id: "action_2",
      reference: "RES-001",
      kind: "restaurant_booking",
      revision: 1,
      status: "confirmed",
      paymentStatus: "not_collected_demo",
      summary: {
        kind: "restaurant_booking",
        businessId: "business_1",
        slotId: "slot_1",
        slotDate: "2027-03-01",
        startTime: "19:00",
        endTime: "21:00",
        partySize: 2,
        policies: ["Arrive on time."],
        paymentNotice: "No payment is collected for this reservation.",
      },
    }).success,
    false,
  );
});

test("businessQuerySchema defaults limit to 10 and caps the public page size", () => {
  const parsed = businessQuerySchema.parse({ text: "pizza", offset: 0 });
  assert.equal(parsed.limit, 10);
  assert.equal(parsed.offset, 0);
  assert.equal(businessQuerySchema.safeParse({ limit: 51 }).success, false);
});

test("RelayError exposes stable code, message and details", () => {
  const error = new RelayError("TERMS_CHANGED", "Published terms changed", { nextAction: "review_and_approve" });
  assert.equal(error.name, "RelayError");
  assert.equal(error.code, "TERMS_CHANGED");
  assert.equal(error.message, "Published terms changed");
  assert.deepEqual(error.details, { nextAction: "review_and_approve" });
});
