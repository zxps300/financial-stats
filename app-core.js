'use strict';
const KEY = 'btc-youth-v1';
const DEFAULT_INCOME_CATS = [
  'Youth Night Offering',
  'Joint Fellowship Offering',
  'Allocation from Church Funds',
  'Monthly Allowance',
  'Beginning Balance',
  'Offering',
  'Donation',
  'Fundraiser',
  'Dues'
];
const DEFAULT_EXPENSE_CATS = [
  'Monthly Allowance',
  'Food',
  'Transport',
  'Supplies',
  'Venue',
  'Materials',
  'Honorarium',
  'Other'
];
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const freshState = () => ({ currency: '₱', transactions: [], events: [], members: [], incomeCats: [...DEFAULT_INCOME_CATS], expenseCats: [...DEFAULT_EXPENSE_CATS] });
let S = JSON.parse(localStorage.getItem(KEY) || 'null') || freshState();
S.incomeCats ??= [...DEFAULT_INCOME_CATS]; S.expenseCats ??= [...DEFAULT_EXPENSE_CATS];
if (!S.incomeCats.includes('Monthly Allowance')) S.incomeCats.splice(3, 0, 'Monthly Allowance');
if (!S.expenseCats.includes('Monthly Allowance')) S.expenseCats.unshift('Monthly Allowance');

let view = 'monthly', filter = { q: '', type: '', event: '', allowanceOnly: false, sort: 'date', recentOnly: false }, period = 'all';
let selectedTxIds = new Set();
let activeMonth = today().slice(0, 7);
let msFundTab = 'all'; // 'all' | 'general' | 'allowance'
window.setMsFundTab = function(tab) { msFundTab = tab || 'all'; render(); };
let reportMode = localStorage.getItem('btc-rep-mode') || 'monthly'; // 'monthly' | 'annual'
let reportMonth = localStorage.getItem('btc-rep-month') || '';
let reportYear = localStorage.getItem('btc-rep-year') || '';

const inPeriod = t => period === 'all' || t.date.startsWith(period);
let save = () => { localStorage.setItem(KEY, JSON.stringify(S)); render(); };
/* One money style everywhere: ₱1,234.50 and -₱155.00 (a stray "P"/"PHP" currency is shown as ₱). */
const money = n => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const cur = /^(p|php)$/i.test(String(S.currency || '').trim()) ? '₱' : (S.currency || '₱');
  const s = cur + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? '-' + s : s;
};
const signedMoney = n => ((Math.round((Number(n) || 0) * 100) / 100) > 0 ? '+' : '') + money(n);
const sum = (arr) => arr.reduce((a, t) => a + t.amount, 0);
const inc = () => S.transactions.filter(t => t.type === 'income' && t.status !== 'void');
const exp = () => S.transactions.filter(t => t.type === 'expense' && t.status !== 'void');
const generalInc = () => inc().filter(t => !isAllowanceInc(t));
const generalExp = () => exp().filter(t => !isAllowanceExp(t));
const allowanceBalance = () => sum(inc().filter(isAllowanceInc)) - sum(exp().filter(isAllowanceExp));
const generalBalance = () => {
  const ym = today().slice(0, 7);
  const dates = S.transactions.filter(t => t.status !== 'void' && t.date && !isAllowanceInc(t) && !isAllowanceExp(t)).map(t => t.date.slice(0, 7)).sort();
  if (!dates.length) return 0;
  const latestYm = dates[dates.length - 1] > ym ? dates[dates.length - 1] : ym;
  const [y, mo] = latestYm.split('-').map(Number);
  const next = new Date(y, mo, 1);
  const nextYm = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  return getCarriedBeginningBalance(nextYm);
};
const balance = () => generalBalance();
const evName = id => (S.events.find(e => e.id === id) || {}).name || '—';
const memName = id => (S.members.find(m => m.id === id) || {}).name || '';

/* ---------- allowance & fund helpers ---------- */
const isAllowanceInc = t => t.type === 'income' && (
  t.fund === 'allowance' ||
  (!t.fund && (
    t.category === 'Allocation from Church Funds' ||
    t.category === 'Monthly Allowance' ||
    (t.notes || '').includes('[Allowance]') ||
    (t.notes || '').toLowerCase().includes('church allocation') ||
    (t.notes || '').toLowerCase().includes('church funds')
  ))
);

const isAllowanceExp = t => t.type === 'expense' && (
  t.fund === 'allowance' ||
  (!t.fund && (
    t.category === 'Monthly Allowance' ||
    (t.notes || '').includes('[Allowance]') ||
    (t.notes || '').toLowerCase().includes('monthly allowance')
  ))
);

const cleanNotes = s => (s || '').replace(/\[Allowance\]/gi, '').trim();

function getMonthlyAllowance(yearMonth) {
  const ym = yearMonth || getActiveMonth();
  const allocTxs = inc().filter(t => isAllowanceInc(t) && t.date.startsWith(ym));
  const expTxs = exp().filter(t => isAllowanceExp(t) && t.date.startsWith(ym));
  const allocated = sum(allocTxs);
  const spent = sum(expTxs);
  const remaining = allocated - spent;
  return { ym, allocated, spent, remaining, allocTxs, expTxs };
}

function getYearlyAllowance(year) {
  const y = String(year || new Date().getFullYear());
  const allocTxs = inc().filter(t => isAllowanceInc(t) && t.date.startsWith(y));
  const expTxs = exp().filter(t => isAllowanceExp(t) && t.date.startsWith(y));
  const allocated = sum(allocTxs);
  const spent = sum(expTxs);
  const remaining = allocated - spent;
  return { year: y, allocated, spent, remaining, allocTxs, expTxs };
}

/* ---------- calendar & church helpers ---------- */
function getFridaysForMonth(year, month) {
  const fridays = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() === 5) { // 5 = Friday
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      fridays.push({
        date: `${yyyy}-${mm}-${dd}`,
        day: d.getDate(),
        formatted: `${d.toLocaleDateString('en-US', { month: 'short' })}. ${d.getDate()}`,
        display: `Friday, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      });
    }
    d.setDate(d.getDate() + 1);
  }
  return fridays;
}

function getLastSundayForMonth(year, month) {
  const d = new Date(year, month, 0); // last day of month
  while (d.getDay() !== 0) { // 0 = Sunday
    d.setDate(d.getDate() - 1);
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return {
    date: `${yyyy}-${mm}-${dd}`,
    day: d.getDate(),
    formatted: `${d.toLocaleDateString('en-US', { month: 'short' })}. ${d.getDate()}`,
    display: `Last Sunday (${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
  };
}

const DEFAULT_SIGNATORIES = {
  preparedName: 'Earl Justine C. Santiago',
  preparedTitle: 'COYAP Treasurer',
  notedName: 'Bryan Lee J. Sugue',
  notedTitle: 'COYAP President',
  recommendingName: 'Ptr. Restituto Y. Telmo, Jr.',
  recommendingTitle: 'Youth Pastor',
  approvedName: 'Ptra. Evangeline S. Auza',
  approvedTitle: 'Senior Pastor'
};

function getSignatories() {
  try {
    const s = localStorage.getItem('coyap-signatories');
    return s ? { ...DEFAULT_SIGNATORIES, ...JSON.parse(s) } : DEFAULT_SIGNATORIES;
  } catch (e) {
    return DEFAULT_SIGNATORIES;
  }
}

function signatoriesForm() {
  const sig = getSignatories();
  openModal(`<h2>⚙️ Signatures &amp; Roles</h2>
    <form id="sig-form">
      <p class="mute">Configure names and titles for the official printed Cash Accountability Report.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label>Prepared by (Name)<input name="preparedName" value="${esc(sig.preparedName)}" required></label>
        <label>Prepared by (Title)<input name="preparedTitle" value="${esc(sig.preparedTitle)}" required></label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label>Noted by (Name)<input name="notedName" value="${esc(sig.notedName)}" required></label>
        <label>Noted by (Title)<input name="notedTitle" value="${esc(sig.notedTitle)}" required></label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label>Recommending Approval (Name)<input name="recommendingName" value="${esc(sig.recommendingName)}" required></label>
        <label>Recommending Approval (Title)<input name="recommendingTitle" value="${esc(sig.recommendingTitle)}" required></label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label>Approved by (Name)<input name="approvedName" value="${esc(sig.approvedName)}" required></label>
        <label>Approved by (Title)<input name="approvedTitle" value="${esc(sig.approvedTitle)}" required></label>
      </div>
      <div class="row" style="margin-top:12px">
        <button type="button" class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn">Save Signatures</button>
      </div>
    </form>`);
  $('#sig-form').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const updated = {
      preparedName: f.get('preparedName'),
      preparedTitle: f.get('preparedTitle'),
      notedName: f.get('notedName'),
      notedTitle: f.get('notedTitle'),
      recommendingName: f.get('recommendingName'),
      recommendingTitle: f.get('recommendingTitle'),
      approvedName: f.get('approvedName'),
      approvedTitle: f.get('approvedTitle')
    };
    localStorage.setItem('coyap-signatories', JSON.stringify(updated));
    closeModal();
    render();
  };
}

function getActiveMonth() {
  if (activeMonth && activeMonth.length === 7) return activeMonth;
  if (reportMonth && reportMonth.length === 7) return reportMonth;
  if (period !== 'all' && period.length === 7) return period;
  return today().slice(0, 7);
}

function setActiveMonth(ym) {
  if (!ym || ym.length !== 7) return;
  activeMonth = ym;
  localStorage.setItem('btc-active-month', ym);
  render();
}

function shiftActiveMonth(delta) {
  const [y, mo] = getActiveMonth().split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  setActiveMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
}

function showToast(msg) {
  document.querySelectorAll('.ms-toast').forEach(el => el.remove());
  const el = document.createElement('div');
  el.className = 'ms-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function getSkipReasons() {
  try {
    const raw = JSON.parse(localStorage.getItem('btc-skipped-slots') || '{}');
    if (Array.isArray(raw)) {
      const obj = {};
      raw.forEach(k => { obj[k] = 'No meeting'; });
      return obj;
    }
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    return {};
  }
}

function getSkippedSlots() {
  return new Set(Object.keys(getSkipReasons()));
}

function getSkipReason(slotKey) {
  return getSkipReasons()[slotKey] || '';
}

window.setSkipReason = function(slotKey, reason) {
  const map = getSkipReasons();
  const clean = String(reason || '').trim();
  if (clean) map[slotKey] = clean;
  else delete map[slotKey];
  localStorage.setItem('btc-skipped-slots', JSON.stringify(map));
  if (typeof window.onPrefsChanged === 'function') window.onPrefsChanged();
  render();
};

window.toggleSkipSlot = function(slotKey, label) {
  const map = getSkipReasons();
  if (map[slotKey]) {
    delete map[slotKey];
    localStorage.setItem('btc-skipped-slots', JSON.stringify(map));
    if (typeof window.onPrefsChanged === 'function') window.onPrefsChanged();
    render();
    showToast('Restored slot');
  } else {
    window.openSkipReasonModal(slotKey, label || slotKey);
  }
};

window.openSkipReasonModal = function(slotKey, label) {
  const current = getSkipReason(slotKey);
  const presets = ['No meeting', 'Typhoon / Heavy rain', 'Holiday', 'Youth Camp / Event', 'Joint Service', 'No collection'];
  openModal(`<h2>📝 Reason Why Missing</h2>
    <p class="mute" style="margin-bottom:10px">Record why <b>${esc(label)}</b> has no offering or entry.</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
      ${presets.map(p => `<button type="button" class="btn sm ghost" style="font-size:11px;padding:4px 9px" onclick="const i=document.getElementById('skip-reason-inp');if(i){i.value='${esc(p)}';i.focus();}">${esc(p)}</button>`).join('')}
    </div>
    <form id="skip-reason-form">
      <label>Reason
        <input type="text" id="skip-reason-inp" name="reason" value="${esc(current)}" placeholder="e.g. Typhoon, Youth Camp, No Youth Night…" required autocomplete="off">
      </label>
      <div class="row" style="justify-content:space-between;gap:8px;margin-top:12px">
        ${current ? `<button type="button" class="btn sm ghost danger" id="skip-reason-clear">Remove Reason</button>` : '<span></span>'}
        <div style="display:flex;gap:8px">
          <button type="button" class="btn ghost" onclick="closeModal()">Cancel</button>
          <button class="btn">💾 Save Reason</button>
        </div>
      </div>
    </form>`);
  const clr = $('#skip-reason-clear');
  if (clr) clr.onclick = () => { closeModal(); window.setSkipReason(slotKey, ''); showToast('Removed reason'); };
  $('#skip-reason-form').onsubmit = e => {
    e.preventDefault();
    const reason = String(new FormData(e.target).get('reason') || '').trim();
    if (!reason) return;
    closeModal();
    window.setSkipReason(slotKey, reason);
    showToast(`📝 Saved reason: ${reason}`);
  };
};

function isBeginningTx(t) {
  return t.type === 'income' && (
    t.category === 'Beginning Balance' ||
    (t.category || '').toLowerCase().includes('beginning') ||
    (t.notes || '').toLowerCase().includes('beginning')
  );
}

/* Walk prior months cleanly for YOUTH GENERAL FUND only (excludes Church Allowance so funds stay separate) */
function getCarriedBeginningBalance(targetYm) {
  const prior = S.transactions.filter(t => t.status !== 'void' && t.date && t.date < `${targetYm}-01` && !isAllowanceInc(t) && !isAllowanceExp(t));
  if (!prior.length) return 0;
  const byMonth = {};
  prior.forEach(t => {
    const ym = t.date.slice(0, 7);
    (byMonth[ym] ||= []).push(t);
  });
  let running = 0;
  Object.keys(byMonth).sort().forEach(ym => {
    const list = byMonth[ym];
    const mInc = list.filter(t => t.type === 'income');
    const mExp = list.filter(t => t.type === 'expense');
    const begEntries = mInc.filter(isBeginningTx);
    if (begEntries.length) running = sum(begEntries);
    const regularInc = mInc.filter(t => !isBeginningTx(t));
    running = running + sum(regularInc) - sum(mExp);
  });
  return running;
}

function getMonthLedger(targetYm) {
  const ym = targetYm || getActiveMonth();
  const [yStr, moStr] = ym.split('-');
  const y = parseInt(yStr, 10), mo = parseInt(moStr, 10);
  const todayStr = today();
  const currentYm = todayStr.slice(0, 7);
  const skipped = getSkippedSlots();

  const fridaysRaw = getFridaysForMonth(y, mo);
  const lastSunRaw = getLastSundayForMonth(y, mo);
  const monthTitle = new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const shortTitle = new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'short' });

  const mAll = S.transactions.filter(t => t.status !== 'void' && t.date && t.date.startsWith(ym)).sort((a, b) => a.date.localeCompare(b.date));
  const mApproved = mAll;
  const incList = mApproved.filter(t => t.type === 'income');
  const expApproved = mApproved.filter(t => t.type === 'expense');
  const expAll = mAll.filter(t => t.type === 'expense');

  // Beginning balance (General Youth Fund)
  const begEntries = incList.filter(isBeginningTx);
  const hasExplicitBeg = begEntries.length > 0;
  const carriedBegBal = getCarriedBeginningBalance(ym);
  const begBal = hasExplicitBeg ? sum(begEntries) : carriedBegBal;

  // Regular inflows
  const regularInc = incList.filter(t => !isBeginningTx(t));
  const ynAll = regularInc.filter(t => t.category === 'Youth Night Offering');
  const fridayDates = new Set(fridaysRaw.map(f => f.date));

  const fridays = fridaysRaw.map(f => {
    const entries = ynAll.filter(t => t.date === f.date);
    const total = sum(entries);
    const skipKey = `yn:${f.date}`;
    const isSkipped = skipped.has(skipKey);
    const isPastOrToday = f.date <= todayStr;
    const status = entries.length ? 'recorded' : (isSkipped ? 'skipped' : (isPastOrToday ? 'missing' : 'upcoming'));
    return { ...f, entries, primary: entries[0] || null, total, skipKey, status };
  });

  // Any Youth Night Offering logged on a non-Friday (e.g., moved to Thursday)
  const extraYnEntries = ynAll.filter(t => !fridayDates.has(t.date));
  const totalYN = sum(ynAll);

  // Joint Fellowship Offering (Last Sunday or any JF in month)
  const jfEntries = regularInc.filter(t => t.category === 'Joint Fellowship Offering');
  const totalJF = sum(jfEntries);
  const jfSkipKey = `jf:${ym}`;
  const jfStatus = jfEntries.length ? 'recorded' : (skipped.has(jfSkipKey) ? 'skipped' : (lastSunRaw.date <= todayStr ? 'missing' : 'upcoming'));
  const lastSun = { ...lastSunRaw, entries: jfEntries, primary: jfEntries[0] || null, total: totalJF, skipKey: jfSkipKey, status: jfStatus };

  // SEPARATED: Allocation from Church Funds (Monthly Allowance)
  const allocEntries = regularInc.filter(t => isAllowanceInc(t) && t.category !== 'Youth Night Offering' && t.category !== 'Joint Fellowship Offering');
  const totalAlloc = sum(allocEntries);
  const allocSkipKey = `alloc:${ym}`;
  const isFutureMonth = ym > currentYm;
  const allocStatus = allocEntries.length ? 'recorded' : (skipped.has(allocSkipKey) ? 'skipped' : (!isFutureMonth ? 'missing' : 'upcoming'));

  // Other general income (donations, dues, fundraisers, etc. — excludes Church Allowance)
  const otherInc = regularInc.filter(t => t.category !== 'Youth Night Offering' && t.category !== 'Joint Fellowship Offering' && !allocEntries.includes(t));
  const totalOtherInc = sum(otherInc);

  // General Youth Fund totals (STRICTLY SEPARATED from Church Allowance)
  const totalOfferings = totalYN + totalJF + totalOtherInc;
  const totalCashOnHand = begBal + totalOfferings;

  // Expenses strictly separated: General Youth Fund vs Church Monthly Allowance
  const allowExpAll = expAll.filter(t => isAllowanceExp(t));
  const genExpAll = expAll.filter(t => !isAllowanceExp(t));
  const allowExpList = expApproved.filter(t => isAllowanceExp(t));
  const genExpList = expApproved.filter(t => !isAllowanceExp(t));
  const totalAllowExp = sum(allowExpList);
  const totalGenExp = sum(genExpList);
  const totalExpenses = totalGenExp; // General Fund expenses only
  const netCashOnHand = totalCashOnHand - totalGenExp; // General Youth Fund Net Cash on Hand

  // Separated Allowance Balance (this month + YTD)
  const allow = { allocated: totalAlloc, spent: totalAllowExp, remaining: totalAlloc - totalAllowExp };
  const yearAllow = getYearlyAllowance(y);
  const combinedCash = netCashOnHand + allow.remaining;

  // Build missing list (items scheduled on or before today that haven't been entered or skipped)
  const missingItems = [];
  if (!isFutureMonth) {
    fridays.forEach(f => {
      if (f.status === 'missing') {
        missingItems.push({ kind: 'yn', date: f.date, label: `Youth Night (${f.formatted})`, slotId: `ms-yn-${f.date}` });
      }
    });
    if (lastSun.status === 'missing') {
      missingItems.push({ kind: 'jf', date: lastSun.date, label: `Joint Fellowship (${lastSun.formatted})`, slotId: `ms-jf-${ym}` });
    }
    if (allocStatus === 'missing') {
      missingItems.push({ kind: 'alloc', date: `${ym}-01`, label: 'Church Allocation', slotId: `ms-alloc-${ym}` });
    }
  }

  return {
    ym, year: y, month: mo, monthTitle, shortTitle,
    isCurrentMonth: ym === currentYm,
    isFutureMonth,
    hasActivity: mAll.length > 0,
    begEntries, begPrimary: begEntries[0] || null, hasExplicitBeg, carriedBegBal, begBal,
    fridays, extraYnEntries, totalYN,
    lastSun, jfEntries, totalJF,
    allocEntries, allocPrimary: allocEntries[0] || null, totalAlloc, allocStatus, allocSkipKey,
    otherInc, totalOtherInc,
    totalOfferings, totalCashOnHand,
    expAll, expApproved, genExpAll, allowExpAll, genExpList, allowExpList, totalGenExp, totalAllowExp, totalExpenses,
    netCashOnHand, allow, yearAllow, combinedCash, missingItems
  };
}

function getEarliestTrackedMonth() {
  const dates = S.transactions.filter(t => t.status !== 'void' && t.date).map(t => t.date.slice(0, 7)).sort();
  return dates.length ? dates[0] : today().slice(0, 7);
}

window._doClearAllData = async function() {
  S = freshState();
  localStorage.removeItem(KEY);
  localStorage.removeItem('btc-skipped-slots');
  Object.keys(localStorage).filter(k => k.startsWith('btc-annual-')).forEach(k => localStorage.removeItem(k));
  closeModal();
  save();
  showToast('✔ All data cleared');
};

window.recordUploadBatch = function(ids, label) {
  if (!ids || !ids.length) return;
  localStorage.setItem('btc-last-upload-batch', JSON.stringify({
    ids,
    label: label || `Upload (${ids.length})`,
    at: new Date().toISOString()
  }));
};

function getRecentUploadIds() {
  const activeIds = new Set(S.transactions.filter(t => t.status !== 'void').map(t => t.id));
  try {
    const saved = JSON.parse(localStorage.getItem('btc-last-upload-batch') || 'null');
    if (saved && Array.isArray(saved.ids)) {
      const stillThere = saved.ids.filter(id => activeIds.has(id));
      if (stillThere.length) return stillThere;
    }
  } catch (_) {}
  // Fallback for uploads made before batch tracking: group entries within 3 minutes of the latest createdAt
  const withTs = S.transactions
    .filter(t => t.status !== 'void' && t.createdAt)
    .map(t => ({ id: t.id, ts: Date.parse(t.createdAt) }))
    .filter(x => isFinite(x.ts))
    .sort((a, b) => b.ts - a.ts);
  if (!withTs.length) return [];
  const newest = withTs[0].ts;
  return withTs.filter(x => newest - x.ts <= 3 * 60 * 1000).map(x => x.id);
}

window._doDeleteTransactions = async function(ids) {
  const delSet = new Set(ids);
  S.transactions = S.transactions.filter(t => !delSet.has(t.id));
  ids.forEach(id => selectedTxIds.delete(id));
  save();
  showToast(`🗑️ Deleted ${ids.length} ${ids.length === 1 ? 'transaction' : 'transactions'}`);
};

window.deleteSelectedTxs = async function(idsArg) {
  const ids = Array.isArray(idsArg) ? idsArg : [...selectedTxIds];
  if (!ids.length) return;
  if (!confirm(`Permanently delete ${ids.length} ${ids.length === 1 ? 'transaction' : 'transactions'}? This cannot be undone.`)) return;
  await window._doDeleteTransactions(ids);
};

window.toggleTxSelect = function(id, checked) {
  if (checked) selectedTxIds.add(id);
  else selectedTxIds.delete(id);
  render();
};

window.toggleSelectAllVisible = function(checked) {
  const boxes = [...document.querySelectorAll('.tx-sel-chk')];
  boxes.forEach(b => {
    if (checked) selectedTxIds.add(b.dataset.id);
    else selectedTxIds.delete(b.dataset.id);
  });
  render();
};

window.selectRecentUpload = function() {
  const recent = getRecentUploadIds();
  if (!recent.length) {
    showToast('No recent upload found');
    return;
  }
  filter.sort = 'recent';
  filter.recentOnly = true;
  selectedTxIds = new Set(recent);
  render();
  showToast(`Selected ${recent.length} recently uploaded ${recent.length === 1 ? 'entry' : 'entries'}`);
};

window.clearTxSelection = function() {
  selectedTxIds.clear();
  filter.recentOnly = false;
  render();
};

window.clearAllData = function() {
  const isCloud = typeof sb !== 'undefined';
  openModal(`<h2>🗑️ Clear All Data</h2>
    <p class="mute" style="margin-bottom:12px">This will permanently clear all <b>transactions, events, and members</b>${isCloud ? ' from your Supabase database (your login PIN and categories are kept)' : ' from this browser'}.</p>
    <form id="clear-all-form">
      <label>Type <b>DELETE</b> to confirm:
        <input type="text" name="confirm" placeholder="DELETE" autocomplete="off" required>
      </label>
      <p class="mute" id="clear-all-msg" style="color:var(--bad)"></p>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px">
        <button type="button" class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn alt" id="clear-all-submit">🗑️ Clear All Data</button>
      </div>
    </form>`);
  $('#clear-all-form').onsubmit = async e => {
    e.preventDefault();
    const val = String(new FormData(e.target).get('confirm') || '').trim().toUpperCase();
    const msg = $('#clear-all-msg');
    if (val !== 'DELETE') {
      msg.textContent = 'Please type DELETE to confirm.';
      return;
    }
    const btn = $('#clear-all-submit');
    btn.disabled = true;
    btn.textContent = 'Clearing…';
    msg.textContent = '';
    try {
      await window._doClearAllData();
    } catch (err) {
      msg.textContent = err?.message || String(err);
      btn.disabled = false;
      btn.textContent = '🗑️ Clear All Data';
    }
  };
};

