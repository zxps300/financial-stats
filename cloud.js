'use strict';
/* BTC Youth cloud layer: Supabase login, shared data, roles. Loaded after app-core.js, which it builds on. */
const SB_URL = 'https://jsrwuelkzmpfmtpdcgkr.supabase.co';
const SB_KEY = 'sb_publishable_K23e-epSxsLBuLiukePhgA_yQl7zxDE';
const sb = supabase.createClient(SB_URL, SB_KEY);
const legacy = JSON.parse(localStorage.getItem(KEY) || 'null'); // data from the old browser-only version
S = freshState(); // Cloud version always renders live Supabase data, never stale local-only browser data
const OWNER_EMAIL = 'bryanleesugue79@gmail.com';
const isOwnerEmail = e => String(e || '').trim().toLowerCase() === OWNER_EMAIL;
let me = null, session = null;
const isT = () => me?.role === 'treasurer' || isOwnerEmail(session?.user?.email);
const canAdd = () => (me && me.role !== 'viewer') || isOwnerEmail(session?.user?.email);
const fail = e => alert(e?.message || String(e));

let _prefsRowId = null;
function collectLocalPrefs() {
  const skippedSlots = typeof getSkipReasons === 'function' ? getSkipReasons() : {};
  const annual = {};
  Object.keys(localStorage).filter(k => k.startsWith('btc-annual-')).forEach(k => {
    try { annual[k.slice('btc-annual-'.length)] = JSON.parse(localStorage.getItem(k) || '{}'); } catch (_) {}
  });
  return { skippedSlots, annual };
}
function applyCloudPrefs(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.skippedSlots && typeof payload.skippedSlots === 'object') {
    localStorage.setItem('btc-skipped-slots', JSON.stringify(payload.skippedSlots));
  }
  // Replace local annual overrides with the synced cloud copy so cleared notes/adjustments also sync
  Object.keys(localStorage).filter(k => k.startsWith('btc-annual-')).forEach(k => localStorage.removeItem(k));
  if (payload.annual && typeof payload.annual === 'object') {
    Object.entries(payload.annual).forEach(([yr, obj]) => {
      if (obj && typeof obj === 'object') localStorage.setItem('btc-annual-' + yr, JSON.stringify(obj));
    });
  }
}
let _prefsTimer = null;
window.onPrefsChanged = function() {
  if (!session) return;
  clearTimeout(_prefsTimer);
  _prefsTimer = setTimeout(async () => {
    try {
      const action = JSON.stringify(collectLocalPrefs());
      if (_prefsRowId) {
        const res = await sb.from('audit_log').update({ action, at: new Date().toISOString() }).eq('id', _prefsRowId).select('id');
        if (!res.error && res.data && res.data.length) return;
      }
      await sb.from('audit_log').delete().eq('actor_name', '__btc_prefs__');
      const ins = await sb.from('audit_log').insert({ tx_id: null, actor_name: '__btc_prefs__', action }).select('id').single();
      if (!ins.error && ins.data) _prefsRowId = ins.data.id;
    } catch (err) {
      console.error('Could not sync preferences:', err);
    }
  }, 250);
};

