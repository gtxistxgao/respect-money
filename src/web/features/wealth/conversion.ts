import { Decimal } from 'decimal.js';
import { intlLocale, t } from '../../../i18n/index.js';
import type { DisplayConversion } from '../../../shared/settings.js';

export function convertedAmount(cents: number, conversion: DisplayConversion) {
  const amount = new Decimal(cents).times(conversion.rate).div(100);
  const format = (value: Decimal) => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }).format(value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());
  return conversion.currency === 'CNY'
    ? t('Approx. {p0} CNY ({p1} × 10,000)', { p0: format(amount), p1: format(amount.div(10000)) })
    : t('Approx. {amount} {currency}', { amount: format(amount), currency: conversion.currency });
}
