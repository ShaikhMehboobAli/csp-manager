export function normalizeDateRange(from?: Date, to?: Date) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const start = from ?? today;

  const end = to ? new Date(to) : undefined;

  if (end) {
    end.setUTCHours(23, 59, 59, 999);
  }

  return {
    from: start,
    to: end,
  };
}