/* ---------- data ---------- */
async function loadAll() {
  const names = ['events', 'members', 'categories', 'transactions', 'audit_log', 'profiles'];
  const res = await Promise.all(names.map(t => sb.from(t).select('*')));
  const bad = res.find(r => r.error); if (bad) throw bad.error;
  const [ev, mem, cat, tx, au, pr] = res.map(r => r.data);

  // Sync missing-entry reasons & annual summary adjustments/notes from cloud
  const prefRows = au.filter(a => a.actor_name === '__btc_prefs__').sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  if (prefRows.length) {
    _prefsRowId = prefRows[0].id;
    try { applyCloudPrefs(JSON.parse(prefRows[0].action)); } catch (_) {}
  } else {
    _prefsRowId = null;
    const localPrefs = collectLocalPrefs();
    if (Object.keys(localPrefs.skippedSlots).length || Object.keys(localPrefs.annual).length) {
      window.onPrefsChanged();
    }
  }

  const logs = {};
  au.filter(a => a.tx_id && a.actor_name !== '__btc_prefs__')
    .sort((a, b) => a.at.localeCompare(b.at))
    .forEach(a => (logs[a.tx_id] ??= []).push(`${a.action} by ${a.actor_name || 'unknown'} · ${new Date(a.at).toLocaleString()}`));
  const cur = localStorage.getItem('btc-cloud-currency') || '₱';
  me = pr.find(p => p.id === session.user.id) || { role: 'viewer', name: session.user.email };
  let inCats = cat.filter(c => c.type === 'income').map(c => c.name);
  let exCats = cat.filter(c => c.type === 'expense').map(c => c.name);
  if (!inCats.length) inCats = [...DEFAULT_INCOME_CATS];
  if (!exCats.length) exCats = [...DEFAULT_EXPENSE_CATS];
  if (isT() && !cat.length) {
    const seeds = [
      ...inCats.map(name => ({ type: 'income', name })),
      ...exCats.map(name => ({ type: 'expense', name }))
    ];
    sb.from('categories').insert(seeds).then(() => {}, console.error);
  }
  S = {
    currency: cur, profiles: pr,
    events: ev.map(e => ({ id: e.id, name: e.name, budget: +e.budget })),
    members: mem.map(m => ({ id: m.id, name: m.name, contact: m.contact || '', monthly: +m.monthly || 0, due: +m.due || 0 })),
    incomeCats: inCats,
    expenseCats: exCats,
    transactions: tx.map(t => {
      const isAllow = (t.notes || '').includes('[Allowance]') || t.category === 'Allocation from Church Funds' || t.category === 'Monthly Allowance';
      return {
        id: t.id,
        type: t.type,
        fund: isAllow ? 'allowance' : 'general',
        date: t.date,
        amount: +t.amount,
        category: t.category || '',
        eventId: t.event_id || '',
        memberId: t.member_id || '',
        notes: t.notes || '',
        status: t.status,
        receipt: t.receipt_path || '',
        createdAt: t.created_at || '',
        log: [`Created ${new Date(t.created_at).toLocaleString()}`, ...(logs[t.id] || [])]
      };
    })
  };
}
async function refresh() { await loadAll(); applyRole(); render(); }
save = () => { localStorage.setItem('btc-cloud-currency', S.currency); render(); };
const audit = (txId, action) => sb.from('audit_log').insert({ tx_id: txId, action, actor_name: me.name });
const check = r => { if (r.error) throw r.error; return r.data; };
const busy = (form, on) => form.querySelectorAll('button').forEach(b => b.disabled = on);

/* ---------- receipt storage helper (compress + upload to Supabase Storage) ---------- */
async function uploadReceiptFile(file) {
  const comp = typeof window.compressReceiptImage === 'function'
    ? await window.compressReceiptImage(file)
    : { blob: file, contentType: file.type || 'image/jpeg', ext: (file.name.split('.').pop() || 'jpg').toLowerCase() };
  const safeBase = (file.name || 'receipt').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40) || 'receipt';
  const path = `${me.id}/${Date.now()}-${safeBase}.${comp.ext || 'jpg'}`;
  const res = await sb.storage.from('receipts').upload(path, comp.blob, {
    contentType: comp.contentType || 'image/jpeg',
    upsert: true
  });
  if (res.error) {
    const msg = res.error.message || String(res.error);
    if (/bucket|not found|row-level security|policy/i.test(msg)) {
      throw new Error(`Receipt storage isn't enabled in Supabase yet (${msg}). Run supabase-lock-owner.sql in Supabase SQL Editor to enable the 'receipts' bucket.`);
    }
    throw res.error;
  }
  return path;
}

/* ---------- forms (reuse the core modals, replace the save step) ---------- */
const coreTxForm = txForm, coreEventForm = eventForm, coreMemberForm = memberForm, coreCatForm = catForm;
txForm = type => {
  coreTxForm(type);
  $('#tx-form').onsubmit = async e => {
    e.preventDefault(); const form = e.target, f = new FormData(form); busy(form, true);
    try {
      let path = null; const file = f.get('receipt');
      if (file && file.size) {
        if (typeof showToast === 'function') showToast('⏳ Uploading receipt...');
        path = await uploadReceiptFile(file);
      }
      const fund = f.get('fund') || (type === 'expense' ? 'general' : 'general');
      let notes = f.get('notes') ? f.get('notes').trim() : '';
      if (fund === 'allowance' && !notes.includes('[Allowance]')) {
        notes = notes ? `[Allowance] ${notes}` : '[Allowance]';
      }
      const row = check(await sb.from('transactions').insert({
        type, date: f.get('date'), amount: +f.get('amount'), category: f.get('category'), event_id: f.get('eventId') || null,
        member_id: f.get('memberId') || null, notes, receipt_path: path, status: 'approved'
      }).select('id').single());
      await audit(row.id, path ? 'Entered with receipt' : 'Entered');
      closeModal(); await refresh();
      if (path && typeof showToast === 'function') showToast('🧾 Expense & receipt saved!');
    } catch (err) { fail(err); busy(form, false); }
  };
};

