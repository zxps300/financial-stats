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

  /* ---------- Excel export (Styled .xlsx via ExcelJS matching official COYAP sheet 1-to-1) ---------- */
  const EXCELJS_CDN = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  function ensureExcelJS() {
    if (typeof window.ExcelJS !== 'undefined') return Promise.resolve(window.ExcelJS);
    return new Promise(resolve => {
      const existing = document.querySelector(`script[src*="exceljs"]`);
      if (existing && window.ExcelJS) return resolve(window.ExcelJS);
      const s = document.createElement('script');
      s.src = EXCELJS_CDN;
      s.onload = () => resolve(window.ExcelJS || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }

  const CUR_FMT = '₱#,##0.00;-₱#,##0.00;"₱0.00"';
  const SIGN_FMT = '+₱#,##0.00;-₱#,##0.00;"₱0.00"';
  const C = {
    ink: 'FF111827',
    mute: 'FF475569',
    teal: 'FF0284C7',
    tealBorder: 'FF0EA5E9',
    tealFill: 'FFF0F9FF',
    green: 'FF059669',
    red: 'FFDC2626',
    line: 'FF334155',
    lightLine: 'FFE2E8F0',
    headFill: 'FFF1F5F9',
    warnFill: 'FFFEFCE8',
    warnBorder: 'FFCA8A04'
  };
  const F = (opts = {}) => ({ name: 'Calibri', size: opts.size || 10.5, bold: !!opts.bold, italic: !!opts.italic, color: { argb: opts.color || C.ink } });

  function addStyledMonthlySheet(wb, ym, tabName) {
    const r = typeof window.getMonthlyReportData === 'function' ? window.getMonthlyReportData(ym) : null;
    if (!r) return null;
    const cleanTab = (tabName || r.monthTitle).replace(/[\\/*?:[\]]/g, '-').slice(0, 31);
    const ws = wb.addWorksheet(cleanTab, {
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true, margins: { left: 0.45, right: 0.45, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
    });
    ws.columns = [{ width: 48 }, { width: 15 }, { width: 15 }, { width: 17 }];

    let rowIdx = 1;
    const putMergedHeader = (text, fontOpts, height) => {
      const row = ws.getRow(rowIdx);
      ws.mergeCells(rowIdx, 1, rowIdx, 4);
      const cell = row.getCell(1);
      cell.value = text;
      cell.font = F(fontOpts);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (height) row.height = height;
      rowIdx++;
    };

    // Official COYAP 6-line Header
    putMergedHeader('Tagbilaran Bible Training Ministries, Inc.', { size: 10.5 }, 17);
    putMergedHeader('BIBLE TRAINING CENTER - TAGBILARAN CHURCH', { size: 13.5, bold: true }, 21);
    putMergedHeader('College, Youth and Professionals (COYAP)', { size: 11, bold: true }, 18);
    putMergedHeader('Cash Accountability Report', { size: 12.5, bold: true }, 22);
    putMergedHeader(`As of ${r.monthTitle}`, { size: 10.5, bold: true }, 17);
    putMergedHeader('In Philippine Peso', { size: 9.5, italic: true, color: C.mute }, 16);
    ws.getRow(rowIdx++).height = 10;

    // Beginning Balance
    const addLine = (a, b, c, d, opts = {}) => {
      const row = ws.getRow(rowIdx);
      const vals = [a, b, c, d];
      vals.forEach((v, i) => {
        if (v !== '' && v != null) {
          const cell = row.getCell(i + 1);
          cell.value = v;
          if (typeof v === 'number') {
            cell.numFmt = opts.numFmt || CUR_FMT;
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          } else {
            cell.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle', wrapText: i === 0 };
          }
          cell.font = F(opts.font || {});
        }
      });
      if (opts.aFont) row.getCell(1).font = F(opts.aFont);
      if (opts.bFont) row.getCell(2).font = F(opts.bFont);
      if (opts.cFont) row.getCell(3).font = F(opts.cFont);
      if (opts.dFont) row.getCell(4).font = F(opts.dFont);
      if (opts.cBorder) row.getCell(3).border = opts.cBorder;
      if (opts.dBorder) row.getCell(4).border = opts.dBorder;
      if (opts.height) row.height = opts.height;
      return rowIdx++;
    };

    addLine('Cash on Hand - Beginning Balance', '', '', '', { aFont: { bold: true }, height: 19 });
    addLine('    Youth Funds from Church', '', '', '', { height: 17 });
    addLine('    Youth Night Offerings', '', 0, '', { numFmt: '#,##0.00', height: 17 });
    addLine('', '', '', r.begBal, {
      dFont: { bold: true },
      cBorder: { bottom: { style: 'thin', color: { argb: C.line } } },
      height: 18
    });
    ws.getRow(rowIdx++).height = 8;

    // Add: Offerings
    addLine('Add: Offerings', '', '', '', { aFont: { bold: true, color: C.teal }, height: 19 });
    addLine('    Youth Night Offerings', '', '', '', { aFont: { bold: true }, height: 18 });
    r.ynSlotRows.forEach(s => {
      const label = `        ${s.label}${s.reason ? ` (${s.reason})` : ''}`;
      addLine(label, s.amount != null ? s.amount : '—', '', '', {
        bFont: s.amount == null ? { color: C.mute } : {},
        height: 17
      });
    });
    addLine('', '', r.totalYN, '', {
      cFont: { bold: true },
      cBorder: { top: { style: 'thin', color: { argb: C.line } }, bottom: { style: 'thin', color: { argb: C.line } } },
      height: 18
    });
    addLine(`    Joint Fellowship Offerings${r.jfSkipReason ? ` (${r.jfSkipReason})` : ''}`, '', r.totalJF ? r.totalJF : '—', r.totalOfferings, {
      cFont: r.totalJF ? {} : { color: C.mute },
      dFont: { bold: true },
      dBorder: { bottom: { style: 'thin', color: { argb: C.line } } },
      height: 18
    });
    r.otherInc.forEach(t => {
      addLine(`    ${t.category} (${t.date})`, '', t.amount, '', { height: 17 });
    });

    // Total Cash on Hand
    addLine('Total Cash on Hand (Youth General Fund)', '', '', r.totalCashOnHand, {
      aFont: { bold: true },
      dFont: { bold: true, size: 11 },
      dBorder: { top: { style: 'thin', color: { argb: C.line } } },
      height: 21
    });
    ws.getRow(rowIdx++).height = 6;

    // Less: General Fund Expenses
    addLine('Less: Expenses (Youth General Fund)', '', '', '', { aFont: { bold: true, color: C.red }, height: 19 });
    if (r.genExpList.length) {
      r.genExpList.forEach(t => {
        const noteStr = cleanNotes(t.notes);
        const label = `        ${t.category} (${t.date}${noteStr ? ' · ' + noteStr : ''})`;
        addLine(label, t.amount, '', '', { height: label.length > 52 ? 28 : 18 });
      });
    } else {
      addLine('        None recorded', 0, '', '', { aFont: { color: C.mute }, bFont: { color: C.mute }, numFmt: '#,##0.00', height: 17 });
    }
    addLine('    Total General Fund Expenses', '', '', -r.totalGenExp, {
      aFont: { bold: true },
      dFont: { bold: true, color: C.red },
      dBorder: { bottom: { style: 'thin', color: { argb: C.line } } },
      height: 19
    });

    // NET CASH ON HAND
    addLine('NET CASH ON HAND (YOUTH GENERAL FUND)', '', '', r.netCashOnHand, {
      aFont: { bold: true, size: 11 },
      dFont: { bold: true, size: 11.5, color: r.netCashOnHand < 0 ? C.red : C.green },
      dBorder: { top: { style: 'thin', color: { argb: C.ink } }, bottom: { style: 'double', color: { argb: C.ink } } },
      height: 23
    });
    ws.getRow(rowIdx++).height = 12;

    // SEPARATED STATEMENT: MONTHLY ALLOWANCE (Framed Box!)
    const boxStart = rowIdx;
    ws.mergeCells(rowIdx, 1, rowIdx, 4);
    const sepTitleRow = ws.getRow(rowIdx);
    sepTitleRow.getCell(1).value = 'SEPARATED STATEMENT: ALLOCATION FROM CHURCH FUNDS (MONTHLY ALLOWANCE)';
    sepTitleRow.getCell(1).font = F({ bold: true, size: 10.5, color: C.teal });
    sepTitleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    sepTitleRow.height = 22;
    rowIdx++;

    addLine(`Allocation from Church Funds (${r.monthTitle})`, '', '', r.allow.allocated, {
      aFont: { bold: true },
      dFont: { bold: true, color: C.green },
      height: 19
    });
    addLine('Less: Allowance Expenses', '', '', '', { aFont: { bold: true, color: C.red }, height: 18 });
    if (r.allowExpList.length) {
      r.allowExpList.forEach(t => {
        const noteStr = cleanNotes(t.notes);
        const label = `        ${t.category} (Allowance · ${t.date}${noteStr ? ' · ' + noteStr : ''})`;
        addLine(label, t.amount, '', '', { height: label.length > 52 ? 28 : 18 });
      });
    } else {
      addLine('        None recorded', 0, '', '', { aFont: { color: C.mute }, bFont: { color: C.mute }, numFmt: '#,##0.00', height: 17 });
    }
    addLine('    Total Allowance Expenses', '', '', -r.allow.spent, {
      aFont: { bold: true },
      dFont: { bold: true, color: C.red },
      dBorder: { bottom: { style: 'thin', color: { argb: C.line } } },
      height: 19
    });
    addLine(`REMAINING ALLOWANCE BALANCE (${r.monthTitle.toUpperCase()})`, '', '', r.allow.remaining, {
      aFont: { bold: true, size: 10.5 },
      dFont: { bold: true, size: 11, color: r.allow.remaining >= 0 ? C.teal : C.red },
      dBorder: { top: { style: 'thin', color: { argb: C.ink } }, bottom: { style: 'double', color: { argb: C.ink } } },
      height: 22
    });
    ws.mergeCells(rowIdx, 1, rowIdx, 4);
    const footRow = ws.getRow(rowIdx);
    footRow.getCell(1).value = `${r.y} Cumulative Remaining Allowance: ${peso(r.yearAllow.remaining)}   |   Reference Combined Cash (Youth Fund + Monthly Allowance Left): ${peso(r.combinedCash)}`;
    footRow.getCell(1).font = F({ size: 9, color: C.mute });
    footRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    footRow.height = 20;
    const boxEnd = rowIdx;
    rowIdx++;

    // Apply light cyan fill & outer teal frame to the Separated Statement box
    for (let rr = boxStart; rr <= boxEnd; rr++) {
      for (let cc = 1; cc <= 4; cc++) {
        const cell = ws.getRow(rr).getCell(cc);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.tealFill } };
        const b = Object.assign({}, cell.border || {});
        if (rr === boxStart) b.top = { style: 'thin', color: { argb: C.tealBorder } };
        if (rr === boxEnd) b.bottom = { style: 'thin', color: { argb: C.tealBorder } };
        if (cc === 1) b.left = { style: 'thin', color: { argb: C.tealBorder } };
        if (cc === 4) b.right = { style: 'thin', color: { argb: C.tealBorder } };
        cell.border = b;
      }
    }

    // Official 4-Leader Signatory Block (exact visual match to screenshot!)
    ws.getRow(rowIdx++).height = 16;

    // Prepared by (left) & Noted (right)
    ws.mergeCells(rowIdx, 1, rowIdx, 2);
    ws.mergeCells(rowIdx, 3, rowIdx, 4);
    ws.getRow(rowIdx).getCell(1).value = 'Prepared by:';
    ws.getRow(rowIdx).getCell(1).font = F({ size: 10 });
    ws.getRow(rowIdx).getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(rowIdx).getCell(3).value = 'Noted:';
    ws.getRow(rowIdx).getCell(3).font = F({ size: 10 });
    ws.getRow(rowIdx).getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(rowIdx++).height = 18;
    ws.getRow(rowIdx++).height = 26; // space for signature

    ws.mergeCells(rowIdx, 1, rowIdx, 2);
    ws.mergeCells(rowIdx, 3, rowIdx, 4);
    ws.getRow(rowIdx).getCell(1).value = r.sig.preparedName;
    ws.getRow(rowIdx).getCell(1).font = F({ bold: true, size: 10.5 });
    ws.getRow(rowIdx).getCell(1).alignment = { horizontal: 'center', vertical: 'bottom' };
    ws.getRow(rowIdx).getCell(1).border = { bottom: { style: 'thin', color: { argb: C.line } } };
    ws.getRow(rowIdx).getCell(2).border = { bottom: { style: 'thin', color: { argb: C.line } } };
    ws.getRow(rowIdx).getCell(3).value = r.sig.notedName;
    ws.getRow(rowIdx).getCell(3).font = F({ bold: true, size: 10.5 });
    ws.getRow(rowIdx).getCell(3).alignment = { horizontal: 'center', vertical: 'bottom' };
    ws.getRow(rowIdx).getCell(3).border = { bottom: { style: 'thin', color: { argb: C.line } } };
    ws.getRow(rowIdx).getCell(4).border = { bottom: { style: 'thin', color: { argb: C.line } } };
    ws.getRow(rowIdx++).height = 19;

    ws.mergeCells(rowIdx, 1, rowIdx, 2);
    ws.mergeCells(rowIdx, 3, rowIdx, 4);
    ws.getRow(rowIdx).getCell(1).value = r.sig.preparedTitle;
    ws.getRow(rowIdx).getCell(1).font = F({ size: 9.5, color: C.mute });
    ws.getRow(rowIdx).getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
    ws.getRow(rowIdx).getCell(3).value = r.sig.notedTitle;
    ws.getRow(rowIdx).getCell(3).font = F({ size: 9.5, color: C.mute });
    ws.getRow(rowIdx).getCell(3).alignment = { horizontal: 'center', vertical: 'top' };
    ws.getRow(rowIdx++).height = 18;

    const addCenteredSig = (label, name, title) => {
      ws.getRow(rowIdx++).height = 10;
      ws.mergeCells(rowIdx, 1, rowIdx, 4);
      ws.getRow(rowIdx).getCell(1).value = label;
      ws.getRow(rowIdx).getCell(1).font = F({ size: 10 });
      ws.getRow(rowIdx).getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(rowIdx++).height = 18;
      ws.getRow(rowIdx++).height = 26;

      ws.mergeCells(rowIdx, 2, rowIdx, 3);
      ws.getRow(rowIdx).getCell(2).value = name;
      ws.getRow(rowIdx).getCell(2).font = F({ bold: true, size: 10.5 });
      ws.getRow(rowIdx).getCell(2).alignment = { horizontal: 'center', vertical: 'bottom' };
      ws.getRow(rowIdx).getCell(2).border = { bottom: { style: 'thin', color: { argb: C.line } } };
      ws.getRow(rowIdx).getCell(3).border = { bottom: { style: 'thin', color: { argb: C.line } } };
      ws.getRow(rowIdx++).height = 19;

      ws.mergeCells(rowIdx, 2, rowIdx, 3);
      ws.getRow(rowIdx).getCell(2).value = title;
      ws.getRow(rowIdx).getCell(2).font = F({ size: 9.5, color: C.mute });
      ws.getRow(rowIdx).getCell(2).alignment = { horizontal: 'center', vertical: 'top' };
      ws.getRow(rowIdx++).height = 18;
    };

    addCenteredSig('Recommending Approval', r.sig.recommendingName, r.sig.recommendingTitle);
    addCenteredSig('Approved by:', r.sig.approvedName, r.sig.approvedTitle);
    return r;
  }

  function addStyledAnnualSheet(wb, selYear) {
    const annual = getAnnualBreakdown(selYear);
    const sig = getSignatories();
    const includeAdj = annual.showAdj || Math.abs(annual.totalAdjustments) > 0.005;
    const hdr = ['Month', 'Beg. Youth Fund', 'Friday Offerings', 'Joint Fellowship', 'Youth Inflow', 'General Exp.', 'Youth Fund Net'];
    if (includeAdj) hdr.push('Adjustment');
    hdr.push('Ending Youth Fund', 'Allowance In', 'Allowance Out', 'Balance', 'Remaining');
    const colCount = hdr.length;
    const allowStartCol = includeAdj ? 10 : 9;

    const ws = wb.addWorksheet(`Annual Summary ${selYear}`.slice(0, 31), {
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.35, right: 0.35, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 } }
    });
    const widths = [15, 14, 13, 13, 14, 14, 14];
    if (includeAdj) widths.push(13);
    widths.push(15, 13, 13, 13, 14);
    ws.columns = widths.map(w => ({ width: w }));

    let rowIdx = 1;
    const putHeader = (text, fontOpts, height) => {
      const row = ws.getRow(rowIdx);
      ws.mergeCells(rowIdx, 1, rowIdx, colCount);
      row.getCell(1).value = text;
      row.getCell(1).font = F(fontOpts);
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      if (height) row.height = height;
      rowIdx++;
    };

    putHeader('Tagbilaran Bible Training Ministries, Inc.', { size: 10.5 }, 16);
    putHeader('BIBLE TRAINING CENTER - TAGBILARAN CHURCH', { size: 13.5, bold: true }, 20);
    putHeader('College, Youth and Professionals (COYAP)', { size: 11, bold: true }, 17);
    putHeader('ANNUAL FINANCIAL ACCOUNTABILITY & NET SUMMARY', { size: 12.5, bold: true, color: C.teal }, 21);
    putHeader(`For the Calendar Year ${selYear}`, { size: 10.5, bold: true }, 17);
    putHeader('In Philippine Peso (PHP) · Youth General Fund & Church Allowance Separated', { size: 9.5, italic: true, color: C.mute }, 16);
    ws.getRow(rowIdx++).height = 8;

    // Table Header
    const hRow = ws.getRow(rowIdx);
    hdr.forEach((h, i) => {
      const cell = hRow.getCell(i + 1);
      cell.value = h;
      const isAllowCol = i + 1 >= allowStartCol;
      cell.font = F({ bold: true, size: 9.5, color: isAllowCol ? C.teal : (h === 'Youth Inflow' ? C.green : h === 'General Exp.' ? C.red : C.ink) });
      cell.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isAllowCol ? C.tealFill : C.headFill } };
      cell.border = {
        top: { style: 'thin', color: { argb: C.line } },
        bottom: { style: 'thin', color: { argb: C.line } },
        left: i + 1 === allowStartCol ? { style: 'medium', color: { argb: C.tealBorder } } : undefined
      };
    });
    hRow.height = 24;
    rowIdx++;

    // 12 Month Rows
    annual.months.forEach(m => {
      const vals = [m.fullName + (m.flagged ? ' ⚠' : ''), m.begCash, m.fridayOfferings, m.jointFellowship, m.totalInflow, m.generalExpenses ? -m.generalExpenses : 0, m.monthlyNet];
      if (includeAdj) vals.push(m.adjustment || 0);
      vals.push(m.endingCash, m.allowanceIn, m.allowanceSpentRaw == null ? '' : Number(m.allowanceSpentRaw), m.allowanceLeft == null ? '—' : m.allowanceLeft, m.allowanceRemaining);
      const row = ws.getRow(rowIdx);
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        const isNetCol = i === 6;
        const isAdjCol = includeAdj && i === 7;
        let color = C.ink;
        if (i === 4) color = C.green;
        if (i === 5 && m.generalExpenses) color = C.red;
        if (isNetCol) color = m.monthlyNet > 0 ? C.green : m.monthlyNet < 0 ? C.red : C.ink;
        if (i + 1 === colCount) color = m.allowanceRemaining < 0 ? C.red : C.teal;
        cell.font = F({ size: 9.5, bold: i === 0 || isNetCol || i === 4 || i + 1 === colCount, color });
        if (typeof v === 'number') {
          cell.numFmt = (isNetCol || isAdjCol) ? SIGN_FMT : CUR_FMT;
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' };
        }
        cell.border = {
          bottom: { style: 'thin', color: { argb: C.lightLine } },
          left: i + 1 === allowStartCol ? { style: 'medium', color: { argb: C.tealBorder } } : undefined
        };
      });
      row.height = 18;
      rowIdx++;
    });

    // Total Row
    const totVals = [`TOTAL FOR ${selYear}`, annual.openingBalance, annual.totalFriday, annual.totalJF, annual.totalInflowYear, annual.totalGeneralExpenses ? -annual.totalGeneralExpenses : 0, annual.totalNetOfYear];
    if (includeAdj) totVals.push(annual.totalAdjustments);
    totVals.push(annual.finalEndingCash, annual.totalAllocIn, annual.totalAllowanceSpent, annual.allowanceLeftYear, annual.allowanceLeftYear);
    const tRow = ws.getRow(rowIdx);
    totVals.forEach((v, i) => {
      const cell = tRow.getCell(i + 1);
      cell.value = v;
      const isNetCol = i === 6;
      const isAdjCol = includeAdj && i === 7;
      let color = C.ink;
      if (i === 0) color = C.teal;
      if (i === 4 || i === (includeAdj ? 8 : 7)) color = C.green;
      if (i === 5 && annual.totalGeneralExpenses) color = C.red;
      if (isNetCol) color = annual.totalNetOfYear >= 0 ? C.green : C.red;
      if (i + 1 === colCount) color = annual.allowanceLeftYear >= 0 ? C.teal : C.red;
      cell.font = F({ size: 10, bold: true, color });
      if (typeof v === 'number') {
        cell.numFmt = (isNetCol || isAdjCol) ? SIGN_FMT : CUR_FMT;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i + 1 >= allowStartCol ? C.tealFill : C.headFill } };
      cell.border = {
        top: { style: 'thin', color: { argb: C.ink } },
        bottom: { style: 'double', color: { argb: C.ink } },
        left: i + 1 === allowStartCol ? { style: 'medium', color: { argb: C.tealBorder } } : undefined
      };
    });
    tRow.height = 22;
    rowIdx++;

    // Flagged Months
    if (annual.flags.length) {
      ws.getRow(rowIdx++).height = 8;
      ws.mergeCells(rowIdx, 1, rowIdx, colCount);
      const fr = ws.getRow(rowIdx);
      fr.getCell(1).value = `⚠ Flagged months — expenses above 2× the average monthly expense (average ${peso(annual.avgExpense)}, threshold ${peso(annual.flagThreshold)})`;
      fr.getCell(1).font = F({ bold: true, size: 9.5, color: C.ink });
      fr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.warnFill } };
      fr.height = 19;
      rowIdx++;
      annual.flags.forEach(f => {
        const note = (annual.months.find(m => m.ym === f.ym) || {}).note || '';
        ws.mergeCells(rowIdx, 1, rowIdx, colCount);
        const nr = ws.getRow(rowIdx);
        nr.getCell(1).value = `   • ${f.month}: ${peso(f.expenses)}${note ? ' — ' + note : ''}`;
        nr.getCell(1).font = F({ size: 9.5, color: C.red });
        nr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.warnFill } };
        nr.height = 17;
        rowIdx++;
      });
    }

    if (annual.spentUnsupported) {
      ws.getRow(rowIdx++).height = 6;
      ws.mergeCells(rowIdx, 1, rowIdx, colCount);
      const wr = ws.getRow(rowIdx);
      wr.getCell(1).value = `⚠ Monthly breakdown missing – total spent ${peso(annual.allowanceTotals.totalSpent)} is unsupported by monthly data.`;
      wr.getCell(1).font = F({ bold: true, size: 9.5, color: C.ink });
      wr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.warnFill } };
      wr.height = 18;
      rowIdx++;
    }

    // Reconciliation
    if (annual.reportedAny) {
      ws.getRow(rowIdx++).height = 10;
      ws.mergeCells(rowIdx, 1, rowIdx, colCount);
      ws.getRow(rowIdx).getCell(1).value = 'Reconciliation — reported vs computed beginning balances';
      ws.getRow(rowIdx).getCell(1).font = F({ bold: true, size: 10 });
      ws.getRow(rowIdx++).height = 18;
      if (annual.recon.length) {
        const rh = ws.getRow(rowIdx);
        ['Month', 'Reported Beginning', 'Expected', 'Difference'].forEach((t, i) => {
          rh.getCell(i + 1).value = t;
          rh.getCell(i + 1).font = F({ bold: true, size: 9.5 });
          rh.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headFill } };
          rh.getCell(i + 1).alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' };
        });
        rh.height = 18;
        rowIdx++;
        annual.recon.forEach(rc => {
          const rr = ws.getRow(rowIdx);
          [rc.month, rc.reported, rc.expected, rc.diff].forEach((v, i) => {
            rr.getCell(i + 1).value = v;
            rr.getCell(i + 1).font = F({ size: 9.5, bold: i === 3, color: i === 3 ? (rc.diff >= 0 ? C.green : C.red) : C.ink });
            if (typeof v === 'number') {
              rr.getCell(i + 1).numFmt = i === 3 ? SIGN_FMT : CUR_FMT;
              rr.getCell(i + 1).alignment = { horizontal: 'right', vertical: 'middle' };
            }
          });
          rr.height = 17;
          rowIdx++;
        });
        const tr = ws.getRow(rowIdx);
        tr.getCell(1).value = 'Total Difference';
        tr.getCell(1).font = F({ bold: true, size: 9.5 });
        tr.getCell(4).value = annual.reconSummary.total;
        tr.getCell(4).numFmt = SIGN_FMT;
        tr.getCell(4).font = F({ bold: true, size: 9.5, color: annual.reconSummary.total >= 0 ? C.green : C.red });
        tr.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
        tr.height = 18;
        rowIdx++;
      }
      ws.mergeCells(rowIdx, 1, rowIdx, colCount);
      ws.getRow(rowIdx).getCell(1).value = `Documented adjustments: ${signedMoney(annual.reconSummary.adjustments)}   |   Total unexplained difference: ${signedMoney(annual.reconSummary.unexplained)}`;
      ws.getRow(rowIdx).getCell(1).font = F({ size: 9.5, color: C.mute });
      ws.getRow(rowIdx++).height = 18;
    }

    // Side-by-side Annual Net Cash Accountability & Monthly Allowance Status boxes
    ws.getRow(rowIdx++).height = 10;
    const sumStart = rowIdx;
    const rightCol = Math.min(7, colCount - 4);
    const putSummaryPair = (lLabel, lVal, rLabel, rVal, opts = {}) => {
      const row = ws.getRow(rowIdx);
      ws.mergeCells(rowIdx, 1, rowIdx, 3);
      row.getCell(1).value = lLabel;
      row.getCell(1).font = F(opts.lFont || { size: 9.5 });
      if (lVal !== '' && lVal != null) {
        row.getCell(4).value = lVal;
        row.getCell(4).numFmt = opts.lFmt || CUR_FMT;
        row.getCell(4).font = F(opts.lValFont || { bold: true, size: 9.5 });
        row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
      }
      if (rLabel) {
        ws.mergeCells(rowIdx, rightCol, rowIdx, rightCol + 2);
        row.getCell(rightCol).value = rLabel;
        row.getCell(rightCol).font = F(opts.rFont || { size: 9.5 });
        if (rVal !== '' && rVal != null) {
          row.getCell(rightCol + 3).value = rVal;
          row.getCell(rightCol + 3).numFmt = opts.rFmt || CUR_FMT;
          row.getCell(rightCol + 3).font = F(opts.rValFont || { bold: true, size: 9.5 });
          row.getCell(rightCol + 3).alignment = { horizontal: 'right', vertical: 'middle' };
        }
      }
      row.height = 18;
      rowIdx++;
    };
    putSummaryPair('Annual Net Cash Accountability', '', 'Monthly Allowance Status', '', {
      lFont: { bold: true, color: C.teal, size: 10 },
      rFont: { bold: true, color: C.teal, size: 10 }
    });
    putSummaryPair('Opening Balance', annual.openingBalance, 'Allowance Allocated / Received', annual.totalAllocIn);
    putSummaryPair(`Total Inflows for ${selYear}`, annual.totalInflowYear, 'Allowance Disbursed / Spent', annual.totalAllowanceSpent ? -annual.totalAllowanceSpent : 0, {
      rValFont: { bold: true, size: 9.5, color: C.red }
    });
    putSummaryPair(`Total Expenses for ${selYear}`, annual.totalExpensesYear ? -annual.totalExpensesYear : 0, 'ALLOWANCE REMAINING LEFT', annual.allowanceLeftYear, {
      lValFont: { bold: true, size: 9.5, color: C.red },
      rFont: { bold: true, size: 10 },
      rValFont: { bold: true, size: 10, color: annual.allowanceLeftYear >= 0 ? C.green : C.red }
    });
    putSummaryPair('TOTAL NET OF THE YEAR', annual.totalNetOfYear, annual.reportedTotalSpent != null ? 'Reported Total Spent' : '', annual.reportedTotalSpent != null ? annual.reportedTotalSpent : '', {
      lFont: { bold: true, size: 10 },
      lValFont: { bold: true, size: 10, color: annual.totalNetOfYear >= 0 ? C.green : C.red },
      lFmt: SIGN_FMT
    });
    putSummaryPair('Closing Balance', annual.finalEndingCash, '', '');
    const sumEnd = rowIdx - 1;
    for (let rr = sumStart; rr <= sumEnd; rr++) {
      for (let cc = 1; cc <= 4; cc++) ws.getRow(rr).getCell(cc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headFill } };
      for (let cc = rightCol; cc <= rightCol + 3; cc++) ws.getRow(rr).getCell(cc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.tealFill } };
    }

    // 4-Leader Signatories
    ws.getRow(rowIdx++).height = 14;
    const mid = Math.floor(colCount / 2);
    ws.mergeCells(rowIdx, 1, rowIdx, mid);
    ws.mergeCells(rowIdx, mid + 1, rowIdx, colCount);
    ws.getRow(rowIdx).getCell(1).value = 'Prepared by:';
    ws.getRow(rowIdx).getCell(1).alignment = { horizontal: 'center' };
    ws.getRow(rowIdx).getCell(mid + 1).value = 'Noted:';
    ws.getRow(rowIdx).getCell(mid + 1).alignment = { horizontal: 'center' };
    ws.getRow(rowIdx++).height = 17;
    ws.getRow(rowIdx++).height = 24;

    ws.mergeCells(rowIdx, 2, rowIdx, mid - 1);
    ws.mergeCells(rowIdx, mid + 2, rowIdx, colCount - 1);
    ws.getRow(rowIdx).getCell(2).value = sig.preparedName;
    ws.getRow(rowIdx).getCell(2).font = F({ bold: true });
    ws.getRow(rowIdx).getCell(2).alignment = { horizontal: 'center' };
    for (let c = 2; c <= mid - 1; c++) ws.getRow(rowIdx).getCell(c).border = { bottom: { style: 'thin', color: { argb: C.line } } };
    ws.getRow(rowIdx).getCell(mid + 2).value = sig.notedName;
    ws.getRow(rowIdx).getCell(mid + 2).font = F({ bold: true });
    ws.getRow(rowIdx).getCell(mid + 2).alignment = { horizontal: 'center' };
    for (let c = mid + 2; c <= colCount - 1; c++) ws.getRow(rowIdx).getCell(c).border = { bottom: { style: 'thin', color: { argb: C.line } } };
    ws.getRow(rowIdx++).height = 18;

    ws.mergeCells(rowIdx, 2, rowIdx, mid - 1);
    ws.mergeCells(rowIdx, mid + 2, rowIdx, colCount - 1);
    ws.getRow(rowIdx).getCell(2).value = sig.preparedTitle;
    ws.getRow(rowIdx).getCell(2).font = F({ size: 9, color: C.mute });
    ws.getRow(rowIdx).getCell(2).alignment = { horizontal: 'center' };
    ws.getRow(rowIdx).getCell(mid + 2).value = sig.notedTitle;
    ws.getRow(rowIdx).getCell(mid + 2).font = F({ size: 9, color: C.mute });
    ws.getRow(rowIdx).getCell(mid + 2).alignment = { horizontal: 'center' };
    ws.getRow(rowIdx++).height = 16;

    const addCenterAnnSig = (label, name, title) => {
      const c1 = Math.max(2, mid - 1), c2 = Math.min(colCount - 1, mid + 2);
      ws.getRow(rowIdx++).height = 8;
      ws.mergeCells(rowIdx, 1, rowIdx, colCount);
      ws.getRow(rowIdx).getCell(1).value = label;
      ws.getRow(rowIdx).getCell(1).alignment = { horizontal: 'center' };
      ws.getRow(rowIdx++).height = 17;
      ws.getRow(rowIdx++).height = 24;
      ws.mergeCells(rowIdx, c1, rowIdx, c2);
      ws.getRow(rowIdx).getCell(c1).value = name;
      ws.getRow(rowIdx).getCell(c1).font = F({ bold: true });
      ws.getRow(rowIdx).getCell(c1).alignment = { horizontal: 'center' };
      for (let c = c1; c <= c2; c++) ws.getRow(rowIdx).getCell(c).border = { bottom: { style: 'thin', color: { argb: C.line } } };
      ws.getRow(rowIdx++).height = 18;
      ws.mergeCells(rowIdx, c1, rowIdx, c2);
      ws.getRow(rowIdx).getCell(c1).value = title;
      ws.getRow(rowIdx).getCell(c1).font = F({ size: 9, color: C.mute });
      ws.getRow(rowIdx).getCell(c1).alignment = { horizontal: 'center' };
      ws.getRow(rowIdx++).height = 16;
    };
    addCenterAnnSig('Recommending Approval', sig.recommendingName, sig.recommendingTitle);
    addCenterAnnSig('Approved by:', sig.approvedName, sig.approvedTitle);
    return annual;
  }

  function addTransactionsSheet(wb, name, txList) {
    const ws = wb.addWorksheet(name.replace(/[\\/*?:[\]]/g, '-').slice(0, 31));
    ws.columns = [{ width: 13 }, { width: 10 }, { width: 12 }, { width: 24 }, { width: 34 }, { width: 15 }, { width: 10 }];
    const hRow = ws.addRow(['Date', 'Type', 'Fund', 'Category', 'Notes', 'Amount', 'Receipt']);
    hRow.eachCell(c => {
      c.font = F({ bold: true, size: 10 });
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headFill } };
      c.border = { bottom: { style: 'thin', color: { argb: C.line } } };
    });
    txList.forEach(t => {
      const amt = t.type === 'expense' ? -Number(t.amount) : Number(t.amount);
      const r = ws.addRow([t.date, t.type, (isAllowanceInc(t) || isAllowanceExp(t)) ? 'Allowance' : 'General', t.category || '', cleanNotes(t.notes || ''), amt, t.receipt ? 'Yes' : '']);
      r.getCell(6).numFmt = CUR_FMT;
      r.getCell(6).font = F({ color: amt < 0 ? C.red : C.green });
    });
  }

  function exportStyledHtmlFallback(filename, ym, selYear, activeMode) {
    const e = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const sheetEl = document.querySelector('#view .coyap-sheet');
    if (sheetEl) {
      const html = `<html><head><meta charset="utf-8"><style>
        body{font-family:Calibri,Arial,sans-serif;color:#111827;font-size:12px}
        table{border-collapse:collapse;width:100%}
        td,th{padding:4px 8px}
        .col-detail,.col-sub,.col-total{text-align:right;mso-number-format:"₱#,##0.00"}
        .border-top{border-top:1px solid #334155}
        .border-bottom{border-bottom:1px solid #334155}
        .border-double{border-top:1px solid #111827;border-bottom:3px double #111827}
        .sig-line{border-bottom:1px solid #334155}
        .separated-allowance-box{border:1px solid #0ea5e9;background:#f0f9ff;padding:12px}
      </style></head><body>${sheetEl.innerHTML}</body></html>`;
      download(filename.replace(/\.xlsx$/i, '.xls'), html, 'application/vnd.ms-excel');
      return;
    }
    const r = typeof window.getMonthlyReportData === 'function' ? window.getMonthlyReportData(ym) : null;
    download(filename.replace(/\.xlsx$/i, '.xls'), `<html><body><h3>${e(r ? r.monthTitle : selYear)}</h3></body></html>`, 'application/vnd.ms-excel');
  }

  window.exportExcel = async function (opts) {
    const allLive = live().sort((a, b) => a.date.localeCompare(b.date));
    const curYear = String(new Date().getFullYear());
    const years = [...new Set([...allLive.map(t => t.date.slice(0, 4)), curYear])].sort().reverse();
    const activeMode = (opts && opts.mode) || (typeof view !== 'undefined' && view === 'reports' && typeof reportMode !== 'undefined' ? reportMode : 'annual');
    const selYear = (opts && opts.year) || (typeof reportYear !== 'undefined' && reportYear) || years[0] || curYear;
    const selYm = (opts && opts.ym) || (typeof reportMonth !== 'undefined' && reportMonth) || (typeof getActiveMonth === 'function' ? getActiveMonth() : `${selYear}-01`);
    const filename = activeMode === 'monthly'
      ? `BTC-Youth-Monthly-Report-${selYm}.xlsx`
      : `BTC-Youth-Annual-Report-${selYear}.xlsx`;

    const EJS = await ensureExcelJS();
    if (!EJS || !EJS.Workbook) {
      exportStyledHtmlFallback(filename, selYm, selYear, activeMode);
      if (typeof showToast === 'function') showToast('📊 Exported Excel report');
      return;
    }

    try {
      const wb = new EJS.Workbook();
      wb.creator = 'BTC Youth Fund Tracker';
      wb.created = new Date();

      if (activeMode === 'monthly') {
        const r = addStyledMonthlySheet(wb, selYm);
        if (!r) return alert('Could not build monthly report.');
        addTransactionsSheet(wb, 'Transactions', r.mApproved);
      } else {
        addStyledAnnualSheet(wb, selYear);
        const yearTxs = allLive.filter(t => t.date.startsWith(selYear));
        const monthsWithData = [...new Set(yearTxs.map(t => ymOf(t.date)))].sort();
        monthsWithData.forEach(ym => {
          const shortM = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
          addStyledMonthlySheet(wb, ym, `${shortM} ${selYear}`);
        });
        addTransactionsSheet(wb, `Transactions ${selYear}`, yearTxs.length ? yearTxs : allLive);
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      if (typeof showToast === 'function') showToast(`📊 Exported ${filename}`);
    } catch (err) {
      console.error('ExcelJS export error:', err);
      exportStyledHtmlFallback(filename, selYm, selYear, activeMode);
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
