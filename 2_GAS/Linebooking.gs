// ════════════════════════════════════════════════════════════════════════
//  LineBooking.gs — PT Station: (A) นัดหมายผ่าน LINE  (B) สรุปสัปดาห์เชิงคลินิก
// ------------------------------------------------------------------------
//  เป็นไฟล์ "เพิ่ม" ในโปรเจกต์ Apps Script เดียวกับ Code.gs (File ▸ + ▸ Script)
//  ใช้ฟังก์ชัน/ค่าคงที่ของ Code.gs ที่มีอยู่แล้ว ไม่ประกาศชื่อซ้ำ (ทุกชื่อขึ้นต้น ptlnBk / ptlnWk / PTLN_BK_)
//  ใช้คู่กับ Code.gs ฉบับ FINAL (แพตช์ 6 จุดรวมไว้แล้ว: ตารางเวลา/ticker/handler/ปุ่มนัดต่อ/trigger เดิม/สถานะระบบ)
//
//  (A) นัดหมายผ่าน LINE — ไม่ต้องเปิดเว็บ ไม่เก็บ state ฝั่งเซิร์ฟเวอร์ (ค่าทั้งหมดอยู่ใน postback data)
//      ผู้ป่วยเดิม : [นัดหมาย] → แตะชื่อ (ผู้ป่วยล่าสุด/ค้นหา) → แตะวัน → แตะเวลา → ยืนยัน
//                    ทางลัด: "⭐ นัดต่อ" (เวลาเดิม +7 วัน) → ยืนยัน  = 3 แตะ
//                    ข้อมูลที่เติมให้เอง: HN ชื่อ เบอร์ สิทธิ หัตถการ ICD-10 นักกายภาพ ประเภท OPD/เยี่ยมบ้าน
//      ผู้ป่วยใหม่ : [นัดหมาย] → 🆕 → HN (หรือ "ไม่มี HN") → ชื่อ → เบอร์ → สิทธิ → ประเภท → หัตถการ → วัน → เวลา → ยืนยัน
//      หลังจอง    : ปุ่ม เลื่อนนัด / ยกเลิกนัด / นัดอีกราย
//  (B) สรุปสัปดาห์ ศุกร์ 15:30: ภาพรวม · กลุ่มโรค/ICD-10 · หัตถการ · ผลลัพธ์ (VAS/Barthel/เป้าหมาย) · คุณภาพข้อมูล
//      พิมพ์ "สรุปสัปดาห์" ใน LINE เพื่อดูเองได้ทุกเมื่อ
//
//  Rich Menu ช่อง "นัดหมาย": ใช้ได้ทั้ง message action (text = "นัดหมาย") หรือ postback (data = "act=bk&s=st")
// ════════════════════════════════════════════════════════════════════════

var PTLN_BK_STATE_TTL_ = 900;    // 15 นาที — รอข้อความที่พิมพ์ต่อ (ค้นหา/ผู้ป่วยใหม่)
var PTLN_BK_NP_TTL_    = 1800;   // 30 นาที — เก็บข้อมูลผู้ป่วยใหม่ระหว่างเลือกวัน/เวลา
var PTLN_BK_ENTRY_     = ['นัดหมาย', 'จองคิว', 'นัด'];
var PTLN_BK_WEEKLY_CMD_ = ['สรุปสัปดาห์', 'สรุปสัปดาห์นี้', 'สรุปเคสทั้งสัปดาห์', 'สรุปเคสสัปดาห์', 'สรุปรายสัปดาห์', 'สัปดาห์'];
// ชื่อปุ่ม Rich Menu ที่อาจตั้งต่างจากคำสั่งเดิม → แปลงเป็นคำสั่งเดิมให้ (ไม่ต้องแก้โค้ดส่วนเดิม)
var PTLN_BK_ALIAS_ = {
  'วันนี้': 'สรุปวันนี้', 'งานวันนี้': 'สรุปวันนี้',
  'ตรวจสอบข้อมูล': 'ตรวจสอบ', 'ตรวจข้อมูล': 'ตรวจสอบ', 'เช็คข้อมูล': 'ตรวจสอบ', 'ตรวจสอบข้อมูลวันนี้': 'ตรวจสอบ',
  'ปักหมุดบ้าน': 'ปักหมุด', 'พรุ่งนี้': 'สรุปพรุ่งนี้', 'งานพรุ่งนี้': 'สรุปพรุ่งนี้'
};
// ตัดไอคอน/สัญลักษณ์นำหน้า เช่น "📋 วันนี้" → "วันนี้" (ปุ่ม Rich Menu ที่ขึ้นต้นด้วยไอคอน)
function ptlnBkNormText_(s) { return String(s || '').trim().replace(/^[^\u0E00-\u0E7Fa-zA-Z0-9]+/, '').trim(); }
var PTLN_BK_MENU_CMDS_ = ['สรุปวันนี้', 'เมนู', 'menu', 'สรุปพรุ่งนี้', 'พรุ่งนี้', 'ตรวจสอบ', 'ตรวจข้อมูล', 'เช็คข้อมูล', 'ปักหมุด', 'ปักหมุดบ้าน'];
var PTLN_BK_RIGHTS_ = ['บัตรทอง', 'ผู้สูงอายุ', 'อสม.', 'ผู้พิการ', 'ข้าราชการ', 'ประกันสังคม', 'ชำระเงินเอง', 'อื่นๆ'];
var PTLN_BK_TREAT_ORDER_ = ['f', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
var PTLN_BK_TREAT_ = {
  f:  { label: 'ติดตามอาการ',    v: 'ติดตามการรักษา' },
  p1: { label: 'US+ES+HP',       v: 'อัลตราซาวน์ (US), กระตุ้นไฟฟ้า (ES), ประคบอุ่น (HP)' },
  p2: { label: 'ดึงหลัง+ES+HP',  v: 'ดึงหลัง (LT), กระตุ้นไฟฟ้า (ES), ประคบอุ่น (HP)' },
  p3: { label: 'ดึงคอ+ES+HP',    v: 'ดึงคอ (CT), กระตุ้นไฟฟ้า (ES), ประคบอุ่น (HP)' },
  p4: { label: 'ออกกำลังกาย',    v: 'ROM Exercise, AM (Active Move)' },
  p5: { label: 'IMC',            v: 'IMC' },
  p6: { label: 'Home Program',   v: 'HOME PROGRAM' }
};
var PTLN_BK_DAYS_TH_   = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
var PTLN_BK_MONTHS_TH_ = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// ════════════════════════════════════════════════════════════
//  0) Helpers
// ════════════════════════════════════════════════════════════
function ptlnBkParse_(raw) {
  var o = {};
  String(raw || '').split('&').forEach(function (kv) {
    var i = kv.indexOf('='); if (i < 0) return;
    var k = kv.substring(0, i), v = kv.substring(i + 1);
    try { v = decodeURIComponent(v); } catch (e) { /* ใช้ค่าดิบ */ }
    o[k] = v;
  });
  return o;
}
function ptlnBkData_(o) {
  var parts = ['act=bk'];
  Object.keys(o).forEach(function (k) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') parts.push(k + '=' + encodeURIComponent(o[k]));
  });
  var s = parts.join('&');
  if (s.length > 300) Logger.log('[Bk] postback data ยาวเกิน 300: ' + s.length);
  return s;
}
// เก็บเฉพาะพารามิเตอร์ที่ต้องส่งต่อระหว่างขั้น
function ptlnBkBase_(p, extra) {
  var o = { h: p.h, t: p.t, rb: p.rb, tp: p.tp, d: p.d, m: p.m, i: p.i };
  Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
  return o;
}
function ptlnBkLabel_(s, max) {
  var a = Array.from(String(s)), n = max || 20;
  return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join('');
}
function ptlnBkShortDate_(ds) {
  var d = ptlnYmdToUtc_(ds);
  return PTLN_BK_DAYS_TH_[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + PTLN_BK_MONTHS_TH_[d.getUTCMonth()];
}
function ptlnBkDn_(n) { return ptlnIsMaskNamesOn_() ? ptlnMaskThaiName_(n) : (n || ''); }
function ptlnBkTime_(m) { m = String(m || ''); return m.length === 4 ? m.slice(0, 2) + ':' + m.slice(2) : m; }
function ptlnBkTypeLabel_(t) { return t === 'h' ? '🏠 เยี่ยมบ้าน' : '🏥 OPD'; }
function ptlnBkColor_(t) { return t === 'h' ? PTLN_COLOR_HOME_ : PTLN_COLOR_OPD_; }
function ptlnBkText_(text, qr) {
  var m = { type: 'text', text: String(text).substring(0, 4900) };
  if (qr && qr.length) m.quickReply = { items: qr.slice(0, 13) };
  return m;
}
function ptlnBkQrPost_(label, data) { return { type: 'action', action: { type: 'postback', label: ptlnBkLabel_(label), data: data } }; }
function ptlnBkQrMsg_(label, text)  { return { type: 'action', action: { type: 'message',  label: ptlnBkLabel_(label), text: text } }; }
function ptlnBkQrCancel_() { return ptlnBkQrPost_('✖ ยกเลิก', ptlnBkData_({ s: 'x' })); }
function ptlnBkFlex_(alt, bubble, qr) {
  var m = { type: 'flex', altText: String(alt).substring(0, 400), contents: bubble };
  if (qr && qr.length) m.quickReply = { items: qr.slice(0, 13) };
  return m;
}
function ptlnBkBtn_(label, data, style, color) {
  var b = { type: 'button', height: 'sm', style: style || 'secondary', action: { type: 'postback', label: ptlnBkLabel_(label), data: data } };
  if (color) b.color = color;
  return b;
}
function ptlnBkBubble_(title, sub, color, bodyContents, footerContents) {
  var b = {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '16px',
      contents: [{ type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true }].concat(
        sub ? [{ type: 'text', text: sub, color: '#FFFFFFCC', size: 'xs', wrap: true, margin: 'xs' }] : []) },
    body: { type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'md', contents: bodyContents }
  };
  if (footerContents && footerContents.length) b.footer = { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: footerContents };
  return b;
}
// เลื่อน/ยกเลิกในโค้ดเดิมไม่ล้าง cache หน้าคิวว่างสาธารณะ → ล้างให้ที่นี่ (ไม่ทำให้พังถ้าไม่มีฟังก์ชัน)
function ptlnBkClearPublicCache_() { try { if (typeof clearPublicAvailabilityCache === 'function') clearPublicAvailabilityCache(); } catch (e) { /* ไม่ร้ายแรง */ } }
function ptlnBkNote_(text) { return { type: 'text', text: text, size: 'xs', color: PTLN_COLOR_WARN_, wrap: true }; }

