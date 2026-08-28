/* Reporting module - monthly / date-range reports, account-grouped reports,
 * and a balance sheet. Pure functions over an array of entry records.
 *
 * An entry has: type ('income'|'expense'), accountId, amount (base),
 * gstAmount, totalAmount, category, createdBy, date.
 */
import { csvEscape, formatDateTime, formatMoney } from './utils.js';

const num = (v) => Number(v) || 0;

/** Inclusive-of-start, exclusive-of-end filter on `date`. */
function inRange(entries, startMs, endMs) {
  return entries.filter((e) => {
    const t = new Date(e.date).getTime();
    return !isNaN(t) && t >= startMs && t < endMs;
  });
}

function monthBounds(monthValue) {
  const [y, m] = monthValue.split('-').map(Number);
  return {
    start: new Date(y, m - 1, 1).getTime(),
    end: new Date(y, m, 1).getTime(),
    label: new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  };
}

function rangeBounds(startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00').getTime();
  const endBase = new Date(endDate + 'T00:00:00');
  endBase.setDate(endBase.getDate() + 1); // make end inclusive
  return { start, end: endBase.getTime() };
}

function toSortedArr(obj) {
  return Object.entries(obj)
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Look up an account name by id from an accounts array. */
function accountNameMap(accounts) {
  const map = {};
  (accounts || []).forEach((a) => (map[a.id] = a.name));
  return map;
}

/**
 * Aggregate a set of entries into income/expense/net totals plus breakdowns.
 * `useTotal` controls whether amounts include GST (true) or are base (false).
 */
function aggregate(entries, accounts, useTotal) {
  const acctNames = accountNameMap(accounts);
  const val = (e) => (useTotal ? num(e.totalAmount || e.amount) : num(e.amount));

  let income = 0;
  let expense = 0;
  let gstTotal = 0;
  const byCategory = {};
  const byPerson = {};
  const byAccount = {};

  for (const e of entries) {
    const v = val(e);
    gstTotal += num(e.gstAmount);
    if (e.type === 'income') income += v;
    else expense += v;

    const cat = e.category || 'Other';
    byCategory[cat] = (byCategory[cat] || 0) + v;

    const person = (e.createdBy && (e.createdBy.name || e.createdBy.email)) || 'Unknown';
    byPerson[person] = (byPerson[person] || 0) + v;

    const acctLabel = acctNames[e.accountId] || 'Unassigned';
    if (!byAccount[acctLabel]) byAccount[acctLabel] = { income: 0, expense: 0 };
    if (e.type === 'income') byAccount[acctLabel].income += v;
    else byAccount[acctLabel].expense += v;
  }

  const byAccountArr = Object.entries(byAccount)
    .map(([label, v]) => ({ label, income: v.income, expense: v.expense, net: v.income - v.expense }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  return {
    income,
    expense,
    net: income - expense,
    gstTotal,
    count: entries.length,
    byCategory: toSortedArr(byCategory),
    byPerson: toSortedArr(byPerson),
    byAccount: byAccountArr,
    entries: entries.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))
  };
}

export const Reports = {
  /**
   * @param entries  all entries
   * @param monthValue "YYYY-MM"
   * @param opts { accounts, accountId (filter, optional), useTotal }
   */
  monthly(entries, monthValue, opts = {}) {
    const { start, end, label } = monthBounds(monthValue);
    let filtered = inRange(entries, start, end);
    if (opts.accountId) filtered = filtered.filter((e) => e.accountId === opts.accountId);
    const acctName = opts.accountId
      ? (accountNameMap(opts.accounts)[opts.accountId] || 'account')
      : null;
    return {
      ...aggregate(filtered, opts.accounts, opts.useTotal),
      heading: `Monthly - ${label}${acctName ? ' · ' + acctName : ''}`
    };
  },

  /**
   * @param entries  all entries
   * @param startDate "YYYY-MM-DD"
   * @param endDate   "YYYY-MM-DD"
   * @param opts { accounts, accountId, useTotal }
   */
  range(entries, startDate, endDate, opts = {}) {
    const { start, end } = rangeBounds(startDate, endDate);
    let filtered = inRange(entries, start, end);
    if (opts.accountId) filtered = filtered.filter((e) => e.accountId === opts.accountId);
    const acctName = opts.accountId
      ? (accountNameMap(opts.accounts)[opts.accountId] || 'account')
      : null;
    return {
      ...aggregate(filtered, opts.accounts, opts.useTotal),
      heading: `${startDate} to ${endDate}${acctName ? ' · ' + acctName : ''}`
    };
  },

  /**
   * Balance sheet for a date range: per-account opening balance + income
   * (credits) - expenses (debits) = closing balance, plus grand totals and
   * GST collected (on income) vs GST paid (on expenses).
   *
   * @param entries  all entries
   * @param accounts all account heads
   * @param startDate "YYYY-MM-DD"
   * @param endDate   "YYYY-MM-DD"
   * @param opts { useTotal }
   */
  balanceSheet(entries, accounts, startDate, endDate, opts = {}) {
    const useTotal = !!opts.useTotal;
    const { start, end } = rangeBounds(startDate, endDate);
    const filtered = inRange(entries, start, end);
    const val = (e) => (useTotal ? num(e.totalAmount || e.amount) : num(e.amount));

    // Seed every known account so accounts with no activity still show.
    const rows = {};
    (accounts || []).forEach((a) => {
      rows[a.id] = {
        id: a.id,
        name: a.name,
        type: a.type || 'project',
        opening: num(a.openingBalance),
        income: 0,
        expense: 0
      };
    });
    // Bucket for entries whose account was deleted / unassigned.
    const UNASSIGNED = '__unassigned__';
    rows[UNASSIGNED] = { id: UNASSIGNED, name: 'Unassigned', type: 'project', opening: 0, income: 0, expense: 0 };

    let totalIncome = 0;
    let totalExpense = 0;
    let gstCollected = 0; // GST on income
    let gstPaid = 0;      // GST on expenses

    for (const e of filtered) {
      const key = rows[e.accountId] ? e.accountId : UNASSIGNED;
      const v = val(e);
      if (e.type === 'income') {
        rows[key].income += v;
        totalIncome += v;
        gstCollected += num(e.gstAmount);
      } else {
        rows[key].expense += v;
        totalExpense += v;
        gstPaid += num(e.gstAmount);
      }
    }

    const accountRows = Object.values(rows)
      .map((r) => ({ ...r, closing: r.opening + r.income - r.expense }))
      .filter((r) => r.opening !== 0 || r.income !== 0 || r.expense !== 0)
      .sort((a, b) => b.closing - a.closing);

    const openingTotal = accountRows.reduce((s, r) => s + r.opening, 0);

    return {
      heading: `Balance sheet - ${startDate} to ${endDate}`,
      startDate,
      endDate,
      useTotal,
      accountRows,
      openingTotal,
      totalIncome,
      totalExpense,
      netMovement: totalIncome - totalExpense,
      closingTotal: openingTotal + totalIncome - totalExpense,
      gstCollected,
      gstPaid,
      gstNet: gstCollected - gstPaid,
      count: filtered.length
    };
  },

  /** CSV for a monthly/range report. */
  toCsv(report) {
    const header = ['Date', 'Type', 'Account', 'Category', 'Description', 'Amount', 'GST', 'Total', 'RecordedBy', 'HasPhoto'];
    const rows = report.entries.map((e) => [
      csvEscape(formatDateTime(e.date)),
      csvEscape(e.type),
      csvEscape(e._accountName || ''),
      csvEscape(e.category),
      csvEscape(e.description),
      csvEscape(num(e.amount).toFixed(2)),
      csvEscape(num(e.gstAmount).toFixed(2)),
      csvEscape(num(e.totalAmount || e.amount).toFixed(2)),
      csvEscape((e.createdBy && e.createdBy.name) || ''),
      csvEscape(e.photoUrl ? 'yes' : 'no')
    ]);
    const summary = [
      [],
      ['', '', '', '', 'Total income', csvEscape(num(report.income).toFixed(2))],
      ['', '', '', '', 'Total expense', csvEscape(num(report.expense).toFixed(2))],
      ['', '', '', '', 'Net', csvEscape(num(report.net).toFixed(2))],
      ['', '', '', '', 'GST', csvEscape(num(report.gstTotal).toFixed(2))]
    ];
    return [header, ...rows, ...summary].map((r) => r.join(',')).join('\r\n');
  },

  /** CSV for a balance sheet. */
  balanceSheetToCsv(bs) {
    const header = ['Account', 'Type', 'Opening', 'Income', 'Expense', 'Closing'];
    const rows = bs.accountRows.map((r) => [
      csvEscape(r.name),
      csvEscape(r.type),
      csvEscape(r.opening.toFixed(2)),
      csvEscape(r.income.toFixed(2)),
      csvEscape(r.expense.toFixed(2)),
      csvEscape(r.closing.toFixed(2))
    ]);
    const totals = [
      [],
      ['TOTALS', '', csvEscape(bs.openingTotal.toFixed(2)), csvEscape(bs.totalIncome.toFixed(2)), csvEscape(bs.totalExpense.toFixed(2)), csvEscape(bs.closingTotal.toFixed(2))],
      [],
      ['GST collected (on income)', csvEscape(bs.gstCollected.toFixed(2))],
      ['GST paid (on expenses)', csvEscape(bs.gstPaid.toFixed(2))],
      ['Net GST', csvEscape(bs.gstNet.toFixed(2))]
    ];
    return [header, ...rows, ...totals].map((r) => r.join(',')).join('\r\n');
  },

  // exposed for callers that want to format
  formatMoney
};
