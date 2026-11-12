import { endOfIstDay, istInstant, istParts } from "../../../core/utils/ist";

/**
 * Resolves a report period to a date range. Explicit from/to win (any period),
 * so existing callers that send dates are unaffected. Days are IST days.
 */
export function resolveDateRange(period: string, from?: Date, to?: Date) {
  if (from || to) {
    return { from, to };
  }

  const now = new Date();

  const { year, month, day } = istParts(now);

  switch (period) {
    case "TODAY":
      return { from: istInstant(year, month, day), to: endOfIstDay(now) };

    case "YESTERDAY":
      return {
        from: istInstant(year, month, day - 1),
        to: istInstant(year, month, day - 1, 23, 59, 59, 999),
      };

    case "CURRENT_MONTH":
      return { from: istInstant(year, month, 1), to: endOfIstDay(now) };

    case "LAST_MONTH":
      // Day 0 of this month is the last day of the previous month.
      return {
        from: istInstant(year, month - 1, 1),
        to: istInstant(year, month, 0, 23, 59, 59, 999),
      };

    // CUSTOM without dates: no date filter (all time).
    default:
      return { from, to };
  }
}
