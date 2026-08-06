export function resolveDateRange(period: string, from?: Date, to?: Date) {
  const now = new Date();

  switch (period) {
    case "TODAY": {
      const start = new Date(now);

      start.setHours(0, 0, 0, 0);

      const end = new Date(now);

      end.setHours(23, 59, 59, 999);

      return { from: start, to: end };
    }

    case "YESTERDAY": {
      const start = new Date(now);

      start.setDate(start.getDate() - 1);

      start.setHours(0, 0, 0, 0);

      const end = new Date(start);

      end.setHours(23, 59, 59, 999);

      return {
        from: start,
        to: end,
      };
    }

    case "CUSTOM":
      return {
        from,
        to,
      };

    default:
      return {
        from,
        to,
      };
  }
}
