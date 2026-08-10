export function getDashboardDateRange(from?: Date, to?: Date) {
  const now = new Date();

  const rangeFrom = from ? new Date(from) : new Date(now);

  rangeFrom.setUTCHours(0, 0, 0, 0);

  const rangeTo = to ? new Date(to) : new Date(now);

  rangeTo.setUTCHours(23, 59, 59, 999);

  return {
    from: rangeFrom,
    to: rangeTo,
  };
}
