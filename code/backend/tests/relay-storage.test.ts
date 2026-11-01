import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RelayError } from "../src/utils/relay-error.js";
import { proposalRecordSchema } from "../src/schemas/action.schema.js";
import { businessDraftSchema } from "../src/schemas/catalog.schema.js";
import { buildMongoHarness } from "./helpers/relay-mongo.js";

const hotelDraft = businessDraftSchema.parse({
  id: "draft_hotel_1",
  businessId: "business_hotel_1",
  ownerId: "owner_hotel_1",
  category: "hotel",
  revision: 0,
  profile: {
    name: "Alpine Stay",
    timezone: "Europe/Zurich",
    currency: "CHF",
    categoryConfig: {
      kind: "hotel",
      amenities: ["wifi"],
      checkInWindow: { startTime: "15:00", endTime: "21:00" },
    },
  },
  offerings: [
    {
      kind: "room_type",
      id: "suite",
      active: true,
      name: "Suite",
      maxGuests: 2,
      nightlyRate: { amountMinor: 25000, currency: "CHF" },
    },
  ],
  inventoryEdits: [
    {
      kind: "room_night",
      id: "suite_2027_04_02",
      roomTypeId: "suite",
      localNight: "2027-04-02",
      totalRooms: 3,
    },
  ],
  auditTrail: [],
  createdAt: "2027-02-01T10:00:00.000Z",
  updatedAt: "2027-02-01T10:00:00.000Z",
} as const);

const publishedHotelDraft = businessDraftSchema.parse({
  id: "draft_hotel_1",
  businessId: "business_hotel_1",
  ownerId: "owner_hotel_1",
  category: "hotel",
  revision: 0,
  profile: {
    name: "Alpine Stay",
    address: "Bahnhofstrasse 5, Zermatt",
    description: "Mountain suites with breakfast.",
    contact: { email: "stay@example.com", phone: "+41 27 555 0101" },
    timezone: "Europe/Zurich",
    currency: "CHF",
    openingHours: [{ day: "monday", intervals: [{ startTime: "00:00", endTime: "23:59" }] }],
    serviceHours: [{ id: "checkin", label: "Check-in", days: ["monday"], startTime: "15:00", endTime: "21:00" }],
    finalPriceDescription: "Taxes included.",
    policies: ["Valid ID required at check-in."],
    categoryConfig: {
      kind: "hotel",
      amenities: ["wifi"],
      checkInWindow: { startTime: "15:00", endTime: "21:00" },
    },
  },
  offerings: [
    {
      kind: "room_type",
      id: "suite",
      active: true,
      name: "Suite",
      maxGuests: 2,
      nightlyRate: { amountMinor: 25000, currency: "CHF" },
    },
  ],
  inventoryEdits: [
    {
      kind: "room_night",
      id: "suite_2027_04_02",
      roomTypeId: "suite",
      localNight: "2027-04-02",
      totalRooms: 3,
    },
  ],
  auditTrail: [],
  createdAt: "2027-02-01T10:00:00.000Z",
  updatedAt: "2027-02-01T10:00:00.000Z",
} as const);

const restaurantDraft = businessDraftSchema.parse({
  id: "draft_restaurant_1",
  businessId: "business_restaurant_1",
  ownerId: "owner_restaurant_1",
  category: "restaurant",
  revision: 0,
  profile: {
    name: "Brasserie Relay",
    address: "Marktplatz 1, Basel",
    description: "Seasonal plates and terrace dining.",
    contact: { email: "owner@example.com", phone: "+41 61 555 0101" },
    timezone: "Europe/Zurich",
    currency: "CHF",
    openingHours: [{ day: "monday", intervals: [{ startTime: "09:00", endTime: "22:00" }] }],
    serviceHours: [{ id: "dinner", label: "Dinner", days: ["monday"], startTime: "18:00", endTime: "22:00" }],
    finalPriceDescription: "Taxes included.",
    policies: ["Arrive on time."],
    categoryConfig: {
      kind: "restaurant",
      cuisine: "Swiss",
      amenities: ["terrace"],
    },
  },
  offerings: [
    {
      kind: "menu_item",
      id: "fondue",
      active: true,
      name: "Fondue",
      variants: [{ id: "classic", name: "Classic", unitPrice: { amountMinor: 3200, currency: "CHF" } }],
    },
  ],
  inventoryEdits: [
    {
      kind: "restaurant_slot",
      id: "slot_1",
      slotDate: "2027-03-05",
      startTime: "18:00",
      endTime: "20:00",
      totalSeats: 10,
      minPartySize: 1,
      maxPartySize: 6,
    },
    {
      kind: "restaurant_slot",
      id: "slot_2",
      slotDate: "2027-03-06",
      startTime: "20:00",
      endTime: "22:00",
      totalSeats: 10,
      minPartySize: 1,
      maxPartySize: 6,
    },
  ],
  auditTrail: [],
  createdAt: "2027-03-01T10:00:00.000Z",
  updatedAt: "2027-03-01T10:00:00.000Z",
} as const);