window.saveChurchAllocation = async function(allocData) {
  const form = $('#church-alloc-form');
  if (form) busy(form, true);
  try {
    const ym = allocData.date.slice(0, 7);
    let notes = allocData.notes ? allocData.notes.trim() : 'Monthly Allocation from Church Funds';
    if (!notes.includes('[Allowance]')) {
      notes = `[Allowance] ${notes}`;
    }
    if (allocData.id) {
      check(await sb.from('transactions').update({
        amount: allocData.amount,
        date: allocData.date,
        category: 'Allocation from Church Funds',
        notes
      }).eq('id', allocData.id));
      await audit(allocData.id, 'Updated Church Allocation');
    } else {
      const row = check(await sb.from('transactions').insert({
        type: 'income',
        date: allocData.date,
        amount: allocData.amount,
        category: 'Allocation from Church Funds',
        notes,
        status: 'approved'
      }).select('id').single());
      await audit(row.id, 'Entered Church Allocation');
    }
    localStorage.setItem('btc-active-month', ym);
    closeModal();
    await refresh();
  } catch (err) {
    fail(err);
    if (form) busy(form, false);
  }
};

window.deleteChurchAllocation = async function(txId) {
  try {
    check(await sb.from('transactions').update({ status: 'void' }).eq('id', txId));
    await audit(txId, 'Voided Church Allocation');
    closeModal();
    await refresh();
  } catch (err) {
    fail(err);
  }
};

window.saveBatchOfferings = async (entries, deletedIds = []) => {
  const form = $('#batch-offerings-form');
  if (form) busy(form, true);
  try {
    if (deletedIds && deletedIds.length) {
      check(await sb.from('transactions').update({ status: 'void' }).in('id', deletedIds));
    }
    const toUpdate = entries.filter(e => e.id);
    const toInsert = entries.filter(e => !e.id);
    for (const u of toUpdate) {
      let notes = u.notes || '';
      if (u.fund === 'allowance' && !notes.includes('[Allowance]')) {
        notes = notes ? `[Allowance] ${notes}` : '[Allowance]';
      }
      check(await sb.from('transactions').update({
        amount: u.amount,
        date: u.date,
        type: u.type || 'income',
        category: u.category,
        notes
      }).eq('id', u.id));
    }
    if (toInsert.length) {
      const rows = [];
      for (const item of toInsert) {
        let notes = item.notes || '';
        if (item.fund === 'allowance' && !notes.includes('[Allowance]')) {
          notes = notes ? `[Allowance] ${notes}` : '[Allowance]';
        }
        const txType = item.type || 'income';
        let receiptPath = null;
        if (item.receiptFile && item.receiptFile.size) {
          receiptPath = await uploadReceiptFile(item.receiptFile);
        }
        rows.push({
          type: txType,
          date: item.date,
          amount: item.amount,
          category: item.category,
          event_id: null,
          member_id: null,
          notes,
          receipt_path: receiptPath,
          status: 'approved'
        });
      }
      const inserted = check(await sb.from('transactions').insert(rows).select('id'));
      if (inserted && inserted.length && typeof window.recordUploadBatch === 'function') {
        window.recordUploadBatch(inserted.map(r => r.id), `Upload (${inserted.length})`);
      }
    }
    if (entries.length && entries[0].date) {
      localStorage.setItem('btc-active-month', entries[0].date.slice(0, 7));
    }
    await audit(null, `Saved monthly transactions (${entries.length} items)`);
    closeModal();
    await refresh();
    return true;
  } catch (err) {
    fail(err);
    if (form) busy(form, false);
    return false;
  }
};
eventForm = id => {
  coreEventForm(id);
  $('#ev-form').onsubmit = async e => {
    e.preventDefault(); const form = e.target, f = new FormData(form); busy(form, true);
    try {
      const d = { name: f.get('name'), budget: +f.get('budget') };
      check(id ? await sb.from('events').update(d).eq('id', id) : await sb.from('events').insert(d));
      closeModal(); await refresh();
    } catch (err) { fail(err); busy(form, false); }
  };
};
memberForm = id => {
  coreMemberForm(id);
  $('#m-form').onsubmit = async e => {
    e.preventDefault(); const form = e.target, f = new FormData(form); busy(form, true);
    try {
      const d = { name: f.get('name'), contact: f.get('contact'), monthly: +f.get('monthly'), due: +f.get('due') };
      check(id ? await sb.from('members').update(d).eq('id', id) : await sb.from('members').insert(d));
      closeModal(); await refresh();
    } catch (err) { fail(err); busy(form, false); }
  };
};
catForm = () => {
  coreCatForm();
  $('#cat-form').onsubmit = async e => {
    e.preventDefault(); const form = e.target, f = new FormData(form); busy(form, true);
    const clean = (s, fb) => { const a = [...new Set(String(s).split('\n').map(x => x.trim()).filter(Boolean))]; return a.length ? a : fb; };
    try {
      for (const [type, old, now] of [['income', S.incomeCats, clean(f.get('inc'), DEFAULT_INCOME_CATS)], ['expense', S.expenseCats, clean(f.get('exp'), DEFAULT_EXPENSE_CATS)]]) {
        const del = old.filter(c => !now.includes(c)), add = now.filter(c => !old.includes(c));
        if (del.length) check(await sb.from('categories').delete().eq('type', type).in('name', del));
        if (add.length) check(await sb.from('categories').insert(add.map(name => ({ type, name }))));
      }
      closeModal(); await refresh();
    } catch (err) { fail(err); busy(form, false); }
  };
};

