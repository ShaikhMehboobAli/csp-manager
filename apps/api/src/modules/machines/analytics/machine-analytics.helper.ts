export interface DailySessionChunk {
  date: string;
  seconds: number;
}

export function splitSessionAcrossDays(
  startedAt: Date,
  endedAt: Date,
): DailySessionChunk[] {
  const chunks: DailySessionChunk[] = [];

  let current = new Date(startedAt);

  while (current < endedAt) {
    // Beginning of next day (UTC)
    const nextDay = new Date(current);

    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    nextDay.setUTCHours(0, 0, 0, 0);

    const intervalEnd = nextDay < endedAt ? nextDay : endedAt;

    const seconds = Math.floor(
      (intervalEnd.getTime() - current.getTime()) / 1000,
    );

    chunks.push({
      date: current.toISOString().split("T")[0],
      seconds,
    });

    current = intervalEnd;
  }

  return chunks;
}