// ── state (ข้อความที่รอรับต่อ) + ข้อมูลผู้ป่วยใหม่ ──
function ptlnBkGetState_(uid) {
  var r = CacheService.getScriptCache().get('ptln_bk_st_' + uid);
  try { return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function ptlnBkSetState_(uid, st) { CacheService.getScriptCache().put('ptln_bk_st_' + uid, JSON.stringify(st), PTLN_BK_STATE_TTL_); }
function ptlnBkClearState_(uid, alsoNp) {
  var c = CacheService.getScriptCache();
  c.remove('ptln_bk_st_' + uid);
  if (alsoNp) c.remove('ptln_bk_np_' + uid);
}
function ptlnBkNpGet_(uid) {
  var r = CacheService.getScriptCache().get('ptln_bk_np_' + uid);
  try { return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
}
function ptlnBkNpSet_(uid, np) { CacheService.getScriptCache().put('ptln_bk_np_' + uid, JSON.stringify(np), PTLN_BK_NP_TTL_); }

// ════════════════════════════════════════════════════════════
//  1) ข้อมูลผู้ป่วย / คิวว่าง
// ════════════════════════════════════════════════════════════
// โหลดโปรไฟล์ผู้ป่วยจากนัดล่าสุด (เติมข้อมูลให้เอง) — hn='~new' = ผู้ป่วยใหม่ที่พักไว้ใน cache
function ptlnBkLoadProfile_(uid, hn) {
  if (hn === '~new') {
    var np = ptlnBkNpGet_(uid);
    if (!np || !np.hn) return null;
    np.isNew = true; np.t = np.t || 'o'; np.treat = np.treat || 'ติดตามการรักษา';
    return np;
  }
  var hnNorm = normalizeHN(hn);
  if (!hnNorm) return null;
  var data = BOOKINGS_SHEET().getDataRange().getValues();
  var best = null, bestT = -Infinity;
  for (var i = 1; i < data.length; i++) {
    if (normalizeHN(data[i][6]) !== hnNorm) continue;
    var bd = parseFlexDate(data[i][2]); if (!bd) continue;
    if (bd.getTime() >= bestT) { bestT = bd.getTime(); best = data[i]; }
  }
  var prof = { hn: hnNorm, isNew: false };
  if (best) {
    var ap = String(best[12] || 'OPD');
    prof.name = String(best[7] || '');
    prof.phone = String(best[8] || '').replace(/^'/, '');
    prof.rights = String(best[9] || '');
    prof.treat = String(best[10] || '') || 'ติดตามการรักษา';
    prof.t = (ap === 'Home' || ap === 'เยี่ยมบ้าน') ? 'h' : 'o';
    prof.lastDate = dateToStr(parseFlexDate(best[2]));
    prof.lastTime = normalizeTime(best[3]);
    prof.lastTid = String(best[4] || '');
    prof.diagRaw = best[13] ? String(best[13]) : '';
    prof.diag2Raw = best[14] ? String(best[14]) : '';
    return prof;
  }
  var ps = PATIENTS_SHEET();
  if (ps && ps.getLastRow() >= 2) {
    var pd = ps.getDataRange().getValues();
    for (var j = 1; j < pd.length; j++) {
      if (normalizeHN(pd[j][1]) === hnNorm) {
        prof.name = String(pd[j][2] || ''); prof.phone = String(pd[j][3] || '').replace(/^'/, '');
        prof.rights = String(pd[j][4] || ''); prof.treat = 'ติดตามการรักษา'; prof.t = 'o';
        return prof;
      }
    }
  }
  return null;
}

// ผู้ป่วยที่เพิ่งนัดล่าสุด (distinct HN) — แถวท้ายชีต = ใหม่สุด
function ptlnBkRecent_(limit) {
  var data = BOOKINGS_SHEET().getDataRange().getValues();
  var seen = {}, out = [];
  for (var i = data.length - 1; i >= 1 && out.length < limit; i--) {
    var hn = normalizeHN(data[i][6]);
    if (!hn || hn === 'BLOCK' || seen[hn]) continue;
    seen[hn] = true;
    var ap = String(data[i][12] || 'OPD');
    out.push({ hn: hn, name: String(data[i][7] || ''), t: (ap === 'Home' || ap === 'เยี่ยมบ้าน') ? 'h' : 'o' });
  }
  return out;
}

// คิวว่างของวันหนึ่ง (type 'o' = OPD, 'h' = เยี่ยมบ้าน) — onlyTid ใช้ตอนเลื่อนนัด, prefTid = นักกายภาพเดิมมาก่อน
function ptlnBkFreeSlots_(ds, type, onlyTid, prefTid) {
  if (ptlnIsWeekendStr_(ds)) return [];
  var sched;
  try { sched = getDailySlots(ds); } catch (e) { Logger.log('[Bk] getDailySlots: ' + e.message); return []; }
  if (!sched || !sched.length || sched[0].isHoliday) return [];
  var today = dateToStr(new Date());
  var nowHM = Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm');
  var out = [];
  sched.forEach(function (t) {
    var isHome = /HOME/i.test(t.name || '');
    if ((type === 'h') !== isHome) return;
    if (onlyTid && String(t.id) !== String(onlyTid)) return;
    (t.slots || []).forEach(function (s) {
      if (s.booked) return;
      var tm = normalizeTime(s.time);
      if (!tm || tm === '12:00' || tm === '00:00') return;
      if (ds === today && tm <= nowHM) return;
      out.push({ time: tm, tid: String(t.id), tname: t.name, pref: prefTid && String(t.id) === String(prefTid) ? 0 : 1 });
    });
  });
  out.sort(function (a, b) { return a.time.localeCompare(b.time) || a.pref - b.pref; });
  var seen = {}, ded = [];
  out.forEach(function (s) { if (!seen[s.time]) { seen[s.time] = true; ded.push(s); } });
  return ded;
}

// วันทำการถัดไปที่มีคิวว่าง (ไม่เกิน 4 สัปดาห์)
function ptlnBkUpcomingDays_(type, onlyTid, prefTid, maxDays) {
  var today = dateToStr(new Date()), out = [];
  for (var i = 0; i < 28 && out.length < maxDays; i++) {
    var ds = ptlnAddDays_(today, i);
    if (ptlnIsWeekendStr_(ds)) continue;
    var n = ptlnBkFreeSlots_(ds, type, onlyTid, prefTid).length;
    if (n > 0) out.push({ ds: ds, n: n });
  }
  return out;
}

// ⭐ "นัดต่อ": วันเดิม +7 (ข้ามไปสัปดาห์ถัดไปถ้าผ่านมาแล้ว) เวลาเดิม หรือเวลาใกล้เคียงที่สุดในวันนั้น
function ptlnBkSuggest_(prof, type) {
  if (!prof || !prof.lastDate || prof.t !== type) return null;
  var today = dateToStr(new Date());
  var base = ptlnAddDays_(prof.lastDate, 7), guard = 0;
  while (base < today && guard++ < 60) base = ptlnAddDays_(base, 7);
  var slots = ptlnBkFreeSlots_(base, type, null, prof.lastTid);
  if (!slots.length) return null;
  var toMin = function (t) { var a = t.split(':'); return Number(a[0]) * 60 + Number(a[1]); };
  var target = toMin(prof.lastTime || '09:00'), best = slots[0];
  slots.forEach(function (s) { if (Math.abs(toMin(s.time) - target) < Math.abs(toMin(best.time) - target)) best = s; });
  return { ds: base, time: best.time, tid: best.tid };
}

function ptlnBkResolveTreat_(prof, tp) {
  if (tp && PTLN_BK_TREAT_[tp]) return PTLN_BK_TREAT_[tp].v;
  return (prof && prof.treat) || 'ติดตามการรักษา';
}

// ════════════════════════════════════════════════════════════
//  2) จุดเข้า — เรียกจาก ptlnHandleEvent_ (คืน true = จัดการแล้ว)
// ════════════════════════════════════════════════════════════
function ptlnBkHandleEvent_(ev, userId) {
  try {
    if (ev.type === 'postback') {
      var p = ptlnBkParse_(ev.postback && ev.postback.data);
      if (p.act !== 'bk') return false;
      ptlnBkOnPostback_(ev, userId, p, (ev.postback && ev.postback.params) || {});
      return true;
    }
    if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
      var text = String(ev.message.text || '').trim(), nt = ptlnBkNormText_(text);
      if (PTLN_BK_ALIAS_[nt]) { ptlnBkClearState_(userId, true); ev.message.text = PTLN_BK_ALIAS_[nt]; return false; }  // ให้ handler เดิมรับต่อ
      if (PTLN_BK_ENTRY_.indexOf(nt) !== -1 || PTLN_BK_WEEKLY_CMD_.indexOf(nt) !== -1 || PTLN_BK_MENU_CMDS_.indexOf(nt) !== -1) text = nt;
      if (PTLN_BK_ENTRY_.indexOf(text) !== -1) { ptlnBkClearState_(userId, true); ptlnBkStart_(ev, userId); return true; }
      if (PTLN_BK_WEEKLY_CMD_.indexOf(text) !== -1) { ptlnWkReplyNow_(ev); return true; }
      if (PTLN_BK_MENU_CMDS_.indexOf(text) !== -1) { ptlnBkClearState_(userId, true); return false; }
      var st = ptlnBkGetState_(userId);
      if (!st) return false;
      if (text === 'ยกเลิก') { ptlnBkClearState_(userId, true); ptlnReplyOrPush_(ev, [ptlnBkText_('ยกเลิกแล้วค่ะ พิมพ์ "นัดหมาย" เพื่อเริ่มใหม่')]); return true; }
      ptlnBkOnText_(ev, userId, text, st);
      return true;
    }
  } catch (e) {
    Logger.log('[Bk] ERROR: ' + e.message + '\n' + (e.stack || ''));
    try { ptlnReplyOrPush_(ev, [ptlnBkText_('⚠️ ระบบนัดหมายขัดข้อง: ' + e.message + '\nลองพิมพ์ "นัดหมาย" ใหม่อีกครั้งค่ะ')]); } catch (e2) { /* เงียบ */ }
    return true;
  }
  return false;
}

function ptlnBkOnPostback_(ev, uid, p, params) {
  switch (p.s) {
    case 'st': ptlnBkClearState_(uid, true); return ptlnBkStart_(ev, uid);
    case 'x':  ptlnBkClearState_(uid, true); return ptlnReplyOrPush_(ev, [ptlnBkText_('ยกเลิกแล้วค่ะ พิมพ์ "นัดหมาย" เพื่อเริ่มใหม่')]);
    case 'sr':
      ptlnBkSetState_(uid, { step: 'search' });
      return ptlnReplyOrPush_(ev, [ptlnBkText_('🔍 พิมพ์ชื่อ หรือ HN ของผู้ป่วย (อย่างน้อย 2 ตัวอักษร)', [ptlnBkQrCancel_()])]);
    case 'np':
      ptlnBkNpSet_(uid, {});
      ptlnBkSetState_(uid, { step: 'hn' });
      return ptlnReplyOrPush_(ev, [ptlnBkText_('🆕 ผู้ป่วยใหม่\nพิมพ์ HN ของผู้ป่วย', [ptlnBkQrMsg_('ไม่มี HN', 'ไม่มี HN'), ptlnBkQrCancel_()])]);
    case 'dy': return ptlnBkSendDays_(ev, uid, p, '');
    case 'rs': p.rb = p.b; return ptlnBkSendDays_(ev, uid, p, '');
    case 'tm': if (params && params.date) p.d = params.date; return ptlnBkSendTimes_(ev, uid, p, '');
    case 'cf': return ptlnBkConfirm_(ev, uid, p);
    case 'tp': return ptlnBkAskTreat_(ev, uid, p);
    case 'ok': return ptlnBkCommit_(ev, uid, p);
    case 'cx': return ptlnBkCancelAsk_(ev, p);
    case 'cy': return ptlnBkCancelDo_(ev, p);
    case 'nt': { // ผู้ป่วยใหม่: เลือกประเภทแล้ว → เลือกหัตถการ
      var np1 = ptlnBkNpGet_(uid); np1.t = p.t === 'h' ? 'h' : 'o'; ptlnBkNpSet_(uid, np1);
      var qr = PTLN_BK_TREAT_ORDER_.map(function (k) { return ptlnBkQrPost_(PTLN_BK_TREAT_[k].label, ptlnBkData_({ s: 'nz', tp: k })); });
      qr.push(ptlnBkQrCancel_());
      return ptlnReplyOrPush_(ev, [ptlnBkText_('✏️ เลือกหัตถการที่จะทำ (เปลี่ยนได้ที่หน้ายืนยัน)', qr)]);
    }
    case 'nz': { // ผู้ป่วยใหม่: เลือกหัตถการแล้ว → เลือกวัน
      var np2 = ptlnBkNpGet_(uid);
      np2.treat = ptlnBkResolveTreat_(null, p.tp); ptlnBkNpSet_(uid, np2);
      return ptlnBkSendDays_(ev, uid, { h: '~new', t: np2.t || 'o' }, '');
    }
    default:
      return ptlnReplyOrPush_(ev, [ptlnBkText_('ปุ่มนี้หมดอายุแล้วค่ะ พิมพ์ "นัดหมาย" เพื่อเริ่มใหม่')]);
  }
}

// ── ข้อความที่พิมพ์ระหว่างรอ (ค้นหา / ผู้ป่วยใหม่) ──
function ptlnBkOnText_(ev, uid, text, st) {
  if (st.step === 'search') {
    if (text.length < 2) return ptlnReplyOrPush_(ev, [ptlnBkText_('พิมพ์อย่างน้อย 2 ตัวอักษรนะคะ', [ptlnBkQrCancel_()])]);
    var list = searchHistorySuggestions(text) || [];
    if (!list.length) {
      return ptlnReplyOrPush_(ev, [ptlnBkText_('ไม่พบ "' + text + '" ลองพิมพ์ใหม่ หรือเริ่มผู้ป่วยใหม่',
        [ptlnBkQrPost_('🆕 ผู้ป่วยใหม่', ptlnBkData_({ s: 'np' })), ptlnBkQrCancel_()])]);
    }
    ptlnBkClearState_(uid, false);
    return ptlnReplyOrPush_(ev, [ptlnBkFlex_('เลือกผู้ป่วย', ptlnBkPatientListBubble_('พบ ' + list.length + ' ราย — แตะเพื่อเลือก', list)),
      ptlnBkText_('ไม่ใช่คนนี้?', [ptlnBkQrPost_('🔍 ค้นหาใหม่', ptlnBkData_({ s: 'sr' })), ptlnBkQrPost_('🆕 ผู้ป่วยใหม่', ptlnBkData_({ s: 'np' })), ptlnBkQrCancel_()])]);
  }

  var np = ptlnBkNpGet_(uid);
  if (st.step === 'hn') {
    if (text === 'ไม่มี HN') {
      np.hn = 'TEMP-' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMddHHmmss'); // ไม่ซ้ำ (ใช้เวลาเป็นเลข) — ผู้ป่วยที่ยังไม่มี HN จริง แก้เป็น HN จริงทีหลังได้
    } else {
      var hn = normalizeHN(text);
      if (!/^[0-9A-Za-z\-\/]{1,20}$/.test(hn)) return ptlnReplyOrPush_(ev, [ptlnBkText_('HN ไม่ถูกต้อง ลองพิมพ์ใหม่ (ตัวเลข/ตัวอักษร ไม่มีช่องว่าง)', [ptlnBkQrMsg_('ไม่มี HN', 'ไม่มี HN'), ptlnBkQrCancel_()])]);
      var exist = ptlnBkLoadProfile_(uid, hn);
      if (exist && exist.name) { // HN นี้มีในระบบแล้ว → ใช้ข้อมูลเดิม ไม่สร้างซ้ำ
        ptlnBkClearState_(uid, true);
        return ptlnBkSendDays_(ev, uid, { h: hn }, 'พบ HN ' + hn + ' ในระบบแล้ว (' + ptlnBkDn_(exist.name) + ') — ใช้ข้อมูลเดิม');
      }
      np.hn = hn;
    }
    ptlnBkNpSet_(uid, np);
    ptlnBkSetState_(uid, { step: 'name' });
    return ptlnReplyOrPush_(ev, [ptlnBkText_('พิมพ์ ชื่อ-นามสกุล ผู้ป่วย', [ptlnBkQrCancel_()])]);
  }
  if (st.step === 'name') {
    if (text.length < 2 || text.length > 80) return ptlnReplyOrPush_(ev, [ptlnBkText_('ชื่อสั้นหรือยาวเกินไป ลองพิมพ์ใหม่', [ptlnBkQrCancel_()])]);
    np.name = text; ptlnBkNpSet_(uid, np);
    ptlnBkSetState_(uid, { step: 'phone' });
    return ptlnReplyOrPush_(ev, [ptlnBkText_('พิมพ์เบอร์โทร (9–10 หลัก)', [ptlnBkQrMsg_('ข้าม (ไม่มีเบอร์)', 'ข้าม'), ptlnBkQrCancel_()])]);
  }
  if (st.step === 'phone') {
    if (text === 'ข้าม') np.phone = 'ไม่พบข้อมูล';
    else {
      var digits = text.replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 10) return ptlnReplyOrPush_(ev, [ptlnBkText_('เบอร์ไม่ถูกต้อง ลองพิมพ์ใหม่ เช่น 0812345678', [ptlnBkQrMsg_('ข้าม (ไม่มีเบอร์)', 'ข้าม'), ptlnBkQrCancel_()])]);
      if (digits.length === 9) digits = '0' + digits;
      np.phone = digits.slice(0, 3) + '-' + digits.slice(3);
    }
    ptlnBkNpSet_(uid, np);
    ptlnBkSetState_(uid, { step: 'rights' });
    return ptlnReplyOrPush_(ev, [ptlnBkText_('เลือกสิทธิการรักษา',
      PTLN_BK_RIGHTS_.map(function (r) { return ptlnBkQrMsg_(r, r); }).concat([ptlnBkQrCancel_()]))]);
  }
  if (st.step === 'rights') {
    np.rights = text.substring(0, 40); ptlnBkNpSet_(uid, np);
    ptlnBkClearState_(uid, false);
    return ptlnReplyOrPush_(ev, [ptlnBkText_('เลือกประเภทการนัด',
      [ptlnBkQrPost_('🏥 OPD', ptlnBkData_({ s: 'nt', t: 'o' })), ptlnBkQrPost_('🏠 เยี่ยมบ้าน', ptlnBkData_({ s: 'nt', t: 'h' })), ptlnBkQrCancel_()])]);
  }
  ptlnBkClearState_(uid, false);
  return ptlnReplyOrPush_(ev, [ptlnBkText_('พิมพ์ "นัดหมาย" เพื่อเริ่มใหม่ค่ะ')]);
}

// ════════════════════════════════════════════════════════════
//  3) หน้าจอแต่ละขั้น
// ════════════════════════════════════════════════════════════
function ptlnBkPatientRow_(name, hn, sub, data, color) {
  return {
    type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center',
    action: { type: 'postback', data: data },
    contents: [
      { type: 'box', layout: 'vertical', flex: 1, contents: [
        { type: 'text', text: ptlnBkDn_(name) || 'ไม่ระบุชื่อ', weight: 'bold', size: 'sm', wrap: true, color: '#111111' },
        { type: 'text', text: 'HN ' + hn + (sub ? ' • ' + sub : ''), size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, wrap: true, margin: 'xs' } ] },
      { type: 'text', text: '›', size: 'lg', color: color || PTLN_COLOR_TEXT_SOFT_, flex: 0, gravity: 'center' }
    ]
  };
}
function ptlnBkPatientListBubble_(title, list) {
  var rows = [];
  list.slice(0, 8).forEach(function (x, i) {
    if (i > 0) rows.push({ type: 'separator', margin: 'md' });
    rows.push(ptlnBkPatientRow_(x.name, x.hn, x.rights || '', ptlnBkData_({ s: 'dy', h: x.hn })));
  });
  return ptlnBkBubble_('➕ นัดหมาย', title, PTLN_COLOR_BRAND_, rows);
}

// หน้าแรก: ผู้ป่วยล่าสุด + ค้นหา + ผู้ป่วยใหม่
function ptlnBkStart_(ev, uid) {
  var recent = ptlnBkRecent_(5), rows = [];
  if (recent.length) {
    rows.push({ type: 'text', text: 'ผู้ป่วยล่าสุด — แตะเพื่อนัดต่อ', size: 'xs', color: PTLN_COLOR_TEXT_SOFT_ });
    recent.forEach(function (x, i) {
      if (i > 0) rows.push({ type: 'separator', margin: 'sm' });
      rows.push(ptlnBkPatientRow_(x.name, x.hn, ptlnBkTypeLabel_(x.t), ptlnBkData_({ s: 'dy', h: x.hn })));
    });
  } else rows.push({ type: 'text', text: 'ยังไม่มีประวัติผู้ป่วย', size: 'sm', color: PTLN_COLOR_TEXT_SOFT_ });
  var bubble = ptlnBkBubble_('➕ นัดหมาย', 'เลือกผู้ป่วย หรือเริ่มรายใหม่', PTLN_COLOR_BRAND_, rows,
    [ptlnBkBtn_('🔍 ค้นหาชื่อ / HN', ptlnBkData_({ s: 'sr' }), 'primary', PTLN_COLOR_BRAND_),
     ptlnBkBtn_('🆕 ผู้ป่วยใหม่ (ไม่มีในระบบ)', ptlnBkData_({ s: 'np' }), 'secondary')]);
  return ptlnReplyOrPush_(ev, [ptlnBkFlex_('นัดหมาย — เลือกผู้ป่วย', bubble)]);
}

// ขั้นเลือกวัน (ใช้ทั้งนัดใหม่และเลื่อนนัด)
function ptlnBkSendDays_(ev, uid, p, notice) {
  var isResched = !!p.rb, prof = null, name = '', type = p.t || 'o', onlyTid = '', prefTid = '', hnShow = '';
  if (isResched) {
    var det = getVisitFullDetail(p.rb);
    if (!det || !det.success) return ptlnReplyOrPush_(ev, [ptlnBkText_('ไม่พบนัดนี้แล้วค่ะ (อาจถูกยกเลิกไปแล้ว)')]);
    name = det.name; hnShow = det.hn; onlyTid = getBookingTherapist(p.rb) || '';
  } else {
    prof = ptlnBkLoadProfile_(uid, p.h);
    if (!prof) return ptlnReplyOrPush_(ev, [ptlnBkText_('ไม่พบข้อมูลผู้ป่วย — พิมพ์ "นัดหมาย" เพื่อเริ่มใหม่')]);
    name = prof.name; hnShow = prof.hn; prefTid = prof.lastTid || '';
    if (!p.t) type = prof.t || 'o';
  }
  p.t = type;
  var days = ptlnBkUpcomingDays_(type, onlyTid, prefTid, 5);
  var sug = (!isResched && prof) ? ptlnBkSuggest_(prof, type) : null;
  var todayStr = dateToStr(new Date());

  var body = [];
  if (notice) body.push(ptlnBkNote_(notice));
  if (sug) {
    body.push({ type: 'text', text: 'นัดต่อ: ' + ptlnThaiDateLabel_(sug.ds) + ' เวลา ' + sug.time + ' น.', size: 'sm', weight: 'bold', wrap: true, color: ptlnBkColor_(type) });
    body.push(ptlnBkBtn_('⭐ นัดต่อ ' + sug.ds.slice(8) + '/' + sug.ds.slice(5, 7) + ' ' + sug.time,
      ptlnBkData_(ptlnBkBase_(p, { s: 'cf', d: sug.ds, m: sug.time.replace(':', ''), i: sug.tid })), 'primary', ptlnBkColor_(type)));
    body.push({ type: 'text', text: 'เวลาเดิม +7 วัน (นักกายภาพคนเดิม) • หรือเลือกวันอื่นด้านล่าง', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, wrap: true });
    body.push({ type: 'separator' });
  }
  if (days.length) {
    body.push({ type: 'text', text: 'เลือกวัน (ตัวเลข = จำนวนคิวว่าง)', size: 'xs', color: PTLN_COLOR_TEXT_SOFT_ });
    days.forEach(function (d) {
      body.push(ptlnBkBtn_(ptlnBkShortDate_(d.ds) + ' (' + d.n + ')', ptlnBkData_(ptlnBkBase_(p, { s: 'tm', d: d.ds })), 'secondary'));
    });
  } else {
    body.push({ type: 'text', text: 'ไม่พบคิวว่างใน 4 สัปดาห์ข้างหน้า' + (type === 'h' ? ' (เยี่ยมบ้าน)' : ''), size: 'sm', color: PTLN_COLOR_WARN_, wrap: true });
  }
  body.push({ type: 'button', height: 'sm', style: 'link', action: {
    type: 'datetimepicker', label: '📅 เลือกวันอื่น', mode: 'date', data: ptlnBkData_(ptlnBkBase_(p, { s: 'tm', d: '' })),
    initial: todayStr, min: todayStr, max: ptlnAddDays_(todayStr, 90) } });

  var title = isResched ? '🔁 เลื่อนนัด' : '📅 เลือกวันนัด';
  var sub = ptlnBkDn_(name) + ' • HN ' + hnShow + ' • ' + ptlnBkTypeLabel_(type);
  var qr = [];
  if (!isResched) qr.push(ptlnBkQrPost_(type === 'o' ? '🏠 เปลี่ยนเป็นเยี่ยมบ้าน' : '🏥 เปลี่ยนเป็น OPD', ptlnBkData_(ptlnBkBase_(p, { s: 'dy', t: type === 'o' ? 'h' : 'o', d: '', m: '', i: '' }))));
  qr.push(ptlnBkQrCancel_());
  return ptlnReplyOrPush_(ev, [ptlnBkFlex_(title + ' ' + name, ptlnBkBubble_(title, sub, ptlnBkColor_(type), body), qr)]);
}

// ขั้นเลือกเวลา
function ptlnBkSendTimes_(ev, uid, p, notice) {
  var ds = p.d, today = dateToStr(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds || '') || ds < today) return ptlnBkSendDays_(ev, uid, p, 'วันที่ไม่ถูกต้อง กรุณาเลือกใหม่');
  var onlyTid = p.rb ? (getBookingTherapist(p.rb) || '') : '', prefTid = '';
  if (!p.rb) { var pr = ptlnBkLoadProfile_(uid, p.h); prefTid = pr ? (pr.lastTid || '') : ''; }
  var slots = ptlnBkFreeSlots_(ds, p.t || 'o', onlyTid, prefTid);
  if (!slots.length) return ptlnBkSendDays_(ev, uid, p, 'วัน' + ptlnBkShortDate_(ds) + ' ไม่มีคิวว่าง (หรือเป็นวันหยุด) เลือกวันอื่นนะคะ');
  var body = [];
  if (notice) body.push(ptlnBkNote_(notice));
  body.push({ type: 'text', text: 'วัน' + ptlnThaiDateLabel_(ds).replace(/^วัน/, ''), weight: 'bold', size: 'sm', wrap: true });
  for (var i = 0; i < slots.length && i < 24; i += 4) {
    body.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: slots.slice(i, i + 4).map(function (s) {
      return ptlnBkBtn_(s.time, ptlnBkData_(ptlnBkBase_(p, { s: 'cf', d: ds, m: s.time.replace(':', ''), i: s.tid })), 'secondary');
    }) });
  }
  var bubble = ptlnBkBubble_('⏰ เลือกเวลา', ptlnBkTypeLabel_(p.t || 'o') + ' • ว่าง ' + slots.length + ' ช่วง', ptlnBkColor_(p.t || 'o'), body);
  return ptlnReplyOrPush_(ev, [ptlnBkFlex_('เลือกเวลานัด', bubble,
    [ptlnBkQrPost_('◀ เลือกวันอื่น', ptlnBkData_(ptlnBkBase_(p, { s: p.rb ? 'rs' : 'dy', b: p.rb, d: '', m: '', i: '' }))), ptlnBkQrCancel_()])]);
}