window._doDeleteTransactions = async function(ids) {
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      await sb.from('audit_log').delete().in('tx_id', chunk);
      await sb.from('transactions').delete().in('id', chunk);
    }
    // Fallback if DELETE RLS policy isn't active: void any remaining rows
    const { data: leftover } = await sb.from('transactions').select('id').in('id', ids).neq('status', 'void');
    if (leftover && leftover.length) {
      check(await sb.from('transactions').update({ status: 'void' }).in('id', leftover.map(r => r.id)));
    }
    ids.forEach(id => { if (typeof selectedTxIds !== 'undefined') selectedTxIds.delete(id); });
    await refresh();
    if (typeof showToast === 'function') showToast(`🗑️ Deleted ${ids.length} ${ids.length === 1 ? 'transaction' : 'transactions'}`);
  } catch (err) {
    fail(err);
  }
};

window._doClearAllData = async function() {
  // Attempt hard delete on all data tables (works when owner_only_* RLS policies are active)
  await sb.from('audit_log').delete().not('id', 'is', null);
  await sb.from('transactions').delete().not('id', 'is', null);
  await sb.from('events').delete().not('id', 'is', null);
  await sb.from('members').delete().not('id', 'is', null);

  // Fallback: if transactions still exist (DELETE RLS policy not yet enabled), void them all so balances clear to 0
  const { data: leftover } = await sb.from('transactions').select('id').neq('status', 'void');
  if (leftover && leftover.length) {
    const ids = leftover.map(r => r.id);
    check(await sb.from('transactions').update({ status: 'void' }).in('id', ids));
  }

  localStorage.removeItem('btc-skipped-slots');
  Object.keys(localStorage).filter(k => k.startsWith('btc-annual-')).forEach(k => localStorage.removeItem(k));
  closeModal();
  await refresh();
  if (typeof showToast === 'function') showToast('✔ All data cleared');
};

