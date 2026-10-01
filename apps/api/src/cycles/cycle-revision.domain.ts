import {
  addIsoDays,
  assertIsoDate,
  compareIsoDates,
  cycleAndPeriodFor,
  validateSettings,
  type CycleRange,
  type CycleSettings,
} from './cycle-period.domain.js';

export type CycleRevisionPreviewInput = {
  oldSettings: CycleSettings;
  newSettings: CycleSettings;
  asOf: string;
  confirmedPeriodEnds: Array<{ id: string; end: string }>;
};

export type CycleRevisionPreview = {
  effectiveOn: string;
  transitionRanges: CycleRange[];
  preservedPeriodIds: string[];
};

export function previewCycleRevision(input: CycleRevisionPreviewInput): CycleRevisionPreview {
  const { oldSettings, newSettings, asOf, confirmedPeriodEnds } = input;
  validateSettings(oldSettings);
  validateSettings(newSettings);
  assertIsoDate(asOf);
  for (const confirmed of confirmedPeriodEnds) assertIsoDate(confirmed.end);

  const lastConfirmedEnd = confirmedPeriodEnds.reduce<string | null>(
    (latest, { end }) => (latest === null || compareIsoDates(end, latest) > 0 ? end : latest),
    null,
  );
  const anchor =
    lastConfirmedEnd !== null && compareIsoDates(lastConfirmedEnd, asOf) > 0
      ? lastConfirmedEnd
      : asOf;
  const effectiveOn = addIsoDays(cycleAndPeriodFor(newSettings, anchor).cycle.end, 1);

  // Unconfirmed periods before gapStart keep their old-settings ranges; caller owns them.
  const oldPeriodStart = cycleAndPeriodFor(oldSettings, asOf).period.start;
  const afterConfirmed = lastConfirmedEnd === null ? null : addIsoDays(lastConfirmedEnd, 1);
  const gapStart =
    afterConfirmed !== null && compareIsoDates(afterConfirmed, oldPeriodStart) > 0
      ? afterConfirmed
      : oldPeriodStart;

  const lastDay = addIsoDays(effectiveOn, -1);
  const transitionRanges: CycleRange[] = [];
  let cursor = gapStart;
  while (compareIsoDates(cursor, effectiveOn) < 0) {
    const oldEnd = cycleAndPeriodFor(oldSettings, cursor).period.end;
    const end = compareIsoDates(oldEnd, lastDay) < 0 ? oldEnd : lastDay;
    transitionRanges.push({ start: cursor, end });
    cursor = addIsoDays(end, 1);
  }

  return {
    effectiveOn,
    transitionRanges,
    preservedPeriodIds: [...new Set(confirmedPeriodEnds.map(({ id }) => id))],
  };
}
