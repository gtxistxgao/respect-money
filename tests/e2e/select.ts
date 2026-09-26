import { type Locator } from '@playwright/test';

export async function selectOption(trigger: Locator, selection: string | { label: string }) {
  await trigger.click();
  const menu = trigger.page().getByRole('listbox');
  const option = typeof selection === 'string'
    ? menu.locator(`[role="option"][data-value=${JSON.stringify(selection)}]`)
    : menu.getByRole('option', { name: selection.label, exact: true });
  await option.click();
}
