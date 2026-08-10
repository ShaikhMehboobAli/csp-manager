export type RuntimeSession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  status: string;
  isUnexpectedStop: boolean;
};

export function calculateSessionOverlapSeconds(
  session: RuntimeSession,
  rangeFrom: Date,
  rangeTo: Date,
): number {
  const sessionStart = session.startedAt;

  // For an active session, calculate until the current time.
  const sessionEnd = session.endedAt ?? new Date();

  // No overlap with requested range.
  if (sessionEnd <= rangeFrom || sessionStart >= rangeTo) {
    return 0;
  }

  const effectiveStart = sessionStart > rangeFrom ? sessionStart : rangeFrom;

  const effectiveEnd = sessionEnd < rangeTo ? sessionEnd : rangeTo;

  if (effectiveEnd <= effectiveStart) {
    return 0;
  }

  return Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / 1000);
}