// หน้ายืนยัน
function ptlnBkConfirm_(ev, uid, p) {
  var time = ptlnBkTime_(p.m), tname = buildTherapistMap()[p.i] || '-', rows;
  var title = p.rb ? '🔁 ยืนยันเลื่อนนัด' : '✅ ยืนยันนัดหมาย', name, hn;
  if (p.rb) {
    var det = getVisitFullDetail(p.rb);
    if (!det || !det.success) return ptlnReplyOrPush_(ev, [ptlnBkText_('ไม่พบนัดนี้แล้วค่ะ')]);
    name = det.name; hn = det.hn;
    rows = [ptlnDetailRow_('นัดเดิม', det.date + ' ' + det.time + ' น.'), ptlnDetailRow_('นัดใหม่', ptlnBkShortDate_(p.d) + ' ' + time + ' น.'), ptlnDetailRow_('นักกายภาพ', tname)];
  } else {
    var prof = ptlnBkLoadProfile_(uid, p.h);
    if (!prof) return ptlnReplyOrPush_(ev, [ptlnBkText_('ข้อมูลผู้ป่วยหมดอายุ — พิมพ์ "นัดหมาย" เริ่มใหม่ค่ะ')]);
    name = prof.name; hn = prof.hn;
    rows = [
      ptlnDetailRow_('📅 วัน', ptlnThaiDateLabel_(p.d)), ptlnDetailRow_('⏰ เวลา', time + ' น.'),
      ptlnDetailRow_('🩺 นักกายภาพ', tname), ptlnDetailRow_('ประเภท', ptlnBkTypeLabel_(p.t || 'o')),
      ptlnDetailRow_('💳 สิทธิ', prof.rights || '-'), ptlnDetailRow_('🧾 หัตถการ', ptlnBkResolveTreat_(prof, p.tp))
    ];
    if (prof.isNew) rows.push({ type: 'text', text: '🆕 ผู้ป่วยใหม่ — ระบบจะลงทะเบียนในฐานข้อมูลให้อัตโนมัติ', size: 'xxs', color: PTLN_COLOR_HOME_, wrap: true });
  }
  var foot = [ptlnBkBtn_(p.rb ? '✅ ยืนยันเลื่อนนัด' : '✅ ยืนยันนัด', ptlnBkData_(ptlnBkBase_(p, { s: 'ok' })), 'primary', ptlnBkColor_(p.t || 'o')),
    ptlnBkBtn_('⏰ เปลี่ยนเวลา', ptlnBkData_(ptlnBkBase_(p, { s: 'tm', m: '', i: '' })), 'secondary')];
  if (!p.rb) foot.push(ptlnBkBtn_('✏️ เปลี่ยนหัตถการ', ptlnBkData_(ptlnBkBase_(p, { s: 'tp' })), 'secondary'));
  foot.push(ptlnBkBtn_('✖ ยกเลิก', ptlnBkData_({ s: 'x' }), 'link'));
  var bubble = ptlnBkBubble_(title, ptlnBkDn_(name) + ' • HN ' + hn, ptlnBkColor_(p.t || 'o'), rows, foot);
  return ptlnReplyOrPush_(ev, [ptlnBkFlex_('ยืนยันนัด ' + name, bubble)]);
}

