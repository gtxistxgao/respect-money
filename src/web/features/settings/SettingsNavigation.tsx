import { Link, useLocation } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { t } from '../../../i18n/index.js';

const sections = [
  ['language', 'Language'],
  ['currency', 'Exchange rate'],
  ['bank-connections', 'Bank connections'],
  ['accounts', 'My accounts'],
  ['categories', 'Categories'],
  ['classification', 'Automatic classification'],
  ['reclassification', 'Reclassify'],
  ['advanced', 'Advanced settings'],
  ['history', 'Historical data coverage'],
] as const;

export function SettingsNavigation() {
  const { hash } = useLocation();
  return <section className="settings-navigation">
    <div className="rail-title"><Settings2 size={16} /><span>{t('Settings')}</span></div>
    <nav aria-label={t('Settings')}>{sections.map(([id, label]) => <Link key={id} to={{ pathname: '/settings', hash: '#' + id }} aria-current={(hash || '#language') === '#' + id ? 'location' : undefined}>{t(label)}</Link>)}</nav>
  </section>;
}