window.openToolsModal = function() {
  const isCloud = typeof sb !== 'undefined';
  const isTreasurer = !isCloud || (typeof isT === 'function' && isT());
  const canEdit = !isCloud || (typeof canAdd === 'function' && canAdd());
  const hasLegacy = isCloud && typeof legacy !== 'undefined' && legacy && (legacy.transactions?.length || legacy.events?.length || legacy.members?.length) && !localStorage.getItem(KEY + '-imported');

  openModal(`<h2>⚙️ Tools &amp; Data</h2>
    <p class="mute" style="margin-bottom:6px">Manage imports, exports, backups, and settings.</p>
    <div class="tools-grid">
      ${canEdit ? `<button class="tool-tile" onclick="closeModal();batchOfferingsModal(getActiveMonth())"><strong>📅 Batch Month Editor</strong><small>Edit an entire month side-by-side</small></button>` : ''}
      <button class="tool-tile" onclick="closeModal();allowanceTrackerModal(getActiveMonth())"><strong>💳 Allowance Tracker</strong><small>View separated church allowance details</small></button>
      ${typeof window.dataCheck === 'function' ? `<button class="tool-tile" onclick="closeModal();window.dataCheck()"><strong>🩺 Data Check</strong><small>Find duplicates &amp; balance gaps</small></button>` : ''}
      ${typeof window.exportExcel === 'function' ? `<button class="tool-tile" onclick="closeModal();window.exportExcel()"><strong>📊 Export to Excel</strong><small>Download .xlsx report workbook</small></button>` : ''}
      ${canEdit && typeof window.importExcelReport === 'function' ? `<button class="tool-tile" onclick="closeModal();window.importExcelReport()"><strong>📥 Import Excel Report</strong><small>Load 2026 financial report data</small></button>` : ''}
      ${isTreasurer ? `<button class="tool-tile" onclick="closeModal();catForm()"><strong>🏷️ Manage Categories</strong><small>Customize income &amp; expense labels</small></button>` : ''}
      ${typeof window.backupData === 'function' ? `<button class="tool-tile" onclick="closeModal();window.backupData()"><strong>💾 Backup Data</strong><small>Save full JSON copy</small></button>` : ''}
      ${isTreasurer && typeof window.restoreData === 'function' ? `<button class="tool-tile" onclick="closeModal();window.restoreData()"><strong>♻️ Import Backup (JSON)</strong><small>Restore or merge a JSON backup file</small></button>` : ''}
      ${typeof window.installApp === 'function' ? `<button class="tool-tile" onclick="closeModal();window.installApp()"><strong>📲 Install App</strong><small>Add to phone or desktop home screen</small></button>` : ''}
      ${isCloud && typeof window.openResetPasswordModal === 'function' ? `<button class="tool-tile" onclick="closeModal();window.openResetPasswordModal()"><strong>🔢 Change 6-Digit PIN</strong><small>Update your private unlock PIN</small></button>` : ''}
      ${hasLegacy ? `<button class="tool-tile" onclick="closeModal();importLegacy()"><strong>📦 Import Old Browser Data</strong><small>Move local entries to shared cloud</small></button>` : ''}
      ${!isCloud ? `<button class="tool-tile" onclick="closeModal();sample()"><strong>✨ Load Sample Data</strong><small>Try the app with demo records</small></button>` : ''}
      ${isTreasurer ? `<button class="tool-tile danger" onclick="window.clearAllData()"><strong>🗑️ Clear All Data</strong><small>Delete all transactions, events &amp; members</small></button>` : ''}
    </div>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" onclick="closeModal()">Close</button>
    </div>`);
};

/* ---------- annual net summary calculation ----------
   Ledger chain (always computed, never typed):
     inflow    = friday + joint fellowship (+ other general income, 0 if none)
     net       = inflow - expenses
     beginning = opening (Jan)  |  previous month's ending (Feb-Dec)
     ending    = beginning + net + adjustment   (adjustment defaults to 0)
   Typed "Beginning Balance" transactions are NOT deleted: they are kept as reported_beginning
   and only used for the Reconciliation section. */
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* Seed values supplied with the 2026 report; editable in the UI (stored per year in this browser). */
const ANNUAL_SEEDS = { 2026: { reportedTotalSpent: 6410.50 } };

function getAnnualOverrides(year) {
  try { return JSON.parse(localStorage.getItem('btc-annual-' + year) || '{}') || {}; } catch (e) { return {}; }
}
function patchAnnualOverrides(year, fn) {
  const o = getAnnualOverrides(year);
  fn(o);
  localStorage.setItem('btc-annual-' + year, JSON.stringify(o));
  if (typeof window.onPrefsChanged === 'function') window.onPrefsChanged();
  render();
}
const annualNum = v => { const n = parseMoneyInput(v); return isNaN(n) ? null : n; };
window.annualSetAdj = (ym, v) => patchAnnualOverrides(ym.slice(0, 4), o => { (o.adjustments ||= {})[ym] = annualNum(v) ?? 0; });
window.annualSetSpent = (ym, v) => patchAnnualOverrides(ym.slice(0, 4), o => { (o.allowSpent ||= {})[ym] = annualNum(v); });
window.annualSetNote = (ym, v) => patchAnnualOverrides(ym.slice(0, 4), o => { (o.notes ||= {})[ym] = String(v || '').trim(); });
window.annualSetReportedSpent = (year, v) => patchAnnualOverrides(year, o => { o.reportedTotalSpent = annualNum(v); });
window.annualToggleAdj = year => patchAnnualOverrides(year, o => { o.showAdj = !o.showAdj; });

/* Pure calculation (no DOM / storage) so it can be unit-tested.
   months[i] = { ym, friday, jf, other, expenses, reportedBeginning, allowanceIn, allowanceSpent (number|null) } */
function computeAnnualLedger({ opening = 0, months = [], adjustments = {}, reportedTotalSpent = null }) {
  let running = round2(opening);
  const rows = months.map(m => {
    const inflow = round2((m.friday || 0) + (m.jf || 0) + (m.other || 0));
    const expenses = round2(m.expenses || 0);
    const net = round2(inflow - expenses);
    const adjustment = round2(adjustments[m.ym] || 0);
    const beginning = running;
    const ending = round2(beginning + net + adjustment);
    running = ending;
    return { ...m, inflow, expenses, net, adjustment, beginning, ending, reportedBeginning: m.reportedBeginning ?? null, reconDiff: null };
  });

  // Reconciliation: where the typed (reported) beginning does not continue from the prior reported beginning + net.
  const recon = [];
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    if (!p || r.reportedBeginning == null || p.reportedBeginning == null) return;
    const expected = round2(p.reportedBeginning + p.net);
    r.reconDiff = round2(r.reportedBeginning - expected);
    if (r.reconDiff !== 0) recon.push({ ym: r.ym, month: r.fullName, reported: r.reportedBeginning, expected, diff: r.reconDiff });
  });

  const sumOf = k => round2(rows.reduce((a, r) => a + (r[k] || 0), 0));
  const totals = {
    beginning: rows.length ? rows[0].beginning : round2(opening),
    friday: sumOf('friday'), jf: sumOf('jf'), other: sumOf('other'),
    inflow: sumOf('inflow'), expenses: sumOf('expenses'), net: sumOf('net'), adjustments: sumOf('adjustment'),
    ending: rows.length ? rows[rows.length - 1].ending : round2(opening)
  };
  const expectedClosing = round2(opening + totals.net + totals.adjustments);
  const check = { ok: Math.abs(totals.ending - expectedClosing) < 0.005, closing: totals.ending, expectedClosing };
  const reconTotal = round2(recon.reduce((a, r) => a + r.diff, 0));
  const reconSummary = { total: reconTotal, adjustments: totals.adjustments, unexplained: round2(reconTotal - totals.adjustments) };

  // Flags: expenses more than 2x the average monthly expense (average of months that have expenses).
  const spendMonths = rows.filter(r => r.expenses > 0);
  const avgExpense = spendMonths.length ? round2(spendMonths.reduce((a, r) => a + r.expenses, 0) / spendMonths.length) : 0;
  const flagThreshold = round2(avgExpense * 2);
  rows.forEach(r => { r.flagged = avgExpense > 0 && r.expenses > flagThreshold; });
  const flags = rows.filter(r => r.flagged).map(r => ({ ym: r.ym, month: r.fullName, expenses: r.expenses }));

  // Allowance (separate fund): monthly spent may be unknown (null).
  let cum = 0;
  rows.forEach(r => {
    const raw = r.allowanceSpent == null ? null : Number(r.allowanceSpent);
    r.allowanceSpentRaw = raw;
    r.allowanceIn = round2(r.allowanceIn || 0);
    r.allowanceBalance = raw == null ? null : round2(r.allowanceIn - raw);
    cum = round2(cum + r.allowanceIn - (raw || 0));
    r.allowanceRemaining = cum;
  });
  const received = round2(rows.reduce((a, r) => a + r.allowanceIn, 0));
  const monthlySpent = round2(rows.reduce((a, r) => a + (r.allowanceSpentRaw || 0), 0));
  const totalSpent = reportedTotalSpent != null ? round2(reportedTotalSpent) : monthlySpent;
  const allowance = {
    received, monthlySpent, totalSpent,
    remaining: round2(received - totalSpent),
    unsupported: reportedTotalSpent != null && Math.abs(monthlySpent - totalSpent) > 0.005
  };

  return { rows, totals, check, recon, reconSummary, avgExpense, flagThreshold, flags, allowance, opening: round2(opening) };
}

function getAnnualBreakdown(year) {
  const y = String(year || new Date().getFullYear());
  const ov = getAnnualOverrides(y);
  const seed = ANNUAL_SEEDS[y] || {};
  const reportedTotalSpent = ov.reportedTotalSpent !== undefined ? ov.reportedTotalSpent : (seed.reportedTotalSpent ?? null);

  const inputs = [];
  for (let mo = 1; mo <= 12; mo++) {
    const ym = `${y}-${String(mo).padStart(2, '0')}`;
    const mApproved = S.transactions.filter(t => t.status !== 'void' && t.date.startsWith(ym));
    const mInc = mApproved.filter(t => t.type === 'income');
    const mExp = mApproved.filter(t => t.type === 'expense');
    const begEntries = mInc.filter(isBeginningTx);
    const regular = mInc.filter(t => !isBeginningTx(t));
    const allowExp = mExp.filter(isAllowanceExp);
    const override = ov.allowSpent && ov.allowSpent[ym] != null ? ov.allowSpent[ym] : null;
    inputs.push({
      ym, monthNum: mo, fullName: MONTH_FULL[mo - 1], shortName: MONTH_FULL[mo - 1].slice(0, 3),
      friday: sum(regular.filter(t => t.category === 'Youth Night Offering')),
      jf: sum(regular.filter(t => t.category === 'Joint Fellowship Offering')),
      other: sum(regular.filter(t => t.category !== 'Youth Night Offering' && t.category !== 'Joint Fellowship Offering' && !isAllowanceInc(t))),
      expenses: sum(mExp.filter(t => !isAllowanceExp(t))),
      reportedBeginning: begEntries.length ? sum(begEntries) : null,
      allowanceIn: sum(regular.filter(t => isAllowanceInc(t) && t.category !== 'Youth Night Offering' && t.category !== 'Joint Fellowship Offering')),
      allowanceSpent: override != null ? override : (allowExp.length ? sum(allowExp) : null),
      note: (ov.notes && ov.notes[ym]) || '',
      hasData: mApproved.length > 0
    });
  }
  // Opening balance: January's typed beginning (the only typed beginning that is used), else carried from prior years.
  const opening = inputs[0].reportedBeginning != null ? inputs[0].reportedBeginning : getCarriedBeginningBalance(`${y}-01`);
  const L = computeAnnualLedger({ opening, months: inputs, adjustments: ov.adjustments || {}, reportedTotalSpent });

  const months = L.rows.map(r => ({
    monthNum: r.monthNum, ym: r.ym, shortName: r.shortName, fullName: r.fullName,
    begCash: r.beginning, fridayOfferings: r.friday, jointFellowship: r.jf, allowanceIn: r.allowanceIn,
    otherInflow: r.other, totalInflow: r.inflow,
    allowanceSpent: r.allowanceSpentRaw || 0, allowanceSpentRaw: r.allowanceSpentRaw,
    allowanceLeft: r.allowanceBalance, allowanceRemaining: r.allowanceRemaining,
    generalExpenses: r.expenses, totalExpenses: r.expenses,
    monthlyNet: r.net, adjustment: r.adjustment, endingCash: r.ending,
    reportedBeginning: r.reportedBeginning, reconDiff: r.reconDiff, flagged: r.flagged, note: r.note, hasData: r.hasData
  }));

  return {
    year: y, months,
    totalFriday: L.totals.friday, totalJF: L.totals.jf, totalAllocIn: L.allowance.received,
    totalOtherIn: L.totals.other, totalInflowYear: L.totals.inflow,
    totalAllowanceSpent: L.allowance.totalSpent, totalGeneralExpenses: L.totals.expenses,
    totalExpensesYear: L.totals.expenses, totalNetOfYear: L.totals.net, totalAdjustments: L.totals.adjustments,
    finalEndingCash: L.totals.ending, allowanceLeftYear: L.allowance.remaining, yearStartCash: L.opening,
    openingBalance: L.opening, check: L.check, recon: L.recon, reconSummary: L.reconSummary,
    reportedAny: inputs.some(m => m.reportedBeginning != null),
    flags: L.flags, avgExpense: L.avgExpense, flagThreshold: L.flagThreshold,
    allowanceTotals: L.allowance, spentUnsupported: L.allowance.unsupported, reportedTotalSpent,
    showAdj: !!ov.showAdj || L.totals.adjustments !== 0
  };
}