function ptlnBkAskTreat_(ev, uid, p) {
  var prof = ptlnBkLoadProfile_(uid, p.h), qr = [];
  if (prof && prof.treat && !prof.isNew) qr.push(ptlnBkQrPost_('เหมือนครั้งก่อน', ptlnBkData_(ptlnBkBase_(p, { s: 'cf', tp: '' }))));
  PTLN_BK_TREAT_ORDER_.forEach(function (k) { qr.push(ptlnBkQrPost_(PTLN_BK_TREAT_[k].label, ptlnBkData_(ptlnBkBase_(p, { s: 'cf', tp: k })))); });
  return ptlnReplyOrPush_(ev, [ptlnBkText_('✏️ เลือกหัตถการ' + (prof && prof.treat ? '\nครั้งก่อน: ' + prof.treat : ''), qr.slice(0, 12).concat([ptlnBkQrCancel_()]))]);
}

// บันทึกจริง (กันจองชน + กันกดซ้ำ)
function ptlnBkCommit_(ev, uid, p) {
  var time = ptlnBkTime_(p.m);
  var dupKey = ('ptln_bkok_' + uid.slice(-8) + '_' + [p.h || p.rb, p.d, p.m, p.i].join('_')).substring(0, 240);
  var cache = CacheService.getScriptCache();
  if (cache.get(dupKey)) return ptlnReplyOrPush_(ev, [ptlnBkText_('✅ บันทึกนัดนี้ไปแล้วค่ะ (ไม่ต้องกดซ้ำ)')]);

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return ptlnReplyOrPush_(ev, [ptlnBkText_('ระบบกำลังบันทึกรายการอื่นอยู่ กดยืนยันอีกครั้งใน 5 วินาทีนะคะ')]); }
  var res, name, hn, bid, prof = null;
  try {
    if (p.rb) {
      var det = getVisitFullDetail(p.rb);
      name = det && det.success ? det.name : ''; hn = det && det.success ? det.hn : '';
      res = rescheduleBooking(p.rb, p.d, time); bid = p.rb;
      if (res && res.success) ptlnBkClearPublicCache_();
    } else {
      prof = ptlnBkLoadProfile_(uid, p.h);
      if (!prof) return ptlnReplyOrPush_(ev, [ptlnBkText_('ข้อมูลผู้ป่วยหมดอายุ — พิมพ์ "นัดหมาย" เริ่มใหม่ค่ะ')]);
      name = prof.name; hn = prof.hn;
      var d1 = null, d2 = null;
      try { if (prof.diagRaw) d1 = JSON.parse(prof.diagRaw); } catch (e1) {}
      try { if (prof.diag2Raw) d2 = JSON.parse(prof.diag2Raw); } catch (e2) {}
      res = submitBooking({
        date: p.d, time: time, masseuseId: p.i, hn: prof.hn, name: prof.name, phone: prof.phone || 'ไม่พบข้อมูล',
        rights: prof.rights || 'ไม่พบข้อมูล', treatmentType: ptlnBkResolveTreat_(prof, p.tp),
        appointmentType: (p.t === 'h') ? 'Home' : 'OPD', diagnosis2: d2
      });
      bid = res && res.bookingId;
      if (res && res.success && bid && (d1 || d2)) { try { updateDiagnosis(bid, d1, d2); } catch (e3) { Logger.log('[Bk] updateDiagnosis: ' + e3.message); } }
    }
  } finally {
    try { lock.releaseLock(); } catch (e4) { /* ไม่ร้ายแรง */ }
  }

  if (!res || !res.success) {
    var msg = (res && res.message) || 'บันทึกไม่สำเร็จ';
    if (/คิว/.test(msg)) return ptlnBkSendTimes_(ev, uid, p, '⚠️ ' + msg + ' — เลือกเวลาอื่นที่ว่างได้เลยค่ะ');
    return ptlnReplyOrPush_(ev, [ptlnBkText_('⚠️ ' + msg)]);
  }
  cache.put(dupKey, '1', 120);
  if (p.h === '~new') ptlnBkClearState_(uid, true);

  var tname = buildTherapistMap()[p.i] || (p.rb ? (buildTherapistMap()[getBookingTherapist(bid)] || '-') : '-');
  var rows = [ptlnDetailRow_('📅 วัน', ptlnThaiDateLabel_(p.d)), ptlnDetailRow_('⏰ เวลา', time + ' น.'), ptlnDetailRow_('🩺 นักกายภาพ', tname)];
  if (!p.rb) rows.push(ptlnDetailRow_('ประเภท', ptlnBkTypeLabel_(p.t || 'o')), ptlnDetailRow_('🧾 หัตถการ', ptlnBkResolveTreat_(prof, p.tp)));
  var foot = [
    ptlnBkBtn_('🔁 เลื่อนนัด', ptlnBkData_({ s: 'rs', b: bid, t: p.t || 'o' }), 'secondary'),
    ptlnBkBtn_('🗑️ ยกเลิกนัด', ptlnBkData_({ s: 'cx', b: bid }), 'secondary'),
    ptlnBkBtn_('➕ นัดอีกราย', ptlnBkData_({ s: 'st' }), 'link')
  ];
  var title = p.rb ? '✅ เลื่อนนัดแล้ว' : '✅ จองสำเร็จ';
  return ptlnReplyOrPush_(ev, [ptlnBkFlex_(title + ' ' + name, ptlnBkBubble_(title, ptlnBkDn_(name) + ' • HN ' + hn, PTLN_COLOR_OPD_, rows, foot))]);
}