/* ---------- actions ---------- */
async function changeTx(id, status, label) {
  try {
    const rows = check(await sb.from('transactions').update({ status }).eq('id', id).select('id'));
    if (!rows.length) throw new Error('Not allowed for your role.');
    await audit(id, label); await refresh();
  } catch (err) { fail(err); }
}
approve = id => changeTx(id, 'approved', 'Approved');
voidTx = id => { if (confirm('Void this entry? It will be kept in history but excluded from totals.')) changeTx(id, 'void', 'Voided'); };
delEvent = async id => {
  if (!confirm('Delete this event? Its transactions are kept but unlinked from the event.')) return;
  try { check(await sb.from('events').delete().eq('id', id)); await refresh(); } catch (err) { fail(err); }
};
delMember = async id => {
  if (!confirm('Delete this member? Their payments are kept but unlinked.')) return;
  try { check(await sb.from('members').delete().eq('id', id)); await refresh(); } catch (err) { fail(err); }
};
showReceipt = async id => {
  const t = S.transactions.find(x => x.id === id);
  if (!t || !t.receipt) {
    if (typeof showToast === 'function') showToast('No receipt attached yet');
    return;
  }
  if (String(t.receipt).startsWith('data:') || String(t.receipt).startsWith('http')) {
    return window.renderReceiptModal(t, t.receipt);
  }
  const { data, error } = await sb.storage.from('receipts').createSignedUrl(t.receipt, 600);
  if (error) return fail(error);
  window.renderReceiptModal(t, data.signedUrl);
};

window.attachReceipt = async function(txId, reopenModal = false) {
  const t = S.transactions.find(x => x.id === txId);
  if (!t) return;
  const file = await window.pickReceiptFile();
  if (!file) return;
  try {
    if (typeof showToast === 'function') showToast('⏳ Uploading receipt...');
    const oldPath = t.receipt && !String(t.receipt).startsWith('data:') ? t.receipt : null;
    const path = await uploadReceiptFile(file);
    check(await sb.from('transactions').update({ receipt_path: path }).eq('id', txId));
    if (oldPath && oldPath !== path) {
      await sb.storage.from('receipts').remove([oldPath]).catch(() => {});
    }
    await audit(txId, oldPath ? 'Replaced receipt' : 'Uploaded receipt');
    await refresh();
    if (typeof showToast === 'function') showToast('🧾 Receipt uploaded!');
    if (reopenModal) showReceipt(txId);
  } catch (err) {
    fail(err);
  }
};

window.removeReceipt = async function(txId) {
  const t = S.transactions.find(x => x.id === txId);
  if (!t || !confirm('Remove the receipt photo from this expense?')) return;
  try {
    const oldPath = t.receipt && !String(t.receipt).startsWith('data:') ? t.receipt : null;
    check(await sb.from('transactions').update({ receipt_path: null }).eq('id', txId));
    if (oldPath) {
      await sb.storage.from('receipts').remove([oldPath]).catch(() => {});
    }
    await audit(txId, 'Removed receipt');
    closeModal();
    await refresh();
    if (typeof showToast === 'function') showToast('🗑️ Receipt removed');
  } catch (err) {
    fail(err);
  }
};
async function setRole(id, role) {
  try {
    const rows = check(await sb.from('profiles').update({ role }).eq('id', id).select('id'));
    if (!rows.length) throw new Error('Only the treasurer can change roles.');
    await refresh();
  } catch (err) { fail(err); await refresh(); }
}
async function importLegacy() {
  const n = legacy.transactions.length + legacy.events.length + legacy.members.length;
  if (!confirm(`Import ${legacy.transactions.length} transactions, ${legacy.events.length} events and ${legacy.members.length} members from this browser into the shared database?\nDo this only once.`)) return;
  try {
    const evMap = {}, memMap = {};
    for (const e of legacy.events) evMap[e.id] = check(await sb.from('events').insert({ name: e.name, budget: e.budget }).select('id').single()).id;
    for (const m of legacy.members) memMap[m.id] = check(await sb.from('members').insert({ name: m.name, contact: m.contact || '', monthly: m.monthly || 0, due: m.due || 0 }).select('id').single()).id;
    for (const [type, mine, theirs] of [['income', S.incomeCats, legacy.incomeCats || []], ['expense', S.expenseCats, legacy.expenseCats || []]]) {
      const add = theirs.filter(c => !mine.includes(c)); if (add.length) check(await sb.from('categories').insert(add.map(name => ({ type, name }))));
    }
    const rows = legacy.transactions.map(t => ({ type: t.type, date: t.date, amount: t.amount, category: t.category, event_id: evMap[t.eventId] || null,
      member_id: memMap[t.memberId] || null, notes: t.notes || '', status: t.status }));
    if (rows.length) check(await sb.from('transactions').insert(rows));
    localStorage.setItem(KEY + '-imported', '1'); await refresh(); alert(`Imported ${n} records.`);
  } catch (err) { fail(err); }
}