/* ---------- separated allowance modal ---------- */
window.allowanceTrackerModal = function(initMonth) {
  let ym = initMonth || getActiveMonth();
  function build() {
    const data = getMonthlyAllowance(ym);
    const [yStr, moStr] = ym.split('-');
    const mLabel = new Date(+yStr, +moStr - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const isOk = data.remaining >= 0;
    return `<h2>💳 Monthly Allowance Tracker</h2>
      <p class="mute" style="margin-bottom:14px">Separated fund tracking for <b>${mLabel}</b>. Monitor church allocations, disbursements, and see exactly how much allowance is left.</p>
      
      <div style="background:rgba(255,255,255,.05);padding:10px 14px;border-radius:12px;display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <label style="font-weight:600;display:flex;align-items:center;gap:8px">Month:
          <input type="month" id="allowance-month-sel" value="${ym}" style="width:auto;padding:5px 10px">
        </label>
        <span class="mute" style="font-size:12px">Select month to view separated allowance balance</span>
      </div>

      <div class="allowance-card" style="margin-bottom:18px">
        <div class="row">
          <strong style="font-size:16px;color:var(--b)">${mLabel} Allowance Balance</strong>
          <span class="tag ${isOk ? 'ok' : 'pending'}">${isOk ? 'In Budget ✔' : 'Overspent ⚠️'}</span>
        </div>
        <div class="allowance-box">
          <div class="allowance-item">
            <small>📥 Allocated / Received</small>
            <strong class="pos">${money(data.allocated)}</strong>
          </div>
          <div class="allowance-item">
            <small>📤 Disbursed / Spent</small>
            <strong class="neg">${money(data.spent)}</strong>
          </div>
          <div class="allowance-item" style="border-color:${isOk ? 'rgba(52,211,153,.5)' : 'rgba(251,113,133,.5)'};background:${isOk ? 'rgba(52,211,153,.08)' : 'rgba(251,113,133,.08)'}">
            <small style="color:${isOk ? 'var(--ok)' : 'var(--bad)'}">💰 Allowance Left</small>
            <strong class="${isOk ? 'pos' : 'neg'}" style="font-size:20px">${money(data.remaining)}</strong>
          </div>
        </div>
      </div>

      <div class="toolbar" style="margin-bottom:16px">
        <button type="button" class="btn sm" id="open-alloc-form-btn" style="background:linear-gradient(135deg,#06b6d4,#3b82f6)">🏛️ Church Allocation Form</button>
        <button type="button" class="btn sm alt" id="add-alloc-exp-btn">+ Spend from Allowance (Expense)</button>
      </div>

      <h3 style="font-size:14px;margin-bottom:6px">📥 Allowance Received / Allocations (${data.allocTxs.length})</h3>
      ${data.allocTxs.length ? `<table><tr><th>Date</th><th>Category</th><th>Notes</th><th>Amount</th></tr>` +
        data.allocTxs.map(t => `<tr><td>${t.date}</td><td><span class="tag ok">${esc(t.category)}</span></td><td>${esc(cleanNotes(t.notes) || '—')}</td><td class="pos">+${money(t.amount)}</td></tr>`).join('') + '</table>'
        : '<div class="empty" style="padding:12px;font-size:12px;background:rgba(255,255,255,.02);border-radius:8px">No allowance allocations recorded for this month yet.</div>'}

      <h3 style="font-size:14px;margin-top:16px;margin-bottom:6px">📤 Allowance Spent / Disbursements (${data.expTxs.length})</h3>
      ${data.expTxs.length ? `<table><tr><th>Date</th><th>Category</th><th>Notes</th><th>Amount</th></tr>` +
        data.expTxs.map(t => `<tr><td>${t.date}</td><td><span class="tag neg">${esc(t.category)}</span></td><td>${esc(cleanNotes(t.notes) || '—')}</td><td class="neg">-${money(t.amount)}</td></tr>`).join('') + '</table>'
        : '<div class="empty" style="padding:12px;font-size:12px;background:rgba(255,255,255,.02);border-radius:8px">No allowance expenses recorded for this month yet.</div>'}

      <div class="row" style="margin-top:20px">
        <button type="button" class="btn ghost" onclick="closeModal()">Close</button>
      </div>
    `;
  }

  function bind() {
    openModal(build(), 'landscape');
    $('#allowance-month-sel').onchange = e => {
      ym = e.target.value;
      bind();
    };
    $('#open-alloc-form-btn').onclick = () => {
      churchAllocationForm(ym);
    };
    $('#add-alloc-exp-btn').onclick = () => {
      closeModal();
      txForm('expense');
      setTimeout(() => {
        const form = $('#tx-form');
        if (form) {
          form.elements['date'].value = `${ym}-05`;
          const allowRadio = form.querySelector('input[name="fund"][value="allowance"]');
          if (allowRadio) {
            allowRadio.checked = true;
            allowRadio.dispatchEvent(new Event('change'));
          }
        }
      }, 50);
    };
  }
  bind();
};

/* ---------- dedicated church allocation form ---------- */
window.saveChurchAllocation = async function(allocData) {
  const ym = allocData.date.slice(0, 7);
  const existing = S.transactions.find(t => t.status !== 'void' && t.type === 'income' && t.date.startsWith(ym) && isAllowanceInc(t));
  if (existing) {
    existing.amount = allocData.amount;
    existing.date = allocData.date;
    existing.category = 'Allocation from Church Funds';
    existing.fund = 'allowance';
    existing.notes = allocData.notes || 'Monthly Allocation from Church Funds';
    existing.log = existing.log || [];
    existing.log.push(`Updated Allocation ${new Date().toLocaleString()}`);
  } else {
    S.transactions.push({
      id: uid(),
      type: 'income',
      fund: 'allowance',
      date: allocData.date,
      amount: allocData.amount,
      category: 'Allocation from Church Funds',
      eventId: '',
      memberId: '',
      notes: allocData.notes || 'Monthly Allocation from Church Funds',
      status: 'approved',
      receipt: '',
      log: [`Created Allocation ${new Date().toLocaleString()}`]
    });
  }
  localStorage.setItem('btc-active-month', ym);
  save();
  closeModal();
};

window.deleteChurchAllocation = async function(txId) {
  const t = S.transactions.find(x => x.id === txId);
  if (t) {
    t.status = 'void';
    t.log = t.log || [];
    t.log.push(`Voided Allocation ${new Date().toLocaleString()}`);
    save();
  }
  closeModal();
};

window.churchAllocationForm = function(initMonth) {
  let ym = initMonth || getActiveMonth();
  function build() {
    const [yStr, moStr] = ym.split('-');
    const mLabel = new Date(+yStr, +moStr - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const existing = S.transactions.find(t => t.status !== 'void' && t.type === 'income' && t.date.startsWith(ym) && isAllowanceInc(t));
    const allow = getMonthlyAllowance(ym);

    return `<h2>🏛️ Allocation from Church Funds</h2>
      <p class="mute" style="margin-bottom:14px">Dedicated form to record the monthly funds and allowance allocated by church leadership for youth ministry.</p>

      <div style="background:rgba(255,255,255,.05);padding:10px 14px;border-radius:12px;display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <label style="font-weight:600;display:flex;align-items:center;gap:8px">Month:
          <input type="month" id="church-alloc-month-sel" value="${ym}" style="width:auto;padding:5px 10px">
        </label>
        <span class="mute" style="font-size:12px">Select month to record or update church allocation</span>
      </div>

      <div class="allowance-card" style="margin-bottom:18px">
        <div class="row">
          <strong style="color:var(--b);font-size:15px">${mLabel} Church Fund Summary</strong>
          <span class="tag ${existing ? 'ok' : 'pending'}">${existing ? 'Recorded ✔' : 'Not Recorded'}</span>
        </div>
        <div class="allowance-box">
          <div class="allowance-item">
            <small>📥 Church Allocation</small>
            <strong class="pos">${money(allow.allocated)}</strong>
          </div>
          <div class="allowance-item">
            <small>📤 Allowance Disbursed</small>
            <strong class="neg">${money(allow.spent)}</strong>
          </div>
          <div class="allowance-item" style="border-color:${allow.remaining >= 0 ? 'rgba(52,211,153,.5)' : 'rgba(251,113,133,.5)'}">
            <small style="color:${allow.remaining >= 0 ? 'var(--ok)' : 'var(--bad)'}">💰 Allowance Left</small>
            <strong class="${allow.remaining >= 0 ? 'pos' : 'neg'}" style="font-size:18px">${money(allow.remaining)}</strong>
          </div>
        </div>
      </div>

      <form id="church-alloc-form">
        <input type="hidden" name="alloc_id" value="${existing ? existing.id : ''}">
        <label>Date Received
          <input type="date" name="alloc_date" value="${existing ? existing.date : ym + '-01'}" required>
          <div class="mute" style="font-size:11px;margin-top:2px">Official date the funds were allocated/received from church</div>
        </label>
        <label>Allocation Amount (₱)
          <input type="number" step="0.01" min="0.01" name="alloc_amount" value="${existing ? existing.amount : ''}" placeholder="₱ e.g. 1500.00" required style="font-size:16px;font-weight:700">
        </label>
        <label>Notes / Description
          <input type="text" name="alloc_notes" value="${esc(existing ? cleanNotes(existing.notes) : 'Monthly Allocation from Church Funds')}" placeholder="e.g. Monthly Youth Allowance & Ministry Subsidy">
        </label>
        <div class="row" style="margin-top:16px">
          <div style="display:flex;gap:8px">
            <button type="button" class="btn ghost" onclick="closeModal()">Cancel</button>
            ${existing ? `<button type="button" class="btn ghost danger" id="delete-church-alloc-btn">🗑️ Delete</button>` : ''}
          </div>
          <button class="btn" style="background:linear-gradient(135deg,#06b6d4,#3b82f6)">💾 Save Allocation</button>
        </div>
      </form>`;
  }

  function bind() {
    openModal(build());
    const mSel = $('#church-alloc-month-sel');
    if (mSel) {
      mSel.onchange = e => {
        ym = e.target.value;
        localStorage.setItem('btc-active-month', ym);
        bind();
      };
    }
    const delBtn = $('#delete-church-alloc-btn');
    if (delBtn) {
      delBtn.onclick = async () => {
        const id = $('#church-alloc-form')?.elements['alloc_id']?.value;
        if (id && confirm('Delete/Void this church allocation for ' + ym + '?')) {
          await window.deleteChurchAllocation(id);
        }
      };
    }
    const form = $('#church-alloc-form');
    if (form) {
      form.onsubmit = async e => {
        e.preventDefault();
        const f = new FormData(form);
        const amount = parseFloat(f.get('alloc_amount'));
        if (!amount || amount <= 0) {
          alert('Please enter a valid allocation amount.');
          return;
        }
        await window.saveChurchAllocation({
          id: f.get('alloc_id') || null,
          date: f.get('alloc_date'),
          amount: amount,
          notes: f.get('alloc_notes') || 'Monthly Allocation from Church Funds'
        });
      };
    }
  }
  bind();
};

/* ---------- batch monthly offerings ---------- */
window.saveBatchOfferings = async function(entries, deletedIds = []) {
  if (deletedIds && deletedIds.length) {
    S.transactions = S.transactions.filter(t => !deletedIds.includes(t.id));
  }
  const createdIds = [];

  for (const item of entries) {
    let notes = item.notes || '';
    if (item.fund === 'allowance' && !notes.includes('[Allowance]')) {
      notes = notes ? `[Allowance] ${notes}` : '[Allowance]';
    }
    if (item.id) {
      const existing = S.transactions.find(t => t.id === item.id);
      if (existing) {
        existing.amount = item.amount;
        existing.date = item.date;
        existing.fund = item.fund || existing.fund || 'general';
        existing.category = item.category;
        existing.notes = notes;
        existing.type = item.type || existing.type;
        existing.log = existing.log || [];
        existing.log.push(`Updated on ${new Date().toLocaleString()}`);
        continue;
      }
    }
    let receiptData = item.receipt || '';
    if (!receiptData && item.receiptFile && item.receiptFile.size && typeof window.compressReceiptImage === 'function') {
      try {
        const comp = await window.compressReceiptImage(item.receiptFile);
        receiptData = comp.dataUrl || '';
      } catch {}
    }
    const newId = uid();
    S.transactions.push({
      id: newId,
      type: item.type || 'income',
      fund: item.fund || 'general',
      date: item.date,
      amount: item.amount,
      category: item.category,
      eventId: item.eventId || '',
      memberId: item.memberId || '',
      notes,
      status: 'approved',
      receipt: receiptData,
      createdAt: new Date().toISOString(),
      log: [`Created via Monthly Offerings on ${new Date().toLocaleString()}`]
    });
    createdIds.push(newId);
  }
  if (createdIds.length) {
    window.recordUploadBatch(createdIds, `Batch (${createdIds.length})`);
  }
  if (entries.length && entries[0].date) {
    localStorage.setItem('btc-active-month', entries[0].date.slice(0, 7));
  }
  closeModal();
  save();
};

function batchOfferingsModal(initMonth) {
  let m = initMonth || getActiveMonth();
  const deletedIds = [];

  function buildHtml(targetMonth) {
    const [yStr, moStr] = targetMonth.split('-');
    const y = parseInt(yStr, 10), mo = parseInt(moStr, 10);
    const fridays = getFridaysForMonth(y, mo);
    const lastSun = getLastSundayForMonth(y, mo);
    const monthTitle = new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const curAllow = getMonthlyAllowance(targetMonth);

    // Existing active transactions for this month
    const existing = S.transactions.filter(t => t.status !== 'void' && t.date.startsWith(targetMonth) && !deletedIds.includes(t.id));
    const existingInc = existing.filter(t => t.type === 'income');
    const existingExp = existing.filter(t => t.type === 'expense');

    // Beginning balance
    const begTx = existingInc.find(t => t.category === 'Beginning Balance' || (t.notes || '').toLowerCase().includes('beginning'));

    // Last Sunday
    const jfTx = existingInc.find(t => t.date === lastSun.date && t.category === 'Joint Fellowship Offering');

    // Build Friday rows
    let fridayRowsHtml = '';
    fridays.forEach(f => {
      const matches = existingInc.filter(t => t.date === f.date && t.category === 'Youth Night Offering');
      if (matches.length > 0) {
        matches.forEach((mTx, idx) => {
          fridayRowsHtml += `
            <div class="row-entry batch-row" data-tx-id="${mTx.id}" data-type="income" style="display:grid;grid-template-columns:115px 1fr 1fr auto;gap:6px;align-items:center;background:rgba(52,211,153,.07);border:1px solid rgba(52,211,153,.25);padding:6px 10px;border-radius:8px">
              <div>
                <input type="date" name="row_date" value="${mTx.date}" style="font-size:12px;padding:5px">
                <div class="mute" style="font-size:10px;margin-top:2px">${f.display} ${idx > 0 ? '(Entry #' + (idx+1) + ')' : ''}</div>
              </div>
              <div>
                <input type="number" step="0.01" min="0" name="row_amt" class="batch-num" placeholder="₱ Amount" style="font-size:13px;padding:6px;font-weight:600" value="${mTx.amount}">
                <div style="font-size:10px;color:var(--ok);margin-top:2px">Saved ✔ (change to update)</div>
              </div>
              <input type="text" name="row_notes" placeholder="Notes (optional)" value="${esc(mTx.notes || 'Youth Night Offering')}" style="font-size:12px;padding:6px">
              <input type="hidden" name="row_cat" value="Youth Night Offering">
              <button type="button" class="btn sm ghost danger remove-row-btn" data-id="${mTx.id}" title="Remove entry" style="padding:4px 8px">✕</button>
            </div>
          `;
        });
      } else {
        fridayRowsHtml += `
          <div class="row-entry batch-row" data-tx-id="" data-type="income" style="display:grid;grid-template-columns:115px 1fr 1fr auto;gap:6px;align-items:center;background:rgba(255,255,255,.03);padding:6px 10px;border-radius:8px">
            <div>
              <input type="date" name="row_date" value="${f.date}" style="font-size:12px;padding:5px">
              <div class="mute" style="font-size:10px;margin-top:2px">${f.display}</div>
            </div>
            <div>
              <input type="number" step="0.01" min="0" name="row_amt" class="batch-num" placeholder="₱ Amount" style="font-size:13px;padding:6px">
              <div class="mute" style="font-size:10px;margin-top:2px">Ready to enter</div>
            </div>
            <input type="text" name="row_notes" placeholder="Notes (optional)" value="Youth Night Offering" style="font-size:12px;padding:6px">
            <input type="hidden" name="row_cat" value="Youth Night Offering">
            <span style="width:24px"></span>
          </div>
        `;
      }
    });

    // Existing expenses with fund selector
    let expRowsHtml = '';
    if (existingExp.length) {
      expRowsHtml = existingExp.map(et => {
        const isEtAllow = isAllowanceExp(et);
        const catOpts = S.expenseCats.map(c => `<option ${c === et.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
        return `
          <div class="row-entry batch-row" data-tx-id="${et.id}" data-type="expense" style="display:grid;grid-template-columns:110px 95px 125px 1fr auto;gap:6px;align-items:center;background:rgba(251,113,133,.07);border:1px solid rgba(251,113,133,.25);padding:6px 10px;border-radius:8px">
            <div>
              <input type="date" name="row_date" value="${et.date}" style="font-size:12px;padding:5px">
              <div class="mute" style="font-size:10px;margin-top:2px">Date</div>
            </div>
            <div>
              <input type="number" step="0.01" min="0" name="row_amt" class="batch-num batch-exp" placeholder="₱ Amount" style="font-size:13px;padding:6px;font-weight:600" value="${et.amount}">
              <div style="font-size:10px;color:var(--bad);margin-top:2px">Saved ✔</div>
            </div>
            <div>
              <select name="row_fund" class="batch-fund-sel" style="font-size:11px;padding:5px">
                <option value="general" ${!isEtAllow ? 'selected' : ''}>🏢 General</option>
                <option value="allowance" ${isEtAllow ? 'selected' : ''}>💳 Allowance</option>
              </select>
              <div class="mute" style="font-size:10px;margin-top:2px">Fund source</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
              <select name="row_cat" style="font-size:11px;padding:5px">${catOpts}</select>
              <input type="text" name="row_notes" placeholder="Notes (optional)" value="${esc(cleanNotes(et.notes))}" style="font-size:11px;padding:5px">
            </div>
            <button type="button" class="btn sm ghost danger remove-row-btn" data-id="${et.id}" title="Remove entry" style="padding:4px 8px">✕</button>
          </div>
        `;
      }).join('');
    }

    return `<h2>📅 Monthly Offerings &amp; Transactions</h2>
      <p class="mute" style="margin-bottom:12px">Managing records for <b>${monthTitle}</b>. Add or update Friday offerings, Sunday collections, and expenses without duplicates.</p>

      <div style="margin-bottom:16px;background:rgba(255,255,255,.05);padding:10px 14px;border-radius:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <label style="font-weight:600;display:flex;align-items:center;gap:8px">Month:
          <input type="month" id="batch-month-sel" value="${targetMonth}" style="width:auto;padding:5px 10px">
        </label>
        <span class="mute" style="font-size:12px">Switch month to view and add to any month</span>
      </div>

      ${existing.length ? `
        <div style="background:rgba(124,92,255,.12);border:1px solid rgba(124,92,255,.3);padding:10px 14px;border-radius:10px;margin-bottom:16px;font-size:13px">
          ℹ️ <b>${existing.length} transaction${existing.length > 1 ? 's' : ''}</b> already saved in ${monthTitle} (Income: <b>${money(sum(existingInc))}</b>${existingExp.length ? ' · Expenses: <b>' + money(sum(existingExp)) + '</b>' : ''}). Entries marked <b>Saved ✔</b> will be updated in-place without duplicating!
        </div>
      ` : ''}

      <form id="batch-offerings-form">
        <div class="batch-landscape-grid">
          <!-- LEFT COLUMN: INFLOWS & OFFERINGS -->
          <div class="batch-col-inflow" style="display:flex;flex-direction:column;gap:14px">
            <!-- Beginning balance -->
            <div style="background:rgba(124,92,255,.08);padding:12px 14px;border-radius:12px;border:1px solid rgba(124,92,255,.2)">
              <div style="font-weight:600;color:var(--b);font-size:13px;margin-bottom:2px">💰 Cash on Hand - Beginning Balance</div>
              <div class="mute" style="font-size:11px;margin-bottom:8px">Enter once at the start of your cycle (e.g. ₱2,440.00).</div>
              <div class="batch-row" data-tx-id="${begTx ? begTx.id : ''}" data-type="income" style="display:grid;grid-template-columns:120px 1fr 1fr;gap:8px;align-items:center">
                <input type="date" name="row_date" value="${begTx ? begTx.date : targetMonth + '-01'}" style="font-size:12px;padding:6px">
                <div>
                  <input type="number" step="0.01" min="0" name="row_amt" class="batch-num" placeholder="₱ Beginning balance" style="font-size:13px;padding:6px;font-weight:600" value="${begTx ? begTx.amount : ''}">
                  ${begTx ? '<div style="font-size:10px;color:var(--ok);margin-top:2px">Saved ✔</div>' : ''}
                </div>
                <input type="text" name="row_notes" placeholder="Notes" value="${esc(begTx ? begTx.notes : 'Cash on Hand - Beginning Balance')}" style="font-size:12px;padding:6px">
                <input type="hidden" name="row_cat" value="Beginning Balance">
              </div>
            </div>

            <!-- Youth Night Offerings (Every Friday) -->
            <div style="background:rgba(255,255,255,.02);padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.08)">
              <div class="row" style="margin-bottom:8px">
                <strong style="font-size:14px">🌙 Youth Night Offerings (Every Friday)</strong>
                <button type="button" class="btn sm ghost" id="add-custom-friday-btn">+ Add Friday</button>
              </div>
              <div id="friday-rows-container" style="display:grid;gap:8px">
                ${fridayRowsHtml}
              </div>
            </div>

            <!-- Last Sunday of the Month -->
            <div style="background:rgba(34,211,238,.07);padding:12px 14px;border-radius:12px;border:1px solid rgba(34,211,238,.2)">
              <div style="font-weight:600;color:var(--b);font-size:14px;margin-bottom:2px">☀️ Last Sunday of the Month: ${lastSun.display}</div>
              <div class="mute" style="font-size:11px;margin-bottom:8px">Joint fellowship offerings &amp; sunday gatherings</div>
              <div style="display:grid;gap:8px">
                <div class="batch-row" data-tx-id="${jfTx ? jfTx.id : ''}" data-type="income" style="display:grid;grid-template-columns:120px 1fr 1fr;gap:8px;align-items:center">
                  <input type="date" name="row_date" value="${jfTx ? jfTx.date : lastSun.date}" style="font-size:12px;padding:6px">
                  <div>
                    <input type="number" step="0.01" min="0" name="row_amt" class="batch-num" placeholder="₱ Joint Fellowship" style="font-size:13px;padding:6px;font-weight:600" value="${jfTx ? jfTx.amount : ''}">
                    <div class="mute" style="font-size:10px;margin-top:2px">Joint Fellowship Offering ${jfTx ? '· Saved ✔' : ''}</div>
                  </div>
                  <input type="text" name="row_notes" placeholder="Notes (optional)" value="${esc(jfTx ? jfTx.notes : 'Joint Fellowship Offering')}" style="font-size:12px;padding:6px">
                  <input type="hidden" name="row_cat" value="Joint Fellowship Offering">
                </div>
              </div>

              <!-- Separated Church Allocation Notice & Link -->
              <div style="background:rgba(34,211,238,.08);border:1px dashed rgba(34,211,238,.35);padding:10px 14px;border-radius:10px;margin-top:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                <div>
                  <div style="font-weight:600;font-size:13px;color:var(--b)">🏛️ Allocation from Church Funds</div>
                  <div class="mute" style="font-size:11px">Recorded for ${monthTitle}: <b>${curAllow.allocated > 0 ? money(curAllow.allocated) + ' ✔' : 'None yet'}</b></div>
                </div>
                <button type="button" class="btn sm" id="batch-open-church-alloc" style="background:linear-gradient(135deg,#06b6d4,#3b82f6);padding:6px 12px">🏛️ Manage Church Allocation</button>
              </div>
            </div>
          </div>

          <!-- RIGHT COLUMN: EXPENSES, SUMMARY & SAVE -->
          <div class="batch-col-outflow" style="display:flex;flex-direction:column;gap:14px">
            <!-- Expenses Section with Fund Selection -->
            <div style="background:rgba(251,113,133,.06);padding:12px 14px;border-radius:12px;border:1px solid rgba(251,113,133,.2)">
              <div class="row" style="margin-bottom:8px;flex-wrap:wrap;gap:8px">
                <strong style="font-size:14px;color:var(--bad)">🔻 Monthly Expenses &amp; Fund Allocation</strong>
                <button type="button" class="btn sm ghost" id="add-month-expense-btn">+ Add expense</button>
              </div>
              <div style="margin-bottom:8px">
                <span id="batch-allowance-status" class="tag" style="background:rgba(34,211,238,.15);color:var(--b);font-size:11px;display:inline-block">Allowance Left: ${money(curAllow.remaining)}</span>
              </div>
              <div class="mute" style="font-size:11px;margin-bottom:10px">Choose whether each expense is paid from the <b>🏢 General Fund</b> or the <b>💳 Church Allowance</b>.</div>
              <div id="expense-rows-container" style="display:grid;gap:8px">
                ${expRowsHtml || '<div class="mute" id="no-exp-msg" style="padding:8px 0;font-size:12px">No expenses entered for this month yet. Click "+ Add expense" to add one.</div>'}
              </div>
            </div>

            <!-- Net Total Preview Card -->
            <div style="background:rgba(255,255,255,.05);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,.08)">
              <div class="mute" style="font-size:12px;margin-bottom:4px">Monthly Net Total:</div>
              <div id="batch-total-preview" style="color:var(--ok);font-size:16px;font-weight:700">₱0.00</div>
            </div>

            <!-- Action buttons -->
            <div class="row" style="margin-top:auto;padding-top:10px;justify-content:flex-end;gap:12px">
              <button type="button" class="btn ghost" onclick="closeModal()" style="min-width:100px">Cancel</button>
              <button class="btn" style="background:linear-gradient(135deg,#06b6d4,#3b82f6);min-width:180px;font-weight:600">💾 Save &amp; Update Month</button>
            </div>
          </div>
        </div>
      </form>`;
  }

  function bindBatch(targetMonth) {
    openModal(buildHtml(targetMonth), 'landscape');
    const form = $('#batch-offerings-form');
    const curAllow = getMonthlyAllowance(targetMonth);

    const updateTotal = () => {
      let incTotal = 0, genExp = 0, allowExp = 0;
      form.querySelectorAll('.batch-row').forEach(row => {
        const inp = row.querySelector('.batch-num');
        const amt = parseFloat(inp?.value) || 0;
        if (row.dataset.type === 'expense') {
          const fund = row.querySelector('[name="row_fund"]')?.value || 'general';
          if (fund === 'allowance') {
            allowExp += amt;
          } else {
            genExp += amt;
          }
        } else {
          incTotal += amt;
        }
      });
      const totalExp = genExp + allowExp;
      const netBal = incTotal - totalExp;
      $('#batch-total-preview').textContent = `${money(netBal)} (Inflows: ${money(incTotal)} · Expenses: ${money(totalExp)})`;
      const allowStat = $('#batch-allowance-status');
      if (allowStat) {
        const rem = curAllow.allocated - allowExp;
        allowStat.textContent = `Allowance Left: ${money(rem)} (Allocated: ${money(curAllow.allocated)} · Disbursed: ${money(allowExp)})`;
        allowStat.style.color = rem >= 0 ? 'var(--ok)' : 'var(--bad)';
      }
    };
    form.addEventListener('input', updateTotal);
    form.addEventListener('change', updateTotal);
    updateTotal();

    $('#batch-month-sel').onchange = e => {
      localStorage.setItem('btc-active-month', e.target.value);
      bindBatch(e.target.value);
    };

    const openAllocBtn = $('#batch-open-church-alloc');
    if (openAllocBtn) {
      openAllocBtn.onclick = () => {
        closeModal();
        churchAllocationForm(targetMonth);
      };
    }

    // Remove button handler
    form.addEventListener('click', e => {
      const btn = e.target.closest('.remove-row-btn');
      if (!btn) return;
      const row = btn.closest('.batch-row');
      const txId = btn.dataset.id;
      if (txId) {
        if (!confirm('Remove this saved entry?')) return;
        deletedIds.push(txId);
      }
      row.remove();
      updateTotal();
    });

    // Add another Friday row
    $('#add-custom-friday-btn').onclick = () => {
      const container = $('#friday-rows-container');
      const div = document.createElement('div');
      div.className = 'row-entry batch-row';
      div.dataset.txId = '';
      div.dataset.type = 'income';
      div.style.cssText = 'display:grid;grid-template-columns:115px 1fr 1fr auto;gap:6px;align-items:center;background:rgba(255,255,255,.03);padding:6px 10px;border-radius:8px';
      div.innerHTML = `
        <input type="date" name="row_date" value="${targetMonth}-11" style="font-size:12px;padding:5px">
        <input type="number" step="0.01" min="0" name="row_amt" class="batch-num" placeholder="₱ Amount" style="font-size:13px;padding:6px">
        <input type="text" name="row_notes" placeholder="Notes (optional)" value="Youth Night Offering" style="font-size:12px;padding:6px">
        <input type="hidden" name="row_cat" value="Youth Night Offering">
        <button type="button" class="btn sm ghost danger remove-row-btn" title="Remove" style="padding:4px 8px">✕</button>
      `;
      container.appendChild(div);
      div.querySelector('.batch-num').addEventListener('input', updateTotal);
    };

    // Add expense row with fund selector
    $('#add-month-expense-btn').onclick = () => {
      const noMsg = $('#no-exp-msg');
      if (noMsg) noMsg.remove();
      const container = $('#expense-rows-container');
      const div = document.createElement('div');
      div.className = 'row-entry batch-row';
      div.dataset.txId = '';
      div.dataset.type = 'expense';
      div.style.cssText = 'display:grid;grid-template-columns:110px 95px 125px 1fr auto;gap:6px;align-items:center;background:rgba(251,113,133,.07);padding:6px 10px;border-radius:8px';
      const catOpts = S.expenseCats.map(c => `<option ${c === 'Food' ? 'selected' : ''}>${esc(c)}</option>`).join('');
      div.innerHTML = `
        <div>
          <input type="date" name="row_date" value="${targetMonth}-15" style="font-size:12px;padding:5px">
          <div class="mute" style="font-size:10px;margin-top:2px">Date</div>
        </div>
        <div>
          <input type="number" step="0.01" min="0" name="row_amt" class="batch-num batch-exp" placeholder="₱ Amount" style="font-size:13px;padding:6px">
          <div class="mute" style="font-size:10px;margin-top:2px">New Expense</div>
        </div>
        <div>
          <select name="row_fund" class="batch-fund-sel" style="font-size:11px;padding:5px">
            <option value="general">🏢 General</option>
            <option value="allowance">💳 Allowance</option>
          </select>
          <div class="mute" style="font-size:10px;margin-top:2px">Fund source</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
          <select name="row_cat" style="font-size:11px;padding:5px">${catOpts}</select>
          <input type="text" name="row_notes" placeholder="Notes (optional)" style="font-size:11px;padding:5px">
        </div>
        <button type="button" class="btn sm ghost danger remove-row-btn" title="Remove" style="padding:4px 8px">✕</button>
      `;
      container.appendChild(div);
      div.querySelector('.batch-num').addEventListener('input', updateTotal);
      div.querySelector('.batch-fund-sel').addEventListener('change', updateTotal);
    };

    form.onsubmit = async e => {
      e.preventDefault();
      const entries = [];

      form.querySelectorAll('.batch-row').forEach(row => {
        const amtInput = row.querySelector('.batch-num');
        const amt = parseFloat(amtInput?.value);
        const dateInput = row.querySelector('[name="row_date"]');
        const catInput = row.querySelector('[name="row_cat"]');
        const notesInput = row.querySelector('[name="row_notes"]');
        const fundInput = row.querySelector('[name="row_fund"]');
        const txId = row.dataset.txId || null;
        const type = row.dataset.type || 'income';
        const fund = fundInput ? fundInput.value : 'general';

        if (amt > 0) {
          let notes = notesInput ? notesInput.value.trim() : '';
          if (fund === 'allowance' && !notes.includes('[Allowance]')) {
            notes = notes ? `[Allowance] ${notes}` : '[Allowance]';
          }
          entries.push({
            id: txId,
            type,
            fund,
            date: dateInput.value,
            amount: amt,
            category: catInput ? catInput.value : (type === 'income' ? 'Youth Night Offering' : 'Other'),
            notes
          });
        }
      });

      if (!entries.length && !deletedIds.length) {
        alert('Please enter at least one amount.');
        return;
      }

      await window.saveBatchOfferings(entries, deletedIds);
    };
  }

  bindBatch(m);
}

window.setQuickDate = (d, cat) => {
  const form = $('#tx-form');
  if (!form) return;
  if (form.elements['date']) form.elements['date'].value = d;
  if (cat && form.elements['category']) form.elements['category'].value = cat;
};

/* ---------- modal ---------- */
function openModal(html, cls = '') {
  const m = $('#modal');
  m.className = 'modal' + (cls ? ' ' + cls : '');
  m.innerHTML = html;
  $('#modal-wrap').classList.add('open');
}
function closeModal() {
  $('#modal-wrap').classList.remove('open');
  const m = $('#modal');
  if (m) m.className = 'modal';
}
$('#modal-wrap').addEventListener('click', e => { if (e.target.id === 'modal-wrap') closeModal(); });

function txForm(type) {
  const cats = (type === 'income' ? S.incomeCats : S.expenseCats).map(c => `<option>${c}</option>`).join('');
  const evs = '<option value="">— none —</option>' + S.events.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  const mems = '<option value="">— none —</option>' + S.members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  
  const activeM = getActiveMonth();
  const [actY, actMo] = activeM.split('-').map(Number);
  const fridays = getFridaysForMonth(actY, actMo);
  const lastSun = getLastSundayForMonth(actY, actMo);
  const monthName = new Date(actY, actMo - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  const curAllow = getMonthlyAllowance(activeM);

  // Default date: next Friday or latest date in active month
  let defaultDate = today();
  if (fridays.length && activeM !== today().slice(0, 7)) {
    defaultDate = fridays[0].date;
  }

  const chipsHtml = type === 'income' ? `
    <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
      <span class="mute" style="font-size:11px">⚡ Quick dates (${monthName}):</span>
      ${fridays.map(f => `<button type="button" class="btn sm ghost" style="padding:2px 8px;font-size:11px" onclick="setQuickDate('${f.date}','Youth Night Offering')">${f.formatted}</button>`).join('')}
      <button type="button" class="btn sm ghost" style="padding:2px 8px;font-size:11px;color:var(--b);border-color:var(--b)" onclick="setQuickDate('${lastSun.date}','Joint Fellowship Offering')">Last Sun (${lastSun.formatted})</button>
    </div>` : '';

  const fundSelectorHtml = type === 'expense' ? `
    <label style="font-weight:600;color:var(--text);margin-bottom:2px">Select Fund to Use for this Expense:</label>
    <div class="fund-selector" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <label class="fund-card-option active" id="fund-lbl-general">
        <input type="radio" name="fund" value="general" checked>
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--text)">🏢 General Youth Fund</div>
          <div class="mute" style="font-size:11px">Offerings, dues &amp; fundraisers</div>
        </div>
      </label>
      <label class="fund-card-option" id="fund-lbl-allowance">
        <input type="radio" name="fund" value="allowance">
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--b)">💳 Monthly Allowance</div>
          <div class="mute" style="font-size:11px">From Church Allocation</div>
        </div>
      </label>
    </div>

    <div id="fund-status-banner" style="background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin-bottom:12px;font-size:12px">
      🏢 Charging to <b>General Youth Fund</b> (Total Fund Balance: <b>${money(balance())}</b>)
    </div>` : `
    <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
      <span class="mute" style="font-size:11px">💡 Church Allocation:</span>
      <button type="button" class="btn sm ghost" style="padding:2px 8px;font-size:11px;color:var(--b);border-color:var(--b)" onclick="closeModal();churchAllocationForm();">🏛️ Open Dedicated Church Allocation Form</button>
    </div>`;

  openModal(`<h2>Add ${type}</h2><form id="tx-form">
    ${type === 'expense' ? fundSelectorHtml : ''}
    <label>Date<input type="date" name="date" id="tx-date-input" value="${defaultDate}" required>${chipsHtml}</label>
    <label>Amount<input type="number" name="amount" min="0.01" step="0.01" required></label>
    <label>Category<select name="category">${cats}</select>${type === 'income' ? fundSelectorHtml : ''}</label>
    <label>Event<select name="eventId">${evs}</select></label>
    ${type === 'income' ? `<label>Member (for dues/contributions)<select name="memberId">${mems}</select></label>` : `<label>Receipt photo (optional — camera or gallery)
      <div class="rcpt-upload-box">
        <input type="file" name="receipt" id="tx-receipt-input" accept="image/*">
        <div id="tx-receipt-preview" class="rcpt-preview-wrap" style="display:none"></div>
      </div>
    </label>`}
    <label>Notes<textarea name="notes" rows="2" placeholder="Description or details..."></textarea></label>
    <div class="row"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Save</button></div></form>`);

  const rcptInp = $('#tx-receipt-input');
  if (rcptInp) {
    rcptInp.addEventListener('change', () => {
      const prev = $('#tx-receipt-preview');
      const file = rcptInp.files && rcptInp.files[0];
      if (!prev) return;
      if (!file) { prev.style.display = 'none'; prev.innerHTML = ''; return; }
      const url = URL.createObjectURL(file);
      prev.style.display = 'flex';
      prev.innerHTML = `<img src="${url}" alt="Receipt preview"><div class="rcpt-prev-meta"><b>${esc(file.name)}</b><span class="mute">${(file.size / 1024).toFixed(0)} KB · ready to upload</span></div>`;
    });
  }

  const updateFundUi = () => {
    const form = $('#tx-form');
    if (!form || type !== 'expense') return;
    const fundVal = form.elements['fund']?.value || 'general';
    const dVal = form.elements['date']?.value || today();
    const ym = dVal.slice(0, 7);
    const allow = getMonthlyAllowance(ym);
    const [y, mo] = ym.split('-');
    const moLabel = new Date(+y, +mo - 1, 1).toLocaleDateString('en-US', { month: 'short' });

    const lblGen = $('#fund-lbl-general');
    const lblAllow = $('#fund-lbl-allowance');
    const banner = $('#fund-status-banner');

    if (fundVal === 'allowance') {
      if (lblAllow) lblAllow.classList.add('active');
      if (lblGen) lblGen.classList.remove('active');
      if (banner) {
        banner.style.background = 'rgba(34,211,238,.1)';
        banner.style.borderColor = 'rgba(34,211,238,.35)';
        banner.innerHTML = `💳 Charging to <b>Monthly Allowance</b> · Available Left in ${moLabel}: <b style="color:${allow.remaining >= 0 ? 'var(--ok)' : 'var(--bad)'}">${money(allow.remaining)}</b> (Allocated: ${money(allow.allocated)})`;
      }
    } else {
      if (lblGen) lblGen.classList.add('active');
      if (lblAllow) lblAllow.classList.remove('active');
      if (banner) {
        banner.style.background = 'rgba(255,255,255,.04)';
        banner.style.borderColor = 'var(--line)';
        banner.innerHTML = `🏢 Charging to <b>General Youth Fund</b> · Total Fund Balance: <b>${money(balance())}</b>`;
      }
    }
  };

  const formEl = $('#tx-form');
  if (formEl && type === 'expense') {
    formEl.querySelectorAll('input[name="fund"]').forEach(r => r.addEventListener('change', updateFundUi));
    const dInp = formEl.elements['date'];
    if (dInp) dInp.addEventListener('change', updateFundUi);
  }

  $('#tx-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const dateVal = f.get('date');
    if (dateVal) localStorage.setItem('btc-active-month', dateVal.slice(0, 7));
    const fund = f.get('fund') || (type === 'expense' ? 'general' : 'general');
    let notes = f.get('notes') ? f.get('notes').trim() : '';
    if (fund === 'allowance' && !notes.includes('[Allowance]')) {
      notes = notes ? `[Allowance] ${notes}` : '[Allowance]';
    }
    const t = { id: uid(), type, fund, date: dateVal, amount: +f.get('amount'), category: f.get('category'), eventId: f.get('eventId') || '',
      memberId: f.get('memberId') || '', notes, status: 'approved', receipt: '', log: [`Created ${new Date().toLocaleString()}`] };
    const file = f.get('receipt');
    if (file && file.size) {
      const comp = await window.compressReceiptImage(file);
      t.receipt = comp.dataUrl;
    }
    S.transactions.push(t); closeModal(); save();
    if (t.receipt && typeof showToast === 'function') showToast('🧾 Expense & receipt saved');
  };
}

function eventForm(id) {
  const ev = S.events.find(x => x.id === id) || {};
  openModal(`<h2>${id ? 'Edit' : 'New'} event</h2><form id="ev-form"><label>Name<input name="name" required placeholder="e.g. Youth Camp" value="${esc(ev.name)}"></label>
    <label>Budget<input type="number" name="budget" min="0" step="0.01" required value="${ev.budget ?? ''}"></label>
    <div class="row"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Save</button></div></form>`);
  $('#ev-form').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target);
    if (id) Object.assign(ev, { name: f.get('name'), budget: +f.get('budget') }); else S.events.push({ id: uid(), name: f.get('name'), budget: +f.get('budget') });
    closeModal(); save();
  };
}
function memberForm(id) {
  const m = S.members.find(x => x.id === id) || {};
  openModal(`<h2>${id ? 'Edit' : 'New'} member</h2><form id="m-form"><label>Name<input name="name" required value="${esc(m.name)}"></label>
    <label>Contact (phone or email, optional)<input name="contact" value="${esc(m.contact)}"></label>
    <label>Monthly dues<input type="number" name="monthly" min="0" step="0.01" value="${m.monthly ?? 0}"></label>
    <label>Contribution target (total expected, optional)<input type="number" name="due" min="0" step="0.01" value="${m.due ?? 0}"></label>
    <div class="row"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Save</button></div></form>`);
  $('#m-form').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target);
    const d = { name: f.get('name'), contact: f.get('contact'), monthly: +f.get('monthly'), due: +f.get('due') };
    if (id) Object.assign(m, d); else S.members.push({ id: uid(), ...d });
    closeModal(); save();
  };
}
function delEvent(id) {
  if (!confirm('Delete this event? Its transactions are kept but unlinked from the event.')) return;
  S.transactions.forEach(t => { if (t.eventId === id) t.eventId = ''; });
  S.events = S.events.filter(e => e.id !== id); save();
}
function delMember(id) {
  if (!confirm('Delete this member? Their payments are kept but unlinked.')) return;
  S.transactions.forEach(t => { if (t.memberId === id) t.memberId = ''; });
  S.members = S.members.filter(m => m.id !== id); save();
}
function catForm() {
  openModal(`<h2>Manage categories</h2><form id="cat-form"><p class="mute">One category per line. Existing entries keep their old category names.</p>
    <label>Income categories<textarea name="inc" rows="5">${esc(S.incomeCats.join('\n'))}</textarea></label>
    <label>Expense categories<textarea name="exp" rows="6">${esc(S.expenseCats.join('\n'))}</textarea></label>
    <div class="row"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Save</button></div></form>`);
  $('#cat-form').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target);
    const clean = (s, fb) => { const a = [...new Set(String(s).split('\n').map(x => x.trim()).filter(Boolean))]; return a.length ? a : fb; };
    S.incomeCats = clean(f.get('inc'), DEFAULT_INCOME_CATS); S.expenseCats = clean(f.get('exp'), DEFAULT_EXPENSE_CATS);
    closeModal(); save();
  };
}
/* ---------- receipt helpers (compress, pick, view, attach, remove) ---------- */
window.compressReceiptImage = async function(file, maxDim = 1400, quality = 0.82) {
  const readAsDataUrl = f => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(f);
  });
  if (!file || !file.type || !file.type.startsWith('image/')) {
    const dataUrl = await readAsDataUrl(file);
    return { blob: file, dataUrl, contentType: file.type || 'application/octet-stream', ext: (file.name.split('.').pop() || 'bin').toLowerCase() };
  }
  try {
    const objUrl = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = objUrl;
    });
    URL.revokeObjectURL(objUrl);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxDim || h > maxDim) {
      const ratio = Math.min(maxDim / w, maxDim / h);
      w = Math.max(1, Math.round(w * ratio));
      h = Math.max(1, Math.round(h * ratio));
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const blob = await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', quality));
    if (blob && blob.size) {
      return { blob, dataUrl, contentType: 'image/jpeg', ext: 'jpg' };
    }
  } catch (err) {
    console.warn('Receipt compression fallback:', err);
  }
  const dataUrl = await readAsDataUrl(file);
  const ext = (file.name && file.name.includes('.') ? file.name.split('.').pop() : 'jpg').toLowerCase();
  return { blob: file, dataUrl, contentType: file.type || 'image/jpeg', ext };
};

window.pickReceiptFile = function() {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    let settled = false;
    const finish = file => {
      if (settled) return;
      settled = true;
      inp.remove();
      resolve(file || null);
    };
    inp.addEventListener('change', () => finish(inp.files && inp.files[0]));
    inp.addEventListener('cancel', () => finish(null));
    inp.click();
  });
};

window.msReceiptPicked = function(inp) {
  const lbl = inp && inp.closest('.ms-rcpt-pick');
  if (!lbl) return;
  const span = lbl.querySelector('span');
  const file = inp.files && inp.files[0];
  if (file) {
    lbl.classList.add('has-file');
    lbl.title = `Attached: ${file.name}`;
    if (span) span.textContent = '✅ Receipt';
  } else {
    lbl.classList.remove('has-file');
    lbl.title = 'Attach receipt photo';
    if (span) span.textContent = '📷 Receipt';
  }
};

window.renderReceiptModal = function(t, imgUrl) {
  const canEdit = typeof sb === 'undefined' || (typeof canAdd === 'function' && canAdd());
  const isAllow = isAllowanceExp(t) || isAllowanceInc(t);
  const fundTag = isAllow
    ? `<span class="fund-badge-pill fund-badge-allowance">💳 Allowance</span>`
    : `<span class="fund-badge-pill fund-badge-general">🏢 General</span>`;
  openModal(`
    <h2>🧾 Expense Receipt</h2>
    <div class="rcpt-modal-meta">
      <div><b>${esc(cleanNotes(t.notes) || t.category)}</b> ${fundTag}</div>
      <div class="mute" style="font-size:12px;margin-top:3px">${t.date} · ${esc(t.category)} · <b class="${t.type === 'income' ? 'pos' : 'neg'}">${t.type === 'income' ? '+' : '-'}${money(t.amount)}</b></div>
    </div>
    <div class="rcpt-modal-img-wrap">
      <img src="${imgUrl}" alt="Expense receipt">
    </div>
    <div class="row" style="margin-top:14px;flex-wrap:wrap;gap:8px;justify-content:space-between">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn sm ghost" href="${imgUrl}" target="_blank" rel="noopener" download="receipt-${t.date}.jpg">⬇ Open / Save</a>
        ${canEdit ? `<button type="button" class="btn sm ghost" onclick="attachReceipt('${t.id}', true)">📷 Replace</button>` : ''}
        ${canEdit ? `<button type="button" class="btn sm ghost danger" onclick="removeReceipt('${t.id}')">🗑️ Remove</button>` : ''}
      </div>
      <button type="button" class="btn ghost" onclick="closeModal()">Close</button>
    </div>
  `);
};

function showReceipt(id) {
  const t = S.transactions.find(x => x.id === id);
  if (!t || !t.receipt) { showToast('No receipt attached yet'); return; }
  window.renderReceiptModal(t, t.receipt);
}

window.attachReceipt = async function(txId, reopenModal = false) {
  const t = S.transactions.find(x => x.id === txId);
  if (!t) return;
  const file = await window.pickReceiptFile();
  if (!file) return;
  showToast('⏳ Processing receipt...');
  const comp = await window.compressReceiptImage(file);
  t.receipt = comp.dataUrl;
  t.log = t.log || [];
  t.log.push(`Receipt uploaded ${new Date().toLocaleString()}`);
  save();
  showToast('🧾 Receipt uploaded!');
  if (reopenModal) showReceipt(txId);
};

window.removeReceipt = async function(txId) {
  const t = S.transactions.find(x => x.id === txId);
  if (!t || !confirm('Remove the receipt photo from this expense?')) return;
  t.receipt = '';
  t.log = t.log || [];
  t.log.push(`Receipt removed ${new Date().toLocaleString()}`);
  closeModal();
  save();
  showToast('🗑️ Receipt removed');
};

function showLog(id) { const t = S.transactions.find(x => x.id === id); openModal(`<h2>Edit history</h2>${(t.log || []).map(l => `<p class="mute">${esc(l)}</p>`).join('')}<br><button class="btn ghost" onclick="closeModal()">Close</button>`); }

/* ---------- actions ---------- */
function approve(id) {
  const t = S.transactions.find(x => x.id === id);
  if (!t) return;
  t.status = 'approved'; t.log = t.log || []; t.log.push(`Approved ${new Date().toLocaleString()}`); save();
}
function voidTx(id) {
  if (!confirm('Void this entry? It will be kept in history but excluded from totals.')) return;
  const t = S.transactions.find(x => x.id === id); t.status = 'void'; t.log.push(`Voided ${new Date().toLocaleString()}`); save();
}
function downloadCsv(rows, filename) {
  const blob = new Blob([rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

function getMonthlyReportData(ym) {
  const targetMonth = ym || reportMonth || getActiveMonth();
  const [yStr, moStr] = targetMonth.split('-');
  const y = parseInt(yStr, 10), mo = parseInt(moStr, 10);
  const fridays = getFridaysForMonth(y, mo);
  const monthTitle = new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const shortMonth = new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  const allow = getMonthlyAllowance(targetMonth);
  const sig = getSignatories();

  const mApproved = S.transactions.filter(t => t.status !== 'void' && t.date.startsWith(targetMonth)).sort((a, b) => a.date.localeCompare(b.date));
  const incList = mApproved.filter(t => t.type === 'income');
  const expList = mApproved.filter(t => t.type === 'expense');

  const begEntries = incList.filter(isBeginningTx);
  let begBal = sum(begEntries);
  if (!begEntries.length) begBal = Math.max(0, getCarriedBeginningBalance(targetMonth));

  const regularInc = incList.filter(t => !begEntries.includes(t));
  const ynEntries = regularInc.filter(t => t.category === 'Youth Night Offering');
  const totalYN = sum(ynEntries);
  const jfEntries = regularInc.filter(t => t.category === 'Joint Fellowship Offering');
  const totalJF = sum(jfEntries);
  const jfSkipReason = !totalJF ? getSkipReason('jf:' + targetMonth) : '';
  const allocEntries = regularInc.filter(t => isAllowanceInc(t) && t.category !== 'Youth Night Offering' && t.category !== 'Joint Fellowship Offering');
  const totalAlloc = sum(allocEntries);
  const otherInc = regularInc.filter(t => t.category !== 'Youth Night Offering' && t.category !== 'Joint Fellowship Offering' && !allocEntries.includes(t));
  const totalOtherInc = sum(otherInc);
  const totalOfferings = totalYN + totalJF + totalOtherInc;
  const totalCashOnHand = begBal + totalOfferings;

  const allowExpList = expList.filter(t => isAllowanceExp(t));
  const genExpList = expList.filter(t => !isAllowanceExp(t));
  const totalAllowExp = sum(allowExpList);
  const totalGenExp = sum(genExpList);
  const netCashOnHand = totalCashOnHand - totalGenExp;
  const yearAllow = getYearlyAllowance(y);

  const fridayDatesSet = new Set(fridays.map(f => f.date));
  const ynSlotRows = [
    ...fridays.map(f => {
      const matches = ynEntries.filter(t => t.date === f.date);
      const amt = matches.length ? sum(matches) : null;
      return { date: f.date, label: f.formatted, amount: amt, reason: amt == null ? getSkipReason(`yn:${f.date}`) : '' };
    }),
    ...ynEntries.filter(t => !fridayDatesSet.has(t.date)).map(t => {
      const dObj = new Date(t.date + 'T00:00:00');
      const dLabel = isNaN(dObj) ? t.date : `${dObj.toLocaleDateString('en-US', { month: 'short' })}. ${dObj.getDate()}`;
      return { date: t.date, label: dLabel, amount: t.amount, reason: '' };
    })
  ].sort((a, b) => a.date.localeCompare(b.date));

  return {
    ym: targetMonth, y, mo, monthTitle, shortMonth,
    begBal, begEntries, hasExplicitBeg: begEntries.length > 0,
    ynEntries, ynSlotRows, totalYN,
    jfEntries, totalJF, jfSkipReason,
    allocEntries, totalAlloc,
    otherInc, totalOtherInc,
    totalOfferings, totalCashOnHand,
    genExpList, totalGenExp, netCashOnHand,
    allow, allowExpList, totalAllowExp, yearAllow,
    combinedCash: netCashOnHand + allow.remaining,
    mApproved, sig
  };
}
window.getMonthlyReportData = getMonthlyReportData;

window.printReport = function() {
  const isAnnual = view === 'reports' && reportMode === 'annual';
  let st = document.getElementById('btc-print-page-style');
  if (!st) {
    st = document.createElement('style');
    st.id = 'btc-print-page-style';
    document.head.appendChild(st);
  }
  st.textContent = isAnnual
    ? '@page { size: landscape; margin: 8mm; }'
    : '@page { size: portrait; margin: 10mm; }';

  const prevTitle = document.title;
  if (view === 'reports') {
    if (isAnnual) {
      const years = [...new Set([...S.transactions.map(t => t.date.slice(0, 4)), String(new Date().getFullYear())])].sort().reverse();
      const y = reportYear || years[0] || String(new Date().getFullYear());
      document.title = `BTC Youth - Annual Financial Summary ${y}`;
    } else {
      const rep = getMonthlyReportData(reportMonth || getActiveMonth());
      document.title = `BTC Youth - Cash Accountability Report - ${rep.monthTitle}`;
    }
  }
  const restore = () => { document.title = prevTitle; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  window.print();
  setTimeout(restore, 1500);
};

function csv() {
  if (view === 'reports' && reportMode === 'annual') {
    const years = [...new Set([...S.transactions.map(t => t.date.slice(0, 4)), String(new Date().getFullYear())])].sort().reverse();
    const y = reportYear || years[0] || String(new Date().getFullYear());
    const annual = getAnnualBreakdown(y);
    const sig = getSignatories();
    const includeAdj = annual.showAdj || Math.abs(annual.totalAdjustments) > 0.005;
    const hdr = ['Month', 'Beg. Youth Fund', 'Friday Offerings', 'Joint Fellowship', 'Youth Inflow', 'General Exp.', 'Youth Fund Net'];
    if (includeAdj) hdr.push('Adjustment');
    hdr.push('Ending Youth Fund', 'Allowance In', 'Allowance Out', 'Balance', 'Remaining');

    const rows = [
      ['Tagbilaran Bible Training Ministries, Inc.'],
      ['BIBLE TRAINING CENTER - TAGBILARAN CHURCH'],
      ['College, Youth and Professionals (COYAP)'],
      ['ANNUAL FINANCIAL ACCOUNTABILITY & NET SUMMARY'],
      [`For the Calendar Year ${y}`],
      ['In Philippine Peso (PHP) - Youth General Fund & Church Allowance Separated'],
      [],
      hdr,
      ...annual.months.map(m => {
        const r = [
          m.fullName + (m.flagged ? ' [FLAGGED >2x Avg]' : ''),
          m.begCash.toFixed(2),
          m.fridayOfferings.toFixed(2),
          m.jointFellowship.toFixed(2),
          m.totalInflow.toFixed(2),
          m.generalExpenses ? (-m.generalExpenses).toFixed(2) : '0.00',
          m.monthlyNet.toFixed(2)
        ];
        if (includeAdj) r.push((m.adjustment || 0).toFixed(2));
        r.push(
          m.endingCash.toFixed(2),
          m.allowanceIn.toFixed(2),
          m.allowanceSpentRaw == null ? '' : Number(m.allowanceSpentRaw).toFixed(2),
          m.allowanceLeft == null ? '' : m.allowanceLeft.toFixed(2),
          m.allowanceRemaining.toFixed(2)
        );
        return r;
      }),
      (() => {
        const tot = [
          `TOTAL FOR ${y}`,
          annual.openingBalance.toFixed(2),
          annual.totalFriday.toFixed(2),
          annual.totalJF.toFixed(2),
          annual.totalInflowYear.toFixed(2),
          annual.totalGeneralExpenses ? (-annual.totalGeneralExpenses).toFixed(2) : '0.00',
          annual.totalNetOfYear.toFixed(2)
        ];
        if (includeAdj) tot.push(annual.totalAdjustments.toFixed(2));
        tot.push(
          annual.finalEndingCash.toFixed(2),
          annual.totalAllocIn.toFixed(2),
          annual.totalAllowanceSpent.toFixed(2),
          annual.allowanceLeftYear.toFixed(2),
          annual.allowanceLeftYear.toFixed(2)
        );
        return tot;
      })()
    ];

    if (annual.flags.length) {
      rows.push([], [`Flagged Months (Expenses > 2x Avg: Avg ${annual.avgExpense.toFixed(2)}, Threshold ${annual.flagThreshold.toFixed(2)})`]);
      rows.push(['Month', 'Expenses', 'Note']);
      annual.flags.forEach(f => {
        const mObj = annual.months.find(m => m.ym === f.ym) || {};
        rows.push([f.month, f.expenses.toFixed(2), mObj.note || '']);
      });
    }
    if (annual.spentUnsupported) {
      rows.push([], [`WARNING: Monthly breakdown missing - total spent ${annual.allowanceTotals.totalSpent.toFixed(2)} is unsupported by monthly data.`]);
    }
    if (annual.reportedAny) {
      rows.push([], ['Reconciliation - Reported vs Computed Beginning Balances']);
      if (annual.recon.length) {
        rows.push(['Month', 'Reported Beginning', 'Expected', 'Difference']);
        annual.recon.forEach(r => rows.push([r.month, r.reported.toFixed(2), r.expected.toFixed(2), r.diff.toFixed(2)]));
        rows.push(['Total Difference', '', '', annual.reconSummary.total.toFixed(2)]);
      } else {
        rows.push(['Reported beginning balances agree with the computed chain.']);
      }
      rows.push(['Documented Adjustments', annual.reconSummary.adjustments.toFixed(2)]);
      rows.push(['Total Unexplained Difference', annual.reconSummary.unexplained.toFixed(2)]);
    }

    rows.push(
      [],
      ['Annual Net Cash Accountability', 'Amount'],
      ['Opening Balance', annual.openingBalance.toFixed(2)],
      [`Total Inflows for ${y}`, annual.totalInflowYear.toFixed(2)],
      [`Total Expenses for ${y}`, annual.totalExpensesYear ? (-annual.totalExpensesYear).toFixed(2) : '0.00'],
      ['TOTAL NET OF THE YEAR', annual.totalNetOfYear.toFixed(2)],
      ['Closing Balance', annual.finalEndingCash.toFixed(2)],
      [],
      ['Monthly Allowance Status', 'Amount'],
      ['Allowance Allocated/Received', annual.totalAllocIn.toFixed(2)],
      ['Allowance Disbursed/Spent', annual.totalAllowanceSpent ? (-annual.totalAllowanceSpent).toFixed(2) : '0.00'],
      ['ALLOWANCE REMAINING LEFT', annual.allowanceLeftYear.toFixed(2)],
      [],
      ['Signatories'],
      ['Prepared by', sig.preparedName, sig.preparedTitle],
      ['Noted', sig.notedName, sig.notedTitle],
      ['Recommending Approval', sig.recommendingName, sig.recommendingTitle],
      ['Approved by', sig.approvedName, sig.approvedTitle]
    );
    downloadCsv(rows, `btc-youth-annual-net-summary-${y}.csv`);
    return;
  }

  if (view === 'reports' && reportMode === 'monthly') {
    const r = getMonthlyReportData(reportMonth || getActiveMonth());
    const rows = [
      ['Tagbilaran Bible Training Ministries, Inc.'],
      ['BIBLE TRAINING CENTER - TAGBILARAN CHURCH'],
      ['College, Youth and Professionals (COYAP)'],
      ['Cash Accountability Report'],
      [`As of ${r.monthTitle}`],
      ['In Philippine Peso'],
      [],
      ['Line Item', 'Detail', 'Subtotal', 'Total'],
      ['Cash on Hand - Beginning Balance', '', '', ''],
      ['  Youth Funds from Church', '', '', ''],
      ['  Youth Night Offerings', '', '0.00', ''],
      ['  Beginning Balance Total', '', '', r.begBal.toFixed(2)],
      [],
      ['Add: Offerings', '', '', ''],
      ['  Youth Night Offerings', '', '', ''],
      ...r.ynSlotRows.map(s => [
        `    ${s.label}${s.reason ? ` (${s.reason})` : ''}`,
        s.amount != null ? s.amount.toFixed(2) : '—',
        '',
        ''
      ]),
      ['  Subtotal Youth Night Offerings', '', r.totalYN.toFixed(2), ''],
      [`  Joint Fellowship Offerings${r.jfSkipReason ? ` (${r.jfSkipReason})` : ''}`, '', r.totalJF ? r.totalJF.toFixed(2) : '—', r.totalOfferings.toFixed(2)],
      ...r.otherInc.map(t => [`  ${t.category} (${t.date})`, '', t.amount.toFixed(2), '']),
      ['Total Cash on Hand (Youth General Fund)', '', '', r.totalCashOnHand.toFixed(2)],
      [],
      ['Less: Expenses (Youth General Fund)', '', '', ''],
      ...(r.genExpList.length
        ? r.genExpList.map(t => [`  ${t.category} (${t.date}${cleanNotes(t.notes) ? ' · ' + cleanNotes(t.notes) : ''})`, t.amount.toFixed(2), '', ''])
        : [['  None recorded', '0.00', '', '']]),
      ['Total General Fund Expenses', '', '', (-r.totalGenExp).toFixed(2)],
      ['NET CASH ON HAND (YOUTH GENERAL FUND)', '', '', r.netCashOnHand.toFixed(2)],
      [],
      ['SEPARATED STATEMENT: ALLOCATION FROM CHURCH FUNDS (MONTHLY ALLOWANCE)', '', '', ''],
      [`Allocation from Church Funds (${r.monthTitle})`, '', '', r.allow.allocated.toFixed(2)],
      ['Less: Allowance Expenses', '', '', ''],
      ...(r.allowExpList.length
        ? r.allowExpList.map(t => [`  ${t.category} (Allowance · ${t.date}${cleanNotes(t.notes) ? ' · ' + cleanNotes(t.notes) : ''})`, t.amount.toFixed(2), '', ''])
        : [['  None recorded', '0.00', '', '']]),
      ['Total Allowance Expenses', '', '', (-r.allow.spent).toFixed(2)],
      [`REMAINING ALLOWANCE BALANCE (${r.monthTitle.toUpperCase()})`, '', '', r.allow.remaining.toFixed(2)],
      [`${r.y} Cumulative Remaining Allowance`, '', '', r.yearAllow.remaining.toFixed(2)],
      ['Reference Combined Cash (Youth Fund + Monthly Allowance Left)', '', '', r.combinedCash.toFixed(2)],
      [],
      ['Signatories'],
      ['Prepared by', r.sig.preparedName, r.sig.preparedTitle],
      ['Noted', r.sig.notedName, r.sig.notedTitle],
      ['Recommending Approval', r.sig.recommendingName, r.sig.recommendingTitle],
      ['Approved by', r.sig.approvedName, r.sig.approvedTitle]
    ];
    downloadCsv(rows, `btc-youth-monthly-report-${r.ym}.csv`);
    return;
  }

  const rows = [['Date', 'Type', 'Category', 'Event', 'Member', 'Amount', 'Status', 'Notes']];
  S.transactions.filter(inPeriod).forEach(t => rows.push([t.date, t.type, t.category, evName(t.eventId), memName(t.memberId), t.amount, t.status, t.notes]));
  downloadCsv(rows, 'btc-youth-transactions.csv');
}

function sample() {
  const e1 = { id: uid(), name: 'Youth Camp', budget: 15000 }, e2 = { id: uid(), name: 'Outreach Day', budget: 5000 };
  const ms = ['Anna', 'Ben', 'Carla', 'Daniel'].map(n => ({ id: uid(), name: n, due: 1000, monthly: 200 }));
  const T = (type, d, amount, category, eventId = '', memberId = '', status = 'approved', notes = '') => ({ id: uid(), type, date: d, amount, category, eventId, memberId, notes, status, receipt: '', log: ['Sample data'] });
  S.events.push(e1, e2); S.members.push(...ms);
  S.transactions.push(
    T('income', '2026-09-01', 2440, 'Beginning Balance', '', '', 'approved', 'Cash on Hand - Beginning Balance'),
    T('income', '2026-09-04', 62, 'Youth Night Offering'),
    T('income', '2026-09-11', 120, 'Youth Night Offering'),
    T('income', '2026-09-18', 95, 'Youth Night Offering'),
    T('income', '2026-09-25', 110, 'Youth Night Offering'),
    T('income', '2026-09-27', 350, 'Joint Fellowship Offering'),
    T('income', '2026-09-27', 1500, 'Allocation from Church Funds', '', '', 'approved', 'Monthly Allowance from Church'),
    T('expense', '2026-09-15', 450, 'Monthly Allowance', '', '', 'approved', 'Snack allowance for officers'),
    T('expense', '2026-09-22', 300, 'Monthly Allowance', '', '', 'approved', 'Transport allowance'),
    T('expense', '2026-09-20', 250, 'Supplies', e2.id, '', 'approved')
  );
  save();
}

/* ---------- views ---------- */
function chart() {
  const months = {};
  S.transactions.filter(t => t.status !== 'void' && inPeriod(t)).forEach(t => { const m = t.date.slice(0, 7); months[m] ??= { income: 0, expense: 0 }; months[m][t.type] += t.amount; });
  const keys = Object.keys(months).sort().slice(-12);
  if (!keys.length) return '<div class="empty">No data yet</div>';
  const max = Math.max(...keys.flatMap(k => [months[k].income, months[k].expense])) || 1;
  const w = 520, h = 220, step = (w - 40) / keys.length, bw = Math.min(22, step / 2 - 3);
  let out = `<svg viewBox="0 0 ${w} ${h + 24}" width="100%"><defs><linearGradient id="gi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#7c5cff"/></linearGradient>
  <linearGradient id="ge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fb923c"/><stop offset="1" stop-color="#f43f5e"/></linearGradient></defs>`;
  keys.forEach((k, i) => {
    const x = 30 + i * step, hi = months[k].income / max * h, he = months[k].expense / max * h;
    out += `<rect x="${x}" y="${h - hi}" width="${bw}" height="${hi}" rx="5" fill="url(#gi)"><title>Income ${money(months[k].income)}</title></rect>
    <rect x="${x + bw + 4}" y="${h - he}" width="${bw}" height="${he}" rx="5" fill="url(#ge)"><title>Expenses ${money(months[k].expense)}</title></rect>
    <text x="${x}" y="${h + 16}">${k}</text>`;
  });
  return out + '</svg><p class="mute">🟦 Income &nbsp; 🟧 Expenses</p>';
}

function txRows(list, actions = true, selectable = false) {
  if (!list.length) return '<div class="empty">No transactions yet.</div>';
  const allChecked = selectable && list.length > 0 && list.every(t => selectedTxIds.has(t.id));
  return `<table class="tx-table"><tr class="tx-head">${selectable ? `<th style="width:32px"><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="toggleSelectAllVisible(this.checked)" style="width:auto" title="Select all shown"></th>` : ''}<th>Date</th><th>Type</th><th>Category</th><th>Fund</th><th>Event</th><th>Amount</th><th>Status</th>${actions ? '<th></th>' : ''}</tr>` +
    list.map(t => {
      const isAllow = isAllowanceInc(t) || isAllowanceExp(t);
      const isSel = selectable && selectedTxIds.has(t.id);
      const fundBadge = isAllow
        ? `<span class="fund-badge-pill fund-badge-allowance" title="Church Monthly Allowance Fund">💳 Allowance</span>`
        : `<span class="fund-badge-pill fund-badge-general" title="General Youth Fund">🏢 General</span>`;
      return `<tr style="${isSel ? 'background:rgba(34,211,238,.1)' : ''}">${selectable ? `<td class="c-sel"><input type="checkbox" class="tx-sel-chk" data-id="${t.id}" ${isSel ? 'checked' : ''} onchange="toggleTxSelect('${t.id}',this.checked)" style="width:auto"></td>` : ''}<td class="c-date">${t.date}</td><td class="c-type">${t.type}</td><td class="c-cat"><span class="tag">${esc(t.category)}</span> <span class="mute">${esc(memName(t.memberId) || cleanNotes(t.notes))}</span></td><td class="c-fund">${fundBadge}</td><td class="c-event ${evName(t.eventId) === '—' ? 'is-empty' : ''}">${esc(evName(t.eventId))}</td>
    <td class="c-amt ${t.type === 'income' ? 'pos' : 'neg'}">${t.type === 'income' ? '+' : '-'}${money(t.amount)}</td>
    <td class="c-status"><span class="tag ${t.status === 'void' ? '' : 'ok'}">${t.status === 'void' ? 'void' : 'saved'}</span></td>
    ${actions ? `<td class="c-act" style="white-space:nowrap">${t.receipt ? `<button class="btn sm ghost rcpt-has" title="View receipt" onclick="showReceipt('${t.id}')">🧾</button> ` : (t.type === 'expense' ? `<button class="btn sm ghost rcpt-add" title="Upload receipt photo" onclick="attachReceipt('${t.id}')">📷</button> ` : '')}<button class="btn sm ghost" title="History" onclick="showLog('${t.id}')">🕘</button> <button class="btn sm ghost danger" title="Delete permanently" onclick="deleteSelectedTxs(['${t.id}'])">🗑️</button></td>` : ''}</tr>`;
    }).join('') + '</table>';
}

/* Dues: a member owes this month if monthly > 0 and 'Dues' income logged for them this month is less than monthly */
const paidThisMonth = m => sum(inc().filter(t => t.memberId === m.id && t.category === 'Dues' && t.date.startsWith(today().slice(0, 7))));
const owingThisMonth = () => S.members.filter(m => m.monthly > 0 && paidThisMonth(m) < m.monthly);
function copyReminder() {
  const month = new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const lines = owingThisMonth().map(m => `• ${m.name}: ${money(m.monthly - paidThisMonth(m))}`);
  const msg = `Hi BTC Youth! Friendly reminder: monthly dues for ${month} are still outstanding:\n${lines.join('\n')}\nThank you! 🙏`;
  navigator.clipboard.writeText(msg).then(() => alert('Reminder message copied. Paste it into your group chat.'), () => prompt('Copy this message:', msg));
}
const eventStats = e => { const spent = sum(exp().filter(t => t.eventId === e.id)), raised = sum(inc().filter(t => t.eventId === e.id)); return { spent, raised, pct: e.budget ? spent / e.budget * 100 : 0 }; };

/* ---------- Monthly Sheet inline save handlers ---------- */
function parseMoneyInput(val) {
  const cleaned = String(val ?? '').replace(/[₱$,\s]/g, '').trim();
  if (!cleaned) return NaN;
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : NaN;
}

window.msSaveSlot = async function(inputId, kind, date, txId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const amount = parseMoneyInput(inp.value);
  if (isNaN(amount) || amount <= 0) {
    alert('Please enter an amount greater than 0 (e.g. 150 or 1,500.00).');
    inp.focus();
    return;
  }
  const ym = date.slice(0, 7);
  if (kind === 'alloc') {
    await window.saveChurchAllocation({
      id: txId || null,
      date,
      amount,
      notes: 'Monthly Allocation from Church Funds'
    });
    activeMonth = ym;
    showToast(`✔ Saved Church Allocation (${money(amount)})`);
    return;
  }
  const meta = {
    beg: { category: 'Beginning Balance', notes: 'Cash on Hand - Beginning Balance' },
    yn: { category: 'Youth Night Offering', notes: 'Youth Night Offering' },
    jf: { category: 'Joint Fellowship Offering', notes: 'Joint Fellowship Offering' }
  }[kind] || { category: 'Offering', notes: '' };

  await window.saveBatchOfferings([{
    id: txId || null,
    type: 'income',
    fund: 'general',
    date,
    amount,
    category: meta.category,
    notes: meta.notes
  }]);
  activeMonth = ym;
  showToast(`✔ Saved ${meta.category} (${money(amount)})`);
};

window.msSaveAll = async function() {
  const inputs = [...document.querySelectorAll('.ms-inline-input')];
  const entries = [];
  let allocEntry = null;
  for (const inp of inputs) {
    const raw = inp.value.trim();
    const orig = (inp.dataset.orig || '').trim();
    if (!raw || raw === orig) continue;
    const amount = parseMoneyInput(raw);
    if (isNaN(amount) || amount <= 0) continue;
    const kind = inp.dataset.slotKind;
    const date = inp.dataset.slotDate;
    const txId = inp.dataset.slotTxid || null;
    if (kind === 'alloc') {
      allocEntry = { id: txId, date, amount, notes: 'Monthly Allocation from Church Funds' };
    } else {
      const meta = {
        beg: { category: 'Beginning Balance', notes: 'Cash on Hand - Beginning Balance' },
        yn: { category: 'Youth Night Offering', notes: 'Youth Night Offering' },
        jf: { category: 'Joint Fellowship Offering', notes: 'Joint Fellowship Offering' }
      }[kind] || { category: 'Offering', notes: '' };
      entries.push({ id: txId, type: 'income', fund: 'general', date, amount, category: meta.category, notes: meta.notes });
    }
  }
  const totalCount = entries.length + (allocEntry ? 1 : 0);
  if (!totalCount) {
    showToast('No unsaved changes yet — type an amount first');
    return;
  }
  if (entries.length) await window.saveBatchOfferings(entries);
  if (allocEntry) await window.saveChurchAllocation(allocEntry);
  showToast(`✔ Saved ${totalCount} ${totalCount === 1 ? 'entry' : 'entries'}`);
};

window.msAddCustomYn = async function(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const date = f.get('date');
  const amount = parseMoneyInput(f.get('amount'));
  const notes = (f.get('notes') || '').trim() || 'Youth Night Offering';
  if (!date || isNaN(amount) || amount <= 0) {
    alert('Please enter a date and valid offering amount.');
    return;
  }
  await window.saveBatchOfferings([{
    id: null,
    type: 'income',
    fund: 'general',
    date,
    amount,
    category: 'Youth Night Offering',
    notes
  }]);
  activeMonth = date.slice(0, 7);
  showToast(`✔ Added Youth Night Offering (${money(amount)})`);
};

window.msDeleteSlot = async function(txId, label) {
  if (!txId || !confirm(`Remove ${label || 'this entry'}?`)) return;
  await window.saveBatchOfferings([], [txId]);
  showToast('Removed entry');
};

window.msApplyCarried = async function(ym, amount) {
  await window.saveBatchOfferings([{
    id: null,
    type: 'income',
    fund: 'general',
    date: `${ym}-01`,
    amount,
    category: 'Beginning Balance',
    notes: 'Cash on Hand - Beginning Balance'
  }]);
  activeMonth = ym;
  showToast(`✔ Beginning balance set to ${money(amount)}`);
};

window.msAddExpense = async function(e) {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const date = f.get('date');
  const amount = parseMoneyInput(f.get('amount'));
  const category = f.get('category') || 'Other';
  const fund = f.get('fund') || 'general';
  let notes = (f.get('notes') || '').trim() || category;
  const receiptFile = f.get('receipt');
  const hasReceipt = receiptFile && receiptFile.size > 0;
  if (!date || isNaN(amount) || amount <= 0) {
    alert('Please enter a valid expense date and amount.');
    return;
  }
  if (hasReceipt) showToast('⏳ Uploading expense & receipt...');
  const ok = await window.saveBatchOfferings([{
    id: null,
    type: 'expense',
    fund,
    date,
    amount,
    category: fund === 'allowance' && category === 'Other' ? 'Monthly Allowance' : category,
    notes,
    receiptFile: hasReceipt ? receiptFile : null
  }]);
  if (ok === false) return;
  activeMonth = date.slice(0, 7);
  showToast(hasReceipt ? `🧾 Added expense & receipt (${money(amount)})` : `✔ Added expense (${money(amount)})`);
};

window.msOpenReport = function(ym) {
  reportMode = 'monthly';
  reportMonth = ym;
  localStorage.setItem('btc-rep-mode', 'monthly');
  localStorage.setItem('btc-rep-month', ym);
  view = 'reports';
  render();
};

const views = {
  monthly() {
    const ym = getActiveMonth();
    const L = getMonthLedger(ym);
    const currentYm = today().slice(0, 7);
    const earliestYm = getEarliestTrackedMonth();
    const canEdit = typeof sb === 'undefined' || (typeof canAdd === 'function' && canAdd());

    // Build 12-month health strip for L.year
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let yearMissingMonths = [];
    const stripHtml = monthNames.map((shortM, idx) => {
      const mYm = `${L.year}-${String(idx + 1).padStart(2, '0')}`;
      const ml = mYm === ym ? L : getMonthLedger(mYm);
      const isSelected = mYm === ym;
      const isCur = mYm === currentYm;
      const isFut = mYm > currentYm;
      const isBeforeStart = mYm < earliestYm && !ml.hasActivity;
      let cls = 'month-pill';
      let badge = '—';
      if (isSelected) cls += ' active';
      if (isCur) cls += ' is-current';
      if (isFut) {
        cls += ' is-future';
      } else if (isBeforeStart) {
        cls += ' is-idle';
      } else if (ml.missingItems.length > 0) {
        cls += ' has-missing';
        badge = `${ml.missingItems.length} miss`;
        yearMissingMonths.push({ ym: mYm, label: `${shortM} ${L.year}`, count: ml.missingItems.length });
      } else {
        cls += ' is-complete';
        badge = '✔';
      }
      return `<button type="button" class="${cls}" onclick="setActiveMonth('${mYm}')" title="${ml.monthTitle}${ml.missingItems.length && !isFut && !isBeforeStart ? ' · ' + ml.missingItems.length + ' missing' : ''}">
        <span class="mp-name">${shortM}</span>
        <span class="mp-badge">${badge}</span>
      </button>`;
    }).join('');

    // Missing / status banner for selected month
    let bannerHtml = '';
    if (L.isFutureMonth) {
      bannerHtml = `<div class="ms-banner info"><span>🗓️ <b>${L.monthTitle}</b> is an upcoming month. You can pre-enter amounts anytime.</span></div>`;
    } else if (L.missingItems.length > 0) {
      const chips = L.missingItems.map(m => `<button type="button" class="btn sm ghost" style="padding:3px 9px;font-size:11px;border-color:rgba(251,191,36,.45);color:#fde68a" onclick="const el=document.getElementById('${m.slotId}');if(el){el.focus();el.scrollIntoView({behavior:'smooth',block:'center'});}">${esc(m.label)}</button>`).join('');
      bannerHtml = `<div class="ms-banner warn">
        <div style="display:flex;flex-direction:column;gap:6px;flex:1">
          <div>⚠️ <b>${L.missingItems.length} missing ${L.missingItems.length === 1 ? 'entry' : 'entries'}</b> in <b>${L.monthTitle}</b> — click any item to fill in:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>
        </div>
      </div>`;
    } else {
      bannerHtml = `<div class="ms-banner ok">
        <span>✅ All scheduled offerings &amp; allocations up to today are recorded for <b>${L.monthTitle}</b>.</span>
        ${yearMissingMonths.length ? `<button type="button" class="btn sm ghost" style="border-color:rgba(251,191,36,.45);color:#fde68a" onclick="setActiveMonth('${yearMissingMonths[0].ym}')">Check ${yearMissingMonths[0].label} (${yearMissingMonths[0].count} missing) →</button>` : ''}
      </div>`;
    }

    // Helper for inline editable income slot row
    const slotRow = ({ id, title, sub, status, amount, txId, kind, date, skipKey, extraBtns = '' }) => {
      const reason = skipKey ? getSkipReason(skipKey) : '';
      const rowCls = status === 'missing' ? 'ms-row is-missing' : status === 'recorded' ? 'ms-row is-saved' : status === 'skipped' ? 'ms-row is-skipped' : 'ms-row';
      const badgeHtml = status === 'recorded'
        ? '<span class="ms-status ok">✔ Saved</span>'
        : status === 'missing'
          ? '<span class="ms-status missing">⚠️ Missing</span>'
          : status === 'skipped'
            ? `<span class="ms-status skipped">📝 ${esc(reason || 'Skipped')}</span>`
            : '<span class="ms-status upcoming">Upcoming</span>';

      const displaySub = (status === 'skipped' && reason)
        ? `Reason: <b>${esc(reason)}</b>`
        : sub;

      const rightControls = canEdit ? `
        <div class="ms-row-right">
          ${extraBtns}
          <div class="ms-amt-wrap">
            <span class="ms-amt-prefix">${esc(S.currency)}</span>
            <input type="text" inputmode="decimal" id="${id}" class="ms-inline-input" data-orig="${amount ? amount : ''}" data-slot-kind="${kind}" data-slot-date="${date}" data-slot-txid="${txId || ''}" value="${amount ? amount : ''}" placeholder="0.00" autocomplete="off">
          </div>
          <button type="button" class="btn sm" onclick="msSaveSlot('${id}','${kind}','${date}','${txId || ''}')">${txId ? 'Update' : 'Save'}</button>
          ${txId ? `<button type="button" class="btn sm ghost danger" title="Remove" onclick="msDeleteSlot('${txId}','${esc(title)}')">✕</button>` : ''}
          ${!txId && skipKey ? (status === 'skipped'
            ? `<button type="button" class="btn sm ghost" onclick="openSkipReasonModal('${skipKey}','${esc(title)}')">Edit</button><button type="button" class="btn sm ghost" onclick="toggleSkipSlot('${skipKey}')">Undo</button>`
            : (status === 'missing' ? `<button type="button" class="btn sm ghost" title="Add reason why this is missing" onclick="openSkipReasonModal('${skipKey}','${esc(title)}')">📝 Reason</button>` : '')
          ) : ''}
        </div>
      ` : `<div class="ms-row-right"><strong>${amount ? money(amount) : '—'}</strong></div>`;

      return `<div class="${rowCls}">
        <div class="ms-row-left">
          <div class="ms-row-title">${title} ${badgeHtml}</div>
          ${displaySub ? `<div class="ms-row-sub">${displaySub}</div>` : ''}
        </div>
        ${rightControls}
      </div>`;
    };

    // Youth Night Friday rows
    const fridayRowsHtml = L.fridays.map(f => slotRow({
      id: `ms-yn-${f.date}`,
      title: `Fri, ${f.formatted}`,
      sub: f.entries.length > 1 ? `${f.entries.length} entries totaling ${money(f.total)}` : (f.status === 'missing' ? 'Forgot to input? Enter offering amount' : f.date),
      status: f.status,
      amount: f.primary ? f.primary.amount : '',
      txId: f.primary ? f.primary.id : '',
      kind: 'yn',
      date: f.date,
      skipKey: f.skipKey
    })).join('');

    // Any off-Friday Youth Night entries (e.g., Thursday Oct. 16)
    const extraYnHtml = L.extraYnEntries.map(t => {
      const dObj = new Date(t.date + 'T00:00:00');
      const dLabel = isNaN(dObj) ? t.date : dObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return slotRow({
        id: `ms-yn-extra-${t.id}`,
        title: dLabel,
        sub: esc(t.notes || 'Youth Night Offering (custom date)'),
        status: 'recorded',
        amount: t.amount,
        txId: t.id,
        kind: 'yn',
        date: t.date,
        skipKey: ''
      });
    }).join('');

    // Default date for new inline expense
    const defaultExpDate = L.isCurrentMonth ? today() : `${ym}-15`;
    const expCatOpts = S.expenseCats.map(c => `<option ${c === 'Food' ? 'selected' : ''}>${esc(c)}</option>`).join('');

    // Helper for expense row rendering
    const renderExpRow = t => {
      const rcptBtn = t.receipt
        ? `<button type="button" class="btn sm ghost rcpt-has" title="View receipt" onclick="showReceipt('${t.id}')">🧾</button>`
        : (canEdit ? `<button type="button" class="btn sm ghost rcpt-add" title="Upload receipt photo" onclick="attachReceipt('${t.id}')">📷</button>` : '');
      return `<div class="ms-row">
        <div class="ms-row-left">
          <div class="ms-row-title">${esc(cleanNotes(t.notes) || t.category)} ${t.receipt ? '<span class="ms-status ok" style="font-size:10px;padding:1px 6px">🧾 Receipt</span>' : ''}</div>
          <div class="ms-row-sub">${t.date} · ${esc(t.category)}</div>
        </div>
        <div class="ms-row-right">
          <strong class="neg" style="font-size:15px;font-variant-numeric:tabular-nums">-${money(t.amount)}</strong>
          ${rcptBtn}
          ${canEdit ? `<button type="button" class="btn sm ghost danger" title="Void expense" onclick="voidTx('${t.id}')">✕</button>` : ''}
        </div>
      </div>`;
    };

    // Separated expense lists: General Youth Fund vs Church Monthly Allowance
    const genExpRowsHtml = L.genExpAll.length
      ? L.genExpAll.map(renderExpRow).join('')
      : `<div class="mute" style="padding:8px 4px;font-size:13px">No general fund expenses recorded for ${L.monthTitle} yet.</div>`;

    const allowExpRowsHtml = L.allowExpAll.length
      ? L.allowExpAll.map(renderExpRow).join('')
      : `<div class="mute" style="padding:8px 4px;font-size:13px">No allowance expenses recorded for ${L.monthTitle} yet.</div>`;

    // Other general income rows (if any)
    const otherIncHtml = L.otherInc.length ? `
      <div style="margin-top:10px">
        <div class="mute" style="font-size:12px;font-weight:600;margin-bottom:6px">Other General Income</div>
        <div class="ms-rows">
          ${L.otherInc.map(t => `<div class="ms-row is-saved">
            <div class="ms-row-left">
              <div class="ms-row-title">${esc(t.category)} <span class="ms-status ok">✔ Saved</span></div>
              <div class="ms-row-sub">${t.date}${t.notes ? ' · ' + esc(t.notes) : ''}</div>
            </div>
            <div class="ms-row-right">
              <strong class="pos" style="font-variant-numeric:tabular-nums">+${money(t.amount)}</strong>
              ${canEdit ? `<button type="button" class="btn sm ghost danger" onclick="voidTx('${t.id}')">✕</button>` : ''}
            </div>
          </div>`).join('')}
        </div>
      </div>` : '';

    const begExtraBtn = (!L.hasExplicitBeg && L.carriedBegBal > 0 && canEdit)
      ? `<button type="button" class="btn sm ghost" style="color:var(--b);border-color:rgba(34,211,238,.4)" onclick="msApplyCarried('${ym}', ${L.carriedBegBal})">Use ${money(L.carriedBegBal)}</button>`
      : '';

    const allowIsOk = L.allow.remaining >= 0;

    return `<div class="ms-wrap">
      <!-- 1. Month & Year Switcher + 12-Month Strip -->
      <div class="ms-nav-card">
        <div class="ms-nav-top">
          <div class="ms-nav-controls">
            <button type="button" class="btn sm ghost" onclick="shiftActiveMonth(-1)" title="Previous month">◀</button>
            <div class="ms-month-title">${L.monthTitle}</div>
            <button type="button" class="btn sm ghost" onclick="shiftActiveMonth(1)" title="Next month">▶</button>
            ${!L.isCurrentMonth ? `<button type="button" class="btn sm" style="background:linear-gradient(135deg,#06b6d4,#3b82f6)" onclick="setActiveMonth('${currentYm}')">Current Month</button>` : `<span class="tag ok">Current Month</span>`}
          </div>
          <div class="ms-nav-controls">
            <div class="ms-year-pill">
              <button type="button" onclick="setActiveMonth('${L.year - 1}-${String(L.month).padStart(2, '0')}')">◀</button>
              <span>${L.year}</span>
              <button type="button" onclick="setActiveMonth('${L.year + 1}-${String(L.month).padStart(2, '0')}')">▶</button>
            </div>
            ${canEdit && typeof window.importExcelReport === 'function' ? `<button type="button" class="btn sm" style="background:linear-gradient(135deg,#06b6d4,#3b82f6)" onclick="window.importExcelReport()">📥 Import Excel</button>` : ''}
            <button type="button" class="btn sm ghost" onclick="msOpenReport('${ym}')">📄 Printable Report</button>
          </div>
        </div>
        <div class="month-strip">${stripHtml}</div>
      </div>

      ${!canEdit ? `<div class="ms-banner warn"><span>🔒 <b>Read-only mode</b> — you are signed in as a <b>Viewer</b>. Ask your Treasurer to change your role to Officer or Treasurer under <b>Team &amp; roles</b> to input or import data.</span></div>` : ''}

      <!-- 2. Missing / Status Alert Banner -->
      ${bannerHtml}

      <!-- 3. Separated Fund Summary KPIs (Youth General Fund vs Church Monthly Allowance) -->
      <div class="ms-kpi-grid g4-kpi">
        <div class="ms-kpi">
          <small>🏢 Youth Fund Beginning</small>
          <strong>${money(L.begBal)}</strong>
          <div class="ms-kpi-sub">${L.hasExplicitBeg ? 'Saved for ' + L.shortTitle : (L.carriedBegBal ? 'Carried from prior month' : 'Not set yet')}</div>
        </div>
        <div class="ms-kpi highlight">
          <small>🏢 Youth Fund Net Cash (${L.shortTitle})</small>
          <strong class="${L.netCashOnHand < 0 ? 'neg' : 'pos'}">${money(L.netCashOnHand)}</strong>
          <div class="ms-kpi-sub">Offerings +${money(L.totalOfferings)} · Exp -${money(L.totalGenExp)}</div>
        </div>
        <div class="ms-kpi allowance-kpi">
          <small>💳 Church Allowance (${L.shortTitle})</small>
          <strong style="color:var(--b)">${money(L.allow.allocated)}</strong>
          <div class="ms-kpi-sub">Spent: <b class="neg">-${money(L.allow.spent)}</b></div>
        </div>
        <div class="ms-kpi allowance-kpi ${allowIsOk ? 'allowance-ok' : 'allowance-over'}">
          <small style="color:${allowIsOk ? 'var(--b)' : 'var(--bad)'}">💰 Remaining Allowance (${L.shortTitle})</small>
          <strong class="${allowIsOk ? 'pos' : 'neg'}">${money(L.allow.remaining)}</strong>
          <div class="ms-kpi-sub">${L.year} Total Remaining: <b style="color:${L.yearAllow.remaining < 0 ? 'var(--bad)' : 'var(--b)'}">${money(L.yearAllow.remaining)}</b></div>
        </div>
      </div>

      ${canEdit ? `
        <div id="ms-save-all-bar" class="ms-save-all-bar" style="display:none">
          <span id="ms-dirty-label">You have unsaved amounts</span>
          <button type="button" class="btn sm" style="background:linear-gradient(135deg,#06b6d4,#3b82f6)" onclick="msSaveAll()">💾 Save All Changes</button>
        </div>
      ` : ''}

      <!-- Quick Fund View Switcher (keeps mobile clean & easy to navigate) -->
      <div class="ms-fund-tabs" role="tablist" aria-label="Filter funds">
        <button type="button" class="ms-fund-tab ${msFundTab === 'all' ? 'active' : ''}" onclick="setMsFundTab('all')">📋 All Funds</button>
        <button type="button" class="ms-fund-tab ${msFundTab === 'general' ? 'active' : ''}" onclick="setMsFundTab('general')">🏢 Youth Fund</button>
        <button type="button" class="ms-fund-tab ${msFundTab === 'allowance' ? 'active' : ''}" onclick="setMsFundTab('allowance')">💳 Allowance</button>
      </div>

      ${(msFundTab === 'all' || msFundTab === 'general') ? `
      <!-- 4A. CARD 1: YOUTH GENERAL FUND (Offerings & General Cash on Hand) -->
      <div class="ms-sheet" id="ms-card-general">
        <div class="ms-card-head">
          <div>
            <div style="font-size:16px;font-weight:700">🏢 Youth General Fund — ${L.monthTitle}</div>
            <div class="mute" style="font-size:12px">Youth Night Offerings, Joint Fellowship &amp; General Expenses (separated from Church Allowance)</div>
          </div>
          <span class="fund-badge-pill fund-badge-general">General Fund</span>
        </div>

        <!-- Beginning Balance -->
        <div class="ms-section">
          <div class="ms-sec-head">
            <span class="ms-sec-title">1. Cash on Hand — Beginning Balance</span>
            <strong style="font-size:15px">${money(L.begBal)}</strong>
          </div>
          <div class="ms-rows">
            ${slotRow({
              id: `ms-beg-${ym}`,
              title: 'Beginning Balance',
              sub: L.hasExplicitBeg
                ? `Saved on ${L.begPrimary.date}`
                : (L.carriedBegBal ? `Auto-carried ${money(L.carriedBegBal)} from previous month's Youth Fund` : 'Enter starting Cash on Hand for this month'),
              status: L.hasExplicitBeg ? 'recorded' : 'upcoming',
              amount: L.begPrimary ? L.begPrimary.amount : '',
              txId: L.begPrimary ? L.begPrimary.id : '',
              kind: 'beg',
              date: `${ym}-01`,
              skipKey: '',
              extraBtns: begExtraBtn
            })}
          </div>
        </div>

        <!-- Youth Night Offerings (Every Friday) -->
        <div class="ms-section">
          <div class="ms-sec-head">
            <span class="ms-sec-title">2. Youth Night Offerings (Every Friday)</span>
            <div style="display:flex;align-items:center;gap:10px">
              ${canEdit ? `<button type="button" class="btn sm ghost" onclick="const f=document.getElementById('ms-custom-yn-form');if(f){f.style.display=f.style.display==='none'?'grid':'none';}">+ Custom Date</button>` : ''}
              <strong class="pos" style="font-size:15px">+${money(L.totalYN)}</strong>
            </div>
          </div>
          <div class="ms-rows">
            ${fridayRowsHtml}
            ${extraYnHtml}
          </div>
          ${canEdit ? `
            <form id="ms-custom-yn-form" class="ms-add-exp" style="display:none;grid-template-columns:140px 1fr 130px auto;background:rgba(34,211,238,.06);border-color:rgba(34,211,238,.32)" onsubmit="msAddCustomYn(event)">
              <input type="date" name="date" value="${defaultExpDate}" required title="Offering date">
              <input type="text" name="notes" placeholder="Notes (e.g. Thursday Youth Night)" value="Youth Night Offering">
              <input type="text" inputmode="decimal" name="amount" placeholder="${esc(S.currency)} Amount" required autocomplete="off">
              <button class="btn sm" style="padding:8px 14px">+ Save</button>
            </form>
          ` : ''}
        </div>

        <!-- Joint Fellowship & Other General Offerings -->
        <div class="ms-section">
          <div class="ms-sec-head">
            <span class="ms-sec-title">3. Joint Fellowship &amp; Other Offerings</span>
            <strong class="pos" style="font-size:15px">+${money(L.totalJF + L.totalOtherInc)}</strong>
          </div>
          <div class="ms-rows">
            ${slotRow({
              id: `ms-jf-${ym}`,
              title: `Joint Fellowship Offering`,
              sub: `${L.lastSun.display}${L.lastSun.primary ? ' · Saved on ' + L.lastSun.primary.date : ''}`,
              status: L.lastSun.status,
              amount: L.lastSun.primary ? L.lastSun.primary.amount : '',
              txId: L.lastSun.primary ? L.lastSun.primary.id : '',
              kind: 'jf',
              date: L.lastSun.primary ? L.lastSun.primary.date : L.lastSun.date,
              skipKey: L.lastSun.skipKey
            })}
          </div>
          ${otherIncHtml}
          <div class="ms-subtotal">
            <span>Total Youth Fund Cash on Hand (Beginning + Offerings)</span>
            <strong>${money(L.totalCashOnHand)}</strong>
          </div>
        </div>

        <!-- Less: General Fund Expenses -->
        <div class="ms-section">
          <div class="ms-sec-head">
            <span class="ms-sec-title exp">4. Less: General Fund Expenses</span>
            <strong class="neg" style="font-size:15px">-${money(L.totalGenExp)}</strong>
          </div>
          <div class="ms-rows">
            ${genExpRowsHtml}
          </div>
          ${canEdit ? `
            <form class="ms-add-exp ms-add-exp-gen" style="grid-template-columns:130px 1fr 120px 115px auto auto" onsubmit="msAddExpense(event)">
              <input type="hidden" name="fund" value="general">
              <input type="date" name="date" value="${defaultExpDate}" required title="Expense date">
              <input type="text" name="notes" placeholder="General expense (e.g. Pastor Appreciation, Snacks)">
              <select name="category" title="Category">${expCatOpts}</select>
              <input type="text" inputmode="decimal" name="amount" placeholder="${esc(S.currency)} Amount" required autocomplete="off">
              <label class="ms-rcpt-pick" title="Attach receipt photo"><input type="file" name="receipt" accept="image/*" onchange="msReceiptPicked(this)"><span>📷 Receipt</span></label>
              <button class="btn sm alt" style="padding:8px 14px">+ Add</button>
            </form>
          ` : ''}
        </div>

        <!-- YOUTH FUND NET CASH ON HAND -->
        <div class="ms-grand-total">
          <div>
            <div class="ms-gt-label">Youth Fund Net Cash on Hand — ${L.monthTitle}</div>
            <div class="mute" style="font-size:12px">Total Cash on Hand (${money(L.totalCashOnHand)}) − General Expenses (${money(L.totalGenExp)})</div>
          </div>
          <div class="ms-gt-val ${L.netCashOnHand < 0 ? 'neg' : ''}">${money(L.netCashOnHand)}</div>
        </div>
      </div>
      ` : ''}

      ${(msFundTab === 'all' || msFundTab === 'allowance') ? `
      <!-- 4B. CARD 2: SEPARATED ALLOCATION FROM CHURCH FUNDS (MONTHLY ALLOWANCE) -->
      <div class="ms-sheet allowance-sheet" id="ms-card-allowance">
        <div class="ms-card-head">
          <div>
            <div style="font-size:16px;font-weight:700;color:var(--b)">💳 Allocation from Church Funds — Monthly Allowance (${L.monthTitle})</div>
            <div class="mute" style="font-size:12px">Tracked completely separately from Youth Offerings so you always see your exact remaining allowance</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="tag ${allowIsOk ? 'ok' : 'pending'}">${allowIsOk ? 'In Budget ✔' : 'Overspent ⚠️'}</span>
            <button type="button" class="btn sm ghost" onclick="allowanceTrackerModal('${ym}')">Details</button>
          </div>
        </div>

        <!-- Monthly Allocation Received -->
        <div class="ms-section">
          <div class="ms-sec-head">
            <span class="ms-sec-title">1. Monthly Allocation Received</span>
            <strong class="pos" style="font-size:15px">+${money(L.allow.allocated)}</strong>
          </div>
          <div class="ms-rows">
            ${slotRow({
              id: `ms-alloc-${ym}`,
              title: 'Allocation from Church Funds',
              sub: L.allocPrimary ? `Saved on ${L.allocPrimary.date}` : 'Enter monthly allowance received from church funds',
              status: L.allocStatus,
              amount: L.allocPrimary ? L.allocPrimary.amount : '',
              txId: L.allocPrimary ? L.allocPrimary.id : '',
              kind: 'alloc',
              date: L.allocPrimary ? L.allocPrimary.date : `${ym}-01`,
              skipKey: L.allocSkipKey
            })}
          </div>
        </div>

        <!-- Less: Allowance Expenses -->
        <div class="ms-section">
          <div class="ms-sec-head">
            <span class="ms-sec-title exp">2. Less: Allowance Expenses</span>
            <strong class="neg" style="font-size:15px">-${money(L.allow.spent)}</strong>
          </div>
          <div class="ms-rows">
            ${allowExpRowsHtml}
          </div>
          ${canEdit ? `
            <form class="ms-add-exp ms-add-exp-allow" style="grid-template-columns:130px 1fr 120px auto auto;background:rgba(34,211,238,.06);border-color:rgba(34,211,238,.35)" onsubmit="msAddExpense(event)">
              <input type="hidden" name="fund" value="allowance">
              <input type="hidden" name="category" value="Monthly Allowance">
              <input type="date" name="date" value="${defaultExpDate}" required title="Allowance expense date">
              <input type="text" name="notes" placeholder="Allowance expense (e.g. Pansit, Rice, Joint Lunch)">
              <input type="text" inputmode="decimal" name="amount" placeholder="${esc(S.currency)} Amount" required autocomplete="off">
              <label class="ms-rcpt-pick" title="Attach receipt photo"><input type="file" name="receipt" accept="image/*" onchange="msReceiptPicked(this)"><span>📷 Receipt</span></label>
              <button class="btn sm" style="background:linear-gradient(135deg,#06b6d4,#3b82f6);padding:8px 14px">+ Spend</button>
            </form>
          ` : ''}
        </div>

        <!-- REMAINING ALLOWANCE BALANCE -->
        <div class="ms-grand-total allowance-total ${allowIsOk ? '' : 'is-over'}">
          <div>
            <div class="ms-gt-label">Remaining Allowance Balance — ${L.monthTitle}</div>
            <div class="mute" style="font-size:12px">Allocated (${money(L.allow.allocated)}) − Allowance Expenses (${money(L.allow.spent)}) &nbsp;·&nbsp; <b>${L.year} Cumulative Remaining: ${money(L.yearAllow.remaining)}</b></div>
          </div>
          <div class="ms-gt-val ${allowIsOk ? '' : 'neg'}" style="${allowIsOk ? 'color:var(--b)' : ''}">${money(L.allow.remaining)}</div>
        </div>
      </div>
      ` : ''}
    </div>`;
  },
  dashboard() {
    const activeM = getActiveMonth();
    const curL = getMonthLedger(today().slice(0, 7));
    const allow = getMonthlyAllowance(activeM);
    const [aY, aMo] = activeM.split('-').map(Number);
    const yrAllow = getYearlyAllowance(aY);
    const mLabel = new Date(aY, aMo - 1, 1).toLocaleDateString('en-US', { month: 'short' });
    const m = today().slice(0, 7), mi = sum(generalInc().filter(t => t.date.startsWith(m) && !isBeginningTx(t))), me = sum(generalExp().filter(t => t.date.startsWith(m)));
    const over = S.events.filter(e => eventStats(e).pct > 100), owing = owingThisMonth();

    return `${curL.missingItems.length ? `<div class="alert warn"><div class="row"><span>⚠️ <b>${curL.missingItems.length} missing ${curL.missingItems.length === 1 ? 'entry' : 'entries'}</b> in <b>${curL.monthTitle}</b> (${curL.missingItems.map(x => esc(x.label)).join(', ')})</span><button class="btn sm" onclick="view='monthly';setActiveMonth('${curL.ym}')">Open Monthly Sheet</button></div></div>` : ''}
    ${over.map(e => `<div class="alert">⚠️ <b>${esc(e.name)}</b> is over budget!</div>`).join('')}
    ${owing.length ? `<div class="alert warn"><div class="row"><span>🔔 <b>${owing.length}</b> member${owing.length > 1 ? 's' : ''} still owe${owing.length > 1 ? '' : 's'} this month's dues: ${owing.map(m => esc(m.name)).join(', ')}</span><button class="btn sm" onclick="copyReminder()">Copy reminder</button></div></div>` : ''}
    <div class="grid g4">
      <div class="card stat">
        <span>🏢 Youth General Fund Balance</span>
        <strong class="${generalBalance() < 0 ? 'neg' : ''}">${money(generalBalance())}</strong>
        <div class="mute" style="font-size:11px;margin-top:4px">Offerings &amp; general funds only</div>
      </div>

      <!-- Dedicated Monthly Allowance Stat Card (Separated) -->
      <div class="card stat" style="border-color:rgba(34,211,238,.35);background:linear-gradient(135deg,rgba(34,211,238,.09),rgba(124,92,255,.05))">
        <div class="row">
          <span style="cursor:pointer" onclick="allowanceTrackerModal('${activeM}')">💳 Remaining Allowance (${mLabel})</span>
          <span class="tag ${allow.remaining >= 0 ? 'ok' : 'pending'}" style="font-size:10px">${allow.remaining >= 0 ? 'In Budget' : 'Overspent'}</span>
        </div>
        <strong class="${allow.remaining < 0 ? 'neg' : 'pos'}" style="font-size:26px;cursor:pointer" onclick="allowanceTrackerModal('${activeM}')">${money(allow.remaining)} <span style="font-size:12px;font-weight:400;color:var(--mute)">left</span></strong>
        <div class="row" style="font-size:11px;color:var(--mute);margin-top:4px">
          <span>In: <b>${money(allow.allocated)}</b> · Out: <b>${money(allow.spent)}</b></span>
          <span>${aY}: <b>${money(yrAllow.remaining)}</b></span>
        </div>
        <div style="margin-top:10px;display:flex;gap:6px">
          <button type="button" class="btn sm ghost" style="padding:2px 8px;font-size:11px;color:var(--b);border-color:rgba(34,211,238,.4)" onclick="churchAllocationForm('${activeM}')">🏛️ Allocation</button>
          <button type="button" class="btn sm ghost" style="padding:2px 8px;font-size:11px" onclick="allowanceTrackerModal('${activeM}')">Tracker 💳</button>
        </div>
      </div>

      <div class="card stat"><span>${period === 'all' ? 'Youth Offerings (this month)' : 'Youth Offerings (' + period + ')'}</span><strong class="pos">${money(period === 'all' ? mi : sum(generalInc().filter(t => inPeriod(t) && !isBeginningTx(t))))}</strong></div>
      <div class="card stat"><span>${period === 'all' ? 'General Expenses (this month)' : 'General Expenses (' + period + ')'}</span><strong class="neg">${money(period === 'all' ? me : sum(generalExp().filter(inPeriod)))}</strong></div>
    </div><br>
    <div class="grid g2"><div class="card"><h2>Income vs expenses</h2>${chart()}</div>
    <div class="card"><h2>Event budgets</h2>${S.events.length ? S.events.map(e => { const s = eventStats(e); return `<div><div class="row"><b>${esc(e.name)}</b><span class="mute">${money(s.spent)} / ${money(e.budget)}</span></div><div class="bar"><i class="${s.pct > 100 ? 'over' : ''}" style="width:${Math.min(s.pct, 100)}%"></i></div></div>`; }).join('') : '<div class="empty">No events yet.</div>'}</div></div><br>
    <div class="card"><h2>Recent transactions</h2>${txRows([...S.transactions].filter(inPeriod).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6), false)}</div>`;
  },
  transactions() {
    const recentIds = getRecentUploadIds();
    const recentSet = new Set(recentIds);
    let l = [...S.transactions].filter(inPeriod);
    if (filter.recentOnly && recentSet.size) l = l.filter(t => recentSet.has(t.id));
    if (filter.type) l = l.filter(t => t.type === filter.type);
    if (filter.event) l = l.filter(t => t.eventId === filter.event);
    if (filter.fund) {
      l = l.filter(t => filter.fund === 'allowance' ? (isAllowanceInc(t) || isAllowanceExp(t)) : (!isAllowanceInc(t) && !isAllowanceExp(t)));
    }
    if (filter.allowanceOnly) l = l.filter(t => isAllowanceInc(t) || isAllowanceExp(t));
    if (filter.q) l = l.filter(t => (t.category + t.notes + memName(t.memberId)).toLowerCase().includes(filter.q.toLowerCase()));
    if (filter.sort === 'recent') {
      l.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.date.localeCompare(a.date));
    } else {
      l.sort((a, b) => b.date.localeCompare(a.date));
    }

    // Keep selectedTxIds clean against existing transactions
    const validIds = new Set(S.transactions.map(t => t.id));
    [...selectedTxIds].forEach(id => { if (!validIds.has(id)) selectedTxIds.delete(id); });
    const selCount = selectedTxIds.size;

    const selBar = selCount ? `
      <div class="ms-save-all-bar" style="margin:0 0 12px;border-color:rgba(251,113,133,.5);background:rgba(251,113,133,.12)">
        <span>☑ <b>${selCount}</b> ${selCount === 1 ? 'transaction' : 'transactions'} selected${filter.recentOnly ? ' (recent upload)' : ''}</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn sm ghost" onclick="clearTxSelection()">Clear selection</button>
          <button type="button" class="btn sm alt" onclick="deleteSelectedTxs()">🗑️ Delete Selected (${selCount})</button>
        </div>
      </div>` : '';

    return `<div class="toolbar"><input id="f-q" placeholder="Search…" value="${esc(filter.q)}" style="max-width:190px">
      <select id="f-type" style="max-width:125px"><option value="">All types</option><option ${filter.type === 'income' ? 'selected' : ''}>income</option><option ${filter.type === 'expense' ? 'selected' : ''}>expense</option></select>
      <select id="f-fund" style="max-width:160px"><option value="">All funds</option><option value="general" ${filter.fund === 'general' ? 'selected' : ''}>🏢 General Fund</option><option value="allowance" ${filter.fund === 'allowance' ? 'selected' : ''}>💳 Church Allowance</option></select>
      <select id="f-sort" style="max-width:170px"><option value="date" ${filter.sort !== 'recent' ? 'selected' : ''}>Sort: Date (newest)</option><option value="recent" ${filter.sort === 'recent' ? 'selected' : ''}>Sort: Recently uploaded</option></select>
      <select id="f-event" style="max-width:155px"><option value="">All events</option>${S.events.map(e => `<option value="${e.id}" ${filter.event === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      ${recentIds.length ? `<button type="button" class="btn sm ${filter.recentOnly ? '' : 'ghost'}" style="${filter.recentOnly ? 'background:linear-gradient(135deg,#06b6d4,#3b82f6)' : 'border-color:rgba(34,211,238,.45);color:var(--b)'};padding:6px 12px" onclick="${filter.recentOnly ? 'clearTxSelection()' : 'selectRecentUpload()'}">⚡ ${filter.recentOnly ? 'Show all' : `Select Recent Upload (${recentIds.length})`}</button>` : ''}
      <button class="btn sm ${filter.allowanceOnly ? 'alt' : 'ghost'}" id="f-allowance-toggle" style="padding:6px 12px">💳 ${filter.allowanceOnly ? 'Show all' : 'Allowance only'}</button>
      </div>
      ${selBar}
      <div class="card">${txRows(l, true, true)}</div>`;
  },
  events() {
    return `<div class="toolbar"><button class="btn" id="new-event">+ New event</button></div><div class="grid g2">${S.events.map(e => { const s = eventStats(e);
      return `<div class="card"><div class="row"><h2>${esc(e.name)}</h2><span class="tag ${s.pct > 100 ? 'pending' : 'ok'}">${s.pct.toFixed(0)}% used</span></div>
      <div class="row" style="justify-content:flex-end;margin-bottom:6px"><button class="btn sm ghost" onclick="eventForm('${e.id}')">Edit</button><button class="btn sm ghost danger" onclick="delEvent('${e.id}')">Delete</button></div>
      <div class="bar"><i class="${s.pct > 100 ? 'over' : ''}" style="width:${Math.min(s.pct, 100)}%"></i></div>
      <p class="mute">Budget ${money(e.budget)} · Spent ${money(s.spent)} · Raised ${money(s.raised)}</p>
      <p>Remaining: <b class="${e.budget - s.spent < 0 ? 'neg' : 'pos'}">${money(e.budget - s.spent)}</b></p>
      <p class="mute">Event net: ${money(s.raised - s.spent)}</p></div>`; }).join('') || '<div class="empty card">No events yet. Create one to set a budget.</div>'}</div>`;
  },
  members() {
    return `<div class="toolbar"><button class="btn" id="new-member">+ New member</button>${owingThisMonth().length ? '<button class="btn ghost" onclick="copyReminder()">🔔 Copy dues reminder</button>' : ''}</div><div class="card">${S.members.length ? `<div class="annual-scroll"><table><tr><th>Member</th><th>Monthly dues</th><th>This month</th><th>Total paid</th><th>Target owed</th><th></th></tr>` +
      S.members.map(m => { const paid = sum(inc().filter(t => t.memberId === m.id)), owed = Math.max(m.due - paid, 0), pm = paidThisMonth(m);
        const status = !m.monthly ? '<span class="mute">—</span>' : pm >= m.monthly ? '<span class="tag ok">Paid ✔</span>' : `<span class="tag pending">Owes ${money(m.monthly - pm)}</span>`;
        return `<tr><td>${esc(m.name)}<div class="mute">${esc(m.contact)}</div></td><td>${money(m.monthly || 0)}</td><td>${status}</td><td class="pos">${money(paid)}</td><td class="${owed ? 'neg' : 'pos'}">${m.due ? (owed ? money(owed) : 'Paid ✔') : '—'}</td><td><button class="btn sm ghost" onclick="memberForm('${m.id}')">Edit</button> <button class="btn sm ghost danger" onclick="delMember('${m.id}')">Delete</button></td></tr>`; }).join('') + '</table></div>' : '<div class="empty">No members yet.</div>'}</div>`;
  },
  reports() {
    const sig = getSignatories();
    const curYear = new Date().getFullYear();

    // Available years
    const years = [...new Set([...S.transactions.map(t => t.date.slice(0, 4)), String(curYear)])].sort().reverse();
    const selYear = reportYear || (years[0] || String(curYear));

    // Available months
    const allMonths = [...new Set([
      ...S.transactions.map(t => t.date.slice(0, 7)).filter(Boolean),
      `${selYear}-01`, `${selYear}-02`, `${selYear}-03`, `${selYear}-04`,
      `${selYear}-05`, `${selYear}-06`, `${selYear}-07`, `${selYear}-08`,
      `${selYear}-09`, `${selYear}-10`, `${selYear}-11`, `${selYear}-12`
    ])].sort().reverse();
    const selMonth = reportMonth || getActiveMonth();

    // Report Mode Switcher and Customization Toolbar
    const toolbarHtml = `
      <div class="toolbar" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div class="report-toggle-group">
          <button type="button" class="report-toggle-btn ${reportMode === 'monthly' ? 'active' : ''}" id="rep-mode-monthly">📄 Monthly Report</button>
          <button type="button" class="report-toggle-btn ${reportMode === 'annual' ? 'active' : ''}" id="rep-mode-annual">📊 Annual Summary (Total Net)</button>
        </div>

        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap" class="report-ctrls">
          ${reportMode === 'monthly' ? `
            <label style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px">
              Month:
              <select id="rep-month-sel" style="width:auto;padding:6px 12px;font-size:13px">
                ${allMonths.map(mStr => {
                  const [y, mo] = mStr.split('-');
                  const label = new Date(+y, +mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                  const count = S.transactions.filter(t => t.status === 'approved' && t.date.startsWith(mStr)).length;
                  return `<option value="${mStr}" ${mStr === selMonth ? 'selected' : ''}>${label}${count ? ` (${count} txs)` : ''}</option>`;
                }).join('')}
              </select>
            </label>
            <button class="btn sm" id="batch-offerings-btn-rep" style="background:linear-gradient(135deg,#06b6d4,#3b82f6)">📅 Monthly Offerings</button>
            <button class="btn sm ghost" id="church-alloc-btn-rep" style="border-color:rgba(34,211,238,.4);color:var(--b)">🏛️ Church Allocation</button>
            <button class="btn sm ghost" id="rep-allowance-btn">💳 Allowance Tracker</button>
          ` : `
            <label style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px">
              Year:
              <select id="rep-year-sel" style="width:auto;padding:6px 12px;font-size:13px">
                ${years.map(y => `<option value="${y}" ${y === selYear ? 'selected' : ''}>${y}</option>`).join('')}
              </select>
            </label>
          `}
          ${typeof window.exportExcel === 'function' ? `<button class="btn sm" id="excel-btn" style="background:linear-gradient(135deg,#10b981,#06b6d4)">📊 Export Excel</button>` : ''}
          <button class="btn sm ghost" id="csv-btn">⬇ Export CSV</button>
          <button class="btn sm ghost" id="print-btn">🖨 Print / Save PDF</button>
          <button class="btn sm ghost" id="edit-sig-btn">⚙️ Signatures</button>
        </div>
      </div>
    `;

    // 1. MONTHLY ACCOUNTABILITY REPORT VIEW
    if (reportMode === 'monthly') {
      const targetMonth = selMonth;
      const [yStr, moStr] = targetMonth.split('-');
      const y = parseInt(yStr, 10), mo = parseInt(moStr, 10);
      const fridays = getFridaysForMonth(y, mo);
      const monthTitle = new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const allow = getMonthlyAllowance(targetMonth);

      const mApproved = S.transactions.filter(t => t.status !== 'void' && t.date.startsWith(targetMonth)).sort((a, b) => a.date.localeCompare(b.date));
      const incList = mApproved.filter(t => t.type === 'income');
      const expList = mApproved.filter(t => t.type === 'expense');

      // Beginning balance
      const begEntries = incList.filter(isBeginningTx);
      let begBal = sum(begEntries);
      if (!begEntries.length) {
        begBal = Math.max(0, getCarriedBeginningBalance(targetMonth));
      }

      // Inflows (Youth General Fund strictly separated from Church Allowance)
      const regularInc = incList.filter(t => !begEntries.includes(t));
      const ynEntries = regularInc.filter(t => t.category === 'Youth Night Offering');
      const totalYN = sum(ynEntries);
      const jfEntries = regularInc.filter(t => t.category === 'Joint Fellowship Offering');
      const totalJF = sum(jfEntries);
      const allocEntries = regularInc.filter(t => isAllowanceInc(t) && t.category !== 'Youth Night Offering' && t.category !== 'Joint Fellowship Offering');
      const totalAlloc = sum(allocEntries);
      const otherInc = regularInc.filter(t => t.category !== 'Youth Night Offering' && t.category !== 'Joint Fellowship Offering' && !allocEntries.includes(t));
      const totalOtherInc = sum(otherInc);
      const totalOfferings = totalYN + totalJF + totalOtherInc;
      const totalCashOnHand = begBal + totalOfferings;

      // Expenses: separated into General Fund vs Monthly Allowance
      const allowExpList = expList.filter(t => isAllowanceExp(t));
      const genExpList = expList.filter(t => !isAllowanceExp(t));
      const totalAllowExp = sum(allowExpList);
      const totalGenExp = sum(genExpList);
      const netCashOnHand = totalCashOnHand - totalGenExp;
      const yearAllow = getYearlyAllowance(y);

      // Youth Night itemized rows (show all Fridays of the month + any off-Friday entries, matching Excel sheet)
      const fridayDatesSet = new Set(fridays.map(f => f.date));
      const ynSlotRows = [
        ...fridays.map(f => {
          const matches = ynEntries.filter(t => t.date === f.date);
          return { date: f.date, label: f.formatted, amount: matches.length ? sum(matches) : null };
        }),
        ...ynEntries.filter(t => !fridayDatesSet.has(t.date)).map(t => {
          const dObj = new Date(t.date + 'T00:00:00');
          const dLabel = isNaN(dObj) ? t.date : `${dObj.toLocaleDateString('en-US', { month: 'short' })}. ${dObj.getDate()}`;
          return { date: t.date, label: dLabel, amount: t.amount };
        })
      ].sort((a, b) => a.date.localeCompare(b.date));

      const ynRowsHtml = ynSlotRows.map(r => {
        const reason = r.amount == null ? getSkipReason(`yn:${r.date}`) : '';
        return `<tr>
        <td style="padding-left:48px">${r.label}${reason ? ` <span class="mute">(${esc(reason)})</span>` : ''}</td>
        <td class="col-detail">${r.amount != null ? money(r.amount) : '<span class="mute">—</span>'}</td>
        <td class="col-sub"></td>
        <td class="col-total"></td>
      </tr>`;
      }).join('');

      // General Expenses itemized rows
      let genExpRowsHtml = '';
      if (genExpList.length) {
        genExpRowsHtml = genExpList.map(t => `
          <tr>
            <td style="padding-left:48px">${esc(t.category)} <span class="mute">(${t.date}${cleanNotes(t.notes) ? ' · ' + esc(cleanNotes(t.notes)) : ''})</span></td>
            <td class="col-detail">${money(t.amount)}</td>
            <td class="col-sub"></td>
            <td class="col-total"></td>
          </tr>
        `).join('');
      } else {
        genExpRowsHtml = `
          <tr>
            <td style="padding-left:48px" class="mute">None recorded</td>
            <td class="col-detail mute">0.00</td>
            <td class="col-sub"></td>
            <td class="col-total"></td>
          </tr>
        `;
      }

      // Allowance Expenses itemized rows
      let allowExpRowsHtml = '';
      if (allowExpList.length) {
        allowExpRowsHtml = allowExpList.map(t => `
          <tr>
            <td style="padding-left:48px">${esc(t.category)} <span class="mute">(Allowance · ${t.date}${cleanNotes(t.notes) ? ' · ' + esc(cleanNotes(t.notes)) : ''})</span></td>
            <td class="col-detail">${money(t.amount)}</td>
            <td class="col-sub"></td>
            <td class="col-total"></td>
          </tr>
        `).join('');
      }

      // Other Income rows
      let otherIncHtml = '';
      if (otherInc.length) {
        otherIncHtml = otherInc.map(t => `
          <tr>
            <td colspan="2" style="padding-left:24px">${esc(t.category)} <span class="mute">(${t.date})</span></td>
            <td class="col-sub">${money(t.amount)}</td>
            <td class="col-total"></td>
          </tr>
        `).join('');
      }

      return `
        ${toolbarHtml}

        <!-- Separated Monthly Allowance Status Widget -->
        <div class="allowance-card" style="margin-bottom:22px">
          <div class="row">
            <div>
              <strong style="color:var(--b);font-size:16px">💳 Separated Monthly Allowance (${monthTitle})</strong>
              <div class="mute" style="font-size:12px;margin-top:2px">Tracked independently from general church youth offerings</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="tag ${allow.remaining >= 0 ? 'ok' : 'pending'}">${allow.remaining >= 0 ? 'In Budget ✔' : 'Overspent ⚠️'}</span>
              <button class="btn sm ghost" onclick="churchAllocationForm('${targetMonth}')">🏛️ Church Allocation</button>
              <button class="btn sm ghost" onclick="allowanceTrackerModal('${targetMonth}')">Manage Allowance</button>
            </div>
          </div>
          <div class="allowance-box">
            <div class="allowance-item">
              <small>📥 Allowance Received / Allocated</small>
              <strong class="pos">${money(allow.allocated)}</strong>
            </div>
            <div class="allowance-item">
              <small>📤 Allowance Disbursed / Spent</small>
              <strong class="neg">${money(allow.spent)}</strong>
            </div>
            <div class="allowance-item" style="border-color:${allow.remaining >= 0 ? 'rgba(52,211,153,.5)' : 'rgba(251,113,133,.5)'};background:${allow.remaining >= 0 ? 'rgba(52,211,153,.08)' : 'rgba(251,113,133,.08)'}">
              <small style="color:${allow.remaining >= 0 ? 'var(--ok)' : 'var(--bad)'}">💰 Allowance Remaining Left</small>
              <strong class="${allow.remaining >= 0 ? 'pos' : 'neg'}" style="font-size:18px">${money(allow.remaining)}</strong>
            </div>
          </div>
        </div>

        <!-- Official COYAP Cash Accountability Report Sheet -->
        <div class="card coyap-sheet">
          <div style="text-align:center;line-height:1.4;margin-bottom:26px">
            <div style="font-size:14px;letter-spacing:0.5px">Tagbilaran Bible Training Ministries, Inc.</div>
            <div style="font-size:18px;font-weight:700;letter-spacing:0.5px;margin:3px 0">BIBLE TRAINING CENTER - TAGBILARAN CHURCH</div>
            <div style="font-size:15px;font-weight:600">College, Youth and Professionals (COYAP)</div>
            <div style="font-size:17px;font-weight:700;margin-top:10px">Cash Accountability Report</div>
            <div style="font-size:14px;font-weight:600">As of ${monthTitle}</div>
            <div style="font-size:13px;font-style:italic;color:var(--mute);margin-top:2px">In Philippine Peso</div>
          </div>

          <table class="sheet-table">
            <tbody>
              <!-- Cash on Hand - Beginning Balance -->
              <tr style="font-weight:600">
                <td colspan="4" style="padding-top:10px">Cash on Hand - Beginning Balance</td>
              </tr>
              <tr>
                <td style="padding-left:24px">Youth Funds from Church</td>
                <td class="col-detail"></td>
                <td class="col-sub"></td>
                <td class="col-total"></td>
              </tr>
              <tr>
                <td style="padding-left:24px">Youth Night Offerings</td>
                <td class="col-detail"></td>
                <td class="col-sub">0.00</td>
                <td class="col-total"></td>
              </tr>
              <tr>
                <td colspan="2"></td>
                <td class="col-sub"><span class="sub-line"></span></td>
                <td class="col-total" style="font-weight:700">${begBal ? money(begBal) : '0.00'}</td>
              </tr>

              <!-- Add: Offerings -->
              <tr style="font-weight:600">
                <td colspan="4" class="rpt-teal" style="padding-top:16px;color:var(--b)">Add: Offerings</td>
              </tr>
              <tr style="font-weight:600">
                <td colspan="4" style="padding-left:24px">Youth Night Offerings</td>
              </tr>
              ${ynRowsHtml}
              <tr>
                <td colspan="2"></td>
                <td class="col-sub border-top border-bottom" style="font-weight:600">${money(totalYN)}</td>
                <td class="col-total"></td>
              </tr>

              <tr>
                <td colspan="2" style="padding-left:24px">Joint Fellowship Offerings${!totalJF && getSkipReason('jf:' + targetMonth) ? ` <span class="mute">(${esc(getSkipReason('jf:' + targetMonth))})</span>` : ''}</td>
                <td class="col-sub">${totalJF ? money(totalJF) : '—'}</td>
                <td class="col-total" style="font-weight:700">${money(totalOfferings)}</td>
              </tr>
              ${otherIncHtml}

              <!-- Total Cash on Hand (Youth General Fund) -->
              <tr style="font-weight:700">
                <td colspan="3" style="padding-top:14px">Total Cash on Hand (Youth General Fund)</td>
                <td class="col-total border-top" style="padding-top:14px;font-size:15px">${money(totalCashOnHand)}</td>
              </tr>

              <!-- Less: General Youth Fund Expenses -->
              <tr style="font-weight:600">
                <td colspan="4" class="rpt-red" style="padding-top:14px;color:var(--bad)">Less: Expenses (Youth General Fund)</td>
              </tr>
              ${genExpRowsHtml}
              <tr>
                <td colspan="3" style="padding-left:24px;font-weight:600">Total General Fund Expenses</td>
                <td class="col-total border-bottom rpt-red" style="color:var(--bad);font-weight:700">-${money(totalGenExp)}</td>
              </tr>

              <!-- NET CASH ON HAND (Youth General Fund) -->
              <tr class="net-row">
                <td colspan="3" style="padding-top:16px;font-weight:800;font-size:15px;letter-spacing:0.5px">NET CASH ON HAND (YOUTH GENERAL FUND)</td>
                <td class="col-total border-double ${netCashOnHand < 0 ? 'rpt-red' : 'rpt-green'}" style="padding-top:16px;font-size:16px;font-weight:800;color:${netCashOnHand < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(netCashOnHand)}</td>
              </tr>
            </tbody>
          </table>

          <!-- SEPARATED STATEMENT: Allocation from Church Funds (Monthly Allowance) -->
          <div class="separated-allowance-box" style="margin-top:28px;padding:18px 20px;border:1px solid rgba(34,211,238,.35);border-radius:12px;background:rgba(34,211,238,.05)">
            <div class="sep-title" style="font-weight:700;font-size:14px;color:var(--b);letter-spacing:0.4px;margin-bottom:10px">SEPARATED STATEMENT: ALLOCATION FROM CHURCH FUNDS (MONTHLY ALLOWANCE)</div>
            <table class="sheet-table">
              <tbody>
                <tr style="font-weight:600">
                  <td colspan="3">Allocation from Church Funds (${monthTitle})</td>
                  <td class="col-total rpt-green" style="color:var(--ok)">${money(allow.allocated)}</td>
                </tr>
                <tr style="font-weight:600">
                  <td colspan="4" class="rpt-red" style="padding-top:8px;color:var(--bad)">Less: Allowance Expenses</td>
                </tr>
                ${allowExpList.length ? allowExpRowsHtml : `<tr><td style="padding-left:48px" class="mute">None recorded</td><td class="col-detail mute">0.00</td><td class="col-sub"></td><td class="col-total"></td></tr>`}
                <tr>
                  <td colspan="3" style="padding-left:24px;font-weight:600">Total Allowance Expenses</td>
                  <td class="col-total border-bottom rpt-red" style="color:var(--bad);font-weight:700">-${money(allow.spent)}</td>
                </tr>
                <tr>
                  <td colspan="3" style="padding-top:12px;font-weight:800;font-size:14px;letter-spacing:0.4px">REMAINING ALLOWANCE BALANCE (${monthTitle.toUpperCase()})</td>
                  <td class="col-total border-double ${allow.remaining >= 0 ? 'rpt-teal' : 'rpt-red'}" style="padding-top:12px;font-size:15px;font-weight:800;color:${allow.remaining >= 0 ? 'var(--b)' : 'var(--bad)'}">${money(allow.remaining)}</td>
                </tr>
                <tr>
                  <td colspan="4" style="padding-top:10px;font-size:12px;color:var(--mute)">
                    ${y} Cumulative Remaining Allowance: <b>${money(yearAllow.remaining)}</b> &nbsp;|&nbsp; Reference Combined Cash (Youth Fund + Monthly Allowance Left): <b>${money(netCashOnHand + allow.remaining)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Official 4-Leader Signatory Block -->
          <div class="sig-block" style="margin-top:48px;display:grid;gap:36px">
            <div style="display:flex;justify-content:space-between;gap:40px">
              <div style="flex:1;text-align:center">
                <div style="margin-bottom:45px">Prepared by:</div>
                <div class="sig-line" style="font-weight:700">${esc(sig.preparedName)}</div>
                <div class="mute" style="font-size:12px;margin-top:3px">${esc(sig.preparedTitle)}</div>
              </div>
              <div style="flex:1;text-align:center">
                <div style="margin-bottom:45px">Noted:</div>
                <div class="sig-line" style="font-weight:700">${esc(sig.notedName)}</div>
                <div class="mute" style="font-size:12px;margin-top:3px">${esc(sig.notedTitle)}</div>
              </div>
            </div>

            <div style="max-width:320px;margin:0 auto;text-align:center">
              <div style="margin-bottom:45px">Recommending Approval</div>
              <div class="sig-line" style="font-weight:700">${esc(sig.recommendingName)}</div>
              <div class="mute" style="font-size:12px;margin-top:3px">${esc(sig.recommendingTitle)}</div>
            </div>

            <div style="max-width:320px;margin:0 auto;text-align:center">
              <div style="margin-bottom:45px">Approved by:</div>
              <div class="sig-line" style="font-weight:700">${esc(sig.approvedName)}</div>
              <div class="mute" style="font-size:12px;margin-top:3px">${esc(sig.approvedTitle)}</div>
            </div>
          </div>
        </div>
      `;
    }

    // 2. ANNUAL SUMMARY VIEW (TOTAL NET OF THE YEAR)
    const annual = getAnnualBreakdown(selYear);
    const isNetOk = annual.totalNetOfYear >= 0;
    const showAdj = annual.showAdj;
    const sgn = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    const inp = (val, handler, w, printText) => `<input type="text" inputmode="decimal" class="annual-inp" style="width:${w || 88}px" value="${val == null ? '' : val}" placeholder="0.00" onchange="${handler}(this.value)"><span class="print-only-val">${esc(printText != null ? printText : (val == null || val === '' ? '—' : money(val)))}</span>`;

    const checkHtml = annual.check.ok ? '' : `<div class="alert" style="margin-bottom:16px">🔴 <b>Check failed:</b> closing balance ${money(annual.check.closing)} does not equal opening ${money(annual.openingBalance)} + total net ${signedMoney(annual.totalNetOfYear)} + adjustments ${signedMoney(annual.totalAdjustments)} = ${money(annual.check.expectedClosing)}.</div>`;

    const spentWarnHtml = annual.spentUnsupported ? `<div class="alert warn" style="margin:14px 0 0">⚠️ Monthly breakdown missing – total spent ${money(annual.allowanceTotals.totalSpent)} is unsupported by monthly data.</div>` : '';

    const flagsHtml = annual.flags.length ? `<div class="alert warn recon-box" style="margin:14px 0 0">
        <div style="font-weight:700;margin-bottom:6px">⚠️ Flagged months — expenses above 2× the average monthly expense (average ${money(annual.avgExpense)}, threshold ${money(annual.flagThreshold)})</div>
        ${annual.flags.map(f => {
          const fNote = (annual.months.find(m => m.ym === f.ym) || {}).note || '';
          return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px">
          <span><b>${f.month}</b>: <span class="neg">${money(f.expenses)}</span></span>
          <input type="text" class="annual-inp" style="flex:1;min-width:200px;text-align:left" placeholder="Note / category (e.g. Church project, Baptism)" value="${esc(fNote)}" onchange="annualSetNote('${f.ym}',this.value)">
          ${fNote ? `<span class="print-only-val">— ${esc(fNote)}</span>` : ''}
        </div>`;
        }).join('')}
      </div>` : '';

    const reconHtml = annual.reportedAny ? `<div class="recon-box" style="margin-top:22px;padding:14px 18px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.03)">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">🧾 Reconciliation — reported vs computed beginning balances</div>
        <div class="mute" style="font-size:12px;margin-bottom:8px">Typed beginning balances are kept as “reported”. Computed beginning always equals the previous month's ending. Expected = prior reported beginning + that month's net.</div>
        ${annual.recon.length ? `<div class="annual-scroll"><table class="annual-table" style="min-width:0"><thead><tr><th>Month</th><th>Reported beginning</th><th>Expected</th><th>Difference</th></tr></thead><tbody>
          ${annual.recon.map(r => `<tr><td><b>${r.month}</b></td><td>${money(r.reported)}</td><td>${money(r.expected)}</td><td class="${sgn(r.diff)}" style="font-weight:700">${signedMoney(r.diff)}</td></tr>`).join('')}
          <tr class="tot-row"><td colspan="3">Total difference</td><td class="${sgn(annual.reconSummary.total)}">${signedMoney(annual.reconSummary.total)}</td></tr>
        </tbody></table></div>` : '<div class="pos" style="font-size:13px">✔ Reported beginning balances agree with the computed chain.</div>'}
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:8px;font-size:13px">
          <span>Documented adjustments: <b>${signedMoney(annual.reconSummary.adjustments)}</b></span>
          <span>Total unexplained difference: <b class="${sgn(annual.reconSummary.unexplained)}">${signedMoney(annual.reconSummary.unexplained)}</b></span>
        </div>
      </div>` : '';

    return `
      ${toolbarHtml}
      ${checkHtml}

      <!-- Executive KPI Cards -->
      <div class="grid g4 annual-kpi-grid" style="margin-bottom:20px">
        <div class="card stat" style="border-color:rgba(52,211,153,.35);background:linear-gradient(135deg,rgba(52,211,153,.08),rgba(34,211,238,.04))">
          <span>🏢 Youth Offerings Inflow (${selYear})</span>
          <strong class="pos">${money(annual.totalInflowYear)}</strong>
          <div class="mute" style="font-size:11px;margin-top:4px">Friday + Joint Fellowship (excl. Allowance)</div>
        </div>

        <div class="card stat" style="border-color:rgba(251,113,133,.35);background:linear-gradient(135deg,rgba(251,113,133,.08),rgba(244,63,94,.04))">
          <span>🏢 General Fund Expenses (${selYear})</span>
          <strong class="neg">${money(annual.totalExpensesYear)}</strong>
          <div class="mute" style="font-size:11px;margin-top:4px">General Youth Fund expenses only</div>
        </div>

        <div class="card stat" style="border-color:${isNetOk ? 'rgba(52,211,153,.6)' : 'rgba(251,113,133,.6)'};background:linear-gradient(135deg,${isNetOk ? 'rgba(52,211,153,.15)' : 'rgba(251,113,133,.15)'},rgba(124,92,255,.08))">
          <span style="font-weight:700;color:${isNetOk ? 'var(--ok)' : 'var(--bad)'}">⭐ TOTAL NET OF THE YEAR (${selYear})</span>
          <strong class="${isNetOk ? 'pos' : 'neg'}" style="font-size:28px">${signedMoney(annual.totalNetOfYear)}</strong>
          <div class="mute" style="font-size:11px;margin-top:4px">Opening ${money(annual.openingBalance)} → Closing <b>${money(annual.finalEndingCash)}</b></div>
        </div>

        <div class="card stat" style="border-color:rgba(34,211,238,.45);background:linear-gradient(135deg,rgba(34,211,238,.12),rgba(124,92,255,.05));cursor:pointer" onclick="allowanceTrackerModal('${selYear}-01')">
          <div class="row">
            <span>💳 Remaining Allowance (${selYear})</span>
            <span class="tag ${annual.allowanceLeftYear >= 0 ? 'ok' : 'pending'}" style="font-size:10px">${annual.allowanceLeftYear >= 0 ? 'In Budget' : 'Overspent'}</span>
          </div>
          <strong class="${annual.allowanceLeftYear >= 0 ? 'pos' : 'neg'}" style="color:${annual.allowanceLeftYear >= 0 ? 'var(--b)' : ''}">${money(annual.allowanceLeftYear)}</strong>
          <div class="row" style="font-size:11px;color:var(--mute);margin-top:4px">
            <span>Allocated: <b>${money(annual.totalAllocIn)}</b></span>
            <span>Spent: <b>${money(annual.totalAllowanceSpent)}</b></span>
          </div>
        </div>
      </div>

      <!-- Official Annual Net Summary Sheet (12-Month Table) -->
      <div class="card coyap-sheet annual-sheet">
        <div style="text-align:center;line-height:1.4;margin-bottom:24px">
          <div style="font-size:14px;letter-spacing:0.5px">Tagbilaran Bible Training Ministries, Inc.</div>
          <div style="font-size:18px;font-weight:700;letter-spacing:0.5px;margin:3px 0">BIBLE TRAINING CENTER - TAGBILARAN CHURCH</div>
          <div style="font-size:15px;font-weight:600">College, Youth and Professionals (COYAP)</div>
          <div style="font-size:18px;font-weight:800;margin-top:10px;color:var(--b)">ANNUAL FINANCIAL ACCOUNTABILITY &amp; NET SUMMARY</div>
          <div style="font-size:14px;font-weight:600">For the Calendar Year ${selYear}</div>
          <div style="font-size:13px;font-style:italic;color:var(--mute);margin-top:2px">In Philippine Peso (PHP) · Youth General Fund &amp; Church Allowance Separated</div>
        </div>

        <div class="row annual-toolbar" style="margin-bottom:8px">
          <span class="mute" style="font-size:12px">Beginning = previous month's ending · Ending = Beginning + Net + Adjustment · swipe sideways to see all columns →</span>
          <button type="button" class="btn sm ghost" onclick="annualToggleAdj('${selYear}')">${showAdj ? 'Hide' : 'Show'} adjustments</button>
        </div>

        <div class="annual-scroll">
          <table class="annual-table">
            <thead>
              <tr>
                <th style="min-width:110px">Month</th>
                <th style="min-width:95px">Beg. Youth Fund</th>
                <th style="min-width:90px">Friday Offerings</th>
                <th style="min-width:90px">Joint Fellowship</th>
                <th style="min-width:90px;color:var(--ok)">Youth Inflow</th>
                <th style="min-width:90px;color:var(--bad)">General Exp.</th>
                <th style="min-width:100px;font-weight:700">Youth Fund Net</th>
                ${showAdj ? '<th style="min-width:100px">Adjustment</th>' : ''}
                <th style="min-width:100px">Ending Youth Fund</th>
                <th style="min-width:90px;border-left:2px solid rgba(34,211,238,.35);color:var(--b)">Allowance In</th>
                <th style="min-width:100px;color:var(--b)">Allowance Out</th>
                <th style="min-width:95px;color:var(--b)">Balance</th>
                <th style="min-width:100px;color:var(--b);font-weight:700">Remaining</th>
              </tr>
            </thead>
            <tbody>
              ${annual.months.map(m => `
                  <tr style="${m.hasData ? 'background:rgba(255,255,255,.02);font-weight:500' : 'opacity:0.75'}">
                    <td><b>${m.fullName}</b>${m.flagged ? ' <span class="annual-flag" title="Expenses exceed 2× the average monthly expense">⚠️</span>' : ''}</td>
                    <td>${money(m.begCash)}</td>
                    <td>${money(m.fridayOfferings)}</td>
                    <td>${money(m.jointFellowship)}</td>
                    <td class="pos" style="font-weight:600">${money(m.totalInflow)}</td>
                    <td class="${m.generalExpenses ? 'neg' : ''}" style="font-weight:600">${m.generalExpenses ? '-' + money(m.generalExpenses) : money(0)}</td>
                    <td class="${sgn(m.monthlyNet)}" style="font-weight:700">${signedMoney(m.monthlyNet)}</td>
                    ${showAdj ? `<td>${inp(m.adjustment || '', `annualSetAdj.bind(null,'${m.ym}')`, 84, m.adjustment ? signedMoney(m.adjustment) : money(0))}</td>` : ''}
                    <td style="font-weight:600">${money(m.endingCash)}</td>
                    <td style="border-left:2px solid rgba(34,211,238,.25)">${money(m.allowanceIn)}</td>
                    <td>${inp(m.allowanceSpentRaw, `annualSetSpent.bind(null,'${m.ym}')`, 84)}</td>
                    <td class="${m.allowanceLeft == null ? '' : sgn(m.allowanceLeft)}" style="font-weight:600">${m.allowanceLeft == null ? '—' : money(m.allowanceLeft)}</td>
                    <td class="${sgn(m.allowanceRemaining)}" style="font-weight:700">${money(m.allowanceRemaining)}</td>
                  </tr>
                `).join('')}

              <!-- Annual Total Row with Accounting Double Underline -->
              <tr class="tot-row" style="font-size:14px">
                <td style="font-weight:800;color:var(--b)">TOTAL FOR ${selYear}</td>
                <td>${money(annual.openingBalance)}</td>
                <td>${money(annual.totalFriday)}</td>
                <td>${money(annual.totalJF)}</td>
                <td class="pos" style="font-weight:800">${money(annual.totalInflowYear)}</td>
                <td class="${annual.totalGeneralExpenses ? 'neg' : ''}" style="font-weight:800">${annual.totalGeneralExpenses ? '-' + money(annual.totalGeneralExpenses) : money(0)}</td>
                <td class="${sgn(annual.totalNetOfYear)}" style="font-weight:800;font-size:15px;background:rgba(52,211,153,.15)">${signedMoney(annual.totalNetOfYear)}</td>
                ${showAdj ? `<td style="font-weight:700">${signedMoney(annual.totalAdjustments)}</td>` : ''}
                <td style="font-weight:800;color:var(--ok)">${money(annual.finalEndingCash)}</td>
                <td style="border-left:2px solid rgba(34,211,238,.35);font-weight:700">${money(annual.totalAllocIn)}</td>
                <td class="${annual.totalAllowanceSpent ? 'neg' : ''}" style="font-weight:700">${money(annual.totalAllowanceSpent)}</td>
                <td class="${sgn(annual.allowanceLeftYear)}" style="font-weight:700">${money(annual.allowanceLeftYear)}</td>
                <td class="${sgn(annual.allowanceLeftYear)}" style="font-weight:800;color:${annual.allowanceLeftYear >= 0 ? 'var(--b)' : ''};background:rgba(34,211,238,.12)">${money(annual.allowanceLeftYear)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${flagsHtml}
        ${spentWarnHtml}
        ${reconHtml}

        <!-- Annual Summary Highlights Box -->
        <div class="annual-summary-boxes" style="margin-top:26px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">
          <div style="background:rgba(124,92,255,.08);padding:14px 18px;border-radius:12px;border:1px solid rgba(124,92,255,.25)">
            <div style="font-weight:700;color:var(--b);font-size:13px;margin-bottom:6px">💰 Annual Net Cash Accountability</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px">
              <span>Opening Balance:</span><b>${money(annual.openingBalance)}</b>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px">
              <span>Total Inflows for ${selYear}:</span><b>${money(annual.totalInflowYear)}</b>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
              <span>Total Expenses for ${selYear}:</span><b class="neg">${annual.totalExpensesYear ? '-' : ''}${money(annual.totalExpensesYear)}</b>
            </div>
            <div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:6px;font-size:14px;font-weight:800">
              <span>TOTAL NET OF THE YEAR:</span><span class="${sgn(annual.totalNetOfYear)}">${signedMoney(annual.totalNetOfYear)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:13px">
              <span>Closing Balance:</span><b>${money(annual.finalEndingCash)}</b>
            </div>
          </div>

          <div style="background:rgba(34,211,238,.08);padding:14px 18px;border-radius:12px;border:1px solid rgba(34,211,238,.25)">
            <div style="font-weight:700;color:var(--b);font-size:13px;margin-bottom:6px">💳 Monthly Allowance Status</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px">
              <span>Allowance Allocated/Received:</span><b>${money(annual.totalAllocIn)}</b>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
              <span>Allowance Disbursed/Spent:</span><b class="neg">${annual.totalAllowanceSpent ? '-' : ''}${money(annual.totalAllowanceSpent)}</b>
            </div>
            <div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:6px;font-size:14px;font-weight:800">
              <span>ALLOWANCE REMAINING LEFT:</span><span class="${annual.allowanceLeftYear >= 0 ? 'pos' : 'neg'}">${money(annual.allowanceLeftYear)}</span>
            </div>
            <div class="annual-toolbar" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--mute)">
              <span>Reported total spent (optional)</span>
              ${inp(annual.reportedTotalSpent, `annualSetReportedSpent.bind(null,'${selYear}')`, 96)}
            </div>
          </div>
        </div>

        <!-- Official 4-Leader Signatory Block -->
        <div class="sig-block" style="margin-top:48px;display:grid;gap:36px">
          <div style="display:flex;justify-content:space-between;gap:40px">
            <div style="flex:1;text-align:center">
              <div style="margin-bottom:45px">Prepared by:</div>
              <div class="sig-line" style="font-weight:700">${esc(sig.preparedName)}</div>
              <div class="mute" style="font-size:12px;margin-top:3px">${esc(sig.preparedTitle)}</div>
            </div>
            <div style="flex:1;text-align:center">
              <div style="margin-bottom:45px">Noted:</div>
              <div class="sig-line" style="font-weight:700">${esc(sig.notedName)}</div>
              <div class="mute" style="font-size:12px;margin-top:3px">${esc(sig.notedTitle)}</div>
            </div>
          </div>

          <div style="max-width:320px;margin:0 auto;text-align:center">
            <div style="margin-bottom:45px">Recommending Approval</div>
            <div class="sig-line" style="font-weight:700">${esc(sig.recommendingName)}</div>
            <div class="mute" style="font-size:12px;margin-top:3px">${esc(sig.recommendingTitle)}</div>
          </div>

          <div style="max-width:320px;margin:0 auto;text-align:center">
            <div style="margin-bottom:45px">Approved by:</div>
            <div class="sig-line" style="font-weight:700">${esc(sig.approvedName)}</div>
            <div class="mute" style="font-size:12px;margin-top:3px">${esc(sig.approvedTitle)}</div>
          </div>
        </div>
      </div>
    `;
  }
};

/* ---------- mobile helpers ---------- */
const collapsedSecs = new Set();
function ensureFab() {
  if (document.getElementById('fab-add')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'fab-add'; b.className = 'fab'; b.setAttribute('aria-label', 'Quick add'); b.textContent = '＋';
  b.onclick = () => window.openQuickAdd();
  document.body.appendChild(b);
}
window.openQuickAdd = function() {
  const canImport = typeof window.importExcelReport === 'function';
  openModal(`<h2>＋ Quick Add</h2>
    <p class="mute">What would you like to record?</p>
    <div class="qa-grid">
      <button type="button" class="qa-tile qa-inc" onclick="closeModal();txForm('income')"><span class="qa-ic">💰</span><strong>Income</strong><small>Offering, donation, dues</small></button>
      <button type="button" class="qa-tile qa-exp" onclick="closeModal();txForm('expense')"><span class="qa-ic">🧾</span><strong>Expense</strong><small>General or allowance</small></button>
      ${canImport ? '<button type="button" class="qa-tile" onclick="closeModal();window.importExcelReport()"><span class="qa-ic">📥</span><strong>Import Excel</strong><small>Upload a workbook</small></button>' : ''}
      <button type="button" class="qa-tile" onclick="closeModal();openToolsModal()"><span class="qa-ic">⚙️</span><strong>Tools &amp; Data</strong><small>Backup, restore, PIN</small></button>
    </div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
};
document.addEventListener('click', e => {
  const head = e.target.closest && e.target.closest('.ms-sec-head');
  if (!head || e.target.closest('button, a, input, select, textarea')) return;
  if (!window.matchMedia || !window.matchMedia('(max-width: 760px)').matches) return;
  const sec = head.closest('.ms-section');
  if (!sec || !sec.dataset.key) return;
  sec.classList.toggle('collapsed');
  if (sec.classList.contains('collapsed')) collapsedSecs.add(sec.dataset.key); else collapsedSecs.delete(sec.dataset.key);
});

function render() {
  $('#view').innerHTML = views[view]();
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#page-title').textContent = { monthly: 'Monthly Sheet', dashboard: 'Dashboard', transactions: 'Transactions', events: 'Events & Budgets', members: 'Members', reports: 'Reports' }[view] || 'BTC Youth';
  $('#currency').value = S.currency;
  const years = [...new Set([...S.transactions.map(t => t.date.slice(0, 4)), String(new Date().getFullYear())])].sort().reverse();
  const yrSel = $('#year-select');
  if (yrSel) {
    yrSel.innerHTML = '<option value="all">All years</option>' + years.map(y => `<option ${y === period ? 'selected' : ''}>${y}</option>`).join('');
    yrSel.value = period;
    yrSel.style.display = (view === 'monthly' || view === 'reports') ? 'none' : '';
  }

  // Pressing Enter inside any Monthly Sheet inline amount saves immediately; editing highlights Save All bar
  const updateDirtyBar = () => {
    const allInps = [...document.querySelectorAll('.ms-inline-input')];
    let dirty = 0;
    allInps.forEach(el => {
      const val = el.value.trim();
      const orig = (el.dataset.orig || '').trim();
      const isDirty = val !== '' && val !== orig;
      el.classList.toggle('is-dirty', isDirty);
      if (isDirty) dirty++;
    });
    const bar = document.getElementById('ms-save-all-bar');
    const lbl = document.getElementById('ms-dirty-label');
    if (bar) bar.style.display = dirty > 0 ? 'flex' : 'none';
    if (lbl) lbl.textContent = `You have ${dirty} unsaved ${dirty === 1 ? 'amount' : 'amounts'} ready to save`;
  };
  document.querySelectorAll('.ms-inline-input').forEach(inp => {
    inp.oninput = updateDirtyBar;
    inp.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.msSaveSlot(inp.id, inp.dataset.slotKind, inp.dataset.slotDate, inp.dataset.slotTxid);
      }
    };
  });

  // ---- Mobile: quick-add FAB, collapsible sections, centre the active month ----
  ensureFab();
  const fab = document.getElementById('fab-add');
  if (fab) fab.classList.toggle('hidden', typeof canAdd === 'function' ? !canAdd() : false);
  document.querySelectorAll('#view .ms-sheet').forEach((sheet, si) => {
    sheet.querySelectorAll('.ms-section').forEach((sec, i) => {
      const key = view + ':' + si + ':' + i;
      sec.dataset.key = key;
      sec.classList.toggle('collapsed', collapsedSecs.has(key));
    });
  });
  const stripEl = document.querySelector('.month-strip'), activePill = stripEl && stripEl.querySelector('.month-pill.active');
  if (stripEl && activePill) stripEl.scrollLeft = activePill.offsetLeft - stripEl.clientWidth / 2 + activePill.offsetWidth / 2;

  const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
  on('#new-event', 'onclick', () => eventForm());
  on('#new-member', 'onclick', () => memberForm());
  on('#excel-btn', 'onclick', () => {
    if (typeof window.exportExcel === 'function') {
      const years = [...new Set([...S.transactions.map(t => t.date.slice(0, 4)), String(new Date().getFullYear())])].sort().reverse();
      window.exportExcel({
        mode: reportMode,
        ym: reportMonth || getActiveMonth(),
        year: reportYear || years[0] || String(new Date().getFullYear())
      });
    }
  });
  on('#csv-btn', 'onclick', csv);
  on('#print-btn', 'onclick', () => window.printReport());
  on('#edit-sig-btn', 'onclick', signatoriesForm);
  on('#tools-btn', 'onclick', () => window.openToolsModal());
  on('#batch-offerings-btn', 'onclick', () => batchOfferingsModal());
  on('#batch-offerings-btn-rep', 'onclick', () => batchOfferingsModal());
  on('#church-alloc-btn', 'onclick', () => churchAllocationForm());
  on('#church-alloc-btn-rep', 'onclick', () => churchAllocationForm(reportMonth || getActiveMonth()));
  on('#rep-allowance-btn', 'onclick', () => allowanceTrackerModal(reportMonth || getActiveMonth()));
  on('#sample-btn', 'onclick', sample);
  on('#reset-btn', 'onclick', () => { if (confirm('Clear everything?')) { S = freshState(); save(); } });
  on('#f-q', 'oninput', e => { filter.q = e.target.value; const p = e.target.selectionStart; render(); const q = $('#f-q'); q.focus(); q.setSelectionRange(p, p); });
  on('#f-type', 'onchange', e => { filter.type = e.target.value; render(); });
  on('#f-fund', 'onchange', e => { filter.fund = e.target.value; render(); });
  on('#f-sort', 'onchange', e => { filter.sort = e.target.value; render(); });
  on('#f-event', 'onchange', e => { filter.event = e.target.value; render(); });
  on('#f-allowance-toggle', 'onclick', () => { filter.allowanceOnly = !filter.allowanceOnly; render(); });

  // Report view controls
  on('#rep-mode-monthly', 'onclick', () => {
    reportMode = 'monthly';
    localStorage.setItem('btc-rep-mode', 'monthly');
    render();
  });
  on('#rep-mode-annual', 'onclick', () => {
    reportMode = 'annual';
    localStorage.setItem('btc-rep-mode', 'annual');
    render();
  });
  on('#rep-month-sel', 'onchange', e => {
    reportMonth = e.target.value;
    localStorage.setItem('btc-rep-month', reportMonth);
    render();
  });
  on('#rep-year-sel', 'onchange', e => {
    reportYear = e.target.value;
    localStorage.setItem('btc-rep-year', reportYear);
    render();
  });
}
document.querySelectorAll('.nav-btn').forEach(b => b.onclick = () => { view = b.dataset.view; render(); });
if ($('#year-select')) $('#year-select').onchange = e => { period = e.target.value; render(); };
if ($('#add-income-btn')) $('#add-income-btn').onclick = () => txForm('income');
if ($('#add-expense-btn')) $('#add-expense-btn').onclick = () => txForm('expense');
if ($('#tools-btn')) $('#tools-btn').onclick = () => window.openToolsModal();
const batchBtn = $('#batch-offerings-btn');
if (batchBtn) batchBtn.onclick = () => batchOfferingsModal();
const allocTopBtn = $('#church-alloc-btn');
if (allocTopBtn) allocTopBtn.onclick = () => churchAllocationForm();
if ($('#currency')) $('#currency').onchange = e => { S.currency = e.target.value || '₱'; save(); };
render();




