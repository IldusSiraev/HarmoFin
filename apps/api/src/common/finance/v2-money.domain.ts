const BIGINT_MIN = -9_223_372_036_854_775_808n;
const BIGINT_MAX = 9_223_372_036_854_775_807n;

export class V2MoneyOverflowError extends Error {
  constructor(message: string = 'Денежное значение выходит за допустимые пределы.') {
    super(message);
    this.name = 'V2MoneyOverflowError';
  }
}

export type SpendableInput = {
  cash: bigint;
  current: bigint;
  mandatory: bigint;
  mandatoryDue: bigint;
  otherBalances: bigint[];
};

export type SpendableResult = {
  spendableNow: bigint;
  mandatoryProtected: bigint;
  mandatoryGap: bigint;
  freeToAssign: bigint;
  unbackedAssignments: bigint;
};

export function periodFunded(
  opening: bigint,
  assigned: bigint,
  movedIn: bigint,
  movedOut: bigint,
): bigint {
  const safeOpening = readMinorUnits(opening);
  const safeAssigned = readMinorUnits(assigned);
  const safeMovedIn = readMinorUnits(movedIn);
  const safeMovedOut = readMinorUnits(movedOut);
  const result = safeOpening + safeAssigned + safeMovedIn - safeMovedOut;
  assertInRange(result);
  return result;
}

export function assignmentBalance(funded: bigint, spent: bigint): bigint {
  const safeFunded = readMinorUnits(funded);
  const safeSpent = readMinorUnits(spent);
  const result = safeFunded - safeSpent;
  assertInRange(result);
  return result;
}

export function calculateSpendable(input: SpendableInput): SpendableResult {
  const cash = readMinorUnits(input.cash);
  const current = max0(readMinorUnits(input.current));
  const mandatory = max0(readMinorUnits(input.mandatory));
  const due = max0(readMinorUnits(input.mandatoryDue));
  const otherBalances: bigint[] = [];
  for (const balance of input.otherBalances) {
    otherBalances.push(readMinorUnits(balance));
  }

  const mandatoryProtected = max2(mandatory, due);
  let otherProtected = 0n;
  for (const balance of otherBalances) {
    otherProtected += max0(balance);
  }
  assertInRange(otherProtected);

  const cashAfterProtection = max0(cash - mandatoryProtected - otherProtected);
  const spendableNow = min2(current, cashAfterProtection);
  const mandatoryGap = max0(due - mandatory);

  let positiveAssignments = current + mandatory;
  assertInRange(positiveAssignments);
  positiveAssignments += otherProtected;
  assertInRange(positiveAssignments);

  const freeToAssign = max0(cash - positiveAssignments);
  const unbackedAssignments = max0(positiveAssignments - cash);

  return {
    spendableNow,
    mandatoryProtected,
    mandatoryGap,
    freeToAssign,
    unbackedAssignments,
  };
}

function readMinorUnits(value: unknown): bigint {
  if (typeof value !== 'bigint') {
    throw new TypeError('Денежное значение должно быть целым числом (bigint).');
  }
  assertInRange(value);
  return value;
}

function assertInRange(value: bigint): void {
  if (value < BIGINT_MIN || value > BIGINT_MAX) {
    throw new V2MoneyOverflowError();
  }
}

function max0(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function max2(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function min2(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
