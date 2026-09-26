import { intlLocale } from '../../../i18n/index.js';
import { queryClient } from '../../api.js';
export const refreshWealth = () => queryClient.invalidateQueries({ queryKey: ['wealth'] });

export const assetMoney = (cents: number, fractionDigits: 0 | 2 = 0) => new Intl.NumberFormat(intlLocale(), {
  style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
}).formatToParts(cents / 100).map(part => part.type === 'currency' ? `${part.value}\u00a0` : part.value).join('');
