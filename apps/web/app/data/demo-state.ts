import type { DemoLeftover, DemoSplit } from './demo-scenario.js';

export type DemoState = {
  step: number;
  start: number;
  offset: number;
  split: DemoSplit | null;
  leftover: DemoLeftover | null;
};

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  const text = typeof value === 'string' ? value : '';
  if (!/^\d+$/.test(text)) return fallback;
  const parsed = Number(text);
  return parsed >= min && parsed <= max ? parsed : fallback;
}

export function parseDemoQuery(query: Record<string, unknown>): DemoState {
  const split = query.split === 'suggested' || query.split === 'vacation' ? query.split : null;
  const leftoverRaw =
    query.leftover === 'carry' || query.leftover === 'save' ? query.leftover : null;
  const leftover = split ? leftoverRaw : null;
  let step = intIn(query.step, 0, 6, 0);
  if (step >= 3 && !split) step = 2;
  if (step === 6 && !leftover) step = 5;
  return {
    step,
    start: intIn(query.start, 1, 28, 10),
    offset: intIn(query.offset, 1, 27, 15),
    split,
    leftover,
  };
}

export function toDemoQuery(state: DemoState): Record<string, string> {
  return {
    step: String(state.step),
    start: String(state.start),
    offset: String(state.offset),
    ...(state.split ? { split: state.split } : {}),
    ...(state.leftover ? { leftover: state.leftover } : {}),
  };
}