function ptlnBkCancelAsk_(ev, p) {
  var det = getVisitFullDetail(p.b);
  if (!det || !det.success) return ptlnReplyOrPush_(ev, [ptlnBkText_('ไม่พบนัดนี้แล้วค่ะ (อาจถูกยกเลิกไปแล้ว)')]);
  var bubble = ptlnBkBubble_('🗑️ ยืนยันยกเลิกนัด?', ptlnBkDn_(det.name) + ' • HN ' + det.hn, PTLN_COLOR_WARN_,
    [ptlnDetailRow_('วัน', det.date), ptlnDetailRow_('เวลา', det.time + ' น.'), { type: 'text', text: 'การยกเลิกจะลบนัดนี้ออกจากระบบ กู้คืนไม่ได้', size: 'xxs', color: PTLN_COLOR_WARN_, wrap: true }],
    [ptlnBkBtn_('ยืนยันยกเลิกนัด', ptlnBkData_({ s: 'cy', b: p.b }), 'primary', PTLN_COLOR_WARN_), ptlnBkBtn_('ไม่ยกเลิก', ptlnBkData_({ s: 'x' }), 'link')]);
  return ptlnReplyOrPush_(ev, [ptlnBkFlex_('ยืนยันยกเลิกนัด', bubble)]);
}
function ptlnBkCancelDo_(ev, p) {
  var res = cancelBooking(p.b);
  if (res && res.success) ptlnBkClearPublicCache_();
  return ptlnReplyOrPush_(ev, [ptlnBkText_(res && res.success ? '🗑️ ยกเลิกนัดเรียบร้อยแล้วค่ะ' : '⚠️ ไม่พบนัดนี้ (อาจถูกยกเลิกไปแล้ว)',
    [ptlnBkQrPost_('➕ นัดใหม่', ptlnBkData_({ s: 'st' }))])]);
}