/* ---------- team view + role-aware render ---------- */
views.team = () => `<div class="card"><h2>Team &amp; roles</h2>
  <p class="mute">New sign-ups start as <b>viewers</b>. Officers can add entries and approve expenses entered by someone else. The treasurer manages everything else.</p>
  <table><tr><th>Name</th><th>Email</th><th>Role</th></tr>${S.profiles.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.email)}</td><td>${p.id === me.id ? `<span class="tag ok">${p.role} (you)</span>` :
    `<select style="width:auto" onchange="setRole('${p.id}',this.value)">${['treasurer', 'officer', 'viewer'].map(r => `<option ${r === p.role ? 'selected' : ''}>${r}</option>`).join('')}</select>`}</td></tr>`).join('')}</table></div>`;

const coreRender = render;
function hide(sel) { document.querySelectorAll(sel).forEach(el => el.style.display = 'none'); }
render = function () {
  if (!me) return;
  coreRender();
  if (view === 'team') $('#page-title').textContent = 'Team & roles';
  if (!isT()) hide('[onclick^="voidTx"],[onclick^="eventForm"],[onclick^="delEvent"],[onclick^="memberForm"],[onclick^="delMember"],#new-event,#new-member');
  if (!canAdd()) hide('[onclick^="approve"]');
};
function applyRole() {
  const show = (sel, on) => { const el = $(sel); if (el) el.style.display = on ? '' : 'none'; };
  show('#cat-btn', isT()); show('#nav-team', false); show('#add-income-btn', canAdd()); show('#add-expense-btn', canAdd());
  show('#batch-offerings-btn', canAdd());
  show('#import-btn', isT() && legacy && (legacy.transactions?.length || legacy.events?.length || legacy.members?.length) && !localStorage.getItem(KEY + '-imported'));
  const activeTxCount = S.transactions.filter(t => t.status !== 'void').length;
  $('#user-label').innerHTML = `${esc(me.name)}<small>☁️ Cloud · ${activeTxCount} entries</small>`;
}
window.importLegacy = importLegacy;
if ($('#cat-btn')) $('#cat-btn').onclick = () => catForm();
if ($('#import-btn')) $('#import-btn').onclick = importLegacy;
if ($('#logout-btn')) $('#logout-btn').onclick = () => sb.auth.signOut();

/* ---------- auth (owner-only 6-digit PIN via Supabase Auth) ---------- */
const pinInput = $('#pin-input');
const pinDots = [...document.querySelectorAll('#pin-dots span')];
const authForm = $('#auth-form');

function syncPinDots() {
  if (!pinInput) return;
  pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 6);
  const len = pinInput.value.length;
  pinDots.forEach((d, i) => d.classList.toggle('filled', i < len));
}

async function submitPin() {
  if (!authForm || !pinInput) return;
  const pin = pinInput.value.replace(/\D/g, '');
  const msg = $('#auth-msg');
  if (pin.length !== 6) {
    if (msg) { msg.style.color = 'var(--warn)'; msg.textContent = 'Enter your 6-digit PIN.'; }
    return;
  }
  busy(authForm, true);
  if (msg) { msg.style.color = 'var(--mute)'; msg.textContent = 'Unlocking…'; }
  try {
    const { error } = await sb.auth.signInWithPassword({ email: OWNER_EMAIL, password: pin });
    if (error) throw new Error('Incorrect PIN. Please try again.');
    pinInput.value = '';
    syncPinDots();
  } catch (err) {
    pinInput.value = '';
    syncPinDots();
    if (msg) { msg.style.color = 'var(--bad)'; msg.textContent = err.message; }
  }
  busy(authForm, false);
}

if (pinInput) {
  pinInput.oninput = () => {
    syncPinDots();
    if (pinInput.value.length === 6) submitPin();
  };
}
const pinPad = $('#pin-pad');
if (pinPad && pinInput) {
  pinPad.onclick = e => {
    const btn = e.target.closest('button[data-k]');
    if (!btn || btn.disabled) return;
    const k = btn.dataset.k;
    if (k === 'clear') pinInput.value = '';
    else if (k === 'back') pinInput.value = pinInput.value.slice(0, -1);
    else if (pinInput.value.length < 6) pinInput.value += k;
    syncPinDots();
    if (pinInput.value.length === 6) submitPin();
  };
}
if (authForm) {
  authForm.onsubmit = e => { e.preventDefault(); submitPin(); };
}

function openResetPasswordModal(s) {
  openModal(`<h2>🔢 Change 6-Digit PIN</h2>
    <p class="mute" style="margin-bottom:12px">Choose a new 6-digit numeric PIN for your private account.</p>
    <form id="pw-reset-form">
      <label>New 6-digit PIN<input type="password" name="pw1" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="••••••"></label>
      <label>Confirm 6-digit PIN<input type="password" name="pw2" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="••••••"></label>
      <p class="mute" id="pw-reset-msg" style="color:var(--warn)"></p>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px">
        <button type="button" class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn">Save New PIN</button>
      </div>
    </form>`);
  $('#pw-reset-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), p1 = String(f.get('pw1') || '').trim(), p2 = String(f.get('pw2') || '').trim(), msg = $('#pw-reset-msg');
    if (!/^\d{6}$/.test(p1)) { msg.textContent = 'PIN must be exactly 6 digits.'; return; }
    if (p1 !== p2) { msg.textContent = 'PINs do not match.'; return; }
    busy(e.target, true); msg.textContent = '';
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) { msg.textContent = error.message; busy(e.target, false); return; }
    closeModal();
    alert('PIN updated! Use your new 6-digit PIN next time you sign in.');
    if (s) enter(s);
  };
}
window.openResetPasswordModal = openResetPasswordModal;
const _startedInRecovery = location.hash.includes('type=recovery') || location.search.includes('type=recovery');
let _recoveryModalShown = false;

async function enter(s) {
  if (!isOwnerEmail(s?.user?.email)) {
    await sb.auth.signOut();
    $('#auth-msg').textContent = 'Access denied: this app is private and restricted to the owner.';
    $('#auth-wrap').classList.add('open');
    return;
  }
  session = s;
  try { await loadAll(); } catch (err) { $('#auth-msg').textContent = 'Could not load data: ' + (err.message || err) + ' (did you run the SQL schema?)'; return; }
  $('#auth-wrap').classList.remove('open'); applyRole(); render();
  if (_startedInRecovery && !_recoveryModalShown) {
    _recoveryModalShown = true;
    openResetPasswordModal(s);
  }
}
sb.auth.onAuthStateChange((event, s) => {
  if (event === 'PASSWORD_RECOVERY') {
    _recoveryModalShown = true;
    $('#auth-wrap').classList.remove('open');
    openResetPasswordModal(s);
  } else if (event === 'SIGNED_OUT') {
    me = null; session = null; S = freshState(); render(); $('#auth-wrap').classList.add('open');
  } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && s && (!session || session.user.id !== s.user.id)) {
    setTimeout(() => enter(s), 0);
  }
});
sb.auth.getSession().then(({ data }) => {
  if (!data.session) {
    $('#auth-wrap').classList.add('open');
  } else {
    if (!session) enter(data.session);
    if (_startedInRecovery && !_recoveryModalShown) {
      _recoveryModalShown = true;
      $('#auth-wrap').classList.remove('open');
      openResetPasswordModal(data.session);
    }
  }
});

/* Auto-sync with Supabase whenever you switch back to the app on phone or laptop */
let _lastSyncAt = 0;
async function syncNow(showMsg = false) {
  if (!session) return;
  const now = Date.now();
  if (!showMsg && now - _lastSyncAt < 3000) return;
  _lastSyncAt = now;
  try {
    await refresh();
    const n = S.transactions.filter(t => t.status !== 'void').length;
    if (showMsg && typeof showToast === 'function') showToast(`✔ Synced with cloud (${n} entries)`);
  } catch (err) {
    if (showMsg) fail(err);
  }
}
window.syncNow = syncNow;
document.addEventListener('visibilitychange', () => { if (!document.hidden && session) syncNow(false); });
window.addEventListener('focus', () => { if (session) syncNow(false); });

/* Add a 1-tap Sync button to the topbar in cloud mode */
const topActions = document.querySelector('.topbar .actions');
if (topActions && !document.getElementById('cloud-sync-btn')) {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'cloud-sync-btn';
  b.className = 'btn ghost';
  b.textContent = '🔄 Sync';
  b.title = 'Refresh latest data from Supabase';
  b.onclick = () => syncNow(true);
  topActions.insertBefore(b, topActions.firstChild);
}
