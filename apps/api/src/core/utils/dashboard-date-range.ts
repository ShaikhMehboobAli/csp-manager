import { endOfIstDay, startOfIstDay } from "./ist";

/** Whole IST days covering [from, to]; both default to today (IST). */
export function getDashboardDateRange(from?: Date, to?: Date) {
  const now = new Date();

  return {
    from: startOfIstDay(from ?? now),
    to: endOfIstDay(to ?? now),
  };
}
