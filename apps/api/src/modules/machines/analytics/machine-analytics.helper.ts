import { addDays, istDateKey, startOfIstDay } from "../../../core/utils/ist";

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
    // Beginning of the next IST day
    const nextDay = addDays(startOfIstDay(current), 1);

    const intervalEnd = nextDay < endedAt ? nextDay : endedAt;

    const seconds = Math.floor(
      (intervalEnd.getTime() - current.getTime()) / 1000,
    );

    chunks.push({
      date: istDateKey(current),
      seconds,
    });

    current = intervalEnd;
  }

  return chunks;
}
