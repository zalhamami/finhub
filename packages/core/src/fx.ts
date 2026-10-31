import Decimal from 'decimal.js';

/**
 * Pure FX / valuation helpers. Rates, units and prices are numeric strings (never floats);
 * math is done with decimal.js at high precision and rounded half-even exactly once, at the end.
 */

/** Isolated Decimal constructor so we never touch global decimal.js config. */
export const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;

export interface FxRate {
  base: string;
  quote: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  /** 1 base = rate quote (numeric string) */
  rate: string;
}

export class MissingRateError extends Error {
  readonly code = 'missing_fx_rate';
  constructor(
    readonly base: string,
    readonly quote: string,
    readonly date: string,
  ) {
    super(`No FX rate for ${base}/${quote} on or before ${date}`);
    this.name = 'MissingRateError';
  }
}

export class MissingPriceError extends Error {
  readonly code = 'missing_price';
  constructor(
    readonly instrumentId: string,
    readonly date: string,
  ) {
    super(`No price for instrument ${instrumentId} on or before ${date}`);
    this.name = 'MissingPriceError';
  }
}

/**
 * Rate to convert 1 unit of `from` into `to`, using the latest quote on or before `date`.
 * - identity (from === to) is exactly 1, no data needed
 * - direct (base=from, quote=to) or inverse (base=to, quote=from, rate = 1/r)
 * - if both exist, the one with the later date wins; direct wins ties.
 * Throws MissingRateError if neither exists.
 */
export function pickRate(rates: readonly FxRate[], from: string, to: string, date: string): Dec {
  if (from === to) return new D(1);
  let direct: FxRate | undefined;
  let inverse: FxRate | undefined;
  for (const r of rates) {
    if (r.date > date) continue;
    if (r.base === from && r.quote === to) {
      if (!direct || r.date > direct.date) direct = r;
    } else if (r.base === to && r.quote === from) {
      if (!inverse || r.date > inverse.date) inverse = r;
    }
  }
  if (direct && (!inverse || direct.date >= inverse.date)) return positive(direct, from, to, date);
  if (inverse) return new D(1).div(positive(inverse, from, to, date));
  throw new MissingRateError(from, to, date);
}

function positive(r: FxRate, from: string, to: string, date: string): Dec {
  const d = new D(r.rate);
  if (!d.isFinite() || d.lte(0)) throw new MissingRateError(from, to, date);
  return d;
}

/** minor units -> exact major-unit decimal */
export function minorToDecimal(minor: bigint, minorUnit: number): Dec {
  return new D(minor.toString()).div(new D(10).pow(minorUnit));
}

/** major-unit decimal -> minor units, rounded half-even to a whole minor unit. */
export function decimalToMinor(major: Dec, minorUnit: number): bigint {
  const scaled = major.mul(new D(10).pow(minorUnit));
  return BigInt(scaled.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toFixed(0));
}

export interface CurrencyUnit {
  code: string;
  minorUnit: number;
}

/**
 * Convert minor units between currencies (possibly with different minor units).
 * `rate` is 1 `from` = rate `to` (major units); defaults to identity when codes match.
 */
export function convertMinor(
  amount: bigint,
  from: CurrencyUnit,
  to: CurrencyUnit,
  rate: Dec | string,
): bigint {
  const r = rate instanceof D ? rate : new D(rate);
  return decimalToMinor(minorToDecimal(amount, from.minorUnit).mul(r), to.minorUnit);
}

/* ---------- valuation ---------- */

export interface PricePoint {
  instrumentId: string;
  date: string;
  /** price per unit in `currency` major units (numeric string) */
  price: string;
  currency: string;
}

export interface HoldingInput {
  instrumentId: string;
  /** numeric string */
  units: string;
}

export interface ValuationContext {
  baseCurrency: string;
  /** valuation date, YYYY-MM-DD (inclusive) */
  date: string;
  currencies: readonly CurrencyUnit[];
  fxRates: readonly FxRate[];
  prices: readonly PricePoint[];
}

export function currencyUnit(
  ctx: Pick<ValuationContext, 'currencies'>,
  code: string,
): CurrencyUnit {
  const c = ctx.currencies.find((x) => x.code === code);
  if (!c) throw new Error(`Unknown currency ${code}`);
  return c;
}

/** Latest price on or before `date` for an instrument. */
export function pickPrice(
  prices: readonly PricePoint[],
  instrumentId: string,
  date: string,
): PricePoint {
  let best: PricePoint | undefined;
  for (const p of prices) {
    if (p.instrumentId !== instrumentId || p.date > date) continue;
    if (!best || p.date > best.date) best = p;
  }
  if (!best) throw new MissingPriceError(instrumentId, date);
  return best;
}

/** Convert a minor-unit amount in `currency` to base-currency minor units (rounded once). */
export function toBaseMinor(amount: bigint, currency: string, ctx: ValuationContext): bigint {
  const rate = pickRate(ctx.fxRates, currency, ctx.baseCurrency, ctx.date);
  return convertMinor(
    amount,
    currencyUnit(ctx, currency),
    currencyUnit(ctx, ctx.baseCurrency),
    rate,
  );
}

/**
 * Value of an account in base-currency minor units:
 *   cash balance (converted) + sum(units x latest price on/before date x fx to base)
 * Everything is accumulated as exact decimals and rounded half-even once at the end.
 */
export function accountValueBase(
  balanceMinor: bigint,
  currency: string,
  holdings: readonly HoldingInput[],
  ctx: ValuationContext,
): bigint {
  const base = currencyUnit(ctx, ctx.baseCurrency);
  const cashRate = pickRate(ctx.fxRates, currency, ctx.baseCurrency, ctx.date);
  let total = minorToDecimal(balanceMinor, currencyUnit(ctx, currency).minorUnit).mul(cashRate);
  for (const h of holdings) {
    const p = pickPrice(ctx.prices, h.instrumentId, ctx.date);
    const fx = pickRate(ctx.fxRates, p.currency, ctx.baseCurrency, ctx.date);
    total = total.add(new D(h.units).mul(new D(p.price)).mul(fx));
  }
  return decimalToMinor(total, base.minorUnit);
}
