import { describe, expect, it } from 'vitest';

import { balanceDecreases, type TransferEffect } from './direct-transfer.domain.js';

const confirmed = (source: string, destination: string, amount: bigint): TransferEffect => ({
  confirmed: true,
  sourceAccountId: source,
  destinationAccountId: destination,
  amountMinor: amount,
});
const deleted = (source: string, destination: string, amount: bigint): TransferEffect => ({
  ...confirmed(source, destination, amount),
  confirmed: false,
});

describe('balanceDecreases', () => {
  it('удаление уменьшает только счёт назначения', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), deleted('a', 'b', 100n))).toEqual(
      new Map([['b', 100n]]),
    );
  });

  it('восстановление уменьшает только счёт-источник', () => {
    expect(balanceDecreases(deleted('a', 'b', 100n), confirmed('a', 'b', 100n))).toEqual(
      new Map([['a', 100n]]),
    );
  });

  it('рост суммы уменьшает источник на разницу', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('a', 'b', 250n))).toEqual(
      new Map([['a', 150n]]),
    );
  });

  it('уменьшение суммы уменьшает назначение на разницу', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('a', 'b', 40n))).toEqual(
      new Map([['b', 60n]]),
    );
  });

  it('смена назначения уменьшает старое назначение и не трогает новое', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('a', 'c', 100n))).toEqual(
      new Map([['b', 100n]]),
    );
  });

  it('смена источника уменьшает новый источник', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('c', 'b', 100n))).toEqual(
      new Map([['c', 100n]]),
    );
  });

  it('разворот направления уменьшает старое назначение на двойную сумму', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('b', 'a', 100n))).toEqual(
      new Map([['b', 200n]]),
    );
  });

  it('смена только комментария или даты ничего не уменьшает', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('a', 'b', 100n))).toEqual(
      new Map(),
    );
  });
});
