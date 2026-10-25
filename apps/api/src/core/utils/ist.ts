/**
 * Business days are Indian Standard Time (UTC+05:30, no daylight saving).
 * These helpers work on absolute instants, so they don't depend on the
 * server's time zone.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar parts of an instant as seen on an IST clock (month is 0-based). */
export function istParts(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * The instant of an IST wall-clock time. Out-of-range parts roll over like
 * Date.UTC (day 0 = last day of the previous month).
 */
export function istInstant(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0,
) {
  return new Date(
    Date.UTC(year, month, day, hours, minutes, seconds, ms) - IST_OFFSET_MS,
  );
}

export function startOfIstDay(date: Date) {
  const { year, month, day } = istParts(date);

  return istInstant(year, month, day);
}

export function endOfIstDay(date: Date) {
  const { year, month, day } = istParts(date);

  return istInstant(year, month, day, 23, 59, 59, 999);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** `YYYY-MM-DD` of the IST calendar day containing the instant. */
export function istDateKey(date: Date) {
  const { year, month, day } = istParts(date);

  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `YYYY-MM` of the IST calendar month containing the instant. */
export function istMonthKey(date: Date) {
  return istDateKey(date).slice(0, 7);
}