// ════════════════════════════════════════════════════════════
//  (B) สรุปสัปดาห์เชิงคลินิก
// ════════════════════════════════════════════════════════════
var PTLN_WK_MACHINE_  = ['อัลตราซาวน์ (US)', 'กระตุ้นไฟฟ้า (ES)', 'ประคบอุ่น (HP)', 'ดึงหลัง (LT)', 'ดึงคอ (CT)', 'IMC'];
var PTLN_WK_EXERCISE_ = ['ROM Exercise', 'AE (Aerobic)', 'AM (Active Move)', 'AE/AM', 'Ambulation Training'];

function ptlnWkMonday_(ds) { var dow = ptlnYmdToUtc_(ds).getUTCDay(); return ptlnAddDays_(ds, -((dow + 6) % 7)); }

function ptlnWkBuild_(mondayStr) {
  var friStr = ptlnAddDays_(mondayStr, 4), pMon = ptlnAddDays_(mondayStr, -7), pFri = ptlnAddDays_(mondayStr, -3);
  var todayStr = dateToStr(new Date());
  var outMap = {}, os = OUTCOMES_SHEET();
  if (os && os.getLastRow() >= 2) {
    os.getRange(2, 1, os.getLastRow() - 1, 10).getValues().forEach(function (r) {
      var id = (r[1] === null || r[1] === undefined) ? '' : String(r[1]).trim();
      if (id) outMap[id] = { vb: parseFloat(r[5]), va: parseFloat(r[6]), bar: parseFloat(r[7]), goal: String(r[8]) === 'yes' };
    });
  }
  var c = { visits: 0, opd: 0, home: 0, hn: {}, groups: {}, icd: {}, treat: {}, cat: { machine: 0, exercise: 0, program: 0, other: 0 },
    followN: 0, outN: 0, vasN: 0, vbSum: 0, vaSum: 0, improved: 0, better: [], worse: [], barN: 0, barSum: 0, barByHn: {}, goal: 0,
    due: 0, dueDiag: 0, dueOut: 0, complete: 0, missing: [], diagN: 0 };
  var prevVisits = 0;
  var siteIcd = ptlnSiteIcdMap_();
  var rows = BOOKINGS_SHEET().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i], bd = parseFlexDate(r[2]); if (!bd) continue;
    var ds = dateToStr(bd), hn = normalizeHN(r[6]);
    if (hn === 'BLOCK' || ptlnIsWeekendStr_(ds)) continue;
    if (ds >= pMon && ds <= pFri) { prevVisits++; continue; }
    if (ds < mondayStr || ds > friStr || ds > todayStr) continue;

    var bid = (r[1] === null || r[1] === undefined) ? '' : String(r[1]).trim();
    var ap = String(r[12] || 'OPD'), isHome = (ap === 'Home' || ap === 'เยี่ยมบ้าน');
    c.visits++; if (isHome) c.home++; else c.opd++;
    if (hn) c.hn[hn] = true;

    // V33: "ลง ICD-10 แล้ว" = มีรหัสจากหลัก/รอง/รายตำแหน่ง (นิยามเดียวกับรายงานตรวจสอบรายวัน)
    var hasDiag = ptlnBookingHasIcd_(r, siteIcd);
    if (hasDiag) c.diagN++;
    // กลุ่มโรค/ICD พบบ่อย: ใช้ ICD หลัก; ถ้านัดนั้นไม่มีหลัก ใช้ ICD รอง เพื่อไม่ให้นัดหายจากสถิติ
    var dxRaw = r[13] || r[14];
    if (dxRaw) {
      try {
        var dg = JSON.parse(dxRaw);
        var grp = (dg.group || 'ไม่ระบุ').replace(/^[\u{1F300}-\u{1FFFF}\u2600-\u27FF]\s*/u, '').trim();
        c.groups[grp] = (c.groups[grp] || 0) + 1;
        if (dg.icd10) { var k = dg.icd10 + ' ' + (dg.label || ''); c.icd[k] = (c.icd[k] || 0) + 1; }
      } catch (e) { /* ข้ามแถวที่ JSON เสีย */ }
    }
    splitTreatmentType_(r[10]).forEach(function (t) {
      if (t === 'ติดตามการรักษา') { c.followN++; return; }
      c.treat[t] = (c.treat[t] || 0) + 1;
      if (PTLN_WK_MACHINE_.indexOf(t) !== -1) c.cat.machine++;
      else if (PTLN_WK_EXERCISE_.indexOf(t) !== -1) c.cat.exercise++;
      else if (t === 'HOME PROGRAM') c.cat.program++;
      else c.cat.other++;
    });

    var o = outMap[bid];
    if (o) {
      c.outN++;
      if (!isNaN(o.vb) && !isNaN(o.va)) {
        c.vasN++; c.vbSum += o.vb; c.vaSum += o.va;
        if (o.vb - o.va >= 2) { c.improved++; c.better.push({ bid: bid, name: String(r[7] || ''), hn: hn, vb: o.vb, va: o.va, ds: ds, drop: o.vb - o.va }); }
        else if (o.va >= o.vb && o.vb >= 4) c.worse.push({ bid: bid, name: String(r[7] || ''), hn: hn, vb: o.vb, va: o.va, ds: ds });
      }
      if (!isNaN(o.bar)) { c.barN++; c.barSum += o.bar; if (hn) (c.barByHn[hn] = c.barByHn[hn] || []).push({ ds: ds, v: o.bar }); }
      if (o.goal) c.goal++;
    }
    var tm = normalizeTime(r[3]);
    if (!(ds === todayStr && tm >= PTLN_AUDIT_CUTOFF_HHMM_)) {
      c.due++; if (hasDiag) c.dueDiag++; if (o) c.dueOut++;
      if (o && hasDiag) c.complete++;
      else c.missing.push({ bid: bid, name: String(r[7] || ''), hn: hn, ds: ds, time: tm, kind: isHome ? 'home' : 'opd', noOut: !o, noDiag: !hasDiag });
    }
  }
  // Barthel เปลี่ยน: ผู้ป่วยที่มีคะแนนตั้งแต่ 2 ครั้งในสัปดาห์ → ครั้งสุดท้าย − ครั้งแรก
  var bChg = [], bUp = 0;
  Object.keys(c.barByHn).forEach(function (h) {
    var a = c.barByHn[h].sort(function (x, y) { return x.ds < y.ds ? -1 : x.ds > y.ds ? 1 : 0; });
    if (a.length >= 2 && a[0].ds !== a[a.length - 1].ds) { var dd = a[a.length - 1].v - a[0].v; bChg.push(dd); if (dd > 0) bUp++; }
  });
  c.better.sort(function (x, y) { return y.drop - x.drop; });
  c.worse.sort(function (x, y) { return y.va - x.va; });
  var top = function (obj, n) { return Object.keys(obj).map(function (k) { return { name: k, count: obj[k] }; }).sort(function (a, b) { return b.count - a.count; }).slice(0, n); };
  var mon = ptlnYmdToUtc_(mondayStr), fri = ptlnYmdToUtc_(friStr);
  return {
    mondayStr: mondayStr, friStr: friStr, prevVisits: prevVisits, c: c,
    label: mon.getUTCDate() + ' ' + PTLN_TH_MONTHS_[mon.getUTCMonth() + 1] + ' – ' + fri.getUTCDate() + ' ' + PTLN_TH_MONTHS_[fri.getUTCMonth() + 1] + ' ' + (fri.getUTCFullYear() + 543),
    patients: Object.keys(c.hn).length, groups: top(c.groups, 6), icds: top(c.icd, 5), procs: top(c.treat, 6),
    vasBefore: c.vasN ? c.vbSum / c.vasN : null, vasAfter: c.vasN ? c.vaSum / c.vasN : null,
    barthelAvg: c.barN ? c.barSum / c.barN : null,
    barthelChange: bChg.length ? bChg.reduce(function (s, x) { return s + x; }, 0) / bChg.length : null, barthelN: bChg.length, barthelUp: bUp
  };
}

