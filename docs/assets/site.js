// This page is a standalone illustration. It never calls the ledger API.
const pageDocument = globalThis.document;
const tabs = [...pageDocument.querySelectorAll('[data-preview]')];

function selectPreview(tab) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    pageDocument.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  }
  for (const item of pageDocument.querySelectorAll('[data-sidebar]')) {
    item.classList.toggle('selected', item.dataset.sidebar === tab.dataset.preview);
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectPreview(tab));
  tab.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
    if (event.key === 'Home') next = tabs[0];
    if (event.key === 'End') next = tabs.at(-1);
    if (next) {
      event.preventDefault();
      selectPreview(next);
      next.focus();
    }
  });
});
