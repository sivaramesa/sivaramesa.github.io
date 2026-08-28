/* Main application controller - wires auth, data, UI and the service worker. */
import { isConfigured } from './firebase-config.js';
import { Auth } from './auth.js';
import { DB } from './db.js';
import { Entries, computeGst } from './entries.js';
import { Accounts } from './accounts.js';
import { Sync } from './sync.js';
import { Reports } from './reports.js';
import { UI } from './ui.js';
import {
  authErrorMessage,
  isoToTimeInput,
  dateTimeToIso,
  currentMonthInput,
  todayDateInput,
  downloadFile,
  formatMoney
} from './utils.js';

const state = {
  entries: [],
  accounts: [],
  filters: { text: '', accountId: '', type: '' },
  historyFilters: { text: '', accountId: '', type: '' },
  photoFile: null,
  entryType: 'expense',
  lastReport: null,
  lastBalanceSheet: null,
  signupMode: false
};

// ---------------------------------------------------------------------------
// Bootstrapping
// ---------------------------------------------------------------------------
async function boot() {
  registerServiceWorker();
  await DB.init();

  if (!isConfigured) {
    UI.toast('Add your Firebase config in js/firebase-config.js to enable login & sync.', 'error', 6000);
  }

  wireAuthForm();
  wireAppControls();
  wireConnectivity();

  Auth.onChange(async (user) => {
    if (user) {
      UI.showApp(Auth.currentProfile());
      await onSignedIn();
    } else {
      Entries.unsubscribe();
      Accounts.unsubscribe();
      UI.showAuth();
    }
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) =>
        console.warn('SW registration failed:', e && e.message)
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Auth form
// ---------------------------------------------------------------------------
function wireAuthForm() {
  const form = UI.$('#login-form');
  const toggleBtn = UI.$('#auth-toggle-btn');

  toggleBtn.addEventListener('click', () => {
    state.signupMode = !state.signupMode;
    UI.$('#name-field').hidden = !state.signupMode;
    UI.$('#auth-title').textContent = state.signupMode ? 'Create account' : 'Sign in';
    UI.$('#auth-submit').textContent = state.signupMode ? 'Create account' : 'Sign in';
    UI.$('#auth-toggle-text').textContent = state.signupMode ? 'Already have an account?' : 'New here?';
    toggleBtn.textContent = state.signupMode ? 'Sign in instead' : 'Create an account';
    UI.$('#auth-error').hidden = true;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.$('#auth-error').hidden = true;
    const email = UI.$('#auth-email').value;
    const password = UI.$('#auth-password').value;
    const name = UI.$('#auth-name').value;
    const submit = UI.$('#auth-submit');
    submit.disabled = true;
    try {
      if (state.signupMode) await Auth.signUp(email, password, name);
      else await Auth.signIn(email, password);
      form.reset();
    } catch (err) {
      const el = UI.$('#auth-error');
      el.textContent = authErrorMessage(err);
      el.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Signed-in flow
// ---------------------------------------------------------------------------
async function onSignedIn() {
  // Instant render from local cache.
  state.accounts = await Accounts.getAllLocal();
  state.entries = await Entries.getAllLocal();
  UI.populateAccountSelects(state.accounts);
  renderAccounts();
  renderEntries();
  renderHistory();

  // Defaults.
  UI.$('#entry-date').value = todayDateInput();
  UI.$('#entry-time').value = isoToTimeInput();
  UI.$('#report-month').value = currentMonthInput();
  UI.$('#report-start').value = todayDateInput();
  UI.$('#report-end').value = todayDateInput();
  UI.$('#bs-start').value = firstOfMonth();
  UI.$('#bs-end').value = todayDateInput();

  UI.setSyncStatus(navigator.onLine);

  // Live subscriptions.
  Accounts.subscribe(
    (list) => {
      state.accounts = list;
      UI.populateAccountSelects(list);
      renderAccounts();
      renderEntries(); // account names may have changed
      renderHistory();
    },
    () => UI.toast('Account sync interrupted.', 'error')
  );
  Entries.subscribe(
    (list) => {
      state.entries = list;
      renderEntries();
      renderHistory();
      renderAccounts(); // balances depend on entries
    },
    () => UI.toast('Live sync interrupted. Showing cached data.', 'error')
  );

  // Reconcile with the server: push anything queued locally, then replace the
  // local mirror with authoritative Firebase data.
  Sync.flush().then(async (res) => {
    if (res && res.pushed > 0) {
      state.entries = await Entries.getAllLocal();
      state.accounts = await Accounts.getAllLocal();
      renderEntries();
      renderHistory();
      renderAccounts();
      UI.toast(`Synced ${res.pushed} offline change${res.pushed === 1 ? '' : 's'}.`, 'success');
    }
  });
}

function firstOfMonth() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

function renderEntries() {
  UI.renderEntryList(
    state.entries,
    state.accounts,
    state.filters,
    Auth.current() && Auth.current().uid,
    { onDelete: handleDeleteEntry }
  );
}

function renderAccounts() {
  UI.renderAccounts(state.accounts, state.entries, { onDelete: handleDeleteAccount });
}

function renderHistory() {
  UI.renderHistory(
    state.entries,
    state.accounts,
    state.historyFilters,
    Auth.current() && Auth.current().uid,
    { onDelete: handleDeleteEntry }
  );
}

async function handleDeleteEntry(entry) {
  if (!confirm('Delete this transaction? This cannot be undone.')) return;
  try {
    await Entries.remove(entry.id);
    state.entries = state.entries.filter((e) => e.id !== entry.id);
    renderEntries();
    renderHistory();
    renderAccounts();
    UI.toast('Transaction deleted.', 'success');
  } catch (err) {
    UI.toast('Delete failed: ' + (err && err.message), 'error');
  }
}

async function handleDeleteAccount(account) {
  const used = state.entries.some((e) => e.accountId === account.id);
  const msg = used
    ? 'This account head has entries. Deleting it keeps the entries but marks them Unassigned. Continue?'
    : 'Delete this account head?';
  if (!confirm(msg)) return;
  try {
    await Accounts.remove(account.id);
    state.accounts = state.accounts.filter((a) => a.id !== account.id);
    UI.populateAccountSelects(state.accounts);
    renderAccounts();
    UI.toast('Account head deleted.', 'success');
  } catch (err) {
    UI.toast('Delete failed: ' + (err && err.message), 'error');
  }
}

// ---------------------------------------------------------------------------
// App controls
// ---------------------------------------------------------------------------
function wireAppControls() {
  document.querySelectorAll('.tab-btn').forEach((btn) =>
    btn.addEventListener('click', () => UI.switchTab(btn.dataset.tab))
  );

  UI.$('#logout-btn').addEventListener('click', async () => {
    await Auth.logout();
    UI.toast('Signed out.', 'info');
  });

  // Manual "sync now" button.
  UI.$('#sync-btn').addEventListener('click', handleManualSync);

  // Entry type toggle
  document.querySelectorAll('.type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach((b) => b.classList.toggle('active', b === btn));
      state.entryType = btn.dataset.type;
      UI.$('#entry-type').value = state.entryType;
    });
  });

  // GST toggle + live preview
  const gstEnabled = UI.$('#gst-enabled');
  gstEnabled.addEventListener('change', () => {
    UI.$('#gst-fields').hidden = !gstEnabled.checked;
    updateGstPreview();
  });
  UI.$('#gst-rate').addEventListener('input', updateGstPreview);
  UI.$('#entry-amount').addEventListener('input', updateGstPreview);

  // Photo preview
  const photoInput = UI.$('#entry-photo');
  photoInput.addEventListener('change', () => {
    const file = photoInput.files && photoInput.files[0];
    state.photoFile = file || null;
    const wrap = UI.$('#photo-preview-wrap');
    if (file) {
      UI.$('#photo-preview').src = URL.createObjectURL(file);
      wrap.hidden = false;
    } else {
      wrap.hidden = true;
    }
  });
  UI.$('#photo-remove').addEventListener('click', () => {
    state.photoFile = null;
    photoInput.value = '';
    UI.$('#photo-preview-wrap').hidden = true;
  });

  UI.$('#entry-form').addEventListener('submit', handleAddEntry);
  UI.$('#account-form').addEventListener('submit', handleAddAccount);

  // List filters
  UI.$('#list-search').addEventListener('input', (e) => {
    state.filters.text = e.target.value;
    renderEntries();
  });
  UI.$('#list-account-filter').addEventListener('change', (e) => {
    state.filters.accountId = e.target.value;
    renderEntries();
  });
  UI.$('#list-type-filter').addEventListener('change', (e) => {
    state.filters.type = e.target.value;
    renderEntries();
  });

  // History filters
  UI.$('#history-search').addEventListener('input', (e) => {
    state.historyFilters.text = e.target.value;
    renderHistory();
  });
  UI.$('#history-account-filter').addEventListener('change', (e) => {
    state.historyFilters.accountId = e.target.value;
    renderHistory();
  });
  UI.$('#history-type-filter').addEventListener('change', (e) => {
    state.historyFilters.type = e.target.value;
    renderHistory();
  });

  // Reports
  UI.$('#run-monthly').addEventListener('click', () => {
    const month = UI.$('#report-month').value;
    if (!month) return UI.toast('Pick a month first.', 'error');
    state.lastReport = Reports.monthly(state.entries, month, reportOpts());
    tagEntriesWithAccountNames(state.lastReport);
    UI.renderReport(state.lastReport);
  });
  UI.$('#run-range').addEventListener('click', () => {
    const start = UI.$('#report-start').value;
    const end = UI.$('#report-end').value;
    if (!start || !end) return UI.toast('Pick both start and end dates.', 'error');
    if (start > end) return UI.toast('Start date must be before end date.', 'error');
    state.lastReport = Reports.range(state.entries, start, end, reportOpts());
    tagEntriesWithAccountNames(state.lastReport);
    UI.renderReport(state.lastReport);
  });
  UI.$('#report-export').addEventListener('click', () => {
    if (!state.lastReport) return;
    const csv = Reports.toCsv(state.lastReport);
    downloadFile(`ledger-report-${todayDateInput()}.csv`, csv, 'text/csv');
    UI.toast('Report exported.', 'success');
  });

  // Balance sheet
  UI.$('#run-balance-sheet').addEventListener('click', () => {
    const start = UI.$('#bs-start').value;
    const end = UI.$('#bs-end').value;
    if (!start || !end) return UI.toast('Pick both start and end dates.', 'error');
    if (start > end) return UI.toast('Start date must be before end date.', 'error');
    state.lastBalanceSheet = Reports.balanceSheet(state.entries, state.accounts, start, end, {
      useTotal: UI.$('#report-use-total').checked
    });
    UI.renderBalanceSheet(state.lastBalanceSheet);
  });
  UI.$('#bs-export').addEventListener('click', () => {
    if (!state.lastBalanceSheet) return;
    const csv = Reports.balanceSheetToCsv(state.lastBalanceSheet);
    downloadFile(`balance-sheet-${todayDateInput()}.csv`, csv, 'text/csv');
    UI.toast('Balance sheet exported.', 'success');
  });
}

function reportOpts() {
  return {
    accounts: state.accounts,
    accountId: UI.$('#report-account-filter').value || '',
    useTotal: UI.$('#report-use-total').checked
  };
}

// Attach readable account names to the report's entries for CSV export.
function tagEntriesWithAccountNames(report) {
  const map = {};
  state.accounts.forEach((a) => (map[a.id] = a.name));
  report.entries.forEach((e) => (e._accountName = map[e.accountId] || 'Unassigned'));
}

function updateGstPreview() {
  const amount = parseFloat(UI.$('#entry-amount').value) || 0;
  const enabled = UI.$('#gst-enabled').checked;
  const rate = parseFloat(UI.$('#gst-rate').value) || 0;
  const { gstAmount, totalAmount } = computeGst(amount, enabled, rate);
  UI.$('#gst-amount-preview').textContent = formatMoney(gstAmount);
  UI.$('#gst-total-preview').textContent = formatMoney(totalAmount);
}

async function handleAddEntry(e) {
  e.preventDefault();
  const errEl = UI.$('#entry-error');
  errEl.hidden = true;

  const amount = parseFloat(UI.$('#entry-amount').value);
  const accountId = UI.$('#entry-account').value;
  const category = UI.$('#entry-category').value.trim();
  const description = UI.$('#entry-description').value;
  const dateStr = UI.$('#entry-date').value;
  const timeStr = UI.$('#entry-time').value;
  const gstEnabled = UI.$('#gst-enabled').checked;
  const gstRate = parseFloat(UI.$('#gst-rate').value) || 0;

  const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; };

  if (!accountId) return fail('Select an account head. Create one in the Accounts tab if needed.');
  if (!(amount > 0)) return fail('Enter a valid amount greater than zero.');
  if (!dateStr) return fail('Pick a date for this transaction.');

  const dateIso = dateTimeToIso(dateStr, timeStr);

  const submit = UI.$('#entry-submit');
  submit.disabled = true;
  submit.textContent = state.photoFile ? 'Uploading…' : 'Saving…';

  try {
    await Entries.create(
      { type: state.entryType, accountId, amount, category, description, dateIso, gstEnabled, gstRate },
      state.photoFile
    );

    // Reset form (keep the selected type + account + date for fast repeat entry).
    UI.$('#entry-amount').value = '';
    UI.$('#entry-category').value = '';
    UI.$('#entry-description').value = '';
    UI.$('#entry-time').value = isoToTimeInput();
    UI.$('#gst-enabled').checked = false;
    UI.$('#gst-fields').hidden = true;
    updateGstPreview();
    state.photoFile = null;
    UI.$('#entry-photo').value = '';
    UI.$('#photo-preview-wrap').hidden = true;

    state.entries = await Entries.getAllLocal();
    renderEntries();
    renderHistory();
    renderAccounts();

    UI.toast(navigator.onLine ? 'Entry saved & synced.' : 'Saved offline - will sync later.', 'success');
    UI.switchTab('list');
  } catch (err) {
    fail('Could not save: ' + (err && err.message));
  } finally {
    submit.disabled = false;
    submit.textContent = 'Save entry';
  }
}

async function handleAddAccount(e) {
  e.preventDefault();
  const errEl = UI.$('#account-error');
  errEl.hidden = true;

  const name = UI.$('#account-name').value;
  const type = UI.$('#account-type').value;
  const openingBalance = UI.$('#account-opening').value;
  const description = UI.$('#account-description').value;

  const submit = UI.$('#account-submit');
  submit.disabled = true;
  try {
    await Accounts.create({ name, type, openingBalance, description });
    UI.$('#account-form').reset();
    UI.$('#account-opening').value = '0';
    state.accounts = await Accounts.getAllLocal();
    UI.populateAccountSelects(state.accounts);
    renderAccounts();
    UI.toast('Account head created.', 'success');
  } catch (err) {
    errEl.textContent = err && err.message;
    errEl.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Manual sync
// ---------------------------------------------------------------------------
async function handleManualSync() {
  const btn = UI.$('#sync-btn');
  if (!navigator.onLine) {
    UI.toast('You are offline. Changes will sync when you reconnect.', 'info');
    return;
  }
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    const res = await Sync.flush();
    if (Auth.current()) {
      state.entries = await Entries.getAllLocal();
      state.accounts = await Accounts.getAllLocal();
      renderEntries();
      renderHistory();
      renderAccounts();
    }
    if (res && res.pushed > 0) {
      UI.toast(`Synced ${res.pushed} change${res.pushed === 1 ? '' : 's'} to cloud.`, 'success');
    } else if (res && res.failed) {
      UI.toast('Sync had trouble. Will retry.', 'error');
    } else {
      UI.toast('Everything is up to date.', 'success');
    }
  } catch (e) {
    UI.toast('Sync failed: ' + (e && e.message), 'error');
  } finally {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------
function wireConnectivity() {
  const update = () => UI.setSyncStatus(navigator.onLine);

  // Reflect pending-op count + syncing state in the top-bar indicator.
  Sync.onStatus((s) => UI.setSyncStatus(navigator.onLine, s));

  window.addEventListener('online', async () => {
    update();
    UI.toast('Back online - syncing…', 'info');
    const res = await Sync.flush();
    if (res && (res.pushed > 0 || res.pulled >= 0) && Auth.current()) {
      // Refresh from the freshly-replaced local mirror.
      state.entries = await Entries.getAllLocal();
      state.accounts = await Accounts.getAllLocal();
      renderEntries();
      renderHistory();
      renderAccounts();
      if (res.pushed > 0) {
        UI.toast(`Pushed ${res.pushed} offline change${res.pushed === 1 ? '' : 's'} to cloud.`, 'success');
      }
    }
  });

  window.addEventListener('offline', () => {
    update();
    UI.toast('You are offline. Changes are saved locally and will sync later.', 'info');
  });
  update();
}

boot();
