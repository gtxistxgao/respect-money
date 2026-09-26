import { Select } from '../../Select.js';
import { t } from "../../../i18n/index.js";
import { useState } from 'react';
import { api, money, refreshData } from '../../api.js';
import { ErrorNotice } from '../../components.js';

type MatchTransaction = { id: string; description: string; accountName: string; postedDate: string; cashflowCents: number };
export type DuplicateGroup = { manual: MatchTransaction & { version: string }; candidates: MatchTransaction[] };
export function DuplicateReview({ groups }: { groups: DuplicateGroup[] }) {
  return groups.length > 0 && <section className="duplicate-review"><h2>{t("Review manual entries")}</h2><p>{t("These entries have the same amounts and nearby dates as bank transactions. After matching, only the bank record is counted; the manual original is preserved.")}</p>{groups.map((group) => <Candidate key={group.manual.id} group={group} />)}</section>;
}
function Candidate({ group }: { group: DuplicateGroup }) {
  const [selected, setSelected] = useState(group.candidates[0].id); const [error, setError] = useState<unknown>(); const [saving, setSaving] = useState(false);
  async function match() {
    setSaving(true); try { await api(`/transactions/${group.manual.id}/match`, { method: 'PUT', body: JSON.stringify({ version: group.manual.version, duplicateOf: selected }) }); await refreshData(); } catch (e) { setError(e); } finally { setSaving(false); }
  }
  return <div className="duplicate-item"><ErrorNotice error={error} /><div><strong>{group.manual.description}</strong><small>{group.manual.accountName} · {group.manual.postedDate} · {money(group.manual.cashflowCents)}</small></div><Select aria-label={t("Bank transaction matching {p0}", { p0: group.manual.description })} value={selected} onValueChange={(nextValue) => setSelected(nextValue)}>{group.candidates.map((t) => <option key={t.id} value={t.id}>{t.description} · {t.accountName} · {t.postedDate}</option>)}</Select><button className="button secondary" disabled={saving} onClick={() => void match()}>{t("Confirm match")}</button></div>;
}