// แถวเคสที่กดเปิดรายละเอียดได้ (ใช้ในการ์ดผลลัพธ์)
function ptlnWkCaseRow_(x, tag) {
  return { type: 'box', layout: 'horizontal', margin: 'sm', alignItems: 'center',
    action: { type: 'postback', data: 'act=case&kind=opd&b=' + encodeURIComponent(x.bid) + '&d=' + x.ds, displayText: '📋 ' + ptlnBkDn_(x.name) },
    contents: [ { type: 'text', text: ptlnBkDn_(x.name) + ' (' + tag + ')', size: 'xxs', flex: 1, wrap: true }, { type: 'text', text: '›', flex: 0, color: PTLN_COLOR_TEXT_SOFT_ } ] };
}
function ptlnWkDelta_(cur, prev) {
  var d = cur - prev;
  if (!prev && !cur) return { text: '–', color: PTLN_COLOR_TEXT_SOFT_ };
  if (d > 0) return { text: '▲ +' + d + ' จากสัปดาห์ก่อน (' + prev + ')', color: PTLN_COLOR_OPD_ };
  if (d < 0) return { text: '▼ ' + d + ' จากสัปดาห์ก่อน (' + prev + ')', color: PTLN_COLOR_WARN_ };
  return { text: '± 0 เท่าสัปดาห์ก่อน (' + prev + ')', color: PTLN_COLOR_TEXT_SOFT_ };
}
function ptlnWkBar_(label, count, total, color) {
  var pct = total ? Math.round(count / total * 100) : 0, w = Math.max(1, Math.min(99, pct));
  return { type: 'box', layout: 'vertical', margin: 'md', spacing: 'xs', contents: [
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: label, size: 'xs', flex: 5, wrap: true, color: '#111111' },
      { type: 'text', text: count + ' (' + pct + '%)', size: 'xs', weight: 'bold', align: 'end', flex: 3, color: color } ] },
    { type: 'box', layout: 'horizontal', height: '8px', backgroundColor: '#EEEEEE', cornerRadius: '4px', contents: [
      { type: 'box', layout: 'vertical', flex: w, backgroundColor: color, cornerRadius: '4px', contents: [{ type: 'filler' }] },
      { type: 'filler', flex: 100 - w } ] }
  ] };
}
function ptlnWkTxt_(text, size, color, bold) {
  var t = { type: 'text', text: text, size: size || 'xs', wrap: true, margin: 'sm' };
  if (color) t.color = color; if (bold) t.weight = 'bold'; return t;
}
function ptlnWkHeader_(title, color) {
  return { type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '16px', contents: [
    { type: 'text', text: 'PT STATION • สรุปสัปดาห์', color: '#FFFFFFAA', size: 'xs', weight: 'bold' },
    { type: 'text', text: title, color: '#FFFFFF', size: 'lg', weight: 'bold', margin: 'xs', wrap: true } ] };
}
function ptlnWkCard_(title, color, body, footer) {
  var b = { type: 'bubble', size: 'mega', header: ptlnWkHeader_(title, color), body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: body } };
  if (footer) b.footer = footer; return b;
}

function ptlnWkBubbles_(w) {
  var c = w.c, B = PTLN_COLOR_BRAND_, bubbles = [];
  // 1) ภาพรวม
  var dl = ptlnWkDelta_(c.visits, w.prevVisits);
  bubbles.push(ptlnWkCard_('ภาพรวมสัปดาห์', B, [
    ptlnWkTxt_('📅 ' + w.label, 'sm', '#111111', true),
    { type: 'box', layout: 'horizontal', margin: 'lg', spacing: 'sm', contents: [
      ptlnStatBox_('รวมทั้งหมด', c.visits, B), ptlnStatBox_('OPD', c.opd, PTLN_COLOR_OPD_), ptlnStatBox_('เยี่ยมบ้าน', c.home, PTLN_COLOR_HOME_) ] },
    ptlnWkTxt_(dl.text, 'xs', dl.color, true),
    ptlnWkTxt_('ผู้ป่วยไม่ซ้ำ ' + w.patients + ' ราย', 'xs', PTLN_COLOR_TEXT_SOFT_),
    ptlnWkTxt_('เป้าหมายสัปดาห์ ' + c.visits + ' / ' + WEEKLY_TARGET + ' ราย' + (c.visits >= WEEKLY_TARGET ? '  ✅ ถึงเป้า' : ''), 'xs', PTLN_COLOR_TEXT_SOFT_)
  ]));
  // 2) กลุ่มโรค
  var dBody = [ptlnWkTxt_('🩺 กลุ่มโรคที่รักษา (วินิจฉัยหลัก)', 'sm', '#111111', true)];
  if (w.groups.length) {
    w.groups.forEach(function (g) { dBody.push(ptlnWkBar_(g.name, g.count, c.diagN, PTLN_COLOR_OPD_)); });
    dBody.push({ type: 'separator', margin: 'lg' });
    dBody.push(ptlnWkTxt_('ICD-10 พบบ่อย', 'xs', '#111111', true));
    w.icds.forEach(function (x) { dBody.push(ptlnWkTxt_('• ' + x.name + '  ×' + x.count, 'xxs', PTLN_COLOR_TEXT_SOFT_)); });
  } else dBody.push(ptlnWkTxt_('ยังไม่มีการบันทึกวินิจฉัยในสัปดาห์นี้', 'xs', PTLN_COLOR_TEXT_SOFT_));
  dBody.push(ptlnWkTxt_('ลงวินิจฉัยแล้ว ' + c.diagN + ' / ' + c.visits + ' ครั้ง', 'xxs', PTLN_COLOR_TEXT_SOFT_));
  bubbles.push(ptlnWkCard_('กลุ่มโรค', PTLN_COLOR_OPD_, dBody));
  // 3) หัตถการ
  var totalProc = c.cat.machine + c.cat.exercise + c.cat.program + c.cat.other;
  var tBody = [ptlnWkTxt_('💆 หัตถการที่ทำ (' + totalProc + ' รายการ)', 'sm', '#111111', true)];
  if (totalProc) {
    tBody.push(ptlnWkBar_('เครื่องมือ (US/ES/HP/ดึง/IMC)', c.cat.machine, totalProc, B));
    tBody.push(ptlnWkBar_('ออกกำลังกาย / ฝึกเดิน', c.cat.exercise, totalProc, PTLN_COLOR_OPD_));
    tBody.push(ptlnWkBar_('โปรแกรมกลับบ้าน', c.cat.program, totalProc, PTLN_COLOR_HOME_));
    if (c.cat.other) tBody.push(ptlnWkBar_('อื่น ๆ', c.cat.other, totalProc, PTLN_COLOR_TEXT_SOFT_));
    tBody.push({ type: 'separator', margin: 'lg' });
    tBody.push(ptlnWkTxt_('อันดับหัตถการ', 'xs', '#111111', true));
    w.procs.forEach(function (x, i) { tBody.push(ptlnWkTxt_((i + 1) + '. ' + x.name + '  ×' + x.count, 'xxs', PTLN_COLOR_TEXT_SOFT_)); });
  } else tBody.push(ptlnWkTxt_('ไม่มีข้อมูลหัตถการ', 'xs', PTLN_COLOR_TEXT_SOFT_));
  if (c.followN) tBody.push(ptlnWkTxt_('นัดติดตามอาการ (ไม่นับเป็นหัตถการ) ' + c.followN + ' ครั้ง', 'xxs', PTLN_COLOR_TEXT_SOFT_));
  bubbles.push(ptlnWkCard_('หัตถการ', PTLN_COLOR_HOME_, tBody));
  // 4) ผลลัพธ์ทางคลินิก
  var oBody = [ptlnWkTxt_('📈 ผลลัพธ์การรักษา (จาก ' + c.outN + ' ครั้งที่บันทึกผล)', 'sm', '#111111', true)];
  if (c.vasN) {
    oBody.push(ptlnWkTxt_('VAS เฉลี่ย ' + w.vasBefore.toFixed(1) + ' → ' + w.vasAfter.toFixed(1) +
      '  (ลด ' + (w.vasBefore - w.vasAfter).toFixed(1) + ')', 'sm', (w.vasBefore - w.vasAfter) > 0 ? PTLN_COLOR_OPD_ : PTLN_COLOR_WARN_, true));
    oBody.push(ptlnWkBar_('ปวดลดลง ≥ 2 คะแนน', c.improved, c.vasN, PTLN_COLOR_OPD_));
  } else oBody.push(ptlnWkTxt_('ยังไม่มีข้อมูล VAS', 'xs', PTLN_COLOR_TEXT_SOFT_));
  if (w.barthelAvg !== null) oBody.push(ptlnWkTxt_('Barthel เฉลี่ย ' + w.barthelAvg.toFixed(0) + ' / 100' +
    (w.barthelChange !== null ? '  • เปลี่ยน ' + (w.barthelChange > 0 ? '+' : '') + w.barthelChange.toFixed(1) + ' (ดีขึ้น ' + w.barthelUp + '/' + w.barthelN + ' ราย)' : ''), 'xs', '#111111'));
  oBody.push(ptlnWkBar_('🎯 บรรลุเป้าหมาย', c.goal, c.outN, PTLN_COLOR_OPD_));
  if (c.better.length) {
    oBody.push({ type: 'separator', margin: 'lg' });
    oBody.push(ptlnWkTxt_('✅ ดีขึ้นชัดเจน (VAS ลด ≥ 2)', 'xs', PTLN_COLOR_OPD_, true));
    c.better.slice(0, 3).forEach(function (x) { oBody.push(ptlnWkCaseRow_(x, 'VAS ' + x.vb + '→' + x.va)); });
  }
  if (c.worse.length) {
    oBody.push({ type: 'separator', margin: 'lg' });
    oBody.push(ptlnWkTxt_('⚠️ ควรทบทวนแผน (VAS ไม่ลดและยังปวด ≥ 4)', 'xs', PTLN_COLOR_WARN_, true));
    c.worse.slice(0, 5).forEach(function (x) { oBody.push(ptlnWkCaseRow_(x, 'VAS ' + x.vb + '→' + x.va)); });
  }
  bubbles.push(ptlnWkCard_('ผลลัพธ์ทางคลินิก', PTLN_COLOR_BRAND_, oBody));
  // 5) คุณภาพข้อมูล
  var pctOk = c.due ? Math.round(c.complete / c.due * 100) : 100;
  var qBody = [ptlnWkTxt_('🔎 คุณภาพข้อมูล: ลงครบ ' + c.complete + ' / ' + c.due + ' ครั้ง (' + pctOk + '%)', 'sm', c.missing.length ? PTLN_COLOR_WARN_ : PTLN_COLOR_OPD_, true)];
  if (c.due) {
    qBody.push(ptlnWkBar_('ลง ICD-10 แล้ว', c.dueDiag, c.due, PTLN_COLOR_OPD_));
    qBody.push(ptlnWkBar_('บันทึกผล (Outcome) แล้ว', c.dueOut, c.due, PTLN_COLOR_BRAND_));
  }
  if (!c.missing.length) qBody.push(ptlnWkTxt_('✅ ลงข้อมูลครบทุกราย ไม่มีรายการตกหล่น', 'xs', PTLN_COLOR_OPD_));
  c.missing.slice(0, 8).forEach(function (x, i) {
    if (i > 0) qBody.push({ type: 'separator', margin: 'sm' });
    qBody.push({ type: 'box', layout: 'horizontal', margin: 'sm', spacing: 'md', alignItems: 'center',
      action: { type: 'postback', data: 'act=case&kind=' + x.kind + '&b=' + encodeURIComponent(x.bid) + '&d=' + x.ds, displayText: '📋 ' + ptlnBkDn_(x.name) },
      contents: [
        { type: 'text', text: ptlnBkShortDate_(x.ds), size: 'xxs', weight: 'bold', flex: 0, color: PTLN_COLOR_AUDIT_ },
        { type: 'box', layout: 'vertical', flex: 1, contents: [
          { type: 'text', text: ptlnBkDn_(x.name) || 'ไม่ระบุชื่อ', size: 'xs', weight: 'bold', wrap: true },
          { type: 'text', text: (x.noOut ? '❌ ยังไม่บันทึกผล' : '') + (x.noOut && x.noDiag ? ' • ' : '') + (x.noDiag ? '⚠️ ขาด ICD-10' : ''), size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, wrap: true } ] },
        { type: 'text', text: '›', flex: 0, color: PTLN_COLOR_TEXT_SOFT_ } ] });
  });
  if (c.missing.length > 8) qBody.push(ptlnWkTxt_('…และอีก ' + (c.missing.length - 8) + ' ราย (พิมพ์ "ตรวจสอบ" ดูรายวัน)', 'xxs', PTLN_COLOR_TEXT_SOFT_));
  bubbles.push(ptlnWkCard_('คุณภาพข้อมูล', PTLN_COLOR_AUDIT_, qBody));
  return bubbles;
}