function buildProposalId(): string {
  return `proposal_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function buildRestaurantBookingProposal(slotId: string, slotDate: string, startTime: string, endTime: string) {
  return proposalRecordSchema.parse({
    id: buildProposalId(),
    principal: { role: "client", userId: "client_1" },
    revision: 0,
    kind: "restaurant_booking",
    payload: {
      kind: "restaurant_booking",
      businessId: restaurantDraft.businessId,
      slotId,
      partySize: 4,
    },
    summary: {
      kind: "restaurant_booking",
      businessId: restaurantDraft.businessId,
      slotId,
      slotDate,
      startTime,
      endTime,
      partySize: 4,
      policies: ["Arrive on time."],
      paymentNotice: "No payment is collected for this reservation.",
    },
    termsRevision: {
      businessRevision: restaurantDraft.revision,
      offeringRevisions: [],
      inventoryRevisions: [],
    },
    expiresAt: "2027-03-01T10:15:00.000Z",
    state: "pending",
    durableResultRef: null,
  });
}

function buildRestaurantAmendmentProposal(reservationId: string, businessId = restaurantDraft.businessId) {
  return proposalRecordSchema.parse({
    id: buildProposalId(),
    principal: { role: "client", userId: "client_1" },
    revision: 0,
    kind: "reservation_amendment",
    payload: {
      kind: "reservation_amendment",
      amendment: {
        kind: "restaurant_booking",
        reservationId,
        expectedReservationRevision: 0,
        slotId: "slot_2",
        partySize: 4,
      },
    },
    summary: {
      kind: "reservation_amendment",
      summary: {
        kind: "restaurant_booking",
        reservationId,
        expectedReservationRevision: 0,
        businessId,
        slotId: "slot_2",
        slotDate: "2027-03-06",
        startTime: "20:00",
        endTime: "22:00",
        partySize: 4,
        policies: ["Updated slot"],
        paymentNotice: "No payment is collected for this reservation.",
      },
    },
    termsRevision: {
      businessRevision: restaurantDraft.revision,
      offeringRevisions: [],
      inventoryRevisions: [],
    },
    expiresAt: "2027-03-01T11:15:00.000Z",
    state: "pending",
    durableResultRef: null,
  });
}

function buildHotelBookingProposal() {
  return proposalRecordSchema.parse({
    id: buildProposalId(),
    principal: { role: "client", userId: "client_1" },
    revision: 0,
    kind: "hotel_booking",
    payload: {
      kind: "hotel_booking",
      businessId: hotelDraft.businessId,
      roomTypeId: "suite",
      checkIn: "2027-04-02",
      checkOut: "2027-04-04",
      guests: 2,
    },
    summary: {
      kind: "hotel_booking",
      businessId: hotelDraft.businessId,
      roomTypeId: "suite",
      checkIn: "2027-04-02",
      checkOut: "2027-04-04",
      nights: ["2027-04-02", "2027-04-03"],
      guests: 2,
      nightlyRate: { amountMinor: 25000, currency: "CHF" },
      totalPrice: { amountMinor: 50000, currency: "CHF" },
      chargeDescription: "Suite stay",
      policies: ["Bring ID."],
      paymentNotice: "Payment will be collected outside chat during the demo.",
    },
    termsRevision: {
      businessRevision: hotelDraft.revision,
      offeringRevisions: [{ id: "suite", revision: 0 }],
      inventoryRevisions: [],
    },
    expiresAt: "2027-02-01T10:15:00.000Z",
    state: "pending",
    durableResultRef: null,
  });
}

function buildHotelAmendmentProposal(reservationId: string, roomTypeId: string) {
  return proposalRecordSchema.parse({
    id: buildProposalId(),
    principal: { role: "client", userId: "client_1" },
    revision: 0,
    kind: "reservation_amendment",
    payload: {
      kind: "reservation_amendment",
      amendment: {
        kind: "hotel_booking",
        reservationId,
        expectedReservationRevision: 0,
        checkIn: "2027-04-03",
        checkOut: "2027-04-05",
        guests: 2,
      },
    },
    summary: {
      kind: "reservation_amendment",
      summary: {
        kind: "hotel_booking",
        reservationId,
        expectedReservationRevision: 0,
        businessId: hotelDraft.businessId,
        roomTypeId,
        checkIn: "2027-04-03",
        checkOut: "2027-04-05",
        nights: ["2027-04-03", "2027-04-04"],
        guests: 2,
        nightlyRate: { amountMinor: 25000, currency: "CHF" },
        totalPrice: { amountMinor: 50000, currency: "CHF" },
        chargeDescription: "Suite stay",
        policies: ["Bring ID."],
        paymentNotice: "Payment will be collected outside chat during the demo.",
      },
    },
    termsRevision: {
      businessRevision: hotelDraft.revision,
      offeringRevisions: [{ id: "suite", revision: 0 }],
      inventoryRevisions: [],
    },
    expiresAt: "2027-02-01T11:15:00.000Z",
    state: "pending",
    durableResultRef: null,
  });
}

test("catalog storage persists and reloads partial hotel drafts", async (t) => {
  const harness = await buildMongoHarness();
  t.after(() => harness.close());

  await harness.catalog.insertDraft(hotelDraft);
  const stored = await harness.catalog.getDraft(hotelDraft.ownerId, hotelDraft.id);

  assert.deepEqual(stored, hotelDraft);
  assert.deepEqual(await harness.catalog.listDrafts(hotelDraft.ownerId, 0, 10), [hotelDraft]);
});

test("catalog storage rejects replacing the same draft revision twice", async (t) => {
  const harness = await buildMongoHarness();
  t.after(() => harness.close());

  await harness.catalog.insertDraft(hotelDraft);
  const firstUpdate = {
    ...hotelDraft,
    revision: 1,
    updatedAt: "2027-02-01T11:00:00.000Z",
    profile: {
      ...hotelDraft.profile,
      description: "Updated draft",
    },
  };

  assert.equal(await harness.catalog.replaceDraft(firstUpdate, 0), true);
  assert.equal(await harness.catalog.replaceDraft(firstUpdate, 0), false);
  assert.deepEqual(await harness.catalog.getDraft(hotelDraft.ownerId, hotelDraft.id), firstUpdate);
});

test("publication rejects inventory that points at offerings from another business", async (t) => {
  const harness = await buildMongoHarness();
  t.after(() => harness.close());

  const invalidDraft = businessDraftSchema.parse({
    ...restaurantDraft,
    revision: 2,
    inventoryEdits: [
      {
        kind: "sellable_variant",
        id: "stock_1",
        offeringId: "product_external",
        variantId: "variant_external",
        remainingUnits: 5,
      },
    ],
  } as const);

  await assert.rejects(
    () => harness.uow.run((tx) => harness.catalog.publish(invalidDraft, tx)),
    (error: unknown) => {
      assert.ok(error instanceof RelayError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.match(error.message, /inventory/i);
      return true;
    },
  );
});

test("reservation amendment stores the validated restaurant snapshot for the new slot", async (t) => {
  const harness = await buildMongoHarness();
  t.after(() => harness.close());

  await harness.catalog.insertDraft(restaurantDraft);
  await harness.uow.run((tx) => harness.catalog.publish(restaurantDraft, tx));

  const originalProposal = buildRestaurantBookingProposal("slot_1", "2027-03-05", "18:00", "20:00");
  const reservation = await harness.uow.run((tx) => harness.transactions.insertAction({ role: "client", userId: "client_1" }, originalProposal, tx));

  const amendment = buildRestaurantAmendmentProposal(reservation.id);
  const amended = await harness.uow.run((tx) => harness.transactions.amendReservation("client_1", reservation.id, 0, amendment, tx));

  assert.equal(amended.summary.kind, "restaurant_booking");
  assert.equal(amended.summary.slotId, "slot_2");
  assert.equal(amended.summary.slotDate, "2027-03-06");
  assert.equal(amended.summary.startTime, "20:00");
  assert.equal(amended.summary.endTime, "22:00");

  const record = await harness.transactions.getReservationRecord("client_1", reservation.id);
  assert.equal(record?.result.summary.kind, "restaurant_booking");
  assert.equal(record?.result.summary.slotId, "slot_2");
  assert.equal(record?.result.summary.slotDate, "2027-03-06");
});

test("reservation amendment rejects business or hotel room-type changes", async (t) => {
  const harness = await buildMongoHarness();
  t.after(() => harness.close());

  await harness.catalog.insertDraft(restaurantDraft);
  await harness.uow.run((tx) => harness.catalog.publish(restaurantDraft, tx));
  const restaurantReservation = await harness.uow.run((tx) => harness.transactions.insertAction(
    { role: "client", userId: "client_1" },
    buildRestaurantBookingProposal("slot_1", "2027-03-05", "18:00", "20:00"),
    tx,
  ));

  await assert.rejects(
    () => harness.uow.run((tx) => harness.transactions.amendReservation(
      "client_1",
      restaurantReservation.id,
      0,
      buildRestaurantAmendmentProposal(restaurantReservation.id, "business_other"),
      tx,
    )),
    (error: unknown) => {
      assert.ok(error instanceof RelayError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.match(error.message, /businessId/i);
      return true;
    },
  );

  await harness.catalog.insertDraft(publishedHotelDraft);
  await harness.uow.run((tx) => harness.catalog.publish(publishedHotelDraft, tx));
  const hotelReservation = await harness.uow.run((tx) => harness.transactions.insertAction(
    { role: "client", userId: "client_1" },
    buildHotelBookingProposal(),
    tx,
  ));

  await assert.rejects(
    () => harness.uow.run((tx) => harness.transactions.amendReservation(
      "client_1",
      hotelReservation.id,
      0,
      buildHotelAmendmentProposal(hotelReservation.id, "deluxe"),
      tx,
    )),
    (error: unknown) => {
      assert.ok(error instanceof RelayError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.match(error.message, /roomTypeId/i);
      return true;
    },
  );
});
