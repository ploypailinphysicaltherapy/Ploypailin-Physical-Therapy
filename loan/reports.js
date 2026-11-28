/* ศูนย์ยืม-คืนอุปกรณ์ — โมดูลรายงาน / ปฏิทินการยืม / ใบยืม-คืนสำหรับพิมพ์ (V38)
   โหลดเมื่อเข้าหน้า #/reports #/calendar หรือกดพิมพ์ใบยืมเท่านั้น (ไม่อยู่ในการโหลดหน้าแรก)
   ใช้ฟังก์ชันภายในของ app.js ผ่าน window.ELC_APP · ไลบรารี Excel (SheetJS) โหลดตอนกดปุ่ม "ส่งออก Excel" เท่านั้น
   แนวคิดมาจากระบบ controlall (รายงาน/Excel, ปฏิทินรอบปี, ใบยืม) เขียนใหม่ให้ตรงกับข้อมูลและดีไซน์ของระบบนี้ */
(function () {
'use strict';
var A = window.ELC_APP;
if (!A || window.ELC_RPT) return;
var esc = A.esc, icon = A.icon, fmtDate = A.fmtDate, API = A.API, C = A.C;
var $ = function (s) { return document.querySelector(s); };
var DONE = 'คืนแล้ว', OPEN = 'ยืมอยู่';
var XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

// ---------- วันที่ ----------
function pad(n) { return (n < 10 ? '0' : '') + n; }
function isoOf(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function parse(iso) { var p = String(iso).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
function days(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
function dmy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + (+m[1] + 543) : ''; }   // วว/ดด/พ.ศ.
function fyStart(t) { var d = parse(t), y = d.getUTCFullYear(); return (d.getUTCMonth() >= 9 ? y : y - 1) + '-10-01'; }
function stamp() { var n = new Date(); return n.getFullYear() + pad(n.getMonth() + 1) + pad(n.getDate()); }
function fail(e, nid) { A.fail(e, nid); }

// ---------- โหลดข้อมูล ----------
var cache = {};
function loadRange(from, to, force) {
  var k = from + '|' + to;
  if (!force && cache[k] && Date.now() - cache[k].ts < 60000) return Promise.resolve(cache[k].d);
  return API.call('loanRange', { from: from, to: to }, { timeout: 90000 }).then(function (d) { cache[k] = { ts: Date.now(), d: d }; return d; });
}
function bars(rows, total) {
  if (!rows.length) return '<div class="empty">ไม่มีข้อมูลในช่วงนี้</div>';
  var max = Math.max.apply(null, rows.map(function (r) { return r[1]; })) || 1;
  return '<div class="bars">' + rows.map(function (r) {
    return '<div class="bar-r"><span class="bl" title="' + esc(r[0]) + '">' + esc(r[0]) + '</span><span class="bt"><i style="width:' + Math.max(3, Math.round(r[1] * 100 / max)) + '%"></i></span><b>' + r[1] + '</b></div>';
  }).join('') + '</div>';
}
function tally(list, keyFn, top) {
  var m = {}; list.forEach(function (x) { var k = keyFn(x) || 'ไม่ระบุ'; m[k] = (m[k] || 0) + 1; });
  var a = Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (x, y) { return y[1] - x[1]; });
  return top ? a.slice(0, top) : a;
}

// =====================================================================
//  รายงาน
// =====================================================================
var RS = { from: '', to: '', tab: 'all', q: '', data: null, busy: false };

function stats(d) {
  var inR = d.loans.filter(function (l) { return l.loanDate >= d.from && l.loanDate <= d.to; });
  var ret = inR.filter(function (l) { return l.status === DONE; });
  var open = d.loans.filter(function (l) { return l.status === OPEN; });
  var od = open.filter(function (l) { return l.overdue; });
  var held = ret.filter(function (l) { return l.returnDate && l.loanDate; }).map(function (l) { return Math.max(0, days(l.loanDate, l.returnDate)); });
  var avg = held.length ? Math.round(held.reduce(function (a, b) { return a + b; }, 0) / held.length * 10) / 10 : 0;
  var late = ret.filter(function (l) { return l.dueDate && l.returnDate && l.returnDate > l.dueDate; }).length;
  return { inR: inR, ret: ret, open: open, od: od, avg: avg, late: late };
}

function reportList(d, st) {
  var rows = d.loans;
  if (RS.tab === 'open') rows = st.open; else if (RS.tab === 'over') rows = st.od;
  var q = RS.q.trim().toLowerCase();
  if (q) rows = rows.filter(function (l) { return [l.assetNo, l.assetName, l.borrowerName, l.phone].join(' ').toLowerCase().indexOf(q) >= 0; });
  var cut = rows.length > 200;
  return { cut: cut, total: rows.length, html: rows.length ? '<div class="list">' + rows.slice(0, 200).map(function (l) {
    var b = l.status === OPEN ? (l.overdue ? '<span class="badge bad">เกิน ' + l.daysLate + ' วัน</span>' : '<span class="badge acc">ยืมอยู่</span>') : '<span class="badge ok">คืนแล้ว</span>';
    return '<div class="li noth"><div class="mn"><div class="t">' + esc((l.assetNo ? l.assetNo + ' · ' : '') + l.assetName) + '</div><div class="s">' + esc(l.borrowerName) + (l.borrowerType ? ' (' + esc(l.borrowerType) + ')' : '') + ' · ยืม ' + esc(fmtDate(l.loanDate)) + ' · กำหนดคืน ' + esc(fmtDate(l.dueDate)) + (l.returnDate ? ' · คืน ' + esc(fmtDate(l.returnDate)) : '') + '</div></div><div class="end">' + b +
      '<button class="btn sm" data-do="printLoan" data-id="' + esc(l.loanId) + '" aria-label="พิมพ์ใบยืม" title="พิมพ์ใบยืม">' + icon('print') + '</button></div></div>';
  }).join('') + '</div>' : '<div class="list"><div class="empty">ไม่มีรายการ</div></div>' };
}

function paintReport() {
  var d = RS.data, v = $('#view'); if (!d || !v) return;
  var st = stats(d), L = reportList(d, st), as = d.assets || { total: 0, byStatus: {}, byCategory: {} };
  var statusRows = Object.keys(as.byStatus).map(function (k) { return [k, as.byStatus[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  var catRows = Object.keys(as.byCategory).map(function (k) { return [k, as.byCategory[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
  var chip = function (k, t, n) { return '<button class="chip" data-rt="' + k + '" aria-pressed="' + (RS.tab === k) + '">' + t + (n != null ? ' (' + n + ')' : '') + '</button>'; };
  var pre = function (k, t) { return '<button class="chip" data-rp="' + k + '">' + t + '</button>'; };
  v.innerHTML = '<div class="ph"><div><h1>รายงานการยืม-คืน</h1><p>' + esc(fmtDate(d.from)) + ' – ' + esc(fmtDate(d.to)) + (d.truncated ? ' · แสดงเฉพาะ 5,000 รายการล่าสุด' : '') + '</p></div>' +
    '<div class="acts"><button class="btn" data-ra="print">' + icon('print') + 'พิมพ์รายงาน</button><button class="btn pri" data-ra="xlsx"' + (RS.busy ? ' disabled' : '') + '>' + icon('log') + 'ส่งออก Excel</button></div></div>' +
    '<div class="rfilter"><label>ตั้งแต่<input type="date" id="rf" value="' + esc(d.from) + '" max="' + esc(d.today) + '"></label><label>ถึง<input type="date" id="rt" value="' + esc(d.to) + '" max="' + esc(d.today) + '"></label>' +
    '<div class="chips" role="group" aria-label="ช่วงเวลาที่ใช้บ่อย">' + pre('month', 'เดือนนี้') + pre('30', '30 วัน') + pre('fy', 'ปีงบประมาณ') + pre('year', '1 ปี') + '</div></div>' +
    '<div class="sum"><div><b>' + st.inR.length + '</b><span>ยืมในช่วงนี้</span></div><div><b>' + st.ret.length + '</b><span>คืนแล้ว</span></div><div><b>' + st.open.length + '</b><span>ยังไม่คืน</span></div><div><b class="' + (st.od.length ? 'bad' : '') + '">' + st.od.length + '</b><span>เกินกำหนด</span></div><div><b>' + st.avg + '</b><span>วันเฉลี่ยที่ยืม</span></div></div>' +
    '<div class="cols rcols"><section class="sec"><h2>ครุภัณฑ์ที่ถูกยืมบ่อย</h2>' + bars(tally(st.inR, function (l) { return (l.assetNo ? l.assetNo + ' · ' : '') + l.assetName; }, 8)) + '</section>' +
    '<section class="sec"><h2>ผู้ยืมแยกตามประเภท</h2>' + bars(tally(st.inR, function (l) { return l.borrowerType; })) + '</section></div>' +
    '<div class="cols rcols"><section class="sec"><h2>สถานะครุภัณฑ์ทั้งหมด (' + as.total + ')</h2>' + bars(statusRows) + '</section>' +
    '<section class="sec"><h2>หมวดครุภัณฑ์</h2>' + bars(catRows) + '</section></div>' +
    (st.late ? '<p class="hint">ในช่วงนี้มี ' + st.late + ' รายการที่คืนช้ากว่ากำหนด</p>' : '') +
    '<section class="sec"><h2>รายการยืม-คืน <span class="cnt">' + L.total + '</span></h2><div class="tools"><div class="chips" role="group" aria-label="กรอง">' + chip('all', 'ทั้งหมด', d.loans.length) + chip('open', 'ยังไม่คืน', st.open.length) + chip('over', 'เกินกำหนด', st.od.length) + '</div>' +
    '<div class="q">' + icon('search') + '<label class="sr" for="rq">ค้นหา</label><input id="rq" type="search" placeholder="ค้นหาผู้ยืม / อุปกรณ์" value="' + esc(RS.q) + '" autocomplete="off"></div></div><div id="rlist">' + L.html + '</div>' + (L.cut ? '<p class="hint">แสดง 200 รายการแรก — ส่งออก Excel เพื่อดูทั้งหมด</p>' : '') + '</section>';
  bindReport();
}
function bindReport() {
  var v = $('#view'); if (!v) return;
  v.onclick = function (e) {
    var t = e.target.closest && e.target.closest('[data-rt],[data-rp],[data-ra]'); if (!t) return;
    if (t.dataset.rt) { RS.tab = t.dataset.rt; return paintReport(); }
    if (t.dataset.rp) {
      var td = A.today(), k = t.dataset.rp;
      RS.to = td; RS.from = k === 'month' ? td.slice(0, 8) + '01' : k === '30' ? A.addDays(td, -29) : k === 'fy' ? fyStart(td) : A.addDays(td, -364);
      return reload();
    }
    if (t.dataset.ra === 'xlsx') exportXlsx(t); else if (t.dataset.ra === 'print') printReport();
  };
  var f = $('#rf'), tt = $('#rt');
  var chg = function () { if (f.value && tt.value) { RS.from = f.value; RS.to = tt.value; reload(); } };
  if (f) f.onchange = chg; if (tt) tt.onchange = chg;
  var q = $('#rq'); if (q) q.oninput = function () { RS.q = q.value; var d = RS.data, L = reportList(d, stats(d)); $('#rlist').innerHTML = L.html; };
}
function reload() {
  var nid = A.nav(); $('#view').innerHTML = '<p class="loading">กำลังโหลด…</p>';
  loadRange(RS.from, RS.to, true).then(function (d) { if (nid !== A.nav()) return; RS.data = d; RS.from = d.from; RS.to = d.to; paintReport(); }).catch(function (e) { fail(e, nid); });
}
function reports(nid) {
  var td = A.today(); if (!RS.from) { RS.from = td.slice(0, 8) + '01'; RS.to = td; }
  loadRange(RS.from, RS.to).then(function (d) { if (nid !== A.nav()) return; RS.data = d; RS.from = d.from; RS.to = d.to; paintReport(); document.title = 'รายงาน · ' + C.ORG_NAME; }).catch(function (e) { fail(e, nid); });
}

// ---------- ส่งออก Excel (โหลด SheetJS เมื่อกดเท่านั้น) ----------
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise(function (res, rej) {
    var s = document.createElement('script'), t = setTimeout(function () { rej(new Error('โหลดตัวสร้าง Excel ช้าเกินไป')); }, window.ELC_XLSX_TIMEOUT || 12000);
    s.src = XLSX_URL; s.onload = function () { clearTimeout(t); res(); }; s.onerror = function () { clearTimeout(t); rej(new Error('โหลดตัวสร้าง Excel ไม่สำเร็จ')); };
    document.head.appendChild(s);
  });
}
function loanRowsX(list) {
  return list.map(function (l) {
    return { 'เลขที่ใบยืม': l.loanId, 'เลขครุภัณฑ์': l.assetNo, 'ชื่ออุปกรณ์': l.assetName, 'ผู้ยืม': l.borrowerName, 'ประเภทผู้ยืม': l.borrowerType, 'โทรศัพท์': l.phone,
      'วันที่ยืม': dmy(l.loanDate), 'กำหนดคืน': dmy(l.dueDate), 'วันที่คืน': dmy(l.returnDate), 'สถานะ': l.status === OPEN && l.overdue ? 'เกินกำหนด ' + l.daysLate + ' วัน' : l.status,
      'สภาพก่อนยืม': l.conditionOut, 'สภาพเมื่อคืน': l.conditionIn, 'หมายเหตุ': l.note };
  });
}
function assetRowsX(list) {
  return list.map(function (a) {
    return { 'เลขครุภัณฑ์': a.assetNo, 'ชื่อ': a.name, 'หมวด': a.category, 'ยี่ห้อ': a.brand, 'รุ่น': a.model, 'ซีเรียล': a.serialNo, 'สถานที่เก็บ': a.location, 'ผู้ดูแล': a.custodian,
      'สถานะ': a.status, 'ให้ยืมได้': a.loanable === 'Y' ? 'ได้' : 'ไม่ได้', 'วันที่ได้มา': dmy(a.acquireDate), 'ราคา': a.unitPrice === '' ? '' : a.unitPrice, 'ผู้ยืมปัจจุบัน': a.loan ? a.loan.borrowerName : '', 'กำหนดคืน': a.loan ? dmy(a.loan.dueDate) : '' };
  });
}
function csvDownload(rows, name) {
  if (!rows.length) rows = [{ 'ไม่มีข้อมูล': '' }];
  var keys = Object.keys(rows[0]);
  var cell = function (v) { v = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  var txt = '﻿' + keys.map(cell).join(',') + '\r\n' + rows.map(function (r) { return keys.map(function (k) { return cell(r[k]); }).join(','); }).join('\r\n');
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function exportXlsx(btn) {
  var d = RS.data; if (!d || RS.busy) return;
  RS.busy = true; btn.disabled = true; btn.classList.add('busy'); A.toast('กำลังสร้างไฟล์ Excel…');
  var st = stats(d), done = function () { RS.busy = false; btn.disabled = false; btn.classList.remove('busy'); };
  Promise.all([loadXlsx(), A.getAssets()]).then(function (r) {
    var X = window.XLSX, wb = X.utils.book_new();
    var sum = [['รายงานการยืม-คืนอุปกรณ์', C.ORG_NAME + (C.ORG_SUB ? ' · ' + C.ORG_SUB : '')], ['ช่วงวันที่', dmy(d.from) + ' – ' + dmy(d.to)], [], ['ยืมในช่วงนี้', st.inR.length], ['คืนแล้ว', st.ret.length], ['ยังไม่คืน (รวมค้างจากก่อนช่วง)', st.open.length], ['เกินกำหนด', st.od.length], ['คืนช้ากว่ากำหนด', st.late], ['วันเฉลี่ยที่ยืม', st.avg], [], ['ครุภัณฑ์ทั้งหมด (ไม่รวมจำหน่าย)', d.assets.total]];
    Object.keys(d.assets.byStatus).forEach(function (k) { sum.push(['  สถานะ: ' + k, d.assets.byStatus[k]]); });
    var ws0 = X.utils.aoa_to_sheet(sum); ws0['!cols'] = [{ wch: 38 }, { wch: 30 }]; X.utils.book_append_sheet(wb, ws0, 'สรุป');
    var ws1 = X.utils.json_to_sheet(d.loans.length ? loanRowsX(d.loans) : [{ 'ไม่มีข้อมูล': '' }]); ws1['!cols'] = [10, 14, 28, 22, 14, 14, 12, 12, 12, 16, 18, 18, 30].map(function (w) { return { wch: w }; }); X.utils.book_append_sheet(wb, ws1, 'รายการยืม-คืน');
    var ws2 = X.utils.json_to_sheet(r[1].length ? assetRowsX(r[1]) : [{ 'ไม่มีข้อมูล': '' }]); ws2['!cols'] = [14, 30, 16, 14, 14, 16, 18, 16, 14, 9, 12, 12, 20, 12].map(function (w) { return { wch: w }; }); X.utils.book_append_sheet(wb, ws2, 'ครุภัณฑ์');
    X.writeFile(wb, 'รายงานยืม-คืน_' + stamp() + '.xlsx'); A.toast('ดาวน์โหลดไฟล์ Excel แล้ว'); done();
  }).catch(function (e) {
    done(); csvDownload(loanRowsX(d.loans), 'รายงานยืม-คืน_' + stamp() + '.csv');
    A.toast((e && e.message ? e.message + ' — ' : '') + 'ดาวน์โหลดเป็น CSV แทน (เปิดด้วย Excel ได้)', true);
  });
}

// ---------- พิมพ์รายงาน ----------
var PCSS = '#printRoot{font-family:Sarabun,Tahoma,sans-serif;color:#000;background:#fff;font-size:11pt}@page{size:A4;margin:14mm}' +
  '#printRoot h1{font-size:16pt;margin:0 0 2mm}#printRoot .pfu{color:#333;margin:0 0 5mm}#printRoot table{width:100%;border-collapse:collapse;margin-top:4mm}' +
  '#printRoot th,#printRoot td{border:.3mm solid #666;padding:1.2mm 1.8mm;text-align:left;vertical-align:top;font-size:9.5pt}#printRoot th{background:#eee}' +
  '#printRoot .pfk{display:flex;gap:3mm;flex-wrap:wrap;margin:3mm 0}#printRoot .pfk div{border:.3mm solid #666;padding:2mm 4mm;min-width:30mm}#printRoot .pfk b{display:block;font-size:15pt}' +
  '#printRoot tr{break-inside:avoid}#printRoot thead{display:table-header-group}#printRoot .pfo{white-space:nowrap}';
function printReport() {
  var d = RS.data; if (!d) return;
  var st = stats(d), rows = d.loans.slice(0, 600);
  var html = '<h1>รายงานการยืม-คืนอุปกรณ์</h1><p class="pfu">' + esc(C.ORG_NAME + (C.ORG_SUB ? ' · ' + C.ORG_SUB : '')) + '<br>ช่วงวันที่ ' + esc(dmy(d.from)) + ' – ' + esc(dmy(d.to)) + ' · พิมพ์เมื่อ ' + esc(dmy(d.today)) + '</p>' +
    '<div class="pfk"><div><b>' + st.inR.length + '</b>ยืมในช่วงนี้</div><div><b>' + st.ret.length + '</b>คืนแล้ว</div><div><b>' + st.open.length + '</b>ยังไม่คืน</div><div><b>' + st.od.length + '</b>เกินกำหนด</div><div><b>' + st.avg + '</b>วันเฉลี่ยที่ยืม</div></div>' +
    '<table><thead><tr><th>#</th><th>เลขครุภัณฑ์ / อุปกรณ์</th><th>ผู้ยืม</th><th class="pfo">วันที่ยืม</th><th class="pfo">กำหนดคืน</th><th class="pfo">วันที่คืน</th><th>สถานะ</th></tr></thead><tbody>' +
    rows.map(function (l, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc((l.assetNo ? l.assetNo + ' ' : '') + l.assetName) + '</td><td>' + esc(l.borrowerName) + '</td><td class="pfo">' + esc(dmy(l.loanDate)) + '</td><td class="pfo">' + esc(dmy(l.dueDate)) + '</td><td class="pfo">' + esc(dmy(l.returnDate)) + '</td><td>' + esc(l.status === OPEN && l.overdue ? 'เกินกำหนด ' + l.daysLate + ' วัน' : l.status) + '</td></tr>'; }).join('') +
    '</tbody></table>' + (d.loans.length > rows.length ? '<p>แสดง ' + rows.length + ' จาก ' + d.loans.length + ' รายการ (ดูทั้งหมดใน Excel)</p>' : '');
  A.printDoc(PCSS, html);
}

// =====================================================================
//  ปฏิทินการยืมรอบปี (heat map)
// =====================================================================
var CS = { metric: 'loan', data: null, sel: '' };
var MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function calCounts(d) {
  var m = {}; d.loans.forEach(function (l) { var k = CS.metric === 'return' ? l.returnDate : l.loanDate; if (k) m[k] = (m[k] || 0) + 1; }); return m;
}
function paintCal() {
  var d = CS.data, v = $('#view'); if (!d || !v) return;
  var cnt = calCounts(d), end = parse(d.to), start = parse(A.addDays(d.to, -364));
  start = new Date(start.getTime() - start.getUTCDay() * 86400000);      // เริ่มที่วันอาทิตย์
  var max = 0, total = 0, busy = '', busyN = 0, byMonth = {};
  Object.keys(cnt).forEach(function (k) { if (k < isoOf(start) || k > d.to) return; total += cnt[k]; if (cnt[k] > max) max = cnt[k]; if (cnt[k] > busyN) { busyN = cnt[k]; busy = k; } var mk = k.slice(0, 7); byMonth[mk] = (byMonth[mk] || 0) + cnt[k]; });
  var cells = '', labels = '', cols = Math.ceil((end - start) / 86400000 / 7) + 1;
  for (var w = 0; w < cols; w++) {
    var first = new Date(start.getTime() + w * 7 * 86400000), lab = '';
    for (var q = 0; q < 7; q++) { var dd = new Date(first.getTime() + q * 86400000); if (dd.getUTCDate() === 1) lab = MON[dd.getUTCMonth()]; }
    if (w === 0 && !lab && first.getUTCDate() <= 20) lab = MON[first.getUTCMonth()];
    labels += '<span style="grid-column:' + (w + 1) + '">' + lab + '</span>';
    for (var r = 0; r < 7; r++) {
      var day = new Date(first.getTime() + r * 86400000), k = isoOf(day);
      if (day > end) { cells += '<i class="hc off"></i>'; continue; }
      var n = cnt[k] || 0, lv = n ? Math.max(1, Math.ceil(4 * n / (max || 1))) : 0;
      cells += '<button class="hc l' + lv + (k === CS.sel ? ' sel' : '') + (k === d.today ? ' today' : '') + '" data-d="' + k + '" title="' + esc(fmtDate(k)) + ': ' + n + ' รายการ" aria-label="' + esc(fmtDate(k)) + ' ' + n + ' รายการ"></button>';
    }
  }
  var bm = Object.keys(byMonth).sort(function (a, b) { return byMonth[b] - byMonth[a]; })[0];
  var metricName = CS.metric === 'return' ? 'การคืน' : 'การยืม';
  v.innerHTML = '<div class="ph"><div><h1>ปฏิทินการยืมรอบปี</h1><p>ความเคลื่อนไหว' + metricName + 'ย้อนหลัง 12 เดือน (' + esc(fmtDate(isoOf(start))) + ' – ' + esc(fmtDate(d.to)) + ')</p></div>' +
    '<div class="chips" role="group" aria-label="ชนิดข้อมูล"><button class="chip" data-m="loan" aria-pressed="' + (CS.metric === 'loan') + '">วันที่ยืม</button><button class="chip" data-m="return" aria-pressed="' + (CS.metric === 'return') + '">วันที่คืน</button></div></div>' +
    '<div class="sum"><div><b>' + total + '</b><span>รายการ' + metricName + 'ทั้งปี</span></div><div><b>' + (busyN || '–') + '</b><span>สูงสุดใน 1 วัน' + (busy ? ' (' + esc(fmtDate(busy)) + ')' : '') + '</span></div><div><b>' + (bm ? MON[+bm.slice(5) - 1] : '–') + '</b><span>เดือนที่คึกคักที่สุด' + (bm ? ' (' + byMonth[bm] + ')' : '') + '</span></div><div><b>' + Math.round(total / 52 * 10) / 10 + '</b><span>เฉลี่ยต่อสัปดาห์</span></div></div>' +
    '<section class="sec"><div class="heat" id="heat" role="group" aria-label="แผนภูมิความเคลื่อนไหวรายวัน"><div class="hm" style="grid-template-columns:repeat(' + cols + ',var(--hs))">' + labels + '</div><div class="hg" style="grid-template-columns:repeat(' + cols + ',var(--hs))">' + cells + '</div></div>' +
    '<div class="hlg"><span>น้อย</span><i class="hc l0"></i><i class="hc l1"></i><i class="hc l2"></i><i class="hc l3"></i><i class="hc l4"></i><span>มาก</span></div></section>' +
    '<section class="sec" id="dayBox" aria-live="polite">' + dayHtml(d) + '</section>';
  var h = $('#heat'); if (h) h.scrollLeft = h.scrollWidth;
  v.onclick = function (e) {
    var t = e.target.closest && e.target.closest('[data-d],[data-m]'); if (!t) return;
    if (t.dataset.m) { CS.metric = t.dataset.m; CS.sel = ''; return paintCal(); }
    CS.sel = t.dataset.d; var keep = h ? h.scrollLeft : 0; paintCal(); var h2 = $('#heat'); if (h2) h2.scrollLeft = keep;
    var box = $('#dayBox'); if (box && box.scrollIntoView) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
}
function dayHtml(d) {
  if (!CS.sel) return '<p class="hint">แตะที่ช่องวันที่เพื่อดูรายการของวันนั้น</p>';
  var list = d.loans.filter(function (l) { return (CS.metric === 'return' ? l.returnDate : l.loanDate) === CS.sel; });
  return '<h2>' + esc(fmtDate(CS.sel)) + ' <span class="cnt">' + list.length + '</span></h2>' + (list.length ? '<div class="list">' + list.map(function (l) {
    return '<a class="li noth" href="#/asset/' + esc(l.assetId) + '"><div class="mn"><div class="t">' + esc((l.assetNo ? l.assetNo + ' · ' : '') + l.assetName) + '</div><div class="s">' + esc(l.borrowerName) + (l.borrowerType ? ' (' + esc(l.borrowerType) + ')' : '') + ' · กำหนดคืน ' + esc(fmtDate(l.dueDate)) + '</div></div>' + (l.status === OPEN ? '<span class="badge acc">ยืมอยู่</span>' : '<span class="badge ok">คืนแล้ว</span>') + '</a>';
  }).join('') + '</div>' : '<div class="list"><div class="empty">ไม่มีรายการในวันนี้</div></div>');
}
function calendar(nid) {
  var td = A.today();
  loadRange(A.addDays(td, -364), td).then(function (d) { if (nid !== A.nav()) return; CS.data = d; paintCal(); document.title = 'ปฏิทินการยืม · ' + C.ORG_NAME; }).catch(function (e) { fail(e, nid); });
}

// =====================================================================
//  ใบยืม-คืนสำหรับพิมพ์
// =====================================================================
var FCSS = '#printRoot{font-family:Sarabun,Tahoma,sans-serif;color:#000;background:#fff;font-size:11pt;line-height:1.35}@page{size:A4;margin:12mm 14mm}' +
  '#printRoot .pfh{text-align:center;margin-bottom:2mm}#printRoot .pfh b{font-size:16pt;display:block}#printRoot .pfh span{color:#333;font-size:10.5pt}#printRoot .pfm{display:flex;justify-content:space-between;margin-bottom:1mm;font-size:10.5pt}' +
  '#printRoot table{width:100%;border-collapse:collapse;margin:1mm 0 2mm}#printRoot th,#printRoot td{border:.3mm solid #444;padding:.9mm 2mm;text-align:left;vertical-align:top}#printRoot th{width:30%;background:#f2f2f2;font-weight:600}' +
  '#printRoot h2{font-size:11.5pt;margin:2.5mm 0 0}#printRoot .pfn{font-size:10pt;color:#222;margin:1.5mm 0}' +
  '#printRoot .pfs{display:flex;gap:10mm;margin-top:3mm}#printRoot .pfs div{flex:1;text-align:center;font-size:10.5pt}#printRoot .pfs i{display:block;border-bottom:.3mm dotted #000;height:9mm;margin-bottom:1mm}' +
  '#printRoot .pfc{border-top:.4mm dashed #777;margin:4mm 0 0;padding-top:1mm;text-align:center;font-size:9pt;color:#555}';
function findLoan(id) {
  return API.call('loanList', { scope: 'all', limit: 500 }, { timeout: 90000 }).then(function (list) {
    var l = list.filter(function (x) { return x.loanId === id; })[0];
    if (l) return l;
    return API.call('loanList', { scope: 'open' }).then(function (o) { return o.filter(function (x) { return x.loanId === id; })[0]; });
  });
}
function printLoan(id, btn) {
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  var done = function () { if (btn) { btn.disabled = false; btn.classList.remove('busy'); } };
  Promise.all([findLoan(id), A.getAssets()]).then(function (r) {
    var l = r[0]; done(); if (!l) return A.toast('ไม่พบรายการยืมนี้', true);
    var a = r[1].filter(function (x) { return x.assetId === l.assetId; })[0] || {};
    var blank = '&nbsp;';
    var row = function (k, v) { return '<tr><th>' + k + '</th><td>' + (v ? esc(v) : blank) + '</td></tr>'; };
    var html = '<div class="pfh"><b>ใบยืม-คืนครุภัณฑ์ / อุปกรณ์</b><span>' + esc(C.ORG_NAME + (C.ORG_SUB ? ' · ' + C.ORG_SUB : '')) + '</span></div>' +
      '<div class="pfm"><span>เลขที่ใบยืม: <b>' + esc(l.loanId) + '</b></span><span>พิมพ์เมื่อ ' + esc(dmy(A.today())) + '</span></div>' +
      '<h2>1. รายการอุปกรณ์</h2><table>' + row('เลขครุภัณฑ์', l.assetNo || a.assetNo) + row('ชื่ออุปกรณ์', l.assetName || a.name) + row('ยี่ห้อ / รุ่น', [a.brand, a.model].filter(Boolean).join(' / ')) + row('หมายเลขเครื่อง', a.serialNo) + row('สถานที่เก็บ', a.location) + '</table>' +
      '<h2>2. ผู้ยืม</h2><table>' + row('ชื่อ-สกุล', l.borrowerName) + row('ประเภทผู้ยืม', l.borrowerType) + row('HN (ถ้ามี)', l.borrowerHN) + row('โทรศัพท์', l.phone) + '</table>' +
      '<h2>3. กำหนดการยืม</h2><table>' + row('วันที่ยืม', dmy(l.loanDate)) + row('กำหนดคืน', dmy(l.dueDate)) + row('สภาพก่อนยืม', l.conditionOut) + row('หมายเหตุ', l.note) + '</table>' +
      '<p class="pfn">ข้าพเจ้ารับทราบและยินยอมดูแลรักษาอุปกรณ์ข้างต้นให้อยู่ในสภาพเรียบร้อย และจะนำมาคืนภายในกำหนด หากชำรุดหรือสูญหายจะแจ้งเจ้าหน้าที่ทันที</p>' +
      '<div class="pfs"><div><i></i>ลงชื่อ ผู้ยืม<br>( ' + (l.borrowerName ? esc(l.borrowerName) : '..............................') + ' )<br>วันที่ ......../......../........</div><div><i></i>ลงชื่อ ผู้ให้ยืม / เจ้าหน้าที่<br>( .............................. )<br>วันที่ ......../......../........</div></div>' +
      '<div class="pfc">✂ ส่วนรับคืน</div><h2>4. การรับคืน</h2><table>' + row('วันที่คืน', dmy(l.returnDate)) + row('สภาพเมื่อคืน', l.conditionIn) + '</table>' +
      '<div class="pfs"><div><i></i>ลงชื่อ ผู้คืน<br>( .............................. )<br>วันที่ ......../......../........</div><div><i></i>ลงชื่อ ผู้รับคืน<br>( ' + (l.returnedBy ? esc(l.returnedBy) : '..............................') + ' )<br>วันที่ ......../......../........</div></div>';
    A.printDoc(FCSS, html);
  }).catch(function (e) { done(); A.toast(e.message || 'พิมพ์ไม่สำเร็จ', true); });
}

window.ELC_RPT = { reports: reports, calendar: calendar, printLoan: printLoan };
})();
