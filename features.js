/* Extra tools: Data check, Excel export, Backup/Restore, carry-forward, Install app (PWA) */
(function () {
  const $id = id => document.getElementById(id);
  const peso = n => (typeof money === 'function' ? money(n) : '₱' + Number(n).toFixed(2));
  const live = () => S.transactions.filter(t => t.status !== 'void' && t.date);
  const ymOf = d => d.slice(0, 7);
  const monthName = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const dow = d => new Date(d + 'T00:00:00').getDay();
  const nextYm = ym => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const prevYm = ym => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

  function monthStats() {
    const m = {};
    live().forEach(t => {
      const k = ymOf(t.date);
      const s = m[k] ||= { begin: 0, hasBegin: false, offer: 0, genExp: 0, alloc: 0, allowExp: 0 };
      if (t.type === 'income') {
        if (isAllowanceInc(t)) s.alloc += t.amount;
        else if (t.category === 'Beginning Balance') { s.begin += t.amount; s.hasBegin = true; }
        else s.offer += t.amount;
      } else if (t.status === 'approved' || !t.status) {
        if (isAllowanceExp(t)) s.allowExp += t.amount; else s.genExp += t.amount;
      }
    });
    Object.values(m).forEach(s => { s.net = s.begin + s.offer - s.genExp; s.allowLeft = s.alloc - s.allowExp; });
    return m;
  }

  /* ---------- Data check ---------- */
  function findIssues() {
    const issues = [], stats = monthStats(), tx = live();
    tx.forEach(t => {
      if (t.type === 'income' && t.category === 'Youth Night Offering' && dow(t.date) !== 5)
        issues.push({ lvl: 'warn', msg: `Youth Night Offering ${peso(t.amount)} is dated <b>${t.date}</b> which is not a Friday.` });
      if (t.type === 'income' && t.category === 'Joint Fellowship Offering' && dow(t.date) !== 0)
        issues.push({ lvl: 'info', msg: `Joint Fellowship ${peso(t.amount)} is dated <b>${t.date}</b> which is not a Sunday.` });
    });
    const seen = {};
    tx.forEach(t => { const k = [t.type, t.date, t.amount, t.category, t.fund || ''].join('|'); (seen[k] ||= []).push(t); });
    Object.values(seen).filter(a => a.length > 1).forEach(a =>
      issues.push({ lvl: 'warn', msg: `Possible duplicate ×${a.length}: ${a[0].type} ${peso(a[0].amount)} · ${a[0].category} · ${a[0].date}` }));
    Object.keys(stats).sort().forEach(k => {
      const s = stats[k], nk = nextYm(k), n = stats[nk];
      if (s.allowLeft < 0) issues.push({ lvl: 'bad', msg: `<b>${monthName(k)}</b>: allowance overspent by ${peso(-s.allowLeft)}.` });
      if (n && n.hasBegin && Math.abs(n.begin - s.net) > 0.009)
        issues.push({ lvl: 'warn', msg: `<b>${monthName(nk)}</b> starts with ${peso(n.begin)} but ${monthName(k)} ended with ${peso(s.net)} (difference ${peso(n.begin - s.net)}).` });
      if (n && !n.hasBegin)
        issues.push({ lvl: 'info', msg: `<b>${monthName(nk)}</b> has no beginning balance. Carry forward ${peso(s.net)} from ${monthName(k)}?`, carry: { ym: nk, amount: s.net } });
    });
    return issues;
  }
  window.__applyCarry = async (ym, amount) => {
    await window.saveBatchOfferings([{ type: 'income', fund: 'general', date: ym + '-01', amount, category: 'Beginning Balance', notes: 'Carried forward from ' + monthName(prevYm(ym)) }]);
    setTimeout(window.dataCheck, 400);
  };
  window.dataCheck = function () {
    const issues = findIssues(), icon = { bad: '🔴', warn: '🟠', info: '🔵' };
    openModal(`<h2>🩺 Data Check</h2>
      <p class="mute" style="margin-bottom:12px">${issues.length ? issues.length + ' item(s) to review.' : 'Everything looks consistent ✔'}</p>
      <div style="display:grid;gap:8px;max-height:55vh;overflow:auto">${issues.map(i => `
        <div style="background:rgba(255,255,255,.05);padding:10px 12px;border-radius:10px;font-size:13px;display:flex;gap:10px;align-items:center;justify-content:space-between">
          <span>${icon[i.lvl]} ${i.msg}</span>
          ${i.carry ? `<button class="btn sm" onclick="__applyCarry('${i.carry.ym}',${i.carry.amount})">Apply</button>` : ''}
        </div>`).join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
  };

  /* ---------- Excel export (.xlsx matching on-screen Reports 1-to-1) ---------- */
  function buildMonthlySheetRows(ym) {
    const r = typeof window.getMonthlyReportData === 'function' ? window.getMonthlyReportData(ym) : null;
    if (!r) return null;
    const rows = [
      ['Tagbilaran Bible Training Ministries, Inc.', '', '', ''],
      ['BIBLE TRAINING CENTER - TAGBILARAN CHURCH', '', '', ''],
      ['College, Youth and Professionals (COYAP)', '', '', ''],
      ['Cash Accountability Report', '', '', ''],
      [`As of ${r.monthTitle}`, '', '', ''],
      ['In Philippine Peso', '', '', ''],
      ['', '', '', ''],
      ['PARTICULARS', 'DETAIL', 'SUBTOTAL', 'TOTAL'],
      ['Cash on Hand - Beginning Balance', '', '', ''],
      ['  Youth Funds from Church', '', '', ''],
      ['  Youth Night Offerings', '', 0, ''],
      ['  Beginning Balance Total', '', '', r.begBal],
      ['', '', '', ''],
      ['Add: Offerings', '', '', ''],
      ['  Youth Night Offerings', '', '', '']
    ];
    r.ynSlotRows.forEach(s => {
      rows.push([
        `    ${s.label}${s.reason ? ` (${s.reason})` : ''}`,
        s.amount != null ? s.amount : '—',
        '',
        ''
      ]);
    });
    rows.push(['  Subtotal Youth Night Offerings', '', r.totalYN, '']);
    rows.push([
      `  Joint Fellowship Offerings${r.jfSkipReason ? ` (${r.jfSkipReason})` : ''}`,
      '',
      r.totalJF ? r.totalJF : '—',
      r.totalOfferings
    ]);
    r.otherInc.forEach(t => {
      rows.push([`  ${t.category} (${t.date})`, '', t.amount, '']);
    });
    rows.push(['Total Cash on Hand (Youth General Fund)', '', '', r.totalCashOnHand]);
    rows.push(['', '', '', '']);
    rows.push(['Less: Expenses (Youth General Fund)', '', '', '']);
    if (r.genExpList.length) {
      r.genExpList.forEach(t => {
        const noteStr = cleanNotes(t.notes);
        const rcpt = t.receipt ? ' [Receipt]' : '';
        rows.push([`    ${t.category} (${t.date}${noteStr ? ' · ' + noteStr : ''})${rcpt}`, t.amount, '', '']);
      });
    } else {
      rows.push(['    None recorded', 0, '', '']);
    }
    rows.push(['  Total General Fund Expenses', '', '', -r.totalGenExp]);
    rows.push(['NET CASH ON HAND (YOUTH GENERAL FUND)', '', '', r.netCashOnHand]);
    rows.push(['', '', '', '']);
    rows.push(['SEPARATED STATEMENT: ALLOCATION FROM CHURCH FUNDS (MONTHLY ALLOWANCE)', '', '', '']);
    rows.push([`Allocation from Church Funds (${r.monthTitle})`, '', '', r.allow.allocated]);
    rows.push(['Less: Allowance Expenses', '', '', '']);
    if (r.allowExpList.length) {
      r.allowExpList.forEach(t => {
        const noteStr = cleanNotes(t.notes);
        const rcpt = t.receipt ? ' [Receipt]' : '';
        rows.push([`    ${t.category} (Allowance · ${t.date}${noteStr ? ' · ' + noteStr : ''})${rcpt}`, t.amount, '', '']);
      });
    } else {
      rows.push(['    None recorded', 0, '', '']);
    }
    rows.push(['  Total Allowance Expenses', '', '', -r.allow.spent]);
    rows.push([`REMAINING ALLOWANCE BALANCE (${r.monthTitle.toUpperCase()})`, '', '', r.allow.remaining]);
    rows.push([`${r.y} Cumulative Remaining Allowance`, '', '', r.yearAllow.remaining]);
    rows.push(['Reference Combined Cash (Youth Fund + Monthly Allowance Left)', '', '', r.combinedCash]);
    rows.push(['', '', '', '']);
    rows.push(['Prepared by:', r.sig.preparedName, 'Noted:', r.sig.notedName]);
    rows.push(['', r.sig.preparedTitle, '', r.sig.notedTitle]);
    rows.push(['', '', '', '']);
    rows.push(['Recommending Approval:', r.sig.recommendingName, 'Approved by:', r.sig.approvedName]);
    rows.push(['', r.sig.recommendingTitle, '', r.sig.approvedTitle]);
    return { r, rows };
  }

  function buildAnnualSheetRows(selYear) {
    const annual = getAnnualBreakdown(selYear);
    const sig = getSignatories();
    const includeAdj = annual.showAdj || Math.abs(annual.totalAdjustments) > 0.005;
    const hdr = ['Month', 'Beg. Youth Fund', 'Friday Offerings', 'Joint Fellowship', 'Youth Inflow', 'General Exp.', 'Youth Fund Net'];
    if (includeAdj) hdr.push('Adjustment');
    hdr.push('Ending Youth Fund', 'Allowance In', 'Allowance Out', 'Balance', 'Remaining');
    const colCount = hdr.length;
    const pad = arr => { while (arr.length < colCount) arr.push(''); return arr; };

    const rows = [
      pad(['Tagbilaran Bible Training Ministries, Inc.']),
      pad(['BIBLE TRAINING CENTER - TAGBILARAN CHURCH']),
      pad(['College, Youth and Professionals (COYAP)']),
      pad(['ANNUAL FINANCIAL ACCOUNTABILITY & NET SUMMARY']),
      pad([`For the Calendar Year ${selYear}`]),
      pad(['In Philippine Peso (PHP) · Youth General Fund & Church Allowance Separated']),
      pad([]),
      pad(['KEY METRICS', 'Youth Offerings Inflow', annual.totalInflowYear, 'General Fund Expenses', annual.totalExpensesYear, 'TOTAL NET OF THE YEAR', annual.totalNetOfYear, 'Closing Balance', annual.finalEndingCash, 'Remaining Allowance', annual.allowanceLeftYear]),
      pad([]),
      hdr
    ];

    annual.months.forEach(m => {
      const row = [
        m.fullName + (m.flagged ? ' ⚠' : ''),
        m.begCash,
        m.fridayOfferings,
        m.jointFellowship,
        m.totalInflow,
        m.generalExpenses ? -m.generalExpenses : 0,
        m.monthlyNet
      ];
      if (includeAdj) row.push(m.adjustment || 0);
      row.push(
        m.endingCash,
        m.allowanceIn,
        m.allowanceSpentRaw == null ? '' : Number(m.allowanceSpentRaw),
        m.allowanceLeft == null ? '—' : m.allowanceLeft,
        m.allowanceRemaining
      );
      rows.push(row);
    });

    const totRow = [
      `TOTAL FOR ${selYear}`,
      annual.openingBalance,
      annual.totalFriday,
      annual.totalJF,
      annual.totalInflowYear,
      annual.totalGeneralExpenses ? -annual.totalGeneralExpenses : 0,
      annual.totalNetOfYear
    ];
    if (includeAdj) totRow.push(annual.totalAdjustments);
    totRow.push(
      annual.finalEndingCash,
      annual.totalAllocIn,
      annual.totalAllowanceSpent,
      annual.allowanceLeftYear,
      annual.allowanceLeftYear
    );
    rows.push(totRow);

    if (!annual.check.ok) {
      rows.push(pad([]));
      rows.push(pad([`CHECK FAILED: Closing balance ${peso(annual.check.closing)} != Opening ${peso(annual.openingBalance)} + Net ${peso(annual.totalNetOfYear)} + Adjustments ${peso(annual.totalAdjustments)} = ${peso(annual.check.expectedClosing)}`]));
    }

    if (annual.flags.length) {
      rows.push(pad([]));
      rows.push(pad([`Flagged Months — Expenses above 2× Average Monthly Expense (Avg ${peso(annual.avgExpense)}, Threshold ${peso(annual.flagThreshold)})`]));
      rows.push(pad(['Month', 'Expenses', 'Note / Category']));
      annual.flags.forEach(f => {
        const mObj = annual.months.find(m => m.ym === f.ym) || {};
        rows.push(pad([f.month, f.expenses, mObj.note || '']));
      });
    }

    if (annual.spentUnsupported) {
      rows.push(pad([]));
      rows.push(pad([`WARNING: Monthly breakdown missing – total spent ${peso(annual.allowanceTotals.totalSpent)} is unsupported by monthly data.`]));
    }

    if (annual.reportedAny) {
      rows.push(pad([]));
      rows.push(pad(['Reconciliation — Reported vs Computed Beginning Balances']));
      if (annual.recon.length) {
        rows.push(pad(['Month', 'Reported Beginning', 'Expected', 'Difference']));
        annual.recon.forEach(r => rows.push(pad([r.month, r.reported, r.expected, r.diff])));
        rows.push(pad(['Total Difference', '', '', annual.reconSummary.total]));
      } else {
        rows.push(pad(['Reported beginning balances agree with the computed chain.']));
      }
      rows.push(pad(['Documented Adjustments', annual.reconSummary.adjustments, 'Total Unexplained Difference', annual.reconSummary.unexplained]));
    }

    rows.push(pad([]));
    rows.push(pad(['Annual Net Cash Accountability', 'Amount', '', 'Monthly Allowance Status', 'Amount']));
    rows.push(pad(['Opening Balance', annual.openingBalance, '', 'Allowance Allocated / Received', annual.totalAllocIn]));
    rows.push(pad([`Total Inflows for ${selYear}`, annual.totalInflowYear, '', 'Allowance Disbursed / Spent', annual.totalAllowanceSpent ? -annual.totalAllowanceSpent : 0]));
    rows.push(pad([`Total Expenses for ${selYear}`, annual.totalExpensesYear ? -annual.totalExpensesYear : 0, '', 'ALLOWANCE REMAINING LEFT', annual.allowanceLeftYear]));
    rows.push(pad(['TOTAL NET OF THE YEAR', annual.totalNetOfYear, '', annual.reportedTotalSpent != null ? 'Reported Total Spent' : '', annual.reportedTotalSpent != null ? annual.reportedTotalSpent : '']));
    rows.push(pad(['Closing Balance', annual.finalEndingCash]));
    rows.push(pad([]));
    rows.push(pad(['Prepared by:', sig.preparedName, '', 'Noted:', sig.notedName]));
    rows.push(pad(['', sig.preparedTitle, '', '', sig.notedTitle]));
    rows.push(pad([]));
    rows.push(pad(['Recommending Approval:', sig.recommendingName, '', 'Approved by:', sig.approvedName]));
    rows.push(pad(['', sig.recommendingTitle, '', '', sig.approvedTitle]));

    return { annual, rows, colCount };
  }

  function makeXlsxSheet(aoa, colWidths, mergeHeaderCols) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = colWidths.map(w => ({ wch: w }));
    if (mergeHeaderCols > 1) {
      ws['!merges'] = [0, 1, 2, 3, 4, 5].map(r => ({ s: { r, c: 0 }, e: { r, c: mergeHeaderCols - 1 } }));
    }
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cell && cell.t === 'n') cell.z = '#,##0.00';
      }
    }
    return ws;
  }

  function txSheetRows(txList) {
    return [
      ['Date', 'Type', 'Fund', 'Category', 'Notes', 'Amount', 'Receipt'],
      ...txList.map(t => [
        t.date,
        t.type,
        (isAllowanceInc(t) || isAllowanceExp(t)) ? 'Allowance' : 'General',
        t.category || '',
        cleanNotes(t.notes || ''),
        t.type === 'expense' ? -Number(t.amount) : Number(t.amount),
        t.receipt ? 'Yes' : ''
      ])
    ];
  }

  function exportHtmlXlsFallback(filename, sheets) {
    const e = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    let h = `<html><head><meta charset="utf-8"><style>body{font-family:Calibri,Arial,sans-serif;font-size:12px}table{border-collapse:collapse;margin-bottom:20px}td,th{border:1px solid #d1d5db;padding:4px 8px}td.num{text-align:right;mso-number-format:"#,##0.00"}</style></head><body>`;
    sheets.forEach(s => {
      h += `<h3>${e(s.name)}</h3><table>` + s.rows.map(row =>
        '<tr>' + row.map(v => typeof v === 'number'
          ? `<td class="num">${v.toFixed(2)}</td>`
          : `<td>${e(v)}</td>`
        ).join('') + '</tr>'
      ).join('') + '</table>';
    });
    download(filename.replace(/\.xlsx$/i, '.xls'), h + '</body></html>', 'application/vnd.ms-excel');
  }

  window.exportExcel = function (opts) {
    const allLive = live().sort((a, b) => a.date.localeCompare(b.date));
    const curYear = String(new Date().getFullYear());
    const years = [...new Set([...allLive.map(t => t.date.slice(0, 4)), curYear])].sort().reverse();
    const activeMode = (opts && opts.mode) || (typeof view !== 'undefined' && view === 'reports' && typeof reportMode !== 'undefined' ? reportMode : 'annual');
    const selYear = (opts && opts.year) || (typeof reportYear !== 'undefined' && reportYear) || years[0] || curYear;
    const selYm = (opts && opts.ym) || (typeof reportMonth !== 'undefined' && reportMonth) || (typeof getActiveMonth === 'function' ? getActiveMonth() : `${selYear}-01`);

    const sheets = [];
    let filename = '';

    if (activeMode === 'monthly') {
      const mData = buildMonthlySheetRows(selYm);
      if (!mData) return alert('Could not build monthly report.');
      sheets.push({ name: mData.r.monthTitle.slice(0, 31), rows: mData.rows, cols: [48, 16, 16, 18], merge: 4 });
      sheets.push({ name: 'Transactions', rows: txSheetRows(mData.r.mApproved), cols: [12, 10, 12, 24, 34, 14, 10], merge: 0 });
      filename = `BTC-Youth-Monthly-Report-${selYm}.xlsx`;
    } else {
      const aData = buildAnnualSheetRows(selYear);
      const annCols = [18, 16, 15, 15, 15, 15, 15];
      if (aData.colCount === 13) annCols.push(14);
      annCols.push(17, 15, 15, 15, 16);
      sheets.push({ name: `Annual Summary ${selYear}`.slice(0, 31), rows: aData.rows, cols: annCols, merge: aData.colCount });

      const yearTxs = allLive.filter(t => t.date.startsWith(selYear));
      const monthsWithData = [...new Set(yearTxs.map(t => ymOf(t.date)))].sort();
      monthsWithData.forEach(ym => {
        const mData = buildMonthlySheetRows(ym);
        if (mData) {
          sheets.push({ name: `${mData.r.shortMonth} ${selYear}`.slice(0, 31), rows: mData.rows, cols: [48, 16, 16, 18], merge: 4 });
        }
      });
      sheets.push({ name: `Transactions ${selYear}`.slice(0, 31), rows: txSheetRows(yearTxs.length ? yearTxs : allLive), cols: [12, 10, 12, 24, 34, 14, 10], merge: 0 });
      filename = `BTC-Youth-Annual-Report-${selYear}.xlsx`;
    }

    if (typeof XLSX !== 'undefined' && XLSX.utils && XLSX.writeFile) {
      const wb = XLSX.utils.book_new();
      sheets.forEach(s => {
        const cleanName = s.name.replace(/[\\/*?:[\]]/g, '-').slice(0, 31);
        XLSX.utils.book_append_sheet(wb, makeXlsxSheet(s.rows, s.cols, s.merge), cleanName);
      });
      XLSX.writeFile(wb, filename);
      if (typeof showToast === 'function') showToast(`📊 Exported ${filename}`);
    } else {
      exportHtmlXlsFallback(filename, sheets);
      if (typeof showToast === 'function') showToast(`📊 Exported Excel report`);
    }
  };

  /* ---------- Backup / Restore ---------- */
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  window.backupData = function () {
    const skippedSlots = typeof getSkipReasons === 'function' ? getSkipReasons() : {};
    const data = { app: 'btc-youth', version: 1, exported: new Date().toISOString(), currency: S.currency, transactions: S.transactions, events: S.events, members: S.members, incomeCats: S.incomeCats, expenseCats: S.expenseCats, skippedSlots };
    download(`BTC-Youth-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
  };
  window.restoreData = function () {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const file = inp.files[0];
        if (!file) return;
        const d = JSON.parse(await file.text());
        if (d.app !== 'btc-youth' || !Array.isArray(d.transactions)) throw new Error('Not a valid BTC Youth JSON backup file.');

        const txs = d.transactions || [];
        const evs = d.events || [];
        const mems = d.members || [];

        if (typeof sb === 'undefined') {
          if (!confirm(`Restore "${file.name}"?\n\nThis will replace current local data with ${txs.length} transactions, ${evs.length} events, and ${mems.length} members.`)) return;
          Object.assign(S, { currency: d.currency || S.currency, transactions: txs, events: evs, members: mems, incomeCats: d.incomeCats || S.incomeCats, expenseCats: d.expenseCats || S.expenseCats });
          if (d.skippedSlots && typeof d.skippedSlots === 'object') {
            localStorage.setItem('btc-skipped-slots', JSON.stringify(d.skippedSlots));
          }
          save();
          if (typeof showToast === 'function') showToast(`✔ Restored ${txs.length} transactions`);
          return;
        }

        // Cloud (Supabase) import modal: Merge or Replace
        openModal(`<h2>♻️ Import Backup (JSON)</h2>
          <p class="mute" style="margin-bottom:10px">Loaded <b>${esc(file.name)}</b>:</p>
          <div style="background:rgba(255,255,255,.05);padding:12px 14px;border-radius:12px;font-size:13px;margin-bottom:14px">
            • <b>${txs.length}</b> transactions<br>
            • <b>${evs.length}</b> events<br>
            • <b>${mems.length}</b> members
          </div>
          <p class="mute" id="json-imp-status" style="margin-bottom:12px">Choose how to import into your Supabase database:</p>
          <div style="display:grid;gap:10px">
            <button type="button" class="btn" id="json-imp-merge" style="background:linear-gradient(135deg,#06b6d4,#3b82f6)">➕ Merge (Add new entries, skip duplicates)</button>
            <button type="button" class="btn alt" id="json-imp-replace">🔄 Replace All Cloud Data with Backup</button>
            <button type="button" class="btn ghost" onclick="closeModal()">Cancel</button>
          </div>`);

        const runCloudImport = async (replaceAll) => {
          const st = document.getElementById('json-imp-status');
          const b1 = document.getElementById('json-imp-merge');
          const b2 = document.getElementById('json-imp-replace');
          if (b1) b1.disabled = true;
          if (b2) b2.disabled = true;
          try {
            if (replaceAll) {
              if (!confirm('Replace ALL current Supabase transactions, events, and members with this backup?')) {
                if (b1) b1.disabled = false;
                if (b2) b2.disabled = false;
                return;
              }
              if (st) st.textContent = 'Clearing existing cloud data…';
              await sb.from('audit_log').delete().not('id', 'is', null);
              await sb.from('transactions').delete().not('id', 'is', null);
              await sb.from('events').delete().not('id', 'is', null);
              await sb.from('members').delete().not('id', 'is', null);
              const { data: leftover } = await sb.from('transactions').select('id').neq('status', 'void');
              if (leftover && leftover.length) {
                await sb.from('transactions').update({ status: 'void' }).in('id', leftover.map(r => r.id));
              }
            }

            if (st) st.textContent = 'Importing categories, events, and members…';
            // Categories
            for (const [type, mine, theirs] of [['income', S.incomeCats, d.incomeCats || []], ['expense', S.expenseCats, d.expenseCats || []]]) {
              const add = theirs.filter(c => c && !mine.includes(c));
              if (add.length) await sb.from('categories').insert(add.map(name => ({ type, name })));
            }

            // Events
            const evMap = {};
            const existingEvByName = Object.fromEntries((replaceAll ? [] : S.events).map(e => [e.name.toLowerCase(), e.id]));
            for (const e of evs) {
              const hit = existingEvByName[String(e.name || '').toLowerCase()];
              if (hit) { evMap[e.id] = hit; continue; }
              const res = await sb.from('events').insert({ name: e.name, budget: Number(e.budget) || 0 }).select('id').single();
              if (res.error) throw res.error;
              evMap[e.id] = res.data.id;
            }

            // Members
            const memMap = {};
            const existingMemByName = Object.fromEntries((replaceAll ? [] : S.members).map(m => [m.name.toLowerCase(), m.id]));
            for (const m of mems) {
              const hit = existingMemByName[String(m.name || '').toLowerCase()];
              if (hit) { memMap[m.id] = hit; continue; }
              const res = await sb.from('members').insert({ name: m.name, contact: m.contact || '', monthly: Number(m.monthly) || 0, due: Number(m.due) || 0 }).select('id').single();
              if (res.error) throw res.error;
              memMap[m.id] = res.data.id;
            }

            // Transactions
            const dupKey = t => [t.type, t.date, Number(t.amount).toFixed(2), t.category || ''].join('|');
            const have = replaceAll ? new Set() : new Set(S.transactions.filter(t => t.status !== 'void').map(dupKey));
            const rows = [];
            for (const t of txs) {
              if (!t.date || !(Number(t.amount) > 0) || t.status === 'void') continue;
              if (!replaceAll && have.has(dupKey(t))) continue;
              let notes = t.notes || '';
              if (t.fund === 'allowance' && !notes.includes('[Allowance]')) {
                notes = notes ? `[Allowance] ${notes}` : '[Allowance]';
              }
              rows.push({
                type: t.type === 'expense' ? 'expense' : 'income',
                date: t.date,
                amount: Number(t.amount),
                category: t.category || (t.type === 'expense' ? 'Other' : 'Offering'),
                event_id: evMap[t.eventId] || null,
                member_id: memMap[t.memberId] || null,
                notes,
                status: 'approved'
              });
            }

            if (st) st.textContent = `Uploading ${rows.length} transactions…`;
            const uploadedIds = [];
            for (let i = 0; i < rows.length; i += 100) {
              const chunk = rows.slice(i, i + 100);
              const res = await sb.from('transactions').insert(chunk).select('id');
              if (res.error) throw res.error;
              if (res.data) uploadedIds.push(...res.data.map(r => r.id));
            }
            if (uploadedIds.length && typeof window.recordUploadBatch === 'function') {
              window.recordUploadBatch(uploadedIds, `JSON Backup (${uploadedIds.length})`);
            }

            if (d.skippedSlots && typeof d.skippedSlots === 'object') {
              localStorage.setItem('btc-skipped-slots', JSON.stringify(d.skippedSlots));
              if (typeof window.onPrefsChanged === 'function') window.onPrefsChanged();
            }
            if (d.currency) {
              S.currency = d.currency;
              localStorage.setItem('btc-cloud-currency', d.currency);
            }
            closeModal();
            if (typeof refresh === 'function') await refresh();
            if (typeof showToast === 'function') showToast(`✔ Imported ${rows.length} transactions from backup`);
          } catch (err) {
            if (st) { st.style.color = 'var(--bad)'; st.textContent = 'Import failed: ' + (err.message || err); }
            if (b1) b1.disabled = false;
            if (b2) b2.disabled = false;
          }
        };

        document.getElementById('json-imp-merge').onclick = () => runCloudImport(false);
        document.getElementById('json-imp-replace').onclick = () => runCloudImport(true);
      } catch (err) { alert('Could not restore: ' + err.message); }
    };
    inp.click();
  };

  /* ---------- Install app (PWA) ---------- */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
  window.installApp = async function () {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; return; }
    if (window.matchMedia('(display-mode: standalone)').matches) return alert('The app is already installed.');
    openModal(`<h2>📲 Install on your phone</h2>
      <p class="mute" style="margin:8px 0">Open this site in your phone browser, then:</p>
      <p><b>Android (Chrome):</b> tap ⋮ menu → <b>Install app</b> / <b>Add to Home screen</b>.</p>
      <p style="margin-top:8px"><b>iPhone (Safari):</b> tap Share ⬆ → <b>Add to Home Screen</b>.</p>
      <p class="mute" style="margin-top:10px;font-size:12px">Installing needs the site to be opened over https (or localhost).</p>
      <div class="row" style="margin-top:16px"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
  };
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol))
    navigator.serviceWorker.register('sw.js').catch(() => { });

  /* Tools are now presented inside the clean "Tools & Data" modal in app-core.js */
})();
