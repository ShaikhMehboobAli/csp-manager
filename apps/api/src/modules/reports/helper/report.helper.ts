/**
 * Resolves a report period to a date range. Explicit from/to win (any period),
 * so existing callers that send dates are unaffected. Days are UTC days, like
 * the rest of the API's date filters.
 */
export function resolveDateRange(period: string, from?: Date, to?: Date) {
  if (from || to) {
    return { from, to };
  }

  const now = new Date();

  const startOfDay = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month, day, 0, 0, 0, 0));

  const endOfDay = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  switch (period) {
    case "TODAY":
      return {
        from: startOfDay(year, month, day),
        to: endOfDay(year, month, day),
      };

    case "YESTERDAY":
      return {
        from: startOfDay(year, month, day - 1),
        to: endOfDay(year, month, day - 1),
      };

    case "CURRENT_MONTH":
      return {
        from: startOfDay(year, month, 1),
        to: endOfDay(year, month, day),
      };

    case "LAST_MONTH":
      // Day 0 of this month is the last day of the previous month.
      return {
        from: startOfDay(year, month - 1, 1),
        to: endOfDay(year, month, 0),
      };

    // CUSTOM without dates: no date filter (all time).
    default:
      return { from, to };
  }
}