// วันทำการสุดท้ายของสัปดาห์ = ศุกร์ (ถ้าศุกร์เป็นวันหยุดนักขัตฤกษ์ → ย้อนเป็นพฤหัส ฯลฯ) — ใช้ตัดสินว่าวันนี้ส่งสรุปสัปดาห์ (และข้าม audit รายวัน)
function ptlnWkIsLastWorkday_(todayStr) {
  if (ptlnIsWeekendStr_(todayStr) || getHoliday(todayStr)) return false;
  var d = todayStr;
  for (var i = 0; i < 4; i++) {
    d = ptlnAddDays_(d, 1);
    if (ptlnIsWeekendStr_(d)) return true;
    if (!getHoliday(d)) return false;
  }
  return true;
}
// รันครั้งเดียวจาก Editor: ลบ trigger ศุกร์ 16:00 เดิม + ตั้ง ticker ทุก 5 นาที (ถ้ายังไม่มี)
function ptlnSetupWeeklyClinical() {
  var msgs = [ptlnRemoveWeeklyTrigger()];
  var hasTick = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === PTLN_TRIGGER_TICK_FN_; });
  msgs.push(hasTick ? 'ticker มีอยู่แล้ว' : ptlnSetupExtraTriggers());
  var out = '✅ สรุปสัปดาห์: ศุกร์ 15:30 ผ่าน ticker • ' + msgs.join(' • ');
  Logger.log(out); return out;
}

// ส่งอัตโนมัติ: ticker (PTLN_SCHEDULE_ งาน weeklyclin ศุกร์ 15:30) / สั่งเองจาก Editor: ptlnRunWeeklyClinical()
function ptlnRunWeeklyClinical(opts) {
  var auto = !!(opts && typeof opts === 'object');
  var todayStr = dateToStr(new Date()), mondayStr = ptlnWkMonday_(todayStr);
  if (auto) {
    if (!ptlnIsWeeklyNotifyEnabled_()) { Logger.log('[Weekly] ปิดใช้งานอยู่ — ข้าม'); return; }
    if (!ptlnClaimRun_('weeklyclin', mondayStr)) { Logger.log('[Weekly] ส่งของสัปดาห์ ' + mondayStr + ' ไปแล้ว — ข้าม'); return; }
  }
  try {
    var userIds = ptlnGetActiveStaffIds_();
    if (!userIds.length) { if (auto) ptlnReleaseRun_('weeklyclin', mondayStr); return; }
    var w = ptlnWkBuild_(mondayStr);
    if (auto && w.c.visits === 0) { Logger.log('[Weekly] สัปดาห์นี้ไม่มีนัด — ข้าม'); return; }
    var msgs = ptlnPackBubblesToMessages_(ptlnWkBubbles_(w), '📊 สรุปการรักษาประจำสัปดาห์ ' + w.label);
    ptlnSendMessagesToMany_(userIds, msgs);
    Logger.log('[Weekly] ส่งสำเร็จถึง ' + userIds.length + ' คน (' + w.c.visits + ' ครั้ง)');
  } catch (e) {
    if (auto && !(e && e.sentAny)) ptlnReleaseRun_('weeklyclin', mondayStr);
    Logger.log('[Weekly] ERROR: ' + e.message);
    try { GmailApp.sendEmail(NOTIFY_EMAIL, '⚠️ [PT Station] ส่งสรุปสัปดาห์ผ่าน LINE ไม่สำเร็จ', e.message + '\n\nตรวจสอบ Apps Script > Executions'); } catch (m) { /* เงียบ */ }
  }
}
// พิมพ์ "สรุปสัปดาห์" ใน LINE → ดูทันที (สัปดาห์ปัจจุบัน ถึงวันนี้)
function ptlnWkReplyNow_(ev) {
  var w = ptlnWkBuild_(ptlnWkMonday_(dateToStr(new Date())));
  var msgs = ptlnPackBubblesToMessages_(ptlnWkBubbles_(w), '📊 สรุปการรักษาประจำสัปดาห์ ' + w.label);
  return ptlnReplyOrPush_(ev, msgs.slice(0, PTLN_MSGS_PER_CALL_));
}
function ptlnTestWeeklyClinicalToUser(userId) {
  var w = ptlnWkBuild_(ptlnWkMonday_(dateToStr(new Date())));
  ptlnSendMessagesToMany_([userId], ptlnPackBubblesToMessages_(ptlnWkBubbles_(w), '📊 (ทดสอบ) สรุปสัปดาห์ ' + w.label));
  return 'ส่งสรุปสัปดาห์ทดสอบให้ ' + userId + ' แล้ว';
}

// ════════════════════════════════════════════════════════════
//  SELF-TEST (อ่านอย่างเดียว ไม่ส่ง LINE ไม่แก้ข้อมูล) — รันจาก Editor: ptlnBkSelfTest()
// ════════════════════════════════════════════════════════════
function ptlnBkSelfTest() {
  var res = [];
  function check(n, c, x) { res.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + (x || ''))); }
  var d = ptlnBkData_({ s: 'cf', h: '12345', t: 'o', d: '2026-10-26', m: '0900', i: 'T1', rb: '', tp: '' });
  var p = ptlnBkParse_(d);
  check('postback roundtrip', p.act === 'bk' && p.s === 'cf' && p.h === '12345' && p.m === '0900' && p.rb === undefined);
  check('postback ≤300 (uuid)', ptlnBkData_({ s: 'ok', rb: '12345678-1234-1234-1234-123456789012', d: '2026-10-26', m: '0900', i: 'T1', t: 'o', tp: 'p1' }).length <= 300);
  check('label ≤20', Array.from(ptlnBkLabel_('🏠 เปลี่ยนเป็นเยี่ยมบ้านยาวมากมากมาก')).length <= 20);
  check('time fmt', ptlnBkTime_('0930') === '09:30');
  check('monday', ptlnWkMonday_('2026-10-23') === '2026-10-19' && ptlnWkMonday_('2026-10-18') === '2026-10-12');
  try {
    var w = ptlnWkBuild_(ptlnWkMonday_(dateToStr(new Date())));
    var bs = ptlnWkBubbles_(w), mx = 0; bs.forEach(function (b) { mx = Math.max(mx, JSON.stringify(b).length); });
    check('weekly: 5 การ์ด <50KB', bs.length === 5 && mx < 50000, 'n=' + bs.length + ' max=' + mx);
    var msgs = ptlnPackBubblesToMessages_(bs, 'x'); check('weekly: pack', msgs.length === 1 && msgs[0].contents.type === 'carousel');
  } catch (e) { check('weekly build', false, e.message); }
  check('alias ตรวจสอบข้อมูล', PTLN_BK_ALIAS_[ptlnBkNormText_('🔎 ตรวจสอบข้อมูล')] === 'ตรวจสอบ');
  check('alias วันนี้', PTLN_BK_ALIAS_[ptlnBkNormText_('📋 วันนี้')] === 'สรุปวันนี้');
  check('lastworkday ศุกร์', ptlnWkIsLastWorkday_('2026-10-23') === true && ptlnWkIsLastWorkday_('2026-10-22') === false && ptlnWkIsLastWorkday_('2026-10-24') === false);
  try {
    var rc = ptlnBkRecent_(5); check('recent ทำงานได้', Array.isArray(rc));
    var fs = ptlnBkUpcomingDays_('o', '', '', 2); check('upcoming days ทำงานได้', Array.isArray(fs));
  } catch (e2) { check('booking read', false, e2.message); }
  var failed = res.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  var report = '════ ptlnBkSelfTest ════\n' + res.join('\n') + '\nผล: ' + (res.length - failed) + '/' + res.length + (failed ? ' ❌' : ' ✅');
  Logger.log(report); return report;
}

// ════════════════════════════════════════════════════════════════════════
//  ติดตั้ง (ครั้งเดียว): 1) วาง Code.gs ฉบับ FINAL + ไฟล์นี้  2) ptlnSetupWeeklyClinical()  3) ptlnBkSelfTest()
// ════════════════════════════════════════════════════════════════════════