import { NavLink } from 'react-router-dom';
import { t } from '../../../i18n/index.js';

export const wealthPages = {
  overview: { path: '/wealth', title: 'Wealth', description: 'Your accounts, property and other assets in one place.' },
  accounts: { path: '/wealth/accounts', title: 'Account balances', description: 'View and sort balances across your connected accounts.' },
  history: { path: '/wealth/history', title: 'Balance history', description: 'Review your locally saved balances by Pacific date.' },
} as const;
export type WealthPage = keyof typeof wealthPages;

export function WealthNavigation() {
  return <nav className="wealth-navigation" aria-label={t('Wealth sections')}>
    {Object.values(wealthPages).map(page => <NavLink key={page.path} to={page.path} end>{t(page.title)}</NavLink>)}
  </nav>;
}
