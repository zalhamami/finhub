import { describe, expect, it } from 'vitest';
import { amountPreview, minorToInputText, parseAmountText } from '../src/lib/amount';

describe('parseAmountText', () => {
  it('empty / blank is "empty"', () => {
    expect(parseAmountText('')).toEqual({ status: 'empty' });
    expect(parseAmountText('   ')).toEqual({ status: 'empty' });
  });

  it('parses Indonesian slang into minor units (x100)', () => {
    expect(parseAmountText('1,5jt')).toEqual({ status: 'ok', minor: 150_000_000n });
    expect(parseAmountText('250rb')).toEqual({ status: 'ok', minor: 25_000_000n });
    expect(parseAmountText('Rp1.250.000')).toEqual({ status: 'ok', minor: 125_000_000n });
    expect(parseAmountText('goceng')).toEqual({ status: 'ok', minor: 500_000n });
  });

  it('zero is valid, a leading minus negates', () => {
    expect(parseAmountText('0')).toEqual({ status: 'ok', minor: 0n });
    expect(parseAmountText('Rp 0')).toEqual({ status: 'ok', minor: 0n });
    expect(parseAmountText('-250rb')).toEqual({ status: 'ok', minor: -25_000_000n });
  });

  it('exactly two decimals are cents', () => {
    expect(parseAmountText('1500,50')).toEqual({ status: 'ok', minor: 150_050n });
    expect(parseAmountText('0,05')).toEqual({ status: 'ok', minor: 5n });
  });

  it('junk and ambiguous decimals are invalid', () => {
    expect(parseAmountText('abc')).toEqual({ status: 'invalid' });
    expect(parseAmountText('1,5')).toEqual({ status: 'invalid' });
    expect(parseAmountText('5xyz')).toEqual({ status: 'invalid' });
  });
});

describe('amountPreview', () => {
  it('formats a valid amount as rupiah', () => {
    expect(amountPreview('1,5jt')).toBe('Rp1.500.000');
    expect(amountPreview('-250rb')).toBe('-Rp250.000');
  });
  it('is null while empty or invalid', () => {
    expect(amountPreview('')).toBeNull();
    expect(amountPreview('abc')).toBeNull();
  });
});

describe('minorToInputText', () => {
  it('turns minor units into editable major-unit text', () => {
    expect(minorToInputText('150000000')).toBe('1500000');
    expect(minorToInputText('150050')).toBe('1500,50');
    expect(minorToInputText('150005')).toBe('1500,05');
    expect(minorToInputText('0')).toBe('0');
    expect(minorToInputText('-25000000')).toBe('-250000');
  });
  it('round-trips through the parser', () => {
    for (const minor of ['150000000', '150050', '-12345600', '0']) {
      expect(parseAmountText(minorToInputText(minor))).toEqual({
        status: 'ok',
        minor: BigInt(minor),
      });
    }
  });
  it('null / junk -> empty text', () => {
    expect(minorToInputText(null)).toBe('');
    expect(minorToInputText('x')).toBe('');
  });
});
