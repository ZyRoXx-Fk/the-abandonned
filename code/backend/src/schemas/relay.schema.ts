import { z } from "zod";
import { normalizeLocalDate } from "../utils/local-date.js";

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const RELAY_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,63})$/;

function isValidLocalDate(value: string): boolean {
  try {
    normalizeLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isIsoDateTime(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function isIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function canonicalizeTimeZone(value: string): string {
  return Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return HTTP_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export const relayErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "STALE_REVISION",
  "PROPOSAL_EXPIRED",
  "APPROVAL_REQUIRED",
  "UNAVAILABLE",
  "TERMS_CHANGED",
  "TRANSACTIONS_REQUIRED",
  "UNSAFE_URL",
  "FETCH_UNAVAILABLE",
]);

export type RelayErrorCode = z.infer<typeof relayErrorCodeSchema>;

export const relayIdSchema = z.string().trim().min(1).max(64).regex(RELAY_ID_PATTERN, "Invalid relay identifier");
export const safeIntegerSchema = z.number().int().safe();
export const nonNegativeSafeIntegerSchema = safeIntegerSchema.min(0);
export const positiveSafeIntegerSchema = safeIntegerSchema.min(1);
export const signedSafeIntegerSchema = safeIntegerSchema;
export const finiteNumberSchema = z.number().refine(isFiniteNumber, "Expected a finite number");
export const boundedText = (maxLength: number) => z.string().trim().min(1).max(maxLength);
export const optionalBoundedText = (maxLength: number) => boundedText(maxLength).optional();
export const shortCodeSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9](?:[a-z0-9_-]{0,63})$/, "Expected a lowercase code");
export const urlSchema = z.string().trim().max(2048).refine(isHttpUrl, "Expected an HTTP(S) URL");
export const isoDateTimeSchema = z.string().trim().refine(isIsoDateTime, "Expected an ISO date-time string");
export const localDateSchema = z.string().trim().refine(isValidLocalDate, "Expected a valid local calendar date").transform(normalizeLocalDate);
export const timeZoneSchema = z.string().trim().min(1).max(100).refine(isIanaTimeZone, "Expected a valid IANA time zone").transform(canonicalizeTimeZone);
export const currencySchema = z.string().trim().toUpperCase().length(3).refine((value) => SUPPORTED_CURRENCIES.has(value), "Unsupported currency");
export const timeOfDaySchema = z.string().trim().regex(TIME_OF_DAY_PATTERN, "Expected HH:MM in 24-hour time");
export const weekdaySchema = z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

export const metadataEntrySchema = z.object({
  key: shortCodeSchema,
  value: boundedText(200),
}).strict();

export const timeRangeSchema = z.object({
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
}).strict().refine((value) => value.endTime > value.startTime, {
  message: "endTime must be after startTime",
  path: ["endTime"],
});

export const openingHoursSchema = z.array(z.object({
  day: weekdaySchema,
  intervals: z.array(timeRangeSchema).max(4),
}).strict()).max(7);

export const serviceHoursSchema = z.array(z.object({
  id: relayIdSchema,
  label: boundedText(80),
  days: z.array(weekdaySchema).min(1).max(7),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
}).strict().refine((value) => value.endTime > value.startTime, {
  message: "endTime must be after startTime",
  path: ["endTime"],
})).max(20);

const contactInfoBaseSchema = z.object({
  email: z.string().trim().email().max(320).optional(),
  phone: boundedText(40).optional(),
  websiteUrl: urlSchema.optional(),
}).strict();

export const contactInfoSchema = contactInfoBaseSchema.refine(
  (value) => value.email !== undefined || value.phone !== undefined || value.websiteUrl !== undefined,
  { message: "At least one contact channel is required" },
);

export const draftContactInfoSchema = contactInfoBaseSchema;

export const principalSchema = z.object({
  role: z.enum(["owner", "client"]),
  userId: relayIdSchema,
}).strict();

export const moneySchema = z.object({
  amountMinor: nonNegativeSafeIntegerSchema,
  currency: currencySchema,
}).strict();

export const businessCategorySchema = z.enum(["restaurant", "hotel", "shop"]);

export type Principal = z.infer<typeof principalSchema>;
export type Clock = () => Date;
export type Money = z.infer<typeof moneySchema>;
export type BusinessCategory = z.infer<typeof businessCategorySchema>;
export type MetadataEntry = z.infer<typeof metadataEntrySchema>;
export type ContactInfo = z.infer<typeof contactInfoSchema>;
export type DraftContactInfo = z.infer<typeof draftContactInfoSchema>;
export type OpeningHours = z.infer<typeof openingHoursSchema>;
export type ServiceHours = z.infer<typeof serviceHoursSchema>;

export function getCurrencyFractionDigits(currency: string): number {
  const normalized = currencySchema.parse(currency);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: normalized }).resolvedOptions().maximumFractionDigits ?? 0;
}

export function checkedMultiplyMinorUnits(amountMinor: number, quantity: number): number {
  const safeAmount = nonNegativeSafeIntegerSchema.parse(amountMinor);
  const safeQuantity = nonNegativeSafeIntegerSchema.parse(quantity);
  const result = safeAmount * safeQuantity;

  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Money calculation exceeded the safe integer range");
  }

  return result;
}

export function checkedAddMinorUnits(amounts: number[]): number {
  let total = 0;

  for (const amount of amounts) {
    total += nonNegativeSafeIntegerSchema.parse(amount);
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("Money calculation exceeded the safe integer range");
    }
  }

  return total;
}
