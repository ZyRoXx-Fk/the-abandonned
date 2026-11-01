const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function toParts(value: string): LocalDateParts {
  const normalized = value.trim();
  const match = LOCAL_DATE_PATTERN.exec(normalized);
  if (!match) {
    throw new RangeError(`Local date must use YYYY-MM-DD: ${value}`);
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid local calendar date: ${normalized}`);
  }

  return { year, month, day };
}

function formatParts(parts: LocalDateParts): string {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function toUtcDate(parts: LocalDateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function normalizeLocalDate(value: string): string {
  return formatParts(toParts(value));
}

export function enumerateNights(checkIn: string, checkOut: string): string[] {
  const normalizedCheckIn = normalizeLocalDate(checkIn);
  const normalizedCheckOut = normalizeLocalDate(checkOut);

  if (normalizedCheckOut <= normalizedCheckIn) {
    throw new RangeError("Check-out must be after check-in");
  }

  const nights: string[] = [];
  const cursor = toUtcDate(toParts(normalizedCheckIn));
  const end = toUtcDate(toParts(normalizedCheckOut));

  while (cursor < end) {
    nights.push(formatParts({
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate(),
    }));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return nights;
}
