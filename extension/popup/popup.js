/**
 * @file Menu du bouton de barre d'outils : mêmes actions que le menu contextuel,
 * plus l'ouverture du panneau latéral et des options.
 */

/* global browser */

const statusEl = document.getElementById('status');

/**
 * @param {string} message
 */
function showError(message) {
  statusEl.textContent = message;
  statusEl.hidden = false;
}

/**
 * @returns {Promise<browser.tabs.Tab|null>}
 */
async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

/**
 * Laisse au panneau latéral le temps d'enregistrer son listener avant le
 * premier événement SSE (même délai que côté background).
 */
function waitForSidebar() {
  return new Promise((resolve) => setTimeout(resolve, 250));
}

/**
 * @param {'translate' | 'summarize' | 'extract' | 'custom'} action
 */
async function runAction(action) {
  // sidebarAction.open() doit être appelé depuis le handler du clic,
  // avant tout await, sinon Firefox refuse (user input handler requis).
  const opening = browser.sidebarAction.open();

  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      showError('Aucun onglet actif.');
      return;
    }

    await opening;

    if (action === 'extract' || action === 'custom') {
      await browser.runtime.sendMessage({ type: 'setPendingSidebarIntent', action, tabId: tab.id });
      window.close();
      return;
    }

    await waitForSidebar();
    const response = await browser.runtime.sendMessage({
      type: 'startWebAction',
      streamId: Date.now(),
      tabId: tab.id,
      action,
    });
    if (response && response.ok === false) {
      showError(response.error || 'Échec du démarrage.');
      return;
    }
    window.close();
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Action impossible sur cette page.');
  }
}

for (const button of document.querySelectorAll('.menu-item[data-action]')) {
  button.addEventListener('click', () => {
    void runAction(button.dataset.action);
  });
}

document.getElementById('open-sidebar').addEventListener('click', () => {
  const opening = browser.sidebarAction.open();
  opening.then(() => window.close()).catch(() => window.close());
});

document.getElementById('open-options').addEventListener('click', () => {
  void browser.runtime.openOptionsPage().then(() => window.close());
});
