import { test } from "node:test";
import assert from "node:assert/strict";
import { RelayError } from "../src/utils/relay-error.js";
import { enumerateNights } from "../src/utils/local-date.js";
import { isoDateTimeSchema } from "../src/schemas/relay.schema.js";
import { businessDraftSchema, businessQuerySchema, offeringInputSchema, inventoryInputSchema, publicBusinessSchema } from "../src/schemas/catalog.schema.js";
import { approvalSchema, actionResultSchema, amendmentSchema, customerActionSchema, proposalRecordSchema } from "../src/schemas/action.schema.js";

test("approval requires an explicit approved:true acknowledgement", () => {
  assert.equal(approvalSchema.safeParse({ proposalId: "p", revision: 1 }).success, false);
  assert.equal(approvalSchema.safeParse({ proposalId: "proposal_1", revision: 1, approved: false }).success, false);
  assert.equal(approvalSchema.safeParse({ proposalId: "proposal_1", revision: 1, approved: true }).success, true);
});

test("enumerateNights counts local calendar nights across Europe/Zurich DST changes", () => {
  assert.deepEqual(enumerateNights("2027-03-27", "2027-03-29"), ["2027-03-27", "2027-03-28"]);
  assert.throws(() => enumerateNights("2027-03-29", "2027-03-29"), /Check-out must be after check-in/);
});

test("isoDateTimeSchema requires ISO 8601 timestamps with an explicit timezone", () => {
  assert.equal(isoDateTimeSchema.safeParse("2027-03-01T12:00:00.000Z").success, true);
  assert.equal(isoDateTimeSchema.safeParse("2027-03-01T12:00:00+01:00").success, true);
  assert.equal(isoDateTimeSchema.safeParse("2027-03-01T12:00:00").success, false);
  assert.equal(isoDateTimeSchema.safeParse("2027-03-01").success, false);
  assert.equal(isoDateTimeSchema.safeParse("03/01/2027 12:00").success, false);
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

test("business draft and public business schemas enforce category alignment and a single business currency", () => {
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
  assert.equal(
    businessDraftSchema.safeParse({
      ...partialHotelDraft,
      offerings: [
        {
          kind: "room_type",
          id: "suite",
          active: true,
          name: "Suite",
          maxGuests: 2,
          nightlyRate: { amountMinor: 25000, currency: "EUR" },
        },
      ],
    }).success,
    false,
  );

  const publicHotelBusiness = {
    businessId: "business_1",
    category: "hotel",
    revision: 2,
    profile: {
      name: "Alpine Stay",
      address: "Bahnhofstrasse 1, Zurich",
      description: "Central hotel",
      contact: { email: "hello@example.com" },
      timezone: "Europe/Zurich",
      currency: "CHF",
      openingHours: [{ day: "monday", intervals: [{ startTime: "00:00", endTime: "23:59" }] }],
      serviceHours: [{ id: "checkin", label: "Check-in", days: ["monday"], startTime: "15:00", endTime: "21:00" }],
      finalPriceDescription: "Taxes included.",
      policies: ["Bring ID."],
      categoryConfig: { kind: "hotel", amenities: ["wifi"] },
    },
    offerings: [
      {
        kind: "room_type",
        id: "suite",
        active: true,
        name: "Suite",
        maxGuests: 2,
        nightlyRate: { amountMinor: 25000, currency: "EUR" },
      },
    ],
    availability: [],
    publishedAt: "2027-01-01T10:00:00.000Z",
    updatedAt: "2027-01-01T10:00:00.000Z",
  };
  assert.equal(publicBusinessSchema.safeParse(publicHotelBusiness).success, false);
  assert.equal(
    publicBusinessSchema.safeParse({
      ...publicHotelBusiness,
      offerings: [
        {
          ...publicHotelBusiness.offerings[0],
          nightlyRate: { amountMinor: 25000, currency: "CHF" },
        },
      ],
    }).success,
    true,
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

test("proposalRecordSchema validates complete amendment snapshots with checked stay arithmetic", () => {
  const validHotelAmendmentProposal = {
    id: "proposal_1",
    principal: { role: "client", userId: "client_1" },
    revision: 1,
    kind: "reservation_amendment",
    payload: {
      kind: "reservation_amendment",
      amendment: {
        kind: "hotel_booking",
        reservationId: "reservation_1",
        expectedReservationRevision: 2,
        checkIn: "2027-03-27",
        checkOut: "2027-03-29",
        guests: 2,
      },
    },
    summary: {
      kind: "reservation_amendment",
      summary: {
        kind: "hotel_booking",
        reservationId: "reservation_1",
        expectedReservationRevision: 2,
        businessId: "business_1",
        roomTypeId: "suite",
        checkIn: "2027-03-27",
        checkOut: "2027-03-29",
        nights: ["2027-03-27", "2027-03-28"],
        guests: 2,
        nightlyRate: { amountMinor: 18000, currency: "CHF" },
        totalPrice: { amountMinor: 36000, currency: "CHF" },
        chargeDescription: "Demo stay.",
        policies: ["Bring ID."],
        paymentNotice: "Payment will be collected outside chat during the demo.",
      },
    },
    termsRevision: {
      businessRevision: 3,
      offeringRevisions: [],
      inventoryRevisions: [],
    },
    expiresAt: "2027-03-01T12:00:00.000Z",
    state: "pending",
    durableResultRef: null,
  };

  assert.equal(proposalRecordSchema.safeParse(validHotelAmendmentProposal).success, true);
  assert.equal(
    proposalRecordSchema.safeParse({
      ...validHotelAmendmentProposal,
      summary: {
        kind: "reservation_amendment",
        summary: {
          ...validHotelAmendmentProposal.summary.summary,
          roomTypeId: undefined,
        },
      },
    }).success,
    false,
  );
  assert.equal(
    proposalRecordSchema.safeParse({
      ...validHotelAmendmentProposal,
      summary: {
        kind: "reservation_amendment",
        summary: {
          ...validHotelAmendmentProposal.summary.summary,
          nights: ["2027-03-27"],
          totalPrice: { amountMinor: 18000, currency: "CHF" },
        },
      },
    }).success,
    false,
  );

  const validRestaurantAmendmentProposal = {
    ...validHotelAmendmentProposal,
    id: "proposal_2",
    payload: {
      kind: "reservation_amendment",
      amendment: {
        kind: "restaurant_booking",
        reservationId: "reservation_2",
        expectedReservationRevision: 1,
        slotId: "slot_2",
        partySize: 4,
      },
    },
    summary: {
      kind: "reservation_amendment",
      summary: {
        kind: "restaurant_booking",
        reservationId: "reservation_2",
        expectedReservationRevision: 1,
        businessId: "business_1",
        slotId: "slot_2",
        slotDate: "2027-03-05",
        startTime: "20:00",
        endTime: "22:00",
        partySize: 4,
        policies: ["Arrive on time."],
        paymentNotice: "No payment is collected for this reservation.",
      },
    },
  };

  assert.equal(proposalRecordSchema.safeParse(validRestaurantAmendmentProposal).success, true);
  assert.equal(
    proposalRecordSchema.safeParse({
      ...validRestaurantAmendmentProposal,
      summary: {
        kind: "reservation_amendment",
        summary: {
          ...validRestaurantAmendmentProposal.summary.summary,
          startTime: undefined,
        },
      },
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
