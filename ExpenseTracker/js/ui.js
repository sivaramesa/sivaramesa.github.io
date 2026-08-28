/* UI rendering helpers - pure DOM, no business logic. */
import {
  escapeHtml,
  formatMoney,
  formatDateTime,
  dateGroupKey,
  dateGroupLabel
} from './utils.js';

const $ = (sel) => document.querySelector(sel);

function accountName(accounts, id) {
  const a = (accounts || []).find((x) => x.id === id);
  return a ? a.name : 'Unassigned';
}

// A tag/link for an entry's zipped attachment bundle (if any).
function attachmentTag(e) {
  if (!e.attachmentUrl) return '';
  const n = e.attachmentCount || 1;
  return `<a class="entry-attach-tag" href="${escapeHtml(e.attachmentUrl)}" target="_blank" rel="noopener" download title="Download attachment zip">📎 ${n} file${n === 1 ? '' : 's'} (.zip)</a>`;
}

export const UI = {
  $,

  showAuth() {
    $('#auth-screen').hidden = false;
    $('#app').hidden = true;
  },

  showApp(profile) {
    $('#auth-screen').hidden = true;
    $('#app').hidden = false;
    $('#current-user').textContent = profile ? profile.name : '';
  },

  toast(message, type = 'info', ms = 2600) {
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast toast-' + type;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.hidden = true), ms);
  },

  setSyncStatus(online, sync) {
    const el = $('#sync-status');
    const pending = sync ? sync.pending : 0;
    const syncing = sync ? sync.syncing : false;

    el.classList.toggle('online', !!online);
    el.classList.toggle('offline', !online);
    el.classList.toggle('syncing', !!syncing);
    el.classList.toggle('pending', !online && pending > 0);

    if (!online && pending > 0) {
      el.textContent = '● ' + pending;
      el.title = `Offline - ${pending} change${pending === 1 ? '' : 's'} waiting to sync`;
    } else if (syncing) {
      el.textContent = '⟳';
      el.title = 'Syncing with cloud…';
    } else if (online && pending > 0) {
      el.textContent = '● ' + pending;
      el.title = `${pending} change${pending === 1 ? '' : 's'} pending upload`;
    } else {
      el.textContent = '●';
      el.title = online ? 'Online - synced with cloud' : 'Offline - changes will sync later';
    }
  },

  switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === name)
    );
    document.querySelectorAll('.tab-panel').forEach((p) =>
      p.classList.toggle('active', p.id === 'tab-' + name)
    );
  },

  /** Populate every account <select> in the app. */
  populateAccountSelects(accounts) {
    const selects = [
      { el: $('#entry-account'), placeholder: 'Select account head' },
      { el: $('#list-account-filter'), placeholder: 'All accounts' },
      { el: $('#history-account-filter'), placeholder: 'All accounts' },
      { el: $('#report-account-filter'), placeholder: 'All accounts' }
    ];
    for (const { el, placeholder } of selects) {
      if (!el) continue;
      const prev = el.value;
      el.innerHTML = `<option value="">${placeholder}</option>`;
      for (const a of accounts) {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name;
        el.appendChild(opt);
      }
      if (prev && accounts.some((a) => a.id === prev)) el.value = prev;
    }
    $('#no-accounts-hint').hidden = accounts.length > 0;
  },

  renderAccounts(accounts, entries, handlers) {
    const listEl = $('#account-list');
    const emptyEl = $('#accounts-empty');
    listEl.innerHTML = '';
    emptyEl.hidden = accounts.length > 0;

    // Pre-compute income/expense per account for a quick balance chip.
    const totals = {};
    for (const e of entries) {
      if (!totals[e.accountId]) totals[e.accountId] = { income: 0, expense: 0 };
      const v = Number(e.totalAmount || e.amount) || 0;
      if (e.type === 'income') totals[e.accountId].income += v;
      else totals[e.accountId].expense += v;
    }

    for (const a of accounts) {
      const t = totals[a.id] || { income: 0, expense: 0 };
      const balance = (Number(a.openingBalance) || 0) + t.income - t.expense;
      const card = document.createElement('div');
      card.className = 'account-card';
      card.innerHTML = `
        <div class="account-main">
          <div class="account-top">
            <span class="account-name">${escapeHtml(a.name)}</span>
            <span class="account-type">${escapeHtml(a.type || 'project')}</span>
          </div>
          ${a.description ? `<div class="account-desc">${escapeHtml(a.description)}</div>` : ''}
          <div class="account-meta">
            <span>Opening ${formatMoney(a.openingBalance)}</span>
            <span class="pos">In ${formatMoney(t.income)}</span>
            <span class="neg">Out ${formatMoney(t.expense)}</span>
          </div>
        </div>
        <div class="account-side">
          <span class="account-balance ${balance < 0 ? 'neg' : 'pos'}">${formatMoney(balance)}</span>
          <button class="account-del btn btn-ghost btn-sm" title="Delete" aria-label="Delete account">✕</button>
        </div>
      `;
      card.querySelector('.account-del').addEventListener('click', () => handlers.onDelete(a));
      listEl.appendChild(card);
    }
  },

  renderEntryList(entries, accounts, filters, currentUid, handlers) {
    const listEl = $('#entry-list');
    const emptyEl = $('#list-empty');
    const summaryEl = $('#list-summary');
    const q = (filters.text || '').trim().toLowerCase();

    let filtered = entries;
    if (filters.accountId) filtered = filtered.filter((e) => e.accountId === filters.accountId);
    if (filters.type) filtered = filtered.filter((e) => e.type === filters.type);
    if (q) {
      filtered = filtered.filter(
        (e) =>
          (e.description || '').toLowerCase().includes(q) ||
          (e.category || '').toLowerCase().includes(q) ||
          ((e.createdBy && e.createdBy.name) || '').toLowerCase().includes(q)
      );
    }

    // Summary chips
    let inc = 0, exp = 0;
    for (const e of filtered) {
      const v = Number(e.totalAmount || e.amount) || 0;
      if (e.type === 'income') inc += v; else exp += v;
    }
    summaryEl.innerHTML = `
      <span class="chip pos">Income ${formatMoney(inc)}</span>
      <span class="chip neg">Expense ${formatMoney(exp)}</span>
      <span class="chip">Net ${formatMoney(inc - exp)}</span>
    `;

    listEl.innerHTML = '';
    emptyEl.hidden = filtered.length > 0;

    for (const e of filtered) {
      const card = document.createElement('div');
      card.className = 'expense-card entry-' + (e.type === 'income' ? 'income' : 'expense');

      const who = (e.createdBy && e.createdBy.name) || 'Unknown';
      const mine = e.createdBy && e.createdBy.uid === currentUid;
      const acct = accountName(accounts, e.accountId);
      const sign = e.type === 'income' ? '+' : '−';
      const total = Number(e.totalAmount || e.amount) || 0;

      const gstHtml = e.gstEnabled
        ? `<span class="entry-gst">GST ${e.gstRate}% · ${formatMoney(e.gstAmount)}</span>`
        : '';

      card.innerHTML = `
        <div class="expense-main">
          <div class="expense-top">
            <span class="expense-amount ${e.type === 'income' ? 'pos' : 'neg'}">${sign}${formatMoney(total)}</span>
            <span class="expense-cat">${escapeHtml(e.category || '')}</span>
          </div>
          <div class="expense-desc">${escapeHtml(e.description || '(no description)')}</div>
          <div class="entry-tags">
            <span class="entry-account-tag">${escapeHtml(acct)}</span>
            ${gstHtml}
            ${attachmentTag(e)}
          </div>
          <div class="expense-meta">
            <span class="expense-who">${escapeHtml(who)}${mine ? ' (you)' : ''}</span>
            <span class="expense-when">${escapeHtml(formatDateTime(e.date))}</span>
          </div>
        </div>
        <button class="expense-del btn btn-ghost btn-sm" title="Delete" aria-label="Delete entry">✕</button>
      `;

      card.querySelector('.expense-del').addEventListener('click', () => handlers.onDelete(e));
      listEl.appendChild(card);
    }
  },

  /**
   * Full transaction history grouped by calendar day, newest first, with a
   * per-day total and a delete button on every transaction.
   */
  renderHistory(entries, accounts, filters, currentUid, handlers) {
    const listEl = $('#history-list');
    const emptyEl = $('#history-empty');
    const summaryEl = $('#history-summary');
    const q = (filters.text || '').trim().toLowerCase();

    let rows = entries.slice();
    if (filters.accountId) rows = rows.filter((e) => e.accountId === filters.accountId);
    if (filters.type) rows = rows.filter((e) => e.type === filters.type);
    if (q) {
      rows = rows.filter(
        (e) =>
          (e.description || '').toLowerCase().includes(q) ||
          (e.category || '').toLowerCase().includes(q) ||
          (accountName(accounts, e.accountId) || '').toLowerCase().includes(q) ||
          ((e.createdBy && e.createdBy.name) || '').toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    // Overall summary.
    let inc = 0, exp = 0;
    for (const e of rows) {
      const v = Number(e.totalAmount || e.amount) || 0;
      if (e.type === 'income') inc += v; else exp += v;
    }
    summaryEl.innerHTML = `
      <span class="chip">${rows.length} transaction${rows.length === 1 ? '' : 's'}</span>
      <span class="chip pos">In ${formatMoney(inc)}</span>
      <span class="chip neg">Out ${formatMoney(exp)}</span>
      <span class="chip">Net ${formatMoney(inc - exp)}</span>
    `;

    listEl.innerHTML = '';
    emptyEl.hidden = rows.length > 0;

    // Group into days (rows are already newest-first, so groups preserve order).
    const groups = [];
    const index = {};
    for (const e of rows) {
      const key = dateGroupKey(e.date);
      if (index[key] == null) {
        index[key] = groups.length;
        groups.push({ key, label: dateGroupLabel(e.date), items: [], dayNet: 0 });
      }
      const g = groups[index[key]];
      g.items.push(e);
      const v = Number(e.totalAmount || e.amount) || 0;
      g.dayNet += e.type === 'income' ? v : -v;
    }

    for (const g of groups) {
      const header = document.createElement('div');
      header.className = 'history-day-header';
      header.innerHTML = `
        <span class="history-day-label">${escapeHtml(g.label)}</span>
        <span class="history-day-net ${g.dayNet < 0 ? 'neg' : 'pos'}">${formatMoney(g.dayNet)}</span>
      `;
      listEl.appendChild(header);

      for (const e of g.items) {
        const who = (e.createdBy && e.createdBy.name) || 'Unknown';
        const mine = e.createdBy && e.createdBy.uid === currentUid;
        const acct = accountName(accounts, e.accountId);
        const sign = e.type === 'income' ? '+' : '−';
        const total = Number(e.totalAmount || e.amount) || 0;
        const gstHtml = e.gstEnabled
          ? `<span class="entry-gst">GST ${e.gstRate}%</span>`
          : '';

        const row = document.createElement('div');
        row.className = 'history-row entry-' + (e.type === 'income' ? 'income' : 'expense');
        row.innerHTML = `
          <div class="history-row-main">
            <div class="history-row-top">
              <span class="history-amount ${e.type === 'income' ? 'pos' : 'neg'}">${sign}${formatMoney(total)}</span>
              <span class="history-time">${escapeHtml(formatDateTime(e.date))}</span>
            </div>
            <div class="history-row-desc">${escapeHtml(e.description || e.category || '(no description)')}</div>
            <div class="entry-tags">
              <span class="entry-account-tag">${escapeHtml(acct)}</span>
              ${e.category ? `<span class="entry-cat-tag">${escapeHtml(e.category)}</span>` : ''}
              ${gstHtml}
              ${attachmentTag(e)}
              <span class="history-who">${escapeHtml(who)}${mine ? ' (you)' : ''}</span>
            </div>
          </div>
          <button class="history-del btn btn-ghost btn-sm" title="Delete transaction" aria-label="Delete transaction">✕</button>
        `;
        row.querySelector('.history-del').addEventListener('click', () => handlers.onDelete(e));
        listEl.appendChild(row);
      }
    }
  },

  /** Thumbnail previews of the attachments selected for the current entry. */
  renderAttachmentPreview(files, onRemove) {
    const wrap = $('#attach-preview');
    wrap.innerHTML = '';
    if (!files || !files.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    files.forEach((file, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'attach-thumb';
      const isImg = file.type && file.type.startsWith('image/');
      if (isImg) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.alt = file.name || 'attachment';
        img.onload = () => URL.revokeObjectURL(img.src);
        thumb.appendChild(img);
      } else {
        const doc = document.createElement('span');
        doc.className = 'attach-doc';
        doc.textContent = '📄';
        thumb.appendChild(doc);
      }
      if (file._sizeLabel) {
        const size = document.createElement('span');
        size.className = 'attach-size';
        size.textContent = file._sizeLabel;
        thumb.appendChild(size);
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'attach-thumb-del';
      del.setAttribute('aria-label', 'Remove attachment');
      del.textContent = '✕';
      del.addEventListener('click', () => onRemove(i));
      thumb.appendChild(del);
      wrap.appendChild(thumb);
    });
  },

  renderReport(report) {
    $('#bs-output').hidden = true;
    const out = $('#report-output');
    out.hidden = false;
    $('#report-heading').textContent = report.heading || 'Report';
    $('#report-income').textContent = formatMoney(report.income);
    $('#report-expense').textContent = formatMoney(report.expense);
    const netEl = $('#report-net');
    netEl.textContent = formatMoney(report.net);
    netEl.className = report.net < 0 ? 'neg' : 'pos';
    $('#report-gst').textContent = formatMoney(report.gstTotal);
    $('#report-count').textContent = String(report.count);

    // account breakdown (net per account)
    const acctRows = report.byAccount.map((r) => ({ label: r.label, amount: Math.abs(r.net), _net: r.net }));
    renderBreakdown('#report-by-account', acctRows, true);
    renderBreakdown('#report-by-category', report.byCategory);
    renderBreakdown('#report-by-person', report.byPerson);
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  renderBalanceSheet(bs) {
    $('#report-output').hidden = true;
    const out = $('#bs-output');
    out.hidden = false;
    $('#bs-heading').textContent = bs.heading;

    const tbody = $('#bs-rows');
    tbody.innerHTML = '';
    if (!bs.accountRows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-note">No account activity in this range.</td></tr>';
    }
    for (const r of bs.accountRows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.name)}</td>
        <td>${formatMoney(r.opening)}</td>
        <td class="pos">${formatMoney(r.income)}</td>
        <td class="neg">${formatMoney(r.expense)}</td>
        <td class="${r.closing < 0 ? 'neg' : 'pos'}">${formatMoney(r.closing)}</td>
      `;
      tbody.appendChild(tr);
    }

    $('#bs-opening-total').textContent = formatMoney(bs.openingTotal);
    $('#bs-income-total').textContent = formatMoney(bs.totalIncome);
    $('#bs-expense-total').textContent = formatMoney(bs.totalExpense);
    const closeEl = $('#bs-closing-total');
    closeEl.textContent = formatMoney(bs.closingTotal);
    closeEl.className = bs.closingTotal < 0 ? 'neg' : 'pos';

    $('#bs-gst-collected').textContent = formatMoney(bs.gstCollected);
    $('#bs-gst-paid').textContent = formatMoney(bs.gstPaid);
    $('#bs-gst-net').textContent = formatMoney(bs.gstNet);

    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

function renderBreakdown(target, rows, signed) {
  const el = $(target);
  el.innerHTML = '';
  if (!rows || !rows.length) {
    el.innerHTML = '<p class="empty-note">No data.</p>';
    return;
  }
  const max = rows[0].amount || 1;
  for (const r of rows) {
    const pct = Math.max(4, Math.round((r.amount / max) * 100));
    const displayAmount = signed && typeof r._net === 'number' ? r._net : r.amount;
    const cls = signed && typeof r._net === 'number' ? (r._net < 0 ? 'neg' : 'pos') : '';
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.innerHTML = `
      <div class="breakdown-label">${escapeHtml(r.label)}</div>
      <div class="breakdown-bar"><span style="width:${pct}%"></span></div>
      <div class="breakdown-amount ${cls}">${formatMoney(displayAmount)}</div>
    `;
    el.appendChild(row);
  }
}
