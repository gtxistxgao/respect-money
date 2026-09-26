import { Wealth } from './features/wealth/Wealth.js';
import { WealthNavigation, wealthPages } from './features/wealth/WealthNavigation.js';
import { useEffect } from 'react';
import { useLanguage } from './language.js';
import { t } from "../i18n/index.js";
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, NavLink, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { BarChart3, ChevronRight, LayoutDashboard, Monitor, WalletCards, Landmark } from 'lucide-react';
import { queryClient } from './api.js';
import { Accounting } from './features/accounting/Accounting.js';
import { Settings } from './features/settings/Settings.js';
import { MonthNavigation } from './MonthNavigation.js';
import { Overview } from './features/overview/Overview.js';
import { today } from '../shared/models.js';
import { SettingsNavigation } from './features/settings/SettingsNavigation.js';

export function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><AppLayout /></BrowserRouter></QueryClientProvider>;
}

function AppLayout() {
  const locale = useLanguage();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const wealthPage = Object.values(wealthPages).find(page => page.path === pathname);
  const tabQuery = new URLSearchParams({ month: params.get('month') || today().slice(0, 7) });
  if (params.get('accounts')) tabQuery.set('accounts', params.get('accounts')!);
  useEffect(() => {
    document.title = t('Respect Money · {p0}', { p0: pathname === '/overview' ? t('Overview') : wealthPage ? t(wealthPage.title) : pathname === '/settings' ? t('Settings') : t('Accounting') });
  }, [locale, pathname, wealthPage]);
  useEffect(() => { if (wealthPage) window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [pathname, wealthPage]);
  useEffect(() => { void queryClient.cancelQueries().then(() => queryClient.resetQueries()); }, [locale]);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">{t("Skip to main content")}</a>
    <aside className="app-sidebar">
      <NavLink to="/" className="brand" aria-label={t("Respect Money home")}><span className="brand-mark"><WalletCards size={27} /></span><span>respect<span className="brand-subtitle">money.</span></span></NavLink>
      <nav className="primary-nav" aria-label={t("Main navigation")}>
        <NavLink to={`/overview?${tabQuery}`}><BarChart3 size={18} /><span>{t('Overview')}</span></NavLink>
        <NavLink end to={`/?${tabQuery}`}><LayoutDashboard size={18} /><span>{t('Accounting')}</span></NavLink>
        <NavLink to="/wealth"><Landmark size={18} /><span>{t('Wealth')}</span></NavLink>
      </nav>
      {(pathname === '/' || pathname === '/overview') && <MonthNavigation />}
      {wealthPage && <WealthNavigation />}
      {pathname === '/settings' && <SettingsNavigation />}
      <div className="rail-footer"><span><span className="status-dot" />{t("Saved locally")}</span><NavLink to="/settings">{t("Settings")} <ChevronRight size={14} /></NavLink></div>
    </aside>
    <div className="app-workspace">
      <header className="topbar"><span className="workspace-title">{pathname === '/' ? t("Monthly ledger") : pathname === '/overview' ? t("Cash flow overview") : wealthPage ? t(wealthPage.title === 'Wealth' ? 'Assets and net worth' : wealthPage.title) : pathname === '/settings' ? t("Accounts and preferences") : 'Respect Money'}</span><span className="workspace-local"><Monitor size={16} />{t("Local personal ledger")}</span></header>
      <div id="main-content" tabIndex={-1}>
        <Routes>{Object.entries(wealthPages).map(([view, page]) => <Route key={view} path={page.path} element={<Wealth view={view as keyof typeof wealthPages} />} />)}<Route path="/" element={<Accounting />} /><Route path="/overview" element={<Overview />} /><Route path="/settings" element={<Settings />} /><Route path="*" element={<main className="settings-main"><h1>{t("Page not found")}</h1><NavLink to="/">{t("Back to ledger")}</NavLink></main>} /></Routes>
      </div>
    </div>
  </div>;
}
