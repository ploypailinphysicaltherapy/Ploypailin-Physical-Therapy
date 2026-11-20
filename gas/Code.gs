// Code.gs — PT Station V30 (รวมศูนย์ยืม-คืน: ไฟล์ LoanCenter.gs · ฝั่ง GAS ดูอย่างเดียว · ทำรายการที่หน้าเว็บ GitHub /loan) · V29 FINAL (+QR Code ครุภัณฑ์ + บันทึกลงชีต + ตรวจสภาพ — ท้ายไฟล์ V29 · รัน setupV29() ครั้งเดียว) · V28 (+ศูนย์ควบคุมอุปกรณ์/ทะเบียนครุภัณฑ์) · V25 (+แผนภาพร่างกาย: สีอัมพาต/ใช้งานไม่ได้ + ระบุส่วนที่ไม่มีอวัยวะ [regions] — ดู bcHasContent_/sanitizeBodyChart_) · V24 (+เลือก ต่อจากเดิม/มาเรื่องใหม่ ตั้งแต่ตอนนัด — ท้ายไฟล์ V24 · คอลัมน์ P ใน Bookings) · V23 (+ผู้ป่วย D/C แล้วกลับมา: มาเรื่องเดิม/เรื่องใหม่ — rtn_* ท้ายไฟล์ · ต้องรัน setupV23() ครั้งเดียว) · V20 (+Discharge Board: getDischargeBoard / dischargeEpisode ขยายผลลัพธ์+ปลายทาง) · V15.1 (+V19 แผนภาพร่างกาย) (+V18 หลายตำแหน่ง/Discharge ท้ายไฟล์) (+V17 performance: getMonthlyBundle / getCalendarEvents ใหม่ท้ายไฟล์)
// พัฒนาจาก V14.0: เพิ่มฟีเจอร์ใหม่ครบวงจร + syntax ถูกต้องทุกจุด
// ✅ แก้ V14: PublicRequests header (requestId col), ExtraSlots undefined guard
//            Holidays duplicate-col dedup, clearKPICache ครอบคลุม v14
// ✅ เพิ่ม V14: getPatientStats(), getBatchOutcomes(), getUpcomingAppointments()
//              getNotificationSummary(), generateDailyPrintData(), getWorkloadSummary()
// ✅ เพิ่ม V15: syncMainViews() trigger, setupSyncTrigger()
//              getPublicPendingRequests(), approvePublicRequest()
//   (index.html V15): Notification badge, Print daily report,
//              Public Requests management panel, Patient stats card
// ✅ แก้ V15 Export KPI: parseFlexDate แทน instanceof Date, treatmentCount, rightsCount,
//              section สิทธิ์+ประเภทการรักษา, Progress table, clearKPICache ครอบคลุม v15
// ✅ แก้ V15.2 (Outcomes save/display fix):
//    - saveOutcome/saveOutcome_dual: LockService กันบันทึกซ้อน, ดึง therapistId จาก Bookings อัตโนมัติ,
//      เขียน vas1_diff ครบทั้งโหมด Home/OPD, ไม่เขียนทับ therapistId/date เดิมตอนแก้ไข
//    - getBatchOutcomes / getOutcomeByBooking / getOutcomesByHN: คืน vas2, vas1_diff, therapistId, outcome_type ครบ
//    - เพิ่ม repairOutcomesData() รันครั้งเดียว: ลบแถวขยะ, เติม therapistId / vas diff / goal_met ย้อนหลัง
// ✅ แก้ V15.1: Outcomes date column → บันทึกเป็น timestamp (new Date()) แทน new Date(d.date)
//              ใช้ได้ทั้ง saveOutcome() และ saveOutcome_dual()
//              เพิ่ม formatOutcomeDateCol() สำหรับจัดรูปแบบคอลัมน์ date ใน Sheet
//              เพิ่ม parsePtData_() — parse vas1_type/vas2_type จาก PTDATA ใน note
//              แก้ calcBookingRevenue_: IMC OPD = flat rate 450 บ./ครั้ง (เดิม exclude)
//              เพิ่ม hasIMCTag_(), IMC_OPD_FLAT_RATE = 450
//              exportRevenueAsExcel: เพิ่ม section IMC แยก + แก้ grandTotal/breakdown
//              getRevenueSummary: แก้ bookingTotal ให้ IMC ใช้ IMC_OPD_FLAT_RATE

const SPREADSHEET_ID = '1bngZC-Uh8WATP9i87Oans2zkuoQcgb8d0mdf_eW7EBw';
const TIMEZONE = 'Asia/Bangkok';

// KPI Constants
const MONTHLY_TARGET_PATIENTS = 80;
const MONTHLY_TARGET_HOME     = 20;
const MONTHLY_TARGET_OPD      = 50;
const DAILY_TARGET            = 5;
const WEEKLY_TARGET           = 25;

// ===================================
// ✅ V15.1: parsePtData_ — parse [[PTDATA:{...}]] จาก note field
// ดึง vas1_type / vas2_type กลับมาโดยไม่ต้องเพิ่มคอลัมน์ใหม่ใน Sheet
// ===================================
function parsePtData_(note) {
  if (!note) return {};
  const m = note.match(/\[\[PTDATA:([\s\S]*?)\]\]/);
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch(e) { return {}; }
}

// ✅ V15.2: goal_met จาก PTDATA — รองรับทั้ง opd_goals (เดิม) และ dx1_goals/dx2_goals/home_goals
function outcomeGoalMetFromPtd_(ptd) {
  if (!ptd) return false;
  const lists = [ptd.opd_goals, ptd.dx1_goals, ptd.dx2_goals, ptd.home_goals];
  for (let i = 0; i < lists.length; i++) {
    if (Array.isArray(lists[i]) && lists[i].indexOf('goal_met') !== -1) return true;
  }
  return false;
}

// ===================================
// ✅ LAZY INITIALIZATION
// ===================================
let _ss = null;
function getSpreadsheet() {
  if (!_ss) _ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return _ss;
}
function getSheet(name) { return getSpreadsheet().getSheetByName(name); }

function CONFIG_SHEET()      { return getSheet('Config'); }
function SLOTS_SHEET()       { return getSheet('Slots'); }
function HOLIDAYS_SHEET()    { return getSheet('Holidays'); }
function BOOKINGS_SHEET()    { return getSheet('Bookings'); }
function PATIENTS_SHEET()    { return getSheet('Patients'); }
function EXTRA_SLOTS_SHEET() { return getSheet('ExtraSlots'); }
function OUTCOMES_SHEET()    { return getSheet('Outcomes'); }
function EPISODES_SHEET()    { return getSheet('Episodes'); }

const SYSTEM_VERSION_PROP = PropertiesService.getScriptProperties();
const NOTIFY_EMAIL = 'ploy626210@gmail.com';

// ===================================
// ✅ CORE HELPERS
// ===================================
function normalizeHN(hn) {
  if (!hn && hn !== 0) return '';
  if (typeof hn === 'number') return String(Math.round(hn));
  let s = hn.toString().trim();
  // ✅ FIX (โมดูลเยี่ยมบ้าน GPS): แปลงเลขไทยเต็มความกว้าง/ตัวเลขอารบิกที่พิมพ์มาไม่ตรง ให้เป็นรูปแบบเดียวกันเสมอ
  s = s.replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 48)); // full-width digits → normal
  s = s.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 48));
  s = s.replace(/\s+/g, ''); // ตัดช่องว่างภายใน/หัวท้ายทั้งหมด (กันเคส "17416 " หรือ "174 16")
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  // ✅ FIX: ตัดเลข 0 นำหน้าของ HN ที่เป็นตัวเลขล้วน (เช่น "017416" ↔ 17416) กันไม่ให้พิกัดบ้านที่เคยปักไว้
  //    "หาย" ไปจากหน้าจอเพียงเพราะมีคนพิมพ์ HN คนละรูปแบบในบุ๊กกิ้งครั้งถัดไป
  if (/^\d+$/.test(s) && s.length > 1) s = s.replace(/^0+(?=\d)/, '');
  return s;
}

// ✅ NEW: ใช้เป็น "กุญแจสำรอง" เวลา HN ของ booking กับ HN ที่เคยปักหมุดไว้ไม่ตรงกันเป๊ะ (เช่น พิมพ์ผิด/พิมพ์คนละรูปแบบ)
//    จะได้ยังหาเจอว่าเคยปักหมุดไว้แล้ว โดยเทียบจากเบอร์โทร/ชื่อแทน แล้วติดธง hnMismatch ไว้เตือนให้ไปแก้ HN ที่ booking
function hvNormalizePhone_(phone) {
  if (!phone && phone !== 0) return '';
  const digits = phone.toString().replace(/\D+/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits; // เทียบ 9 หลักท้าย กัน 0 นำหน้า/รหัสประเทศไม่ตรง
}
function hvNormalizeName_(name) {
  return (name || '').toString().trim().replace(/\s+/g, '');
}

function parseFlexDate(val) {
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (!val) return null;
  const s = val.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const clean = s.replace(/,.*$/, '').trim();
  const parts = clean.split('/');
  if (parts.length === 3) {
    let year = parseInt(parts[2]);
    if (year > 2400) year -= 543;
    const d = new Date(year, parseInt(parts[1]) - 1, parseInt(parts[0]), 7, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isLunchBreak(timeStr) {
  if (!timeStr) return false;
  if (timeStr instanceof Date) return timeStr.getHours() === 12 && timeStr.getMinutes() === 0;
  return normalizeTime(timeStr) === '12:00';
}

function isWeekend(dateStr) {
  const dow = new Date(dateStr).getDay();
  return dow === 0 || dow === 6;
}

function normalizeTime(timeStr) {
  if (!timeStr) return '';
  if (timeStr instanceof Date) {
    const h = timeStr.getHours(), m = timeStr.getMinutes();
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  let t = timeStr.toString().trim().replace(/\s+/g,'').replace(/\./g,':').replace(/[^0-9:]/g,'');
  if (t.length === 4 && !t.includes(':')) t = t.slice(0,2) + ':' + t.slice(2);
  if (t.length === 3 && !t.includes(':')) t = '0' + t.slice(0,1) + ':' + t.slice(1);
  if (t.includes(':') && t.split(':')[0].length === 1) t = '0' + t;
  if (t.includes(':')) {
    const parts = t.split(':');
    t = parts[0].padStart(2,'0') + ':' + (parts[1] || '00').padStart(2,'0');
  }
  return t;
}

function dateToStr(d) {
  if (d instanceof Date) return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
  return d ? d.toString() : '';
}

function timeValueToStr(v) {
  if (v instanceof Date) {
    return `${String(v.getHours()).padStart(2,'0')}:${String(v.getMinutes()).padStart(2,'0')}`;
  }
  return v ? v.toString().trim() : '';
}

// ===================================
// ✅ PUBLIC REQUESTS SHEET (FIX: header ตรงกับข้อมูลจริง)
// ===================================
function PUBLIC_REQUESTS_SHEET() {
  let sh = getSheet('PublicRequests');
  if (!sh) {
    sh = getSpreadsheet().insertSheet('PublicRequests');
    // ✅ FIX: เพิ่ม requestId column ให้ตรงกับ handlePublicBookingRequest
    sh.getRange('A1:J1').setValues([[
      'requestId','timestamp','date','time','therapistName',
      'name','phone','visitStatus','note','status'
    ]]).setFontWeight('bold').setBackground('#1565C0').setFontColor('#fff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ===================================
// ✅ JSONP-AWARE JSON OUTPUT HELPER
// ใช้ร่วมกับหน้าเว็บที่โฮสต์แยกโดเมน (เช่น Web.html บน GitHub Pages)
// ซึ่งเรียก API ผ่าน <script> tag (JSONP) เพื่อเลี่ยงปัญหา CORS
// ถ้า request มี ?callback=xxx จะห่อผลลัพธ์เป็น xxx(...) แบบ JavaScript
// ถ้าไม่มี callback จะตอบเป็น JSON ธรรมดาเหมือนเดิม (ไม่กระทบของเดิม)
// ===================================
function jsonOutput_(result, params) {
  const json = JSON.stringify(result);
  const cb = params && params.callback;
  if (cb && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ===================================
// ✅ WEB APP ENTRY POINT
// ===================================
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};

  // ✅ V30: ศูนย์ยืม-คืนอุปกรณ์ (LoanCenter.gs) — ?action=ping | ?action=scan&id=&k= (หน้าสแกน QR บน GitHub เรียกมา)
  if ((params.action === 'ping' || params.action === 'scan') && typeof lcDoGet_ === 'function') return lcDoGet_(params);

  // Capture & store web app URL
  let appUrl = '';
  try {
    const deployUrl = ScriptApp.getService().getUrl();
    if (deployUrl && deployUrl.indexOf('/exec') !== -1) {
      appUrl = deployUrl.split('?')[0];
      PropertiesService.getScriptProperties().setProperty('webAppUrl', appUrl);
    }
  } catch (urlErr) {
    Logger.log('doGet URL capture: ' + urlErr.message);
  }
  if (!appUrl) {
    appUrl = PropertiesService.getScriptProperties().getProperty('webAppUrl') || '';
  }

  // API endpoints
  // ✅ ทุก action ด้านล่างนี้รองรับ JSONP (พารามิเตอร์ ?callback=xxx) เพื่อให้เรียกข้าม
  //    โดเมนได้ (เช่น จาก Web.html ที่โฮสต์บน GitHub Pages) โดยไม่ติด CORS
  //    ถ้าไม่มี callback จะตอบกลับเป็น JSON ธรรมดา (ใช้ได้ทั้ง fetch() same-origin)
  if (params.action === 'getAvailability') {
    const result = getPublicAvailability(params.token || '', params.ym || '');
    return jsonOutput_(result, params);
  }

  if (params.action === 'submitPublicRequest') {
    const result = handlePublicBookingRequest({
      token:         params.token || '',
      date:          params.date || '',
      time:          params.time || '',
      therapistName: params.therapistName || '',
      name:          params.name || '',
      phone:         params.phone || '',
      visitStatus:   params.visitStatus || '',
      note:          params.note || ''
    });
    return jsonOutput_(result, params);
  }

  if (params.action === 'cancelPublicRequest') {
    const result = cancelPublicRequest(params.token || '', params.requestId || '');
    return jsonOutput_(result, params);
  }

  // ✅ V15.3: ตรวจสอบสถานะ requestId หลายรายการพร้อมกัน
  // รับ: token, ids=id1,id2,id3
  // ส่งกลับ: { success, active: {id1:true/false, ...} }
  if (params.action === 'checkPendingStatus') {
    const result = checkPendingStatus(params.token || '', params.ids || '');
    return jsonOutput_(result, params);
  }

  // ✅ NEW: คืนลิงก์คิวว่างสาธารณะปัจจุบัน — ใช้โดยปุ่ม "นัดหมายออนไลน์" ใน Web.html
  //    (เดิม Web.html เรียก action นี้อยู่แล้วแต่ doGet ยังไม่มี handler ให้ — เพิ่มตรงนี้)
  if (params.action === 'getPublicLink') {
    const result = getPublicShareInfo();
    return jsonOutput_(result, params);
  }

  // ✅ V29: หน้าที่เปิดเมื่อสแกน QR ครุภัณฑ์ (สาธารณะ แสดงเฉพาะข้อมูลพื้นฐาน)
  if (params.view === 'asset') return assetScanPage_(params, appUrl);

  // Public view — ✅ V15 SPEED: inline ข้อมูลเดือนปัจจุบันเข้าไปใน HTML เลย
  // ไม่ต้องรอ fetch() รอบ 2 — ลด latency ~1-3 วินาที
  if (params.view === 'public') {
    const token = params.token || '';
    if (!isValidPublicToken(token)) {
      return HtmlService.createHtmlOutput(
        '<html><head><meta charset="UTF-8"><title>ลิงก์ไม่ถูกต้อง</title>' +
        '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap" rel="stylesheet"><style>body{font-family:"Sarabun","Noto Sans Thai",sans-serif;display:flex;align-items:center;justify-content:center;' +
        'height:100vh;margin:0;background:#f5f5f5}.box{text-align:center;padding:40px;' +
        'background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1)}' +
        'h2{color:#dc2626}p{color:#6b7280}</style></head>' +
        '<body><div class="box"><h2>🔒 ลิงก์ไม่ถูกต้องหรือหมดอายุ</h2>' +
        '<p>กรุณาติดต่อเจ้าหน้าที่เพื่อขอลิงก์ใหม่</p></div></body></html>'
      ).setTitle('ลิงก์ไม่ถูกต้อง');
    }
    // โหลดข้อมูลเดือนนี้ล่วงหน้า แล้ว inline เข้า HTML
    const now = new Date();
    const currentYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    let inlineData = 'null';
    try {
      const preloaded = getPublicAvailability(token, currentYm);
      inlineData = JSON.stringify(preloaded).replace(/</g, '\u003c');
    } catch(pe) { Logger.log('preload error: ' + pe.message); }

    const html = getPublicViewHtml()
      .replace('__APP_URL__', function () { return appUrl; })
      .replace('__TOKEN__', function () { return token; })
      .replace('__INLINE_DATA__', function () { return inlineData; });
    return HtmlService.createHtmlOutput(html)
      .setTitle('ตรวจสอบคิวว่าง — PT Station')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // ✅ NEW: หน้าเว็บสาธารณะ (landing page) — Web.html
  // เข้าถึงผ่าน <APP_URL>?view=landing — ใช้แนบลิงก์ประชาสัมพันธ์ /
  // ผูกกับปุ่ม "หน้าเว็บไซต์" ใน index.html
  if (params.view === 'landing') {
    // ✅ ปุ่ม "เข้าสู่ระบบจองคิว" บน Web.html ต้องพาไปหน้าลิงก์คิวว่างสำหรับผู้รับบริการ
    // (ลิงก์เดียวกับที่แสดงในกล่อง "ลิงก์คิวว่างสำหรับผู้รับบริการ" ใน index.html)
    let publicUrl = '';
    try {
      const publicToken = getOrCreatePublicToken();
      publicUrl = appUrl ? (appUrl + '?view=public&token=' + publicToken) : '';
    } catch (pubErr) {
      Logger.log('landing publicUrl error: ' + pubErr.message);
    }

    const html = HtmlService.createHtmlOutputFromFile('Web')
      .getContent()
      .replace(/__APP_URL__/g, appUrl)
      .replace(/__PUBLIC_URL__/g, publicUrl);
    return HtmlService.createHtmlOutput(html)
      .setTitle('PT Station — กายภาพบำบัด รพ.สต.บางขะแยง')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // ✅ NEW: หน้าตั้งค่าแจ้งเตือน LINE — เปิด/ปิดรายคนด้วย Toggle switch + ทดสอบส่งข้อความ
  // เข้าถึงผ่าน <APP_URL>?view=linenotify (แนะนำแชร์ลิงก์นี้เฉพาะแอดมิน ไม่เผยแพร่สาธารณะ)
  if (params.view === 'linenotify') {
    return HtmlService.createHtmlOutputFromFile('LineNotifySettings')
      .setTitle('ตั้งค่าแจ้งเตือน LINE — PT Station')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // ✅ V29: ลิงก์ลึกจากปุ่ม "เจ้าหน้าที่: เปิดในระบบ" ในหน้าสแกน QR → เปิดหน้าครุภัณฑ์รายการนั้นทันที
  if (/^A\d{4,}$/.test(String(params.asset || ''))) {
    const deepHtml = HtmlService.createHtmlOutputFromFile('index').getContent()
      .replace('</head>', function () { return '<script>window.__PT_ASSET_DEEPLINK__=' + JSON.stringify(String(params.asset)) + ';</script></head>'; });
    return HtmlService.createHtmlOutput(deepHtml).setTitle('PT STATION').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // Main app
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('PT STATION')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ===================================
// PUBLIC BOOKING REQUEST
// ===================================
function handlePublicBookingRequest(d) {
  try {
    if (!isValidPublicToken(d.token)) return { success: false, error: 'TOKEN_INVALID' };
    if (!d.date || !d.time || !d.name || !d.phone) {
      return { success: false, error: 'กรุณากรอกข้อมูลให้ครบ (วันที่ เวลา ชื่อ เบอร์โทร)' };
    }
    const requestId  = 'REQ-' + Utilities.getUuid().substring(0, 8).toUpperCase();
    const visitStatus = d.visitStatus || 'พบแพทย์แล้ว';
    PUBLIC_REQUESTS_SHEET().appendRow([
      requestId, new Date(), d.date, d.time, d.therapistName || 'OPD',
      d.name, d.phone, visitStatus, d.note || '', 'pending'
    ]);
    clearPublicAvailabilityCache(); // ✅ ช่วงเวลาที่เพิ่งขอ จะหายจากหน้าสาธารณะทันที
    const visitLabel = visitStatus === 'พบแพทย์แล้ว' ? '✅ พบแพทย์แล้ว' : '⏳ รอการตรวจจากแพทย์อีกครั้ง';
    const body = [
      'มีคำขอนัดหมายใหม่จากลิงก์คิวว่าง', '',
      '🆔 รหัสคำขอ:   ' + requestId,
      '📅 วันที่:        ' + d.date,
      '⏰ เวลา:        ' + d.time,
      '👩‍⚕️ นักกายภาพ:  ' + (d.therapistName || 'OPD'),
      '👤 ชื่อผู้ขอ:   ' + d.name,
      '📞 เบอร์โทร:   ' + d.phone,
      '🏥 สถานะแพทย์: ' + visitLabel,
      '📝 หมายเหตุ:  ' + (d.note || '-'), '',
      '⚠️ กรุณาตรวจสอบและดำเนินการนัดหมายในระบบ PT Station',
      '— ส่งจากระบบ PT Station อัตโนมัติ'
    ].join('\n');
    try {
      GmailApp.sendEmail(NOTIFY_EMAIL,
        '🔔 [PT Station] คำขอนัดหมายใหม่ — ' + d.date + ' เวลา ' + d.time, body);
    } catch (mailErr) {
      Logger.log('Email error: ' + mailErr.message);
    }
    return { success: true, requestId };
  } catch (e) {
    Logger.log('handlePublicBookingRequest: ' + e.message);
    return { success: false, error: e.message };
  }
}

function cancelPublicRequest(token, requestId) {
  try {
    const isAdminBypass = (token === 'INTERNAL_ADMIN_TOKEN_BYPASS');
    if (!isAdminBypass && !isValidPublicToken(token)) {
      return { success: false, error: 'TOKEN_INVALID' };
    }
    if (!requestId) return { success: false, error: 'ไม่พบรหัสคำขอ' };

    const sh   = PUBLIC_REQUESTS_SHEET();
    const data = sh.getDataRange().getValues();
    const header = data[0].map(function(h) { return (h||'').toString().toLowerCase().trim(); });
    const hasReqId  = header[0] === 'requestid';
    const statusCol = hasReqId ? 10 : 8; // 1-based
    const nameCol   = hasReqId ? 6  : 5; // 0-based for data read

    // ROW-N shortcut (schema เก่า)
    if (requestId.startsWith('ROW-')) {
      const rowNum = parseInt(requestId.replace('ROW-', ''));
      if (rowNum >= 2 && rowNum <= data.length) {
        const row = data[rowNum - 1];
        if ((row[statusCol-1] || '').toString() === 'cancelled') {
          return { success: false, error: 'คำขอนี้ถูกยกเลิกไปแล้ว' };
        }
        sh.getRange(rowNum, statusCol).setValue('cancelled');
        // ✅ V15.2: clear cache ทันทีเพื่อให้ public page refresh slot ว่างถูกต้อง
        clearPublicAvailabilityCache();
        try {
          GmailApp.sendEmail(NOTIFY_EMAIL,
            '[PT Station] ยกเลิกคำขอนัด - ' + (row[hasReqId?2:1]||'') + ' เวลา ' + (row[hasReqId?3:2]||''),
            'มีการยกเลิกคำขอนัดหมาย\n\nแถว: ' + requestId + '\nชื่อ: ' + (row[nameCol]||''));
        } catch(mailErr) {}
        return { success: true };
      }
      return { success: false, error: 'ไม่พบแถว ' + requestId };
    }

    // schema ใหม่ — ค้นหาจาก requestId col A
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString() === requestId) {
        if (data[i][9] === 'cancelled') return { success: false, error: 'คำขอนี้ถูกยกเลิกไปแล้ว' };
        sh.getRange(i + 1, statusCol).setValue('cancelled');
        // ✅ V15.2: clear cache ทันทีเพื่อให้ public page refresh slot ว่างถูกต้อง
        clearPublicAvailabilityCache();
        try {
          GmailApp.sendEmail(NOTIFY_EMAIL,
            '[PT Station] ยกเลิกคำขอนัด - ' + data[i][2] + ' เวลา ' + data[i][3],
            'มีการยกเลิกคำขอนัดหมาย\n\nรหัสคำขอ: ' + requestId + '\nชื่อ: ' + data[i][5]);
        } catch(mailErr) {}
        return { success: true };
      }
    }
    return { success: false, error: 'ไม่พบรหัสคำขอ: ' + requestId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ===================================
// VERSION & CACHE
// ===================================
function getSystemVersion() {
  return parseInt(SYSTEM_VERSION_PROP.getProperty('dataVersion') || '0');
}
function incrementVersion() {
  const v = getSystemVersion() + 1;
  SYSTEM_VERSION_PROP.setProperty('dataVersion', v.toString());
}

// ===================================
// THERAPISTS CONFIG
// ===================================
function getAllMasseusesConfig() {
  const data = CONFIG_SHEET().getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      list.push({
        id:    data[i][0].toString().trim(),
        name:  data[i][1] || 'นักกายภาพบำบัด',
        color: data[i][2] || '#00897b'
      });
    }
  }
  return list;
}

function buildTherapistMap() {
  const map = {};
  getAllMasseusesConfig().forEach(t => { map[t.id] = t.name; });
  return map;
}

function getTherapistNameById(id) {
  return buildTherapistMap()[id] || 'นักกายภาพบำบัด';
}

// ===================================
// CALENDAR EVENTS
// ===================================
// getCalendarEvents อยู่ท้ายไฟล์ (V17 — เขียนใหม่ให้อ่านชีตครั้งเดียว + แคช)

// ===================================
// ✅ V15.1: ensureBookingsHeader
// ตรวจสอบว่า Bookings sheet มี header ครบ
// เพิ่ม diagnosis2 (col 15) ถ้ายังไม่มี — รันครั้งเดียวจาก Apps Script Editor
// ===================================
function ensureBookingsHeader() {
  const sheet = BOOKINGS_SHEET();
  if (!sheet) {
    Logger.log('ensureBookingsHeader: ไม่พบ Sheet Bookings');
    return { success: false, message: 'ไม่พบ Sheet Bookings' };
  }

  const expectedHeaders = [
    'Timestamp', 'BookingID', 'Date', 'time', 'TherapistID',
    'PatientID', 'HN', 'Name', 'Phone', 'Rights',
    'TreatmentType', 'Status', 'AppointmentType',
    'diagnosis',   // col 14 ← ICD-10 หลัก (JSON)
    'diagnosis2'   // col 15 ← ICD-10 รอง (JSON) ✅ NEW
  ];

  const lastCol = sheet.getLastColumn();
  const curHeaders = lastCol > 0
    ? sheet.getRange(1, 1, 1, Math.max(lastCol, expectedHeaders.length)).getValues()[0].map(h => (h || '').toString().trim())
    : [];

  const report = [];
  let changed = false;

  expectedHeaders.forEach((hdr, idx) => {
    const col = idx + 1; // 1-based
    const existing = curHeaders[idx] || '';
    if (existing !== hdr) {
      sheet.getRange(1, col).setValue(hdr);
      report.push(`Col ${col}: "${existing || '(ว่าง)'}" → "${hdr}"`);
      changed = true;
    }
  });

  if (changed) {
    sheet.getRange(1, 1, 1, expectedHeaders.length)
      .setFontWeight('bold')
      .setBackground('#1565C0')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  const msg = changed
    ? `อัปเดต header สำเร็จ:\n${report.join('\n')}`
    : 'Header ครบถ้วน ไม่ต้องแก้ไข';
  Logger.log('ensureBookingsHeader: ' + msg);
  return { success: true, changed, report, message: msg };
}

// ===================================
// BOOKINGS
// ===================================
function getBookingsForDate(dateStr) {
  const data = BOOKINGS_SHEET().getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const bd = parseFlexDate(data[i][2]);
    if (!bd || dateToStr(bd) !== dateStr) continue;
    list.push({
      bookingId:       data[i][1],
      time:            timeValueToStr(data[i][3]),
      therapistId:     data[i][4],
      patientId:       data[i][5],
      hn:              normalizeHN(data[i][6]),
      name:            data[i][7],
      phone:           data[i][8],
      rights:          data[i][9],
      treatmentType:   data[i][10],
      status:          data[i][11] || '',
      appointmentType: data[i][12] || 'OPD'
    });
  }
  return list;
}

function submitBooking(d) {
  try {
    const dateObj = new Date(d.date);
    if (isNaN(dateObj.getTime())) return { success: false, message: 'วันที่ไม่ถูกต้อง' };
    if (!d.masseuseId)            return { success: false, message: 'กรุณาระบุนักกายภาพบำบัด' };
    if (!d.hn)                    return { success: false, message: 'กรุณาระบุ HN' };
    // ✅ FIX: บันทึก HN แบบ normalize ตั้งแต่ตอนเขียนลงชีต ไม่ใช่รอ normalize ตอนอ่านอย่างเดียว
    //    ป้องกันปัญหา HN คนละรูปแบบ (เช่น เว้นวรรค/เลข 0 นำหน้า) ทำให้ระบบเยี่ยมบ้าน GPS หาไม่เจอว่าเคยปักหมุดไว้
    d.hn = normalizeHN(d.hn);

    if (!isSlotAvailable(d.date, d.time, d.masseuseId)) {
      return { success: false, message: 'คิวนี้ถูกจองแล้วหรือไม่ว่าง' };
    }

    const time = normalizeTime(d.time);
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return { success: false, message: 'รูปแบบเวลาไม่ถูกต้อง (ใช้ HH:MM เช่น 09:00)' };
    }
    d.time = time;

    let pid = getPatientIdByHn(d.hn);
    if (!pid) pid = addNewPatient(d.hn, d.name, d.phone, d.rights);

    const bid = Utilities.getUuid();

    // ✅ col 15: diagnosis2 (ICD-10 รอง) — บันทึกตอนจองเลยถ้ามี
    const diag2Val = d.diagnosis2 ? JSON.stringify(d.diagnosis2) : '';

    // ✅ V24: ผู้ป่วยที่ D/C แล้วกลับมา → เจ้าหน้าที่เลือกตอนนัดว่า "ต่อจากเดิม" หรือ "มาเรื่องใหม่"
    const intentObj = rtn_normIntent_(d.returnIntent);
    let intentVal = '';
    if (intentObj) { try { rtn_ensureBookingIntentCol_(); intentVal = JSON.stringify(intentObj); } catch (eI) { Logger.log('returnIntent: ' + eI.message); } }

    BOOKINGS_SHEET().appendRow([
      new Date(), bid, new Date(d.date), "'" + d.time,
      d.masseuseId, pid, d.hn, d.name, "'" + d.phone,
      d.rights, d.treatmentType, '', d.appointmentType,
      '',        // col 14: diagnosis — จะถูก set ทีหลังผ่าน updateDiagnosis()
      diag2Val,  // col 15: diagnosis2 ✅ NEW
      intentVal  // col 16: returnIntent ✅ V24 (ต่อจากเดิม / มาเรื่องใหม่ — เลือกตอนนัด)
    ]);

    incrementVersion();
    clearKPICache();
    clearPublicAvailabilityCache();

    // ✅ NEW V16: บันทิกรายได้/ICD9 ของ booking นี้ทันที (best-effort, ไม่ throw error)
    autoLogBookingRevenue_(bid, dateObj, d.hn, d.name, d.rights, d.masseuseId, d.treatmentType, d.appointmentType);

    return { success: true, message: 'จองสำเร็จ', bookingId: bid };
  } catch (e) {
    Logger.log('submitBooking ERROR: ' + e.message);
    return { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message };
  }
}

function isSlotAvailable(date, time, tid) {
  const checkTime = normalizeTime(time);
  return !getBookingsForDate(date).some(
    b => normalizeTime(b.time) === checkTime && b.therapistId === tid
  );
}

// ===================================
// PATIENTS
// ===================================
function searchPatient(q) {
  const data  = PATIENTS_SHEET().getDataRange().getValues();
  const qNorm = normalizeHN(q);
  const qL    = q.toLowerCase();
  const map   = {};   // hn -> record (dedupe ป้องกันรายชื่อซ้ำเมื่อชีต Patients มีแถวซ้ำ)
  const order = [];
  for (let i = 1; i < data.length; i++) {
    const hn   = normalizeHN(data[i][1]);
    const name = (data[i][2] || '').toString();
    if (!hn) continue;
    if (hn.includes(qNorm) || hn === qNorm || name.toLowerCase().includes(qL)) {
      const rec = { hn, name: data[i][2], phone: data[i][3], rights: data[i][4] };
      if (map[hn]) {
        // เจอ HN ซ้ำ — เก็บรวมข้อมูลที่สมบูรณ์ที่สุด (เติมช่องว่างจากแถวก่อนหน้า) แล้วนับเป็นรายการเดียว
        const prev = map[hn];
        map[hn] = {
          hn,
          name:   rec.name   || prev.name,
          phone:  rec.phone  || prev.phone,
          rights: rec.rights || prev.rights
        };
      } else {
        map[hn] = rec;
        order.push(hn);
      }
    }
  }
  const res = order.map(hn => map[hn]);
  return { found: res.length > 0, results: res };
}

function addNewPatient(hn, name, phone, rights) {
  const pid = Utilities.getUuid();
  PATIENTS_SHEET().appendRow([pid, hn, name, "'" + phone, rights, new Date()]);
  return pid;
}

function getPatientIdByHn(hn) {
  const hnNorm = normalizeHN(hn);
  const data   = PATIENTS_SHEET().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normalizeHN(data[i][1]) === hnNorm) return data[i][0];
  }
  return null;
}

// ===================================
// ✅ NEW: getPatientStats — สถิติรายผู้ป่วย (ใช้ใน search view)
// ===================================
function getPatientStats(hn) {
  try {
    const hnNorm = normalizeHN(hn);
    const bData  = BOOKINGS_SHEET().getDataRange().getValues();
    const tMap   = buildTherapistMap();
    let totalVisits = 0, opdCount = 0, homeCount = 0;
    let firstDate = '', lastDate = '';
    const rights = {};

    for (let i = 1; i < bData.length; i++) {
      if (normalizeHN(bData[i][6]) !== hnNorm) continue;
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds = dateToStr(bd);
      totalVisits++;
      const type = (bData[i][12] || 'OPD').toString();
      if (type === 'Home' || type === 'เยี่ยมบ้าน') homeCount++;
      else opdCount++;
      if (!firstDate || ds < firstDate) firstDate = ds;
      if (!lastDate  || ds > lastDate)  lastDate  = ds;
      const r = normalizeRights_(bData[i][9]);
      rights[r] = (rights[r] || 0) + 1;
    }

    // Outcomes
    const outcomes = getOutcomesByHN(hnNorm);
    const goalMet  = outcomes.filter(o => o.goal_met).length;

    // Patient info
    const pData = PATIENTS_SHEET().getDataRange().getValues();
    let patName = '', patPhone = '';
    for (let i = 1; i < pData.length; i++) {
      if (normalizeHN(pData[i][1]) === hnNorm) {
        patName = pData[i][2] || '';
        patPhone = pData[i][3] || '';
        break;
      }
    }

    return {
      success:      true,
      hn:           hnNorm,
      name:         patName,
      phone:        patPhone,
      totalVisits,  opdCount, homeCount,
      firstDate,    lastDate,
      outcomeCount: outcomes.length,
      goalMetCount: goalMet,
      rights:       Object.entries(rights).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({name:k,count:v}))
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ===================================
// ✅ NEW: getBatchOutcomes — โหลด outcomes หลาย bookingId ในครั้งเดียว
// ลด round-trip จาก N calls → 1 call
// ===================================
function getBatchOutcomesCore_(bookingIds) {
  try {
    if (!bookingIds || !bookingIds.length) return {};
    const bidSet = {};
    bookingIds.forEach(id => { if (id) bidSet[id.toString()] = true; });

    const sheet = OUTCOMES_SHEET();
    if (!sheet) return {};
    const data = sheet.getDataRange().getValues();
    const result = {};

    for (let i = 1; i < data.length; i++) {
      const bid = data[i][1] ? data[i][1].toString() : '';
      if (!bid || !bidSet[bid]) continue;
      const note = data[i][9] || '';
      const ptd  = parsePtData_(note);
      result[bid] = {
        vas_before:    data[i][5],
        vas_after:     data[i][6],
        barthel_score: data[i][7],
        goal_met:      data[i][8] === 'yes' || outcomeGoalMetFromPtd_(ptd),
        note:          note,
        therapistId:   data[i][4] || '',
        outcome_type:  ptd.outcome_type || '',
        // ✅ V15.2: VAS ของไดแอกรอง (เดิมไม่ถูกส่งกลับ → หน้ารายวันแสดงไม่ครบ)
        vas2_before:   data[i][12] !== undefined ? data[i][12] : '',
        vas2_after:    data[i][13] !== undefined ? data[i][13] : '',
        // ✅ V15.1: vas_type (pain/numbness) — parse จาก PTDATA ใน note ไม่ต้องเพิ่ม col
        vas_type:      ptd.vas1_type || ptd.vas_type || 'pain',
        vas1_type:     ptd.vas1_type || ptd.vas_type || 'pain',
        vas2_type:     ptd.vas2_type || 'pain'
      };
    }

    // Attach diagnosis + diagnosis2 from Bookings col 14 + 15 ✅ UPDATED
    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    for (let i = 1; i < bData.length; i++) {
      const bid = bData[i][1] ? bData[i][1].toString() : '';
      if (!bid || !result[bid]) continue;
      if (bData[i][13]) {
        try { result[bid].diagnosis = JSON.parse(bData[i][13]); } catch(e) {}
      }
      if (bData[i][14]) {
        try { result[bid].diagnosis2 = JSON.parse(bData[i][14]); } catch(e) {} // ✅ NEW
      }
    }

    return result;
  } catch (e) {
    Logger.log('getBatchOutcomes: ' + e.message);
    return {};
  }
}

// ===================================
// ✅ NEW: getUpcomingAppointments — นัดหมายที่กำลังจะมาถึง (7 วัน)
// ===================================
function getUpcomingAppointments(days) {
  try {
    days = days || 7;
    const today   = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + days);

    const todayStr = dateToStr(today);
    const endStr   = dateToStr(endDate);

    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    const tMap  = buildTherapistMap();
    const list  = [];

    for (let i = 1; i < bData.length; i++) {
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds = dateToStr(bd);
      if (ds < todayStr || ds > endStr) continue;
      const hn = normalizeHN(bData[i][6]);
      if (hn === 'BLOCK') continue;
      list.push({
        date:            ds,
        time:            normalizeTime(bData[i][3]),
        name:            bData[i][7] || '',
        hn,
        phone:           bData[i][8] || '',
        therapistName:   tMap[bData[i][4]] || 'ไม่ระบุ',
        appointmentType: bData[i][12] || 'OPD'
      });
    }
    list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return { success: true, count: list.length, appointments: list };
  } catch (e) {
    return { success: false, error: e.message, appointments: [] };
  }
}

// ===================================
// ✅ NEW: getNotificationSummary — badge แจ้งเตือน (pending requests, today's count)
// ===================================
function getNotificationSummary() {
  try {
    const todayStr = dateToStr(new Date());

    // นัดวันนี้
    const todayBookings = getBookingsForDate(todayStr).filter(b => b.hn !== 'BLOCK');
    const todayCount    = todayBookings.length;
    const arrivedCount  = todayBookings.filter(b => b.status === 'Arrived').length;

    // คำขอ pending จาก PublicRequests — รองรับทั้ง schema เก่าและใหม่
    let pendingRequests = 0;
    try {
      const prSheet = PUBLIC_REQUESTS_SHEET();
      const prData  = prSheet.getDataRange().getValues();
      if (prData.length > 1) {
        const hdr = prData[0].map(function(h){ return (h||'').toString().toLowerCase().trim(); });
        const hasReqId   = hdr[0] === 'requestid';
        const statusIdx  = hasReqId ? 9 : 7; // 0-based
        for (let i = 1; i < prData.length; i++) {
          if ((prData[i][statusIdx] || '').toString().trim() === 'pending') pendingRequests++;
        }
      }
    } catch (e) {}

    // คิวว่างวันนี้
    const slots   = getDailySlots(todayStr);
    let freeSlots = 0;
    if (Array.isArray(slots) && !slots[0]?.isHoliday) {
      slots.forEach(s => {
        if (s.slots) s.slots.forEach(sl => { if (!sl.booked) freeSlots++; });
      });
    }

    return {
      success:         true,
      todayCount,      arrivedCount,
      pendingRequests, freeSlots,
      date:            todayStr
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ===================================
// ✅ NEW: getWorkloadSummary — ภาพรวมปริมาณงาน (สำหรับ dashboard)
// ===================================
function getWorkloadSummary() {
  try {
    const today   = new Date();
    const todayStr = dateToStr(today);
    // สัปดาห์นี้ (จันทร์–วันนี้)
    const dow   = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    monday.setHours(0,0,0,0);

    const hData = HOLIDAYS_SHEET().getDataRange().getValues();
    const holidays = {};
    for (let i = 1; i < hData.length; i++) {
      const hd = parseFlexDate(hData[i][0]);
      if (hd) holidays[dateToStr(hd)] = true;
    }

    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    let weekTotal = 0, weekOPD = 0, weekHome = 0;
    let todayTotal = 0, todayOPD = 0, todayHome = 0;
    const mondayStr = dateToStr(monday);

    for (let i = 1; i < bData.length; i++) {
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds  = dateToStr(bd);
      const hn  = normalizeHN(bData[i][6]);
      if (hn === 'BLOCK') continue;
      const dow2 = new Date(ds).getDay();
      if (dow2 === 0 || dow2 === 6 || holidays[ds]) continue;

      if (ds >= mondayStr && ds <= todayStr) {
        const type = (bData[i][12] || 'OPD').toString();
        weekTotal++;
        if (type === 'Home' || type === 'เยี่ยมบ้าน') weekHome++;
        else weekOPD++;
        if (ds === todayStr) {
          todayTotal++;
          if (type === 'Home' || type === 'เยี่ยมบ้าน') todayHome++;
          else todayOPD++;
        }
      }
    }

    return {
      success: true,
      today:   { total: todayTotal, opd: todayOPD, home: todayHome },
      week:    { total: weekTotal,  opd: weekOPD,  home: weekHome },
      weekTarget: WEEKLY_TARGET
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ===================================
// ✅ NEW: generateDailyPrintData — ข้อมูลสำหรับ Print Report
// ===================================
function generateDailyPrintData(dateStr) {
  try {
    if (!dateStr) dateStr = dateToStr(new Date());
    const bookings = getBookingsForDate(dateStr);
    const tMap     = buildTherapistMap();
    const holiday  = getHoliday(dateStr);
    const thDate   = Utilities.formatDate(new Date(dateStr), 'Asia/Bangkok', 'dd/MM/yyyy');

    const valid = bookings.filter(b => b.hn !== 'BLOCK');
    const opd   = valid.filter(b => b.appointmentType !== 'Home' && b.appointmentType !== 'เยี่ยมบ้าน');
    const home  = valid.filter(b => b.appointmentType === 'Home' || b.appointmentType === 'เยี่ยมบ้าน');

    return {
      success:    true,
      dateStr,    thDate,
      isHoliday:  !!holiday,
      holidayReason: holiday || '',
      opdCount:   opd.length,
      homeCount:  home.length,
      totalCount: valid.length,
      opdList:    opd.map(b => ({
        time:            b.time,
        name:            b.name,
        hn:              b.hn,
        phone:           b.phone,
        rights:          b.rights,
        treatmentType:   b.treatmentType,
        status:          b.status,
        therapistName:   tMap[b.therapistId] || 'ไม่ระบุ'
      })),
      homeList: home.map(b => ({
        time:          b.time,
        name:          b.name,
        hn:            b.hn,
        phone:         b.phone,
        rights:        b.rights,
        treatmentType: b.treatmentType,
        status:        b.status,
        therapistName: tMap[b.therapistId] || 'ไม่ระบุ'
      }))
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ===================================
// BOOKING MANAGEMENT
// ===================================
function setBookingStatus(bid, status) {
  const sheet = BOOKINGS_SHEET();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === bid) {
      sheet.getRange(i+1, 12).setValue(status);
      incrementVersion();
      clearKPICache();
      return { success: true };
    }
  }
  return { success: false, message: 'ไม่พบ booking ID' };
}

function getDailyList(dateStr) {
  const data = BOOKINGS_SHEET().getDataRange().getValues();
  const tMap = buildTherapistMap();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    if (!(data[i][2] instanceof Date)) continue;
    const ds = dateToStr(data[i][2]);
    if (ds !== dateStr) continue;
    list.push({
      bookingId:       data[i][1],
      time:            normalizeTime(data[i][3]),
      name:            data[i][7] || '',
      hn:              normalizeHN(data[i][6]),
      phone:           data[i][8] || '',
      masseuseName:    tMap[data[i][4]] || 'ไม่ระบุ',
      status:          data[i][11] || '',
      appointmentType: data[i][12] || 'OPD',
      returnIntent:    rtn_intentChoice_(data[i][15])   // ✅ V24: '' | 'continue' | 'new'
    });
  }
  return list;
}

// ===================================
// ✅ ENHANCED: getTodayFast — embed outcomes + diagnosis ในครั้งเดียว
// ===================================
function getTodayFast(dateStr) {
  try {
    if (!dateStr) dateStr = dateToStr(new Date());
    const bookings = getDailyList(dateStr);
    if (!bookings.length) return { success: true, date: dateStr, bookings: [] };

    const bidSet = {};
    bookings.forEach(b => { if (b.bookingId) bidSet[b.bookingId.toString()] = true; });

    // ✅ NEW: ผูกสถานะ "พิกัดบ้าน GPS" (HVHouses) เข้ากับรายการเยี่ยมบ้าน — ใช้แสดง badge
    //    บนหน้า "ผู้รับบริการวันนี้" เพื่อไม่ต้องสลับไปหน้า "เยี่ยมบ้าน GPS" เพื่อเช็คก่อน
    const hasHomeCase = bookings.some(b => isHomeVisitAppt_(b.appointmentType));
    if (hasHomeCase) {
      const houseByHN = {};
      const houseByPhone = {};   // ✅ FIX: กุญแจสำรอง กันกรณี HN ของ booking พิมพ์คลาดจาก HN ที่เคยปักหมุดไว้
      const houseByName = {};    // ✅ FIX: กุญแจสำรองอีกชั้น (ใช้เมื่อเบอร์โทรว่าง/ไม่ตรงด้วย)
      const houseSheet = HV_HOUSES_SHEET();
      if (houseSheet && houseSheet.getLastRow() >= 2) {
        houseSheet.getRange(2, 1, houseSheet.getLastRow() - 1, HV_COL_HOUSE.NOTE).getValues().forEach(r => {
          const hn = normalizeHN(r[HV_COL_HOUSE.HN - 1]);
          const rec = { houseId: r[HV_COL_HOUSE.ID - 1], lat: r[HV_COL_HOUSE.LAT - 1], lng: r[HV_COL_HOUSE.LNG - 1] };
          if (hn) houseByHN[hn] = rec;
          const ph = hvNormalizePhone_(r[HV_COL_HOUSE.PHONE - 1]);
          if (ph) houseByPhone[ph] = rec;
          const nm = hvNormalizeName_(r[HV_COL_HOUSE.NAME - 1]);
          if (nm) houseByName[nm] = rec;
        });
      }
      const visitedTodayHN = {};
      const visitSheet = HV_VISITLOG_SHEET();
      const isToday = (dateStr === dateToStr(new Date()));
      if (isToday && visitSheet && visitSheet.getLastRow() >= 2) {
        const todayPart = Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy');
        visitSheet.getRange(2, 1, visitSheet.getLastRow() - 1, HV_COL_VISIT.NOTE).getValues().forEach(r => {
          const ts = String(r[HV_COL_VISIT.TS - 1] || '');
          if (ts.indexOf(todayPart) === 0) {
            const hn = normalizeHN(r[HV_COL_VISIT.HN - 1]);
            if (hn) visitedTodayHN[hn] = true;
          }
        });
      }
      bookings.forEach(b => {
        if (!isHomeVisitAppt_(b.appointmentType)) return;
        const bHn = normalizeHN(b.hn);
        let house = houseByHN[bHn] || null;
        let hnMismatch = false;
        // ✅ FIX: หา HN ตรง ๆ ไม่เจอ → ลองเทียบเบอร์โทร/ชื่อแทน ก่อนจะสรุปว่า "ยังไม่ได้ปักหมุด"
        //    ป้องกัน false-negative จาก HN พิมพ์คลาดในบุ๊กกิ้งครั้งหลัง ทั้งที่จริงเคยปักหมุดไว้แล้ว
        if (!house) {
          const ph = hvNormalizePhone_(b.phone);
          if (ph && houseByPhone[ph]) { house = houseByPhone[ph]; hnMismatch = true; }
          else {
            const nm = hvNormalizeName_(b.name);
            if (nm && houseByName[nm]) { house = houseByName[nm]; hnMismatch = true; }
          }
        }
        b.hvHouse = {
          hasPin: !!(house && house.lat !== '' && house.lng !== '' && house.lat != null && house.lng != null),
          houseId: house ? house.houseId : '',
          checkedInToday: !!visitedTodayHN[bHn],
          hnMismatch: hnMismatch // true = เจอหมุดจากชื่อ/เบอร์ ไม่ใช่จาก HN ตรง ๆ — ควรตรวจ HN ของ booking นี้
        };
      });
    }

    // Outcomes map (1 read)
    const outcomesMap = {};
    const outSheet    = OUTCOMES_SHEET();
    if (outSheet) {
      const outData = outSheet.getDataRange().getValues();
      for (let i = 1; i < outData.length; i++) {
        const bid = outData[i][1] ? outData[i][1].toString() : '';
        if (!bid) continue;
        const note = outData[i][9] || '';
        const ptd  = parsePtData_(note);
        outcomesMap[bid] = {
          vas_before:    outData[i][5] !== undefined ? outData[i][5] : '',
          vas_after:     outData[i][6] !== undefined ? outData[i][6] : '',
          barthel_score: outData[i][7] !== undefined ? outData[i][7] : '',
          goal_met:      outData[i][8] === 'yes',
          note:          note,
          // ✅ V15.1: vas_type — parse จาก PTDATA ใน note
          vas_type:      ptd.vas1_type || ptd.vas_type || 'pain',
          vas1_type:     ptd.vas1_type || ptd.vas_type || 'pain',
          vas2_type:     ptd.vas2_type || 'pain',
          // ✅ NEW: VAS ของ ICD-10 รอง (diagnosis2)
          vas2_before:   outData[i][12] !== undefined && outData[i][12] !== '' ? outData[i][12] : '',
          vas2_after:    outData[i][13] !== undefined && outData[i][13] !== '' ? outData[i][13] : ''
        };
      }
    }

    // Diagnosis map from Bookings col 14 + col 15 (1 read) ✅ UPDATED
    const diagMap  = {};
    const diag2Map = {};
    const bData    = BOOKINGS_SHEET().getDataRange().getValues();
    for (let j = 1; j < bData.length; j++) {
      const bbid = bData[j][1] ? bData[j][1].toString() : '';
      if (!bbid || !bidSet[bbid]) continue;
      if (bData[j][13]) {
        try { diagMap[bbid]  = JSON.parse(bData[j][13]); } catch(e) {}
      }
      if (bData[j][14]) {
        try { diag2Map[bbid] = JSON.parse(bData[j][14]); } catch(e) {}
      }
    }

    // Embed into bookings
    bookings.forEach(b => {
      const bid = b.bookingId ? b.bookingId.toString() : '';
      const out = outcomesMap[bid] || null;
      if (out && diagMap[bid])  out.diagnosis  = diagMap[bid];
      if (out && diag2Map[bid]) out.diagnosis2 = diag2Map[bid]; // ✅ NEW
      b.outcome = out;
    });

    return { success: true, date: dateStr, bookings };
  } catch (e) {
    Logger.log('getTodayFast: ' + e.message);
    return { success: false, error: e.message, date: dateStr || '', bookings: [] };
  }
}

function getBookingsRange(start, end) {
  const data  = BOOKINGS_SHEET().getDataRange().getValues();
  const tMap  = buildTherapistMap();
  const bookings = [];

  for (let i = 1; i < data.length; i++) {
    const d = data[i][2];
    if (!(d instanceof Date)) continue;
    const ds = dateToStr(d);
    if (ds >= start && ds <= end) {
      const b = {
        date:            ds,
        masseuse:        tMap[data[i][4]] || 'นักกายภาพบำบัด',
        time:            normalizeTime(data[i][3]),
        hn:              normalizeHN(data[i][6]),
        name:            data[i][7], phone: data[i][8],
        rights:          data[i][9], treatmentType: data[i][10],
        appointmentType: data[i][12] || 'OPD'
      };
      // ✅ attach diagnosis + diagnosis2 (col 14 + 15)
      if (data[i][13]) { try { b.diagnosis  = JSON.parse(data[i][13]); } catch(e) {} }
      if (data[i][14]) { try { b.diagnosis2 = JSON.parse(data[i][14]); } catch(e) {} } // ✅ NEW
      bookings.push(b);
    }
  }

  const holidays = {};
  const hdata = HOLIDAYS_SHEET().getDataRange().getValues();
  for (let i = 1; i < hdata.length; i++) {
    if (hdata[i][0] instanceof Date) {
      const ds = dateToStr(hdata[i][0]);
      if (!holidays[ds]) holidays[ds] = hdata[i][1] || 'หยุด';
    }
  }

  const defaults = {};
  const sdata = SLOTS_SHEET().getDataRange().getValues();
  for (let i = 1; i < sdata.length; i++) {
    const dow = sdata[i][0], tid = sdata[i][2], tv = sdata[i][1];
    if (dow !== '' && tid && tv) defaults[`${tid}_${dow}`] = 'Open';
  }

  return { bookings, holidays, defaults };
}

function getHoliday(dateStr) {
  const data = HOLIDAYS_SHEET().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] instanceof Date && dateToStr(data[i][0]) === dateStr) {
      return data[i][1] || 'วันหยุด';
    }
  }
  return false;
}

function setHoliday(dateStr, reason, isClosed) {
  const sheet = HOLIDAYS_SHEET();
  if (isClosed) {
    sheet.appendRow([new Date(dateStr), reason]);
  } else {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] instanceof Date && dateToStr(data[i][0]) === dateStr) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
  }
  incrementVersion();
  clearKPICache();
  clearPublicAvailabilityCache();
}

function getAdminBookingList(dateStr) {
  return getBookingsForDate(dateStr).map(b => ({
    id:           b.bookingId,
    time:         b.time,
    masseuseName: getTherapistNameById(b.therapistId),
    name:         b.name,
    hn:           b.hn,
    phone:        b.phone,
    isBlock:      b.hn === 'BLOCK'
  }));
}

function toggleSlotBlock(date, time, mid) {
  const exist = getBookingsForDate(date).find(
    b => normalizeTime(b.time) === normalizeTime(time) && b.therapistId === mid
  );
  if (exist) cancelBooking(exist.bookingId);
  else submitBooking({ date, time, masseuseId: mid, hn: 'BLOCK', name: 'BLOCKED', phone: '', rights: '', treatmentType: '' });
  incrementVersion();
  clearKPICache();
}

function addExtraSlot(date, mid, time) {
  const sheet = EXTRA_SLOTS_SHEET();
  if (sheet) sheet.appendRow([date, "'" + time, mid]);
  incrementVersion();
  clearKPICache();
}

function deleteExtraSlot(date, time, mid) {
  const sheet = EXTRA_SLOTS_SHEET();
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === date &&
        normalizeTime(data[i][1]) === normalizeTime(time) &&
        data[i][2] === mid) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  incrementVersion();
  clearKPICache();
}

function closeMasseuseDay(date, mid) {
  const slots = getAvailableSlotsForTherapist(date, mid);
  slots.forEach(s => { if (isSlotAvailable(date, s.time, mid)) toggleSlotBlock(date, s.time, mid); });
  return { success: true };
}

function getAvailableSlotsForTherapist(dateStr, tid) {
  const dow  = new Date(dateStr).getDay();
  const data = SLOTS_SHEET().getDataRange().getValues();
  const slots = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == dow && data[i][2] == tid && data[i][1]) {
      slots.push({ time: normalizeTime(data[i][1]), type: data[i][3] || 'normal' });
    }
  }
  const exSheet = EXTRA_SLOTS_SHEET();
  if (exSheet) {
    const ex = exSheet.getDataRange().getValues();
    for (let i = 1; i < ex.length; i++) {
      // ✅ FIX: ข้ามแถวที่ไม่มีข้อมูล (undefined/null)
      if (!ex[i][0] || !ex[i][2] || !ex[i][1]) continue;
      if (ex[i][1].toString() === 'undefined') continue;
      if (ex[i][0] == dateStr && ex[i][2] == tid) {
        const t = normalizeTime(ex[i][1]);
        if (t && t !== '00:00') slots.push({ time: t, type: 'extra' });
      }
    }
  }
  return slots.sort((a, b) => a.time.localeCompare(b.time));
}

function getBookingDetails(bid) {
  const data = BOOKINGS_SHEET().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === bid) {
      return {
        success: true,
        hn:      normalizeHN(data[i][6]), name: data[i][7],
        phone:   data[i][8], rights: data[i][9], treatmentType: data[i][10]
      };
    }
  }
  return { success: false, message: 'ไม่พบข้อมูล' };
}

function updateBooking(d) {
  const sheet = BOOKINGS_SHEET();
  const data  = sheet.getDataRange().getValues();
  d.hn = normalizeHN(d.hn); // ✅ FIX: normalize ตอนเขียนเช่นกัน (สอดคล้องกับ submitBooking)
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === d.bookingId) {
      sheet.getRange(i+1, 7, 1, 5).setValues([[d.hn, d.name, d.phone, d.rights, d.treatmentType]]);
      incrementVersion();
      clearKPICache();

      // ✅ NEW V16: re-sync รายได้/ICD9 เมื่อแก้ไข booking (เฉพาะถ้ายังไม่ถูกแก้ไขรายการเองในหน้า Revenue)
      try {
        const dateObj = parseFlexDate(data[i][2]);
        const apptType = data[i][12] || 'OPD'; // ✅ ต้องส่งต่อเพื่อให้เคสเยี่ยมบ้านคิดอัตราเหมาถูกต้อง
        resyncBookingRevenueIfAuto_(d.bookingId, dateObj, d.hn, d.name, d.rights, data[i][4], d.treatmentType, apptType);
      } catch (re) {
        Logger.log('updateBooking revenue resync error (non-fatal): ' + re.message);
      }

      return { success: true };
    }
  }
  return { success: false };
}

function cancelBooking(bid) {
  const sheet = BOOKINGS_SHEET();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === bid) {
      sheet.deleteRow(i+1);
      incrementVersion();
      clearKPICache();
      return { success: true };
    }
  }
  return { success: false };
}

function rescheduleBooking(bid, newDate, newTime) {
  const tid = getBookingTherapist(bid);
  if (!tid || !isSlotAvailable(newDate, newTime, tid)) {
    return { success: false, message: 'คิวใหม่ไม่ว่าง' };
  }
  const sheet = BOOKINGS_SHEET();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === bid) {
      sheet.getRange(i+1, 3).setValue(new Date(newDate));
      sheet.getRange(i+1, 4).setValue("'" + newTime);
      incrementVersion();
      clearKPICache();
      return { success: true };
    }
  }
  return { success: false };
}

function getBookingTherapist(bid) {
  const data = BOOKINGS_SHEET().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === bid) return data[i][4];
  }
  return null;
}

// ===================================
// SLOTS & DAILY VIEW
// ===================================
function getAllMasseusesWithSlots(startDate, endDate) {
  const therapists = getAllMasseusesConfig();
  const slotsData  = SLOTS_SHEET().getDataRange().getValues().slice(1);
  therapists.forEach(t => {
    t.slots = [];
    slotsData.forEach(row => {
      if (row[2] === t.id && row[1]) {
        const time = timeValueToStr(row[1]);
        const norm = normalizeTime(time);
        if (norm === '12:00' || norm === '00:00') return;
        t.slots.push({ time, type: row[3] || 'normal' });
      }
    });
    t.slots.sort((a, b) => normalizeTime(a.time).localeCompare(normalizeTime(b.time)));
  });
  return therapists;
}

function getDailySlots(dateStr) {
  if (isWeekend(dateStr)) return [{ isHoliday: true, reason: 'วันหยุดประจำสัปดาห์' }];
  const holiday = getHoliday(dateStr);
  if (holiday) return [{ isHoliday: true, reason: holiday }];

  const dow       = new Date(dateStr).getDay();
  const therapists = getAllMasseusesConfig();
  const bookings   = getBookingsForDate(dateStr);
  const slotsData  = SLOTS_SHEET().getDataRange().getValues().slice(1);

  therapists.forEach(t => {
    t.slots = [];
    slotsData.forEach(row => {
      if (row[0] !== dow || row[2] !== t.id || !row[1]) return;
      const time = timeValueToStr(row[1]);
      if (isLunchBreak(time) || normalizeTime(time) === '00:00') return;
      if ((row[4] || 'Open') === 'Closed') return;
      t.slots.push({ time, type: row[3] || 'normal', booked: false });
    });

    const exSheet = EXTRA_SLOTS_SHEET();
    if (exSheet) {
      const extra = exSheet.getDataRange().getValues().slice(1);
      extra.forEach(row => {
        // ✅ FIX: skip invalid extra slot rows
        if (!row[0] || !row[2] || !row[1] || row[1].toString() === 'undefined') return;
        if (row[0] !== dateStr || row[2] !== t.id) return;
        const time = timeValueToStr(row[1]);
        if (isLunchBreak(time) || normalizeTime(time) === '00:00') return;
        t.slots.push({ time, type: 'extra', booked: false });
      });
    }

    bookings.forEach(b => {
      if (b.therapistId !== t.id) return;
      const bTime = normalizeTime(b.time);
      const slot  = t.slots.find(s => normalizeTime(s.time) === bTime);
      if (slot) {
        slot.booked = true;
        slot.info   = {
          hn: b.hn, name: b.name, phone: b.phone,
          rights: b.rights, treatmentType: b.treatmentType,
          bookingId: b.bookingId, appointmentType: b.appointmentType
        };
      }
    });

    t.slots.sort((a, b) => normalizeTime(a.time).localeCompare(normalizeTime(b.time)));
  });

  return therapists;
}

function getAvailableTimesForTherapist(dateStr, tid) {
  const slots    = getAvailableSlotsForTherapist(dateStr, tid);
  const bookings = getBookingsForDate(dateStr);
  return slots.filter(s => {
    const nt = normalizeTime(s.time);
    if (nt === '12:00' || nt === '00:00') return false;
    return !bookings.some(b => normalizeTime(b.time) === nt && b.therapistId === tid);
  }).map(s => ({ time: normalizeTime(s.time) }));
}

// ===================================
// SEARCH
// ===================================
function searchHistory(q) {
  if (!q) return [];
  const qNorm = normalizeHN(q);
  const qL    = q.toLowerCase();
  const data  = BOOKINGS_SHEET().getDataRange().getValues();
  const tMap  = buildTherapistMap();
  const res   = [];
  for (let i = 1; i < data.length; i++) {
    const hn    = normalizeHN(data[i][6]);
    const name  = (data[i][7] || '').toString();
    const phone = (data[i][8] || '').toString();
    if (hn.includes(qNorm) || hn === qNorm || name.toLowerCase().includes(qL) || phone.includes(q)) {
      const bd = parseFlexDate(data[i][2]);
      res.push({
        bookingId:       data[i][1],   // ✅ ใช้เปิดดูรายละเอียดการรักษาแต่ละครั้ง
        date:            bd ? Utilities.formatDate(bd, TIMEZONE, 'dd/MM/yyyy') : '',
        time:            normalizeTime(data[i][3]),
        name,   hn,   phone,
        doctor:          tMap[data[i][4]] || 'นักกายภาพบำบัด',
        rights:          data[i][9] || '',
        treatmentType:   data[i][10] || '',
        status:          data[i][11] || '',
        appointmentType: data[i][12] || 'OPD'
      });
    }
  }
  res.sort((a, b) => b.date.localeCompare(a.date));
  return res;
}

// ✅ NEW: getVisitFullDetail — รวมข้อมูล booking + diagnosis + ผลการรักษา (Outcome) ของ visit เดียว
// ใช้เปิดดูรายละเอียดแบบละเอียดจากหน้า "ค้นหาประวัติ" โดยไม่ต้องกดสลับหน้าไปมา
function getVisitFullDetail(bookingId) {
  try {
    const data = BOOKINGS_SHEET().getDataRange().getValues();
    const tMap = buildTherapistMap();
    const bookingIdStr = (bookingId === null || bookingId === undefined) ? '' : bookingId.toString().trim();
    for (let i = 1; i < data.length; i++) {
      if ((data[i][1] === null || data[i][1] === undefined ? '' : data[i][1].toString().trim()) !== bookingIdStr) continue;
      const bd = parseFlexDate(data[i][2]);
      let diagnosis = null, diagnosis2 = null;
      try { if (data[i][13]) diagnosis  = JSON.parse(data[i][13]); } catch (e) {}
      try { if (data[i][14]) diagnosis2 = JSON.parse(data[i][14]); } catch (e) {}

      const detail = {
        success:         true,
        bookingId:       data[i][1],
        date:            bd ? Utilities.formatDate(bd, TIMEZONE, 'dd/MM/yyyy') : '',
        time:            normalizeTime(data[i][3]),
        doctor:          tMap[data[i][4]] || 'นักกายภาพบำบัด',
        hn:              normalizeHN(data[i][6]),
        name:            data[i][7],
        phone:           data[i][8],
        rights:          data[i][9] || '',
        treatmentType:   data[i][10] || '',
        status:          data[i][11] || '',
        appointmentType: data[i][12] || 'OPD',
        diagnosis:       diagnosis,
        diagnosis2:      diagnosis2,
        outcome:         null
      };

      // ผลการรักษา (ถ้ามีการบันทึกไว้)
      const oc = getOutcomeByBooking(bookingId.toString());
      if (oc) {
        detail.outcome = {
          vas_before:    oc.vas_before,
          vas_after:     oc.vas_after,
          vas1_type:     oc.vas1_type,
          vas2_before:   oc.vas2_before,
          vas2_after:    oc.vas2_after,
          vas2_type:     oc.vas2_type,
          barthel_score: oc.barthel_score,
          goal_met:      oc.goal_met,
          note:          oc.note
        };
      }
      return detail;
    }
    return { success: false, message: 'ไม่พบข้อมูลการนัดหมายนี้' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function searchHistorySuggestions(q) {
  if (!q || q.length < 2) return [];
  const qNorm = normalizeHN(q);
  const qL    = q.toLowerCase();
  const data  = BOOKINGS_SHEET().getDataRange().getValues();
  const seen  = {}, res = [];
  for (let i = 1; i < data.length; i++) {
    const hn    = normalizeHN(data[i][6]);
    const name  = (data[i][7] || '').toString();
    const phone = (data[i][8] || '').toString();
    if (hn === 'BLOCK') continue;
    if (hn.includes(qNorm) || hn === qNorm || name.toLowerCase().includes(qL) || phone.includes(q)) {
      const key = hn + '||' + name;
      if (!seen[key]) {
        seen[key] = true;
        res.push({ hn, name, phone, rights: (data[i][9] || '').toString() });
        if (res.length >= 8) break;
      }
    }
  }
  return res;
}

// ===================================
// PATIENT TREND DATA
// ===================================
function getPatientTrendData(hn) {
  try {
    const hnNorm = normalizeHN(hn);
    const outcomes = getOutcomesByHN(hnNorm);
    const episodes = getEpisodesForHN(hnNorm);

    if (!outcomes.length) {
      return { hn: hnNorm, outcomes: [], episodes, trend: 'no_data', totalVisits: 0 };
    }

    // VAS trend
    const vasData  = outcomes.filter(o =>
      o.vas_before !== '' && o.vas_before !== undefined && o.vas_before !== null &&
      o.vas_after  !== '' && o.vas_after  !== undefined && o.vas_after  !== null
    );
    let vasTrend = 'stable', vasChange = 0;
    if (vasData.length >= 2) {
      const vFirst  = parseFloat(vasData[0].vas_after) || 0;
      const vLast   = parseFloat(vasData[vasData.length-1].vas_after) || 0;
      vasChange     = parseFloat((vFirst - vLast).toFixed(1));
      vasTrend      = vasChange >= 2 ? 'improving' : vasChange <= -2 ? 'worsening' : 'stable';
    }

    // Barthel trend
    const barthelData = outcomes.filter(o =>
      o.barthel_score !== undefined && o.barthel_score !== null && o.barthel_score !== ''
    );
    let barthelTrend = 'stable', barthelChange = 0;
    if (barthelData.length >= 2) {
      barthelChange = parseInt(barthelData[barthelData.length-1].barthel_score) - parseInt(barthelData[0].barthel_score);
      barthelTrend  = barthelChange >= 5 ? 'improving' : barthelChange <= -5 ? 'worsening' : 'stable';
    }

    const goalMetRate   = outcomes.length > 0
      ? parseFloat((outcomes.filter(o => o.goal_met).length / outcomes.length * 100).toFixed(1)) : 0;
    let overallTrend    = 'stable';
    if (vasTrend === 'improving' || barthelTrend === 'improving') overallTrend = 'improving';
    if (vasTrend === 'worsening' && barthelTrend !== 'improving') overallTrend = 'worsening';

    // Latest diagnosis + diagnosis2 ✅ UPDATED
    let latestDiag  = null;
    let latestDiag2 = null;
    try {
      const bData = BOOKINGS_SHEET().getDataRange().getValues();
      for (let bi = bData.length-1; bi >= 1; bi--) {
        if (normalizeHN(bData[bi][6]) === hnNorm) {
          if (bData[bi][13]) { try { latestDiag  = JSON.parse(bData[bi][13]); } catch(e2) {} }
          if (bData[bi][14]) { try { latestDiag2 = JSON.parse(bData[bi][14]); } catch(e2) {} } // ✅ NEW
          break;
        }
      }
    } catch(e3) {}

    return {
      hn:            hnNorm, outcomes, episodes,
      totalVisits:   outcomes.length,
      vasTrend,      vasChange,
      barthelTrend,  barthelChange,
      goalMetRate,   overallTrend,
      latestDiag,
      latestDiag2    // ✅ NEW
    };
  } catch (e) {
    Logger.log('getPatientTrendData: ' + e.message);
    return { hn, outcomes: [], episodes: [], trend: 'error', totalVisits: 0, error: e.message };
  }
}

function getOutcomesByHN(hn) {
  const hnNorm = normalizeHN(hn);
  const sheet  = OUTCOMES_SHEET();
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    if (normalizeHN(data[i][2]) !== hnNorm) continue;
    const noteTxt = data[i][9] || '';
    const ptdH    = parsePtData_(noteTxt);
    list.push({
      bookingId:     data[i][1],
      date:          data[i][3] instanceof Date ? dateToStr(data[i][3]) : '',
      therapistId:   data[i][4] || '',
      vas_before:    data[i][5],
      vas_after:     data[i][6],
      barthel_score: data[i][7],
      goal_met:      data[i][8] === 'yes' || outcomeGoalMetFromPtd_(ptdH),
      note:          noteTxt,
      // ✅ V15.2: VAS ไดแอกรอง + ประเภท VAS ให้หน้าประวัติผู้ป่วยแสดงครบ
      vas2_before:   data[i][12] !== undefined ? data[i][12] : '',
      vas2_after:    data[i][13] !== undefined ? data[i][13] : '',
      vas1_type:     ptdH.vas1_type || ptdH.vas_type || 'pain',
      vas2_type:     ptdH.vas2_type || 'pain'
    });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

function getOutcomeByBookingCore_(bookingId) {
  const sheet = OUTCOMES_SHEET();
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1] || '').trim() !== String(bookingId || '').trim()) continue;
    let diagnosis  = null;
    let diagnosis2 = null; // ✅ NEW
    try {
      const bData = BOOKINGS_SHEET().getDataRange().getValues();
      for (let j = 1; j < bData.length; j++) {
        if (bData[j][1] && bData[j][1].toString() === bookingId.toString()) {
          if (bData[j][13]) { try { diagnosis  = JSON.parse(bData[j][13]); } catch(e) {} }
          if (bData[j][14]) { try { diagnosis2 = JSON.parse(bData[j][14]); } catch(e) {} } // ✅ NEW
          break;
        }
      }
    } catch(e) {}
    const note = data[i][9] || '';
    const ptd  = parsePtData_(note);
    return {
      outcomeId:     data[i][0],
      bookingId:     data[i][1],
      hn:            normalizeHN(data[i][2]),
      date:          data[i][3] instanceof Date ? dateToStr(data[i][3]) : '',
      vas_before:    data[i][5],
      vas_after:     data[i][6],
      barthel_score: data[i][7],
      goal_met:      data[i][8] === 'yes' || outcomeGoalMetFromPtd_(ptd),
      note:          note,
      therapistId:   data[i][4] || '',
      outcome_type:  ptd.outcome_type || '',
      vas1_diff:     data[i][11] !== undefined ? data[i][11] : '',
      vas2_diff:     data[i][14] !== undefined ? data[i][14] : '',
      // ✅ V15.1: vas_type — parse จาก PTDATA ใน note ไม่ต้องเพิ่ม col ใหม่
      vas_type:      ptd.vas1_type || ptd.vas_type || 'pain',
      vas1_type:     ptd.vas1_type || ptd.vas_type || 'pain',
      vas2_type:     ptd.vas2_type || 'pain',
      diagnosis,
      diagnosis2,  // ✅ NEW
      // ✅ NEW: VAS ของ ICD-10 รอง (diagnosis2)
      vas2_before:   data[i][12] !== undefined ? data[i][12] : '',
      vas2_after:    data[i][13] !== undefined ? data[i][13] : ''
    };
  }
  return null;
}

// ===================================
// ✅ NEW: getPreviousVisitHistory — "ดูประวัติครั้งก่อนหน้า"
// ให้นักกายภาพตรวจสอบได้ว่าผู้ป่วยรายนี้ครั้งก่อน ๆ ทำอะไรไปบ้าง
// (วันที่ / นักกายภาพ / หัตถการ / วินิจฉัย / VAS / Barthel / เป้าหมาย / บันทึก)
// ก่อนเริ่มบันทึกผลการรักษาของครั้งนี้
// เรียกจากหน้าเว็บผ่าน google.script.run.getPreviousVisitHistory(hn, currentBookingId, limit)
// @param {string} hn                 HN ของผู้ป่วย
// @param {string} [excludeBookingId] bookingId ของครั้งปัจจุบัน (ไม่เอามารวมในประวัติ)
// @param {number} [limit]            จำนวนครั้งล่าสุดที่จะแสดง (ค่าเริ่มต้น 5)
// @return {{success:boolean, hn:string, totalVisitsBefore:number, list:Array}}
// ===================================
function getPreviousVisitHistory(hn, excludeBookingId, limit) {
  try {
    const hnNorm = normalizeHN(hn);
    if (!hnNorm) return { success: false, error: 'ไม่พบ HN', list: [] };
    limit = limit || 5;
    const excludeId = excludeBookingId ? excludeBookingId.toString() : '';

    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    const tMap  = buildTherapistMap();
    const rows  = [];

    for (let i = 1; i < bData.length; i++) {
      if (normalizeHN(bData[i][6]) !== hnNorm) continue;
      const bookingId = bData[i][1] ? bData[i][1].toString() : '';
      if (!bookingId) continue;
      if (excludeId && bookingId === excludeId) continue;
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;

      rows.push({
        bookingId:       bookingId,
        date:            dateToStr(bd),
        time:            timeValueToStr(bData[i][3]),
        therapistName:   tMap[bData[i][4]] || (bData[i][4] || '-'),
        appointmentType: bData[i][12] || 'OPD',
        treatmentType:   bData[i][10] || '',
        status:          bData[i][11] || ''
      });
    }

    // เรียงล่าสุด → เก่าสุด
    rows.sort(function (a, b) {
      return b.date.localeCompare(a.date) || b.time.localeCompare(a.time);
    });

    const totalVisitsBefore = rows.length;
    const top = rows.slice(0, limit);

    top.forEach(function (r) {
      const o = getOutcomeByBooking(r.bookingId);
      if (o) {
        r.hasOutcome    = true;
        r.vas_before    = o.vas_before;
        r.vas_after     = o.vas_after;
        r.vas1_type     = o.vas1_type;
        r.vas2_before   = o.vas2_before;
        r.vas2_after    = o.vas2_after;
        r.vas2_type     = o.vas2_type;
        r.barthel_score = o.barthel_score;
        r.goal_met      = o.goal_met;
        r.diagnosis     = o.diagnosis;
        r.diagnosis2    = o.diagnosis2;
        r.note          = (o.note || '').replace(/\n?\[\[PTDATA:[\s\S]*?\]\]/, '').trim();
      } else {
        r.hasOutcome = false;
      }
    });

    return { success: true, hn: hnNorm, totalVisitsBefore: totalVisitsBefore, list: top };
  } catch (e) {
    Logger.log('getPreviousVisitHistory error: ' + e.message);
    return { success: false, error: e.message, list: [] };
  }
}

// ===================================
// KPI FUNCTIONS
// ===================================
function getKPISummaryFast(yearMonth) {
  try {
    const cache    = CacheService.getScriptCache();
    const cacheKey = `kpi_summary_v15_${yearMonth}`;
    const cached   = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const [year, month] = yearMonth.split('-').map(Number);
    const startDate     = new Date(year, month - 1, 1);
    const endDate       = new Date(year, month, 0);
    const startStr      = Utilities.formatDate(startDate, TIMEZONE, 'yyyy-MM-dd');
    const endStr        = Utilities.formatDate(endDate,   TIMEZONE, 'yyyy-MM-dd');

    const hData    = HOLIDAYS_SHEET().getDataRange().getValues();
    const holidays = {};
    for (let i = 1; i < hData.length; i++) {
      const hd = parseFlexDate(hData[i][0]);
      if (hd) {
        const ds = dateToStr(hd);
        if (ds >= startStr && ds <= endStr && !holidays[ds]) holidays[ds] = true;
      }
    }

    let workingDays = 0;
    for (let day = 1; day <= endDate.getDate(); day++) {
      const ds  = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const dow = new Date(ds).getDay();
      if (dow !== 0 && dow !== 6 && !holidays[ds]) workingDays++;
    }

    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    let totalBookings = 0, arrivedCount = 0, opdVisits = 0, homeVisits = 0;
    const uniquePatients = new Set();

    for (let i = 1; i < bData.length; i++) {
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds  = dateToStr(bd);
      if (ds < startStr || ds > endStr) continue;
      const dow = new Date(ds).getDay();
      if (dow === 0 || dow === 6 || holidays[ds]) continue;
      const hn  = normalizeHN(bData[i][6]);
      if (hn === 'BLOCK') continue;
      totalBookings++;
      if (hn) uniquePatients.add(hn);
      const type = bData[i][12] || 'OPD';
      if (type === 'OPD') opdVisits++; else homeVisits++;
      if (bData[i][11] === 'Arrived') arrivedCount++;
    }

    const arrivalRate      = totalBookings > 0 ? parseFloat(((arrivedCount / totalBookings) * 100).toFixed(1)) : 0;
    const stdWorkDays      = 22;
    const adjustedTargets  = {
      patients: Math.ceil((MONTHLY_TARGET_PATIENTS / stdWorkDays) * workingDays),
      opd:      Math.ceil((MONTHLY_TARGET_OPD      / stdWorkDays) * workingDays),
      home:     Math.ceil((MONTHLY_TARGET_HOME     / stdWorkDays) * workingDays)
    };

    const result = {
      yearMonth, workingDays, totalBookings, arrivedCount, arrivalRate,
      uniquePatients: uniquePatients.size, opdVisits, homeVisits,
      adjustedTargets, timestamp: new Date().toISOString()
    };
    cache.put(cacheKey, JSON.stringify(result), 1800);
    return result;
  } catch (e) {
    Logger.log('KPI Error: ' + e.message);
    return {
      error: e.message, yearMonth, totalBookings: 0, workingDays: 0,
      uniquePatients: 0, opdVisits: 0, homeVisits: 0, arrivedCount: 0, arrivalRate: 0,
      adjustedTargets: { patients: MONTHLY_TARGET_PATIENTS, opd: MONTHLY_TARGET_OPD, home: MONTHLY_TARGET_HOME }
    };
  }
}

function getKPIDailyChunk(yearMonth, startDay, endDay) {
  try {
    const cache    = CacheService.getScriptCache();
    const cacheKey = `kpi_chunk_v15_${yearMonth}_${startDay}_${endDay}`;
    const cached   = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const [year, month] = yearMonth.split('-').map(Number);
    const hData    = HOLIDAYS_SHEET().getDataRange().getValues();
    const holidays = {};
    for (let i = 1; i < hData.length; i++) {
      const hd = parseFlexDate(hData[i][0]);
      if (hd) { const ds = dateToStr(hd); if (!holidays[ds]) holidays[ds] = true; }
    }

    const dailyData = {};
    for (let day = startDay; day <= endDay; day++) {
      const ds  = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const dow = new Date(ds).getDay();
      if (dow === 0 || dow === 6 || holidays[ds]) continue;
      dailyData[ds] = { total: 0, opd: 0, home: 0, targetTotal: DAILY_TARGET };
    }

    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    for (let i = 1; i < bData.length; i++) {
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds = dateToStr(bd);
      if (!dailyData[ds]) continue;
      const hn = normalizeHN(bData[i][6]);
      if (hn === 'BLOCK') continue;
      dailyData[ds].total++;
      const type = bData[i][12] || 'OPD';
      if (type === 'OPD') dailyData[ds].opd++; else dailyData[ds].home++;
    }

    const result = { success: true, dailyData, chunk: { start: startDay, end: endDay } };
    cache.put(cacheKey, JSON.stringify(result), 1800);
    return result;
  } catch (e) {
    return { success: false, error: e.message, dailyData: {} };
  }
}

function getRecentWorkingDays() {
  try {
    const cache    = CacheService.getScriptCache();
    const cacheKey = 'kpi_recent_7days_v15';
    const cached   = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const hData    = HOLIDAYS_SHEET().getDataRange().getValues();
    const holidays = {};
    for (let i = 1; i < hData.length; i++) {
      const hd = parseFlexDate(hData[i][0]);
      if (hd) { const ds = dateToStr(hd); if (!holidays[ds]) holidays[ds] = true; }
    }

    const result       = {};
    const workingDates = [];
    let checkDate      = new Date();
    while (workingDates.length < 7 && checkDate >= new Date('2024-01-01')) {
      const ds  = Utilities.formatDate(checkDate, TIMEZONE, 'yyyy-MM-dd');
      const dow = checkDate.getDay();
      if (dow !== 0 && dow !== 6 && !holidays[ds]) {
        workingDates.push(ds);
        result[ds] = { total: 0, opd: 0, home: 0, arrived: 0 };
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }

    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    for (let i = 1; i < bData.length; i++) {
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds = dateToStr(bd);
      if (!result[ds]) continue;
      const hn = normalizeHN(bData[i][6]);
      if (hn === 'BLOCK') continue;
      result[ds].total++;
      const type = bData[i][12] || 'OPD';
      if (type === 'OPD') result[ds].opd++; else result[ds].home++;
      if (bData[i][11] === 'Arrived') result[ds].arrived++;
    }

    cache.put(cacheKey, JSON.stringify(result), 600);
    return result;
  } catch (e) { return {}; }
}

function clearKPICache() {
  const cache    = CacheService.getScriptCache();
  const today    = new Date();
  const toRemove = [
    'kpi_recent_7days_v11','kpi_recent_7days_v12','kpi_recent_7days_v13',
    'kpi_recent_7days_v14','kpi_recent_7days_v15',
    'kpi_trend_12m_v1','kpi_trend_12m_v2','kpi_trend_12m_v3'
  ];
  for (let i = -1; i <= 1; i++) {
    const d  = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    ['v11','v12','v13','v14','v15'].forEach(v => {
      toRemove.push(`kpi_summary_${v}_${ym}`);
      for (let chunk = 1; chunk <= 31; chunk += 7) {
        toRemove.push(`kpi_chunk_${v}_${ym}_${chunk}_${Math.min(chunk+6,31)}`);
      }
    });
  }
  cache.removeAll(toRemove);
}

function getKPITrend12Months() {
  try {
    const cache    = CacheService.getScriptCache();
    const cacheKey = 'kpi_trend_12m_v3';
    const cached   = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const now    = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'));
    }

    const hData    = HOLIDAYS_SHEET().getDataRange().getValues();
    const holidaySet = {};
    for (let hi = 1; hi < hData.length; hi++) {
      const hd = parseFlexDate(hData[hi][0]);
      if (hd) { const ds = dateToStr(hd); if (!holidaySet[ds]) holidaySet[ds] = true; }
    }

    const stats = {};
    months.forEach(ym => {
      stats[ym] = { total: 0, opd: 0, home: 0, unique: new Set(), workingDays: 0 };
      const [y, m] = ym.split('-').map(Number);
      const days   = new Date(y, m, 0).getDate();
      for (let day = 1; day <= days; day++) {
        const ds  = y + '-' + String(m).padStart(2,'0') + '-' + String(day).padStart(2,'0');
        const dow = new Date(ds).getDay();
        if (dow !== 0 && dow !== 6 && !holidaySet[ds]) stats[ym].workingDays++;
      }
    });

    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    for (let bi = 1; bi < bData.length; bi++) {
      const bd = parseFlexDate(bData[bi][2]);
      if (!bd) continue;
      const ds = dateToStr(bd);
      const ym = ds.substring(0, 7);
      if (!stats[ym]) continue;
      const hn = normalizeHN(bData[bi][6]);
      if (hn === 'BLOCK') continue;
      stats[ym].total++;
      if (hn) stats[ym].unique.add(hn);
      const type = bData[bi][12] || 'OPD';
      if (type === 'OPD') stats[ym].opd++; else stats[ym].home++;
    }

    const mnShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const result  = months.map(ym => {
      const [y, m] = ym.split('-').map(Number);
      const target = Math.ceil((MONTHLY_TARGET_PATIENTS / 22) * stats[ym].workingDays);
      return {
        yearMonth:   ym,
        label:       mnShort[m-1] + (y+543).toString().slice(-2),
        total:       stats[ym].total,
        opd:         stats[ym].opd,
        home:        stats[ym].home,
        unique:      stats[ym].unique.size,
        workingDays: stats[ym].workingDays,
        target,
        achieveRate: target > 0 ? parseFloat((stats[ym].total / target * 100).toFixed(1)) : 0
      };
    });

    cache.put(cacheKey, JSON.stringify(result), 3600);
    return result;
  } catch (e) {
    Logger.log('getKPITrend12Months: ' + e.message);
    return [];
  }
}

function getQuickKPISummary() {
  const today     = new Date();
  const yearMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  return getKPISummaryFast(yearMonth);
}

function getKPIData(yearMonth) { return getKPISummaryFast(yearMonth); }

// ===================================
// ===================================
// EXPORT KPI — V18 LANDSCAPE 3-COLUMN LAYOUT (ซ้าย–กลาง–ขวา, เต็มหน้า A4 ไม่ล้น ไม่ทับ)
// Layout: A4 แนวนอน, แบ่ง 3 ส่วน เริ่มแนวเดียวกัน ไม่เหลื่อม/ไม่ซ้อน
//   ซ้าย   (col A–D, 4 คอลัมน์):  สรุป KPI รวม + ความก้าวหน้าเทียบเป้า (ตารางเดียวรวบ)
//   กลาง   (col F–R, 2 บล็อกย่อย F–K / M–R):  รายละเอียดรายวัน แยกครึ่งเดือนซ้าย-ขวา
//   ขวา    (col T–Z, 2 คอลัมน์ย่อย T–V / X–Z):
//            แถวบน  = สิทธิ์การรักษา | ประเภทการรักษา  (คอลัมน์ชื่อกว้างขึ้น กันคำยาวถูกตัด)
//            แถวล่าง = สถิติการวินิจฉัย: กลุ่มวินิจฉัย | ICD-10 ยอดนิยม
//   ลายเซ็น: กล่องเดี่ยวมุมล่างขวา (col R–Z กว้างขึ้น) ใต้เนื้อหาทั้งหมด กันตัวอักษรซ้อนทับ
//   V18: ขยายฟอนต์/ความสูงแถว/ความกว้างคอลัมน์ขึ้นทั้งหน้า ให้เนื้อหาเต็มพื้นที่ A4 จริง
//        (ไม่ใช่แค่ scale=4 บีบเล็ก) + เอาอีโมจิ ✅/⚠️ ออกจากผลลัพธ์ (กัน PDF เรนเดอร์ตัวอักษรเพี้ยน)
// ===================================
function exportKPIAsExcel(yearMonth) {
  try {
    const [year, month] = yearMonth.split('-').map(Number);
    const startStr = `${year}-${String(month).padStart(2,'0')}-01`;
    const endDate  = new Date(year, month, 0);
    const endStr   = Utilities.formatDate(endDate, TIMEZONE, 'yyyy-MM-dd');

    // ── 1. วันหยุด
    const hData    = HOLIDAYS_SHEET().getDataRange().getValues();
    const holidays = {};
    for (let i = 1; i < hData.length; i++) {
      const hd = parseFlexDate(hData[i][0]);
      if (hd) {
        const ds = dateToStr(hd);
        if (ds >= startStr && ds <= endStr && !holidays[ds]) holidays[ds] = true;
      }
    }

    // ── 2. dailyData
    let workingDays = 0;
    const dailyData = {};
    for (let day = 1; day <= endDate.getDate(); day++) {
      const ds  = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const dow = new Date(ds).getDay();
      if (dow === 0 || dow === 6 || holidays[ds]) continue;
      workingDays++;
      dailyData[ds] = { total: 0, opd: 0, home: 0, arrived: 0, targetTotal: DAILY_TARGET };
    }

    // ── 3. อ่าน Bookings (รวม diagnosis ในลูปเดียวกัน ไม่อ่านซ้ำ)
    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    let totalBookings = 0, arrivedCount = 0, opdVisits = 0, homeVisits = 0;
    const uniquePatients = new Set();
    const rightsCount     = {};
    const treatmentCount  = {};
    let   diagTotal       = 0;
    const diagGroupCount  = {};
    const icdCount        = {};

    for (let i = 1; i < bData.length; i++) {
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds = dateToStr(bd);
      if (ds < startStr || ds > endStr || !dailyData[ds]) continue;
      const hn = normalizeHN(bData[i][6]);
      if (hn === 'BLOCK') continue;

      totalBookings++;
      if (hn) uniquePatients.add(hn);

      const type = (bData[i][12] || 'OPD').toString().trim();
      if (type === 'OPD') { opdVisits++; dailyData[ds].opd++; }
      else                { homeVisits++; dailyData[ds].home++; }

      if (bData[i][11] === 'Arrived') { arrivedCount++; dailyData[ds].arrived++; }
      dailyData[ds].total++;

      const rights = normalizeRights_(bData[i][9]);
      rightsCount[rights] = (rightsCount[rights] || 0) + 1;

      const treat  = (bData[i][10] || 'ไม่ระบุ').toString().trim() || 'ไม่ระบุ';
      treatmentCount[treat] = (treatmentCount[treat] || 0) + 1;

      // สถิติการวินิจฉัย (ICD-10) จากคอลัมน์ diagnosis (col 14)
      if (bData[i][13]) {
        try {
          const diag = JSON.parse(bData[i][13]);
          const grp  = (diag.group || 'ไม่ระบุ').replace(/^[\u{1F300}-\u{1FFFF}\u2600-\u27FF]\s*/u, '').trim();
          diagGroupCount[grp] = (diagGroupCount[grp] || 0) + 1;
          if (diag.icd10) {
            const icdKey = diag.icd10 + ' ' + (diag.label || '');
            icdCount[icdKey] = (icdCount[icdKey] || 0) + 1;
          }
          diagTotal++;
        } catch (e) {}
      }
    }

    const arrivalRate = totalBookings
      ? parseFloat(((arrivedCount / totalBookings) * 100).toFixed(1)) : 0;

    const stdWorkDays = 22;
    const adjTargets  = {
      patients: Math.ceil((MONTHLY_TARGET_PATIENTS / stdWorkDays) * workingDays),
      opd:      Math.ceil((MONTHLY_TARGET_OPD      / stdWorkDays) * workingDays),
      home:     Math.ceil((MONTHLY_TARGET_HOME     / stdWorkDays) * workingDays)
    };
    const safeDiv = (a, b) => b > 0 ? parseFloat((a / b * 100).toFixed(1)) : 0;

    // ── helper: ตัด Top-N แล้วรวมส่วนที่เหลือเป็น "อื่นๆ" เพื่อคุมความสูงให้พอดี 1 หน้า
    function topNWithOthers(countObj, n, totalForPct, othersLabel) {
      const entries = Object.entries(countObj).sort((a, b) => b[1] - a[1]);
      const top  = entries.slice(0, n).map(([name, count]) => ({ name, count }));
      const rest = entries.slice(n);
      if (rest.length) {
        const restSum = rest.reduce((s, [, c]) => s + c, 0);
        top.push({ name: `${othersLabel || 'อื่นๆ'} (${rest.length})`, count: restSum });
      }
      return top.map(({ name, count }) => ({
        name, count,
        pct: totalForPct ? parseFloat((count / totalForPct * 100).toFixed(1)) : 0
      }));
    }
    function placeholderIfEmpty(list, label) {
      return list.length ? list : [{ name: label, count: 0, pct: 0 }];
    }

    // ── 4. สร้าง Spreadsheet (แนวนอน, 3 ส่วน ซ้าย-กลาง-ขวา)
    const newSS  = SpreadsheetApp.create(`รายงาน KPI ${yearMonth}`);
    const sheet  = newSS.getActiveSheet();
    sheet.setName('KPI Report');

    // คอลัมน์ (รวม 26 = A–Z) — V19: ขยายตารางรายวัน (F–R) ให้เต็มพื้นที่กลาง
    //  A–D   ซ้าย (สรุป KPI + แนวโน้ม)    E   สเปเซอร์
    //  F–K   กลาง บล็อก 1 (รายวันครึ่งแรก)  L   สเปเซอร์
    //  M–R   กลาง บล็อก 2 (รายวันครึ่งหลัง)  S   สเปเซอร์
    //  T–V   ขวา บล็อก 1 (สิทธิ์ / กลุ่มวินิจฉัย) — ชื่อกว้าง 130
    //  W     สเปเซอร์เล็ก
    //  X–Z   ขวา บล็อก 2 (ประเภทการรักษา / ICD-10) — ชื่อกว้าง 130
    // col widths (px) — V20: center 1-block layout
    // A–D: ซ้าย 278px  E: spacer 6
    // F=วันที่(46) G=วัน(26) H=รวม(38) I=OPD(38) J=บ้าน(38) K=%(44)  = 230px
    // L: divider 4px
    // M–R: progress bar 6 cells × 34px = 204px   S: spacer 6px
    // T=130 U=34 V=34  W=6  X=130 Y=34 Z=34
    // คอลัมน์รวม 26 (A–Z) — ขยายเต็ม A4 landscape usable ~1050px
    // ซ้าย A–D (278→320px)  E spacer(6)
    // กลาง F–R 13col (290→410px)  S spacer(6)
    // ขวา T–Z 7col (338→308px)
    // รวม: 320+6+410+6+308 = 1050px
    const colWidths = [
      // A–D ซ้าย: รายการ(120) ทำได้/เป้า(80) %(50) ผลลัพธ์(70)
      120, 80, 50, 70,
      6,                            // E spacer
      // F–R กลาง 13 col: วันที่(65) วัน(32) รวม(52) OPD(52) บ้าน(52) %(52) | L–R 7col สีพื้น(×15=105)
      65, 32, 52, 52, 52, 52, 15, 15, 15, 15, 15, 15, 15,
      6,                            // S spacer
      // T–V ขวา บล็อก 1: ชื่อ(140) จำนวน(38) %(38)
      140, 38, 38,
      6,                            // W spacer
      // X–Z ขวา บล็อก 2: ชื่อ(140) จำนวน(38) %(38)
      140, 38, 38
    ];
    colWidths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
    sheet.setRowHeights(1, 200, 23); // V18: ความสูงแถวมาตรฐานเพิ่มขึ้น (เดิม 14) ให้เนื้อหาเต็มหน้าจริง

    const exportDateStr = Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm');
    const thMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                      'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const thMonth  = thMonths[month - 1];
    const thYear   = year + 543;

    // ════════════════════════════════════════
    // ROW 1–3: หัวรายงาน (เต็มหน้า A–Z)
    // ════════════════════════════════════════
    sheet.getRange(1, 1, 1, 26).merge()
      .setValue(`รายงานตัวชี้วัด (KPI) ประจำเดือน${thMonth} ${thYear}  (${yearMonth})`)
      .setFontWeight('bold').setFontSize(16).setFontColor('#FFFFFF')
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBackground('#1565C0');
    sheet.setRowHeight(1, 34);

    sheet.getRange(2, 1, 1, 26).merge()
      .setValue('นางสาวพลอยไพลิน ประทีปพงศ์  |  นักกายภาพบำบัดปฏิบัติการ  |  โรงพยาบาลส่งเสริมสุขภาพตำบลบางขะแยง  อบจ.ปทุมธานี')
      .setFontSize(10).setHorizontalAlignment('center').setBackground('#E3F2FD').setFontColor('#1565C0');
    sheet.setRowHeight(2, 19);

    sheet.getRange(3, 1, 1, 26).merge()
      .setValue(`Export จากระบบ PT Station V18  |  วันที่ออกรายงาน: ${exportDateStr} น.`)
      .setFontSize(8.5).setFontStyle('italic').setHorizontalAlignment('center')
      .setFontColor('#757575').setBackground('#FAFAFA');
    sheet.setRowHeight(3, 16);
    sheet.setRowHeight(4, 6);

    // ════════════════════════════════════════
    // ROW 5: หัวข้อ 3 ส่วน ซ้าย–กลาง–ขวา (เริ่มแนวเดียวกัน)
    // ════════════════════════════════════════
    sheet.getRange(5, 1, 1, 4).merge()
      .setValue('สรุปภาพรวม KPI')
      .setFontWeight('bold').setFontSize(10).setFontColor('#FFFFFF')
      .setBackground('#1565C0').setHorizontalAlignment('left').setVerticalAlignment('middle');
    sheet.getRange(5, 6, 1, 13).merge()
      .setValue('รายละเอียดรายวัน')
      .setFontWeight('bold').setFontSize(10).setFontColor('#FFFFFF')
      .setBackground('#2E7D32').setHorizontalAlignment('left').setVerticalAlignment('middle');
    sheet.getRange(5, 20, 1, 7).merge()
      .setValue('สิทธิ์ / ประเภทการรักษา / สถิติการวินิจฉัย')
      .setFontWeight('bold').setFontSize(10).setFontColor('#FFFFFF')
      .setBackground('#6A1B9A').setHorizontalAlignment('left').setVerticalAlignment('middle');
    sheet.setRowHeight(5, 24);

    // ════════════════════════════════════════
    // ซ้าย (A–D): สรุป KPI รวม + ความก้าวหน้าเทียบเป้า (ตารางเดียว 4 คอลัมน์)
    // ════════════════════════════════════════
    sheet.getRange(6, 1, 1, 4)
      .setValues([['รายการ','ทำได้/เป้า','%','ผลลัพธ์']])
      .setFontWeight('bold').setBackground('#1A78C2').setFontColor('#FFFFFF').setFontSize(9)
      .setHorizontalAlignment('center');
    sheet.setRowHeight(6, 20);

    const passColor = (ok) => ok ? '#059669' : '#d97706';
    const leftRows = [
      ['นัดหมายทั้งหมด',      `${totalBookings}/${adjTargets.patients}`, safeDiv(totalBookings, adjTargets.patients),
        totalBookings >= adjTargets.patients ? 'ผ่านเป้า' : 'ต่ำกว่าเป้า'],
      ['รับบริการ (Arrived)', `${arrivedCount}/${totalBookings}`,         arrivalRate,
        arrivalRate >= 80 ? 'ผ่านเป้า' : 'ต่ำกว่าเป้า'],
      ['ผู้ป่วยไม่ซ้ำ',       `${uniquePatients.size} คน`,                '',  ''],
      ['OPD',                  `${opdVisits}/${adjTargets.opd}`,          safeDiv(opdVisits, adjTargets.opd),
        opdVisits >= adjTargets.opd ? 'ผ่านเป้า' : 'ต่ำกว่าเป้า'],
      ['เยี่ยมบ้าน',          `${homeVisits}/${adjTargets.home}`,         safeDiv(homeVisits, adjTargets.home),
        homeVisits >= adjTargets.home ? 'ผ่านเป้า' : 'ต่ำกว่าเป้า'],
      ['วันทำการ',             `${workingDays} วัน`,                      '',  `เป้ารวม ${adjTargets.patients}`]
    ];
    sheet.getRange(7, 1, leftRows.length, 4).setValues(leftRows).setFontSize(9)
      .setBorder(true,true,true,true,true,true,'#BDBDBD', SpreadsheetApp.BorderStyle.SOLID)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW); // กันคำยาวพับ 2 บรรทัดจนทับกันในแถวเตี้ย
    sheet.getRange(7, 2, leftRows.length, 1).setHorizontalAlignment('center').setFontWeight('bold').setFontColor('#1565C0');
    sheet.getRange(7, 3, leftRows.length, 1).setHorizontalAlignment('center').setNumberFormat('0.0"%"');
    sheet.getRange(7, 4, leftRows.length, 1).setHorizontalAlignment('center').setFontWeight('bold');
    [0,1,3,4].forEach(r => sheet.getRange(7 + r, 4).setFontColor(passColor(leftRows[r][3] === 'ผ่านเป้า')));
    for (let r = 0; r < leftRows.length; r++) {
      sheet.getRange(7 + r, 1, 1, 4).setBackground(r % 2 === 0 ? '#FFFFFF' : '#E3F2FD');
    }
    const leftEndRow = 7 + leftRows.length - 1; // = 12

    // ════════════════════════════════════════
    // ซ้าย-ล่าง (A–D): แนวโน้มการให้บริการ ตั้งแต่ ต.ค. 68
    // กราฟแท่ง 10 ช่อง = 100% (ช่องละ 10%) วาดด้วย background cells
    // ใช้ข้อมูลจาก getKPITrend12Months() กรองเอาตั้งแต่ ต.ค.68
    // ════════════════════════════════════════

    // ── ดึงข้อมูลจาก getKPITrend12Months() แล้วกรองตั้งแต่ ต.ค.68 ──
    const trend12Raw = getKPITrend12Months(); // 12 เดือนย้อนหลัง
    const cutoff     = '2025-10';             // ต.ค. 2025 CE = ต.ค. 68 BE
    const trendData  = trend12Raw.filter(d => d.yearMonth >= cutoff);
    const nM         = trendData.length;

    // ── Title ──
    const tTitleRow = leftEndRow + 2;
    const lastLabel = nM > 0 ? trendData[nM-1].label : '';
    sheet.getRange(tTitleRow,1,1,4).merge()
      .setValue('แนวโน้มการให้บริการ  ต.ค.68 – ' + lastLabel)
      .setFontWeight('bold').setFontSize(9).setFontColor('#FFFFFF')
      .setBackground('#1565C0').setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.setRowHeight(tTitleRow, 22);

    // ── Sub-header ──
    const tSubRow = tTitleRow + 1;
    sheet.setRowHeight(tSubRow, 15);
    sheet.getRange(tSubRow,1)
      .setValue('เดือน')
      .setFontWeight('bold').setFontSize(7.5).setFontColor('#FFFFFF')
      .setBackground('#0D47A1').setHorizontalAlignment('center');
    // col B = 0–50% (5 ช่อง) , col C = 50–100%+ (5+ ช่อง) — ใช้ merged sub-cols
    sheet.getRange(tSubRow,2,1,2).merge()
      .setValue('% บรรลุเป้าหมาย  |  ช่องละ 10%  |  100% = เส้นเป้า')
      .setFontWeight('bold').setFontSize(7.5).setFontColor('#FFFFFF')
      .setBackground('#0D47A1').setHorizontalAlignment('center');
    sheet.getRange(tSubRow,4)
      .setValue('ผล / เป้า')
      .setFontWeight('bold').setFontSize(7.5).setFontColor('#FFFFFF')
      .setBackground('#0D47A1').setHorizontalAlignment('center');

    // ── วาดกราฟแต่ละเดือน ──
    // col B–C รวม ~100px, Courier New 9pt ~5.5px/char → ใส่ได้ ~18 chars
    // ใช้ 10 ช่อง × 1 char + separator = 10 chars → พอดีและอ่านง่าย
    // แต่ละช่อง = 10% → 5 ช่อง = 50%, 10 ช่อง = 100%, 12 ช่อง = 120%
    // cap ที่ 12 ช่อง (120%) เพื่อไม่ล้น
    const SLOTS     = 12; // สูงสุด 120%
    const PCT_PER   = 10; // % ต่อช่อง
    // สีช่อง:
    //   ช่อง 1–6  (0–60%)  = ยังไม่ผ่าน → แดง
    //   ช่อง 7–8  (60–80%) = เกือบผ่าน  → ส้ม
    //   ช่อง 9–10 (80–100%)= ผ่านเกณฑ์  → เขียว
    //   ช่อง 11–12 (>100%) = เกินเป้า   → เขียวเข้ม
    // slotIdx 0-based: slot 0 = 10%, slot 5 = 60%, slot 7 = 80%, slot 9 = 100%, slot 11 = 120%
    // สีตาม "ช่องนั้นแทนถึง %เท่าไหร่":
    //   slot 0–5  → แทน 10–60%  → แดง
    //   slot 6–7  → แทน 70–80%  → ส้ม
    //   slot 8–9  → แทน 90–100% → เขียวอ่อน
    //   slot 10–11→ แทน 110–120%→ เขียวเข้ม
    function slotColor(slotIdx) {
      if (slotIdx <= 5)  return '#E53935'; // แดง     10–60%
      if (slotIdx <= 7)  return '#FB8C00'; // ส้ม     70–80%
      if (slotIdx <= 9)  return '#43A047'; // เขียว   90–100%
      return '#1B5E20';                    // เขียวเข้ม >100%
    }

    // build bar string: ใช้ Unicode block ▓ (filled) vs ░ (empty) ต่างสีใน 1 cell ไม่ได้
    // → ใช้ 1 cell per row, filled part = '█' repeated, empty = '·' (dim)
    // หรือ: แบ่ง col B = 0–60% (6 slots) col C–D... แต่ col ไม่พอ
    //
    // ✅ สุดท้าย: ใช้ RichTextValue เพื่อ color แต่ละ char ต่างกันใน 1 cell
    // → แต่ละ slot 1 char '█' สีตาม threshold + empty slot '░' สีเทาอ่อน

    const tDataStart = tSubRow + 1;
    trendData.forEach(({ label, total, opd, home, target, achieveRate, yearMonth: ym }, idx) => {
      const row     = tDataStart + idx;
      sheet.setRowHeight(row, 17);
      const hasDat  = total > 0;
      const isCurr  = (ym === yearMonth);
      const rowBg   = isCurr ? '#FFF9C4' : (idx%2===0 ? '#FFFFFF' : '#F8F9FA');

      // col A: label
      sheet.getRange(row,1)
        .setValue(label)
        .setFontSize(8).setFontWeight(isCurr?'bold':'normal')
        .setFontColor(isCurr?'#0D47A1':'#37474F')
        .setHorizontalAlignment('center').setVerticalAlignment('middle')
        .setBackground(rowBg);

      // col B–C: กราฟแท่ง RichText
      // floor: ช่องจะเติมก็ต่อเมื่อผ่าน 10% นั้นครบแล้ว
      // เช่น 67.9% → floor(6.79)=6 ช่อง → slot 0-5 (10-60%) → สีแดงและส้ม ✅
      // เช่น 80.0% → floor(8.0)=8 ช่อง → slot 0-7 (10-80%) → แดง,ส้ม,เขียว ✅
      // slot index boundary: 0-5=แดง(10-60%), 6-7=ส้ม(70-80%), 8-9=เขียว(90-100%), 10-11=เขียวเข้ม(110-120%)
      const filledSlots = hasDat ? Math.min(Math.floor(achieveRate / PCT_PER), SLOTS) : 0;
      const builder = SpreadsheetApp.newRichTextValue();
      let barStr = '';
      // รวม consecutive same-color runs เพื่อความถูกต้องของ RichText API
      const runs = [];
      for (let s = 0; s < SLOTS; s++) {
        const ch = s < filledSlots ? '█' : '░';
        const cl = s < filledSlots ? slotColor(s) : '#CCCCCC';
        barStr += ch;
        if (runs.length > 0 && runs[runs.length-1].color === cl) {
          runs[runs.length-1].end = s + 1;
        } else {
          runs.push({ start: s, end: s+1, color: cl });
        }
      }
      builder.setText(barStr);
      runs.forEach(({ start, end, color }) => {
        builder.setTextStyle(start, end,
          SpreadsheetApp.newTextStyle().setForegroundColor(color)
            .setFontFamily('Courier New').setFontSize(10).setBold(false).build());
      });
      sheet.getRange(row,2,1,2).merge()
        .setRichTextValue(builder.build())
        .setVerticalAlignment('middle').setHorizontalAlignment('left')
        .setBackground(rowBg)
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

      // col D: ตัวเลข
      const pctColor = achieveRate>=80?'#1B5E20':achieveRate>=60?'#E65100':'#C62828';
      sheet.getRange(row,4)
        .setValue(hasDat ? total+'/'+target+'\n('+achieveRate+'%)' : '-')
        .setFontSize(7.5).setFontWeight(isCurr?'bold':'normal')
        .setFontColor(hasDat ? pctColor : '#9E9E9E')
        .setHorizontalAlignment('center').setVerticalAlignment('middle')
        .setBackground(rowBg).setWrap(true);
    });

    // ── Legend ──
    const tLegRow = tDataStart + nM;
    sheet.setRowHeight(tLegRow, 14);
    // Legend ใช้ RichText สีตรง
    const legBuilder = SpreadsheetApp.newRichTextValue();
    const legText = '█ <60%  █ 60–80%  █ 80–100%  █ >100%';
    legBuilder.setText(legText);
    const legStyles = [
      { start:0,  end:1,  color:'#E53935' }, // █ <60%
      { start:8,  end:9,  color:'#FB8C00' }, // █ 60–80%
      { start:18, end:19, color:'#43A047' }, // █ 80–100%
      { start:29, end:30, color:'#1B5E20' }  // █ >100%
    ];
    legStyles.forEach(({ start, end, color }) => {
      legBuilder.setTextStyle(start, end,
        SpreadsheetApp.newTextStyle().setForegroundColor(color)
          .setFontFamily('Courier New').setFontSize(8).build());
    });
    sheet.getRange(tLegRow,1,1,4).merge()
      .setRichTextValue(legBuilder.build())
      .setHorizontalAlignment('center').setBackground('#F5F5F5');

    // ── ตารางตัวเลข OPD/บ้าน ──
    const tTblHdr = tLegRow + 1;
    sheet.setRowHeight(tTblHdr, 15);
    [1,3].forEach(c => {
      sheet.getRange(tTblHdr,c,1,2).merge()
        .setValue('เดือน  รวม  OPD  บ้าน  %เป้า')
        .setFontWeight('bold').setFontSize(7.5).setFontColor('#FFFFFF')
        .setBackground('#1565C0').setHorizontalAlignment('center');
    });

    const tTblData = tTblHdr + 1;
    const half2    = Math.ceil(nM/2);
    for (let ri = 0; ri < half2; ri++) {
      sheet.setRowHeight(tTblData+ri, 15);
      [[1, trendData[ri]], [3, trendData[ri+half2]]].forEach(([col, d]) => {
        if (!d) return;
        const cl  = d.achieveRate>=80?'#1B5E20':d.achieveRate>=60?'#E65100':'#B71C1C';
        const txt = d.label+'  '+d.total+'  '+d.opd+'  '+d.home+'  '+d.achieveRate+'%';
        const isCurrCell = d.yearMonth === yearMonth;
        sheet.getRange(tTblData+ri,col,1,2).merge()
          .setValue(txt).setFontSize(7.5)
          .setBackground(isCurrCell?'#FFF9C4':(ri%2===0?'#FFFFFF':'#F5F5F5'))
          .setFontColor(d.total>0?cl:'#9E9E9E').setHorizontalAlignment('left');
        if (isCurrCell) sheet.getRange(tTblData+ri,col).setFontWeight('bold');
      });
    }

    // ── แถวสรุป ──
    const trendSumRow = tTblData + half2;
    sheet.setRowHeight(trendSumRow, 17);
    const tAll = trendData.reduce((s,d)=>s+d.total,0);
    const tOPD = trendData.reduce((s,d)=>s+d.opd,0);
    const tHom = trendData.reduce((s,d)=>s+d.home,0);
    const actM = trendData.filter(d=>d.total>0);
    const avgR = actM.length>0
      ? parseFloat((actM.reduce((s,d)=>s+d.achieveRate,0)/actM.length).toFixed(1)):0;
    sheet.getRange(trendSumRow,1,1,4).merge()
      .setValue('รวม '+nM+' เดือน: '+tAll+' ครั้ง | OPD '+tOPD+' | บ้าน '+tHom+' | เฉลี่ย%เป้า '+avgR+'%')
      .setFontWeight('bold').setBackground('#1565C0').setFontColor('#FFFFFF').setFontSize(8)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');

    // กรอบ
    sheet.getRange(tTitleRow,1,trendSumRow-tTitleRow+1,4)
      .setBorder(true,true,true,true,null,null,'#1565C0',SpreadsheetApp.BorderStyle.SOLID);

    const newLeftEndRow = trendSumRow;










    // ════════════════════════════════════════
    // กลาง (F–R): รายละเอียดรายวัน — 1 ตารางเดียว เต็มพื้นที่กลาง
    // col F=วันที่ G=วัน H=รวม I=OPD J=บ้าน K=% L=spacer M=วันที่ N=วัน O=รวม P=OPD Q=บ้าน R=%
    // แสดงทุกวันแบ่งครึ่งซ้าย-ขวา แต่ใช้ col เดียวกันทั้งหมด ไม่มี bar
    // ════════════════════════════════════════
    // ── รายละเอียดรายวัน: 1 คอลัมน์ ทุกวันเรียงลงมา เต็มพื้นที่กลาง F–R ──
    // col F=วันที่ G=วัน H=รวม I=OPD J=บ้าน K=% L–R=ว่าง (ขยายด้วย merge)
    // header merge F:R
    const dayNamesShort = ['อา','จ','อ','พ','พฤ','ศ','ส'];
    const allRows = [];
    Object.keys(dailyData).sort().forEach(date => {
      const d   = dailyData[date];
      const pct = d.targetTotal ? parseFloat((d.total / d.targetTotal * 100).toFixed(1)) : 0;
      allRows.push({ date, pct,
        rowData: [
          Utilities.formatDate(new Date(date), TIMEZONE, 'dd/MM'),
          dayNamesShort[new Date(date).getDay()],
          d.total, d.opd, d.home, pct
        ]
      });
    });
    const nDays = allRows.length;

    // ── layout กลาง F–R (13 col) 1 column เรียงลงมา
    // F=วันที่(60) G=วัน(30) H=รวม(50) I=OPD(50) J=บ้าน(50) K=%(50) | L–R(7col×14=98) merge สีพื้น
    // ทุก col สัดส่วนพอดี ไม่มี col ใด col หนึ่งกินพื้นที่มากเกิน
    const HDR_COLS   = ['วันที่','วัน','รวม','OPD','บ้าน','%'];
    const DATA_START = 8;

    function pctColor(pct) {
      if (pct >= 100) return '#1B5E20';
      if (pct >= 80)  return '#2E7D32';
      if (pct >= 60)  return '#E65100';
      return '#C62828';
    }

    // title header row 6: merge F:R ทั้งหมด
    sheet.getRange(6, 6, 1, 13).merge()
      .setValue('รายละเอียดรายวัน')
      .setFontWeight('bold').setBackground('#1B5E20').setFontColor('#FFFFFF')
      .setFontSize(11).setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.setRowHeight(6, 22);

    // col headers row 7: F–K (6 col ข้อมูล) | L–R merge สีเขียวต่อเนื่อง
    sheet.getRange(7, 6, 1, 6).setValues([HDR_COLS])
      .setFontWeight('bold').setBackground('#2E7D32').setFontColor('#FFFFFF')
      .setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.getRange(7, 12, 1, 7).merge().setValue('').setBackground('#2E7D32');
    sheet.setRowHeight(7, 20);

    // วาดแถวข้อมูล เริ่ม row 8
    allRows.forEach(({ rowData, pct }, idx) => {
      const r  = DATA_START + idx;
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F1F8E9';

      // F–J: วันที่ วัน รวม OPD บ้าน (5 col แยก)
      sheet.getRange(r, 6, 1, 5).setValues([rowData.slice(0, 5)])
        .setFontSize(10).setBackground(bg)
        .setHorizontalAlignment('center').setVerticalAlignment('middle')
        .setBorder(false, false, true, false, false, false, '#C8E6C9', SpreadsheetApp.BorderStyle.SOLID);

      // K: % เป็น col แยก ไม่ merge — กว้าง 50px พอดีตัวเลข
      sheet.getRange(r, 11)
        .setValue(pct.toFixed(1) + '%')
        .setFontSize(10).setFontWeight('bold').setFontColor(pctColor(pct))
        .setBackground(bg)
        .setHorizontalAlignment('center').setVerticalAlignment('middle')
        .setNumberFormat('@')
        .setBorder(false, false, true, false, false, false, '#C8E6C9', SpreadsheetApp.BorderStyle.SOLID);

      // L–R: merge สีพื้น ต่อเนื่องให้ดูเต็มตาราง ไม่โล่ง
      sheet.getRange(r, 12, 1, 7).merge().setValue('').setBackground(bg)
        .setBorder(false, false, true, false, false, false, '#C8E6C9', SpreadsheetApp.BorderStyle.SOLID);
    });

    const centerEndRow = nDays > 0 ? (DATA_START + nDays - 1) : 7;

    // ════════════════════════════════════════
    // ขวา (T–V / X–Z): แถวบน = สิทธิ์ | ประเภท   แถวล่าง = กลุ่มวินิจฉัย | ICD-10 ยอดนิยม
    // ════════════════════════════════════════
    sheet.getRange(6, 20, 1, 3).setValues([['สิทธิ์การรักษา','จำนวน','%']])
      .setFontWeight('bold').setBackground('#8E24AA').setFontColor('#FFFFFF').setFontSize(9).setHorizontalAlignment('center');
    sheet.getRange(6, 24, 1, 3).setValues([['ประเภทการรักษา','จำนวน','%']])
      .setFontWeight('bold').setBackground('#8E24AA').setFontColor('#FFFFFF').setFontSize(9).setHorizontalAlignment('center');

    function renderMiniTable(startRow, startCol, list, nameColor) {
      const values = list.map(x => [x.name, x.count, x.pct]);
      sheet.getRange(startRow, startCol, values.length, 3).setValues(values).setFontSize(9)
        .setBorder(true,true,true,true,true,true,'#BDBDBD', SpreadsheetApp.BorderStyle.SOLID)
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW); // กันคำยาวพับ 2 บรรทัดจนทับกันในแถวเตี้ย
      sheet.getRange(startRow, startCol + 1, values.length, 1).setHorizontalAlignment('center').setFontWeight('bold').setFontColor(nameColor);
      sheet.getRange(startRow, startCol + 2, values.length, 1).setHorizontalAlignment('center').setNumberFormat('0.0"%"');
      for (let r = 0; r < values.length; r++) {
        sheet.getRange(startRow + r, startCol, 1, 3).setBackground(r % 2 === 0 ? '#FFFFFF' : '#F3E5F5');
      }
      return values.length;
    }

    // V18: เพิ่มจำนวนรายการที่แสดง (top 6) เนื่องจากคอลัมน์ชื่อกว้างขึ้นและมีพื้นที่สูงเหลือมากขึ้น
    const rightsList = placeholderIfEmpty(topNWithOthers(rightsCount, 6, totalBookings, 'อื่นๆ'), 'ไม่มีข้อมูล');
    const treatList  = placeholderIfEmpty(topNWithOthers(treatmentCount, 6, totalBookings, 'อื่นๆ'), 'ไม่มีข้อมูล');
    const topPairRows = Math.max(
      renderMiniTable(7, 20, rightsList, '#8E24AA'),
      renderMiniTable(7, 24, treatList,  '#1565C0')
    );
    const topPairEndRow = 7 + topPairRows - 1;

    const diagHeaderRow = topPairEndRow + 2; // เว้น 1 แถวก่อนหัวข้อบล็อกล่าง
    sheet.getRange(diagHeaderRow, 20, 1, 3).setValues([['กลุ่มวินิจฉัย','จำนวน','%']])
      .setFontWeight('bold').setBackground('#AD1457').setFontColor('#FFFFFF').setFontSize(9).setHorizontalAlignment('center');
    sheet.getRange(diagHeaderRow, 24, 1, 3).setValues([['ICD-10 ยอดนิยม','จำนวน','%']])
      .setFontWeight('bold').setBackground('#AD1457').setFontColor('#FFFFFF').setFontSize(9).setHorizontalAlignment('center');

    const diagGroupList = placeholderIfEmpty(topNWithOthers(diagGroupCount, 5, diagTotal, 'อื่นๆ'), 'ยังไม่มีการบันทึก');
    const topICDList = placeholderIfEmpty(
      Object.entries(icdCount).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([name, count]) => ({ name, count, pct: diagTotal ? parseFloat((count / diagTotal * 100).toFixed(1)) : 0 })),
      'ยังไม่มีการบันทึก'
    );
    const diagDataRow  = diagHeaderRow + 1;
    const diagPairRows = Math.max(
      renderMiniTable(diagDataRow, 20, diagGroupList, '#AD1457'),
      renderMiniTable(diagDataRow, 24, topICDList,    '#6A1B9A')
    );
    const rightEndRow = diagDataRow + diagPairRows - 1;

    // ════════════════════════════════════════
    // ปรับความสูง 3 ฝั่งให้ "จบแถวเดียวกัน" แล้ววาดกรอบปิด — ป้องกันเหลื่อม/ซ้อน
    // ════════════════════════════════════════
    const lastContentRow = Math.max(newLeftEndRow, centerEndRow, rightEndRow);
    if (newLeftEndRow < lastContentRow) {
      sheet.getRange(newLeftEndRow + 1, 1, lastContentRow - newLeftEndRow, 4)
        .setBorder(false,false,true,false,false,false,'#E0E0E0', SpreadsheetApp.BorderStyle.SOLID);
    }

    // ── auto-scale row height ของ center ให้เต็ม lastContentRow ──
    // จำนวนแถวรายวัน = half แถว (row 7 → centerEndRow)
    // พื้นที่ว่างที่เหลือ = lastContentRow - centerEndRow
    if (nDays > 0) {
      // auto-scale: ให้ตารางรายวันยืดเต็ม lastContentRow
      // data เริ่ม row 8, header row 6+7 สูง 20px แต่ละ
      const usableRows   = lastContentRow - DATA_START + 1;
      const scaledHeight = Math.max(23, Math.floor((usableRows * 23) / nDays));
      const cappedHeight = Math.min(scaledHeight, 40);
      sheet.setRowHeights(DATA_START, nDays, cappedHeight);
    }

    if (centerEndRow < lastContentRow) {
      // fill F–R (col 6–18, 13 cols) ด้านล่าง center
      sheet.getRange(centerEndRow + 1, 6, lastContentRow - centerEndRow, 13)
        .merge().setBackground('#FAFAFA');
    }
    if (rightEndRow < lastContentRow) {
      sheet.getRange(rightEndRow + 1, 20, lastContentRow - rightEndRow, 7)
        .setBorder(false,false,true,false,false,false,'#E0E0E0', SpreadsheetApp.BorderStyle.SOLID);
    }
    // กรอบล้อมรอบทั้ง 3 บล็อก ให้เห็นเป็น "3 ส่วน ซ้าย-กลาง-ขวา" ชัดเจน ไม่ปนกัน
    sheet.getRange(5, 1,  newLeftEndRow - 5 + 1, 4)
      .setBorder(true, true, true, true, null, null, '#90A4AE', SpreadsheetApp.BorderStyle.SOLID);
    // center border: F–R (col 6, width 13)
    sheet.getRange(5, 6,  lastContentRow - 5 + 1, 13)
      .setBorder(true, true, true, true, null, null, '#388E3C', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sheet.getRange(5, 20, lastContentRow - 5 + 1, 7)
      .setBorder(true, true, true, true, null, null, '#90A4AE', SpreadsheetApp.BorderStyle.SOLID);

    // ════════════════════════════════════════
    // จุดเซ็น — V18: ขยายกล่องให้กว้างขึ้น (col R–Z, 9 คอลัมน์) กันตัวอักษรซ้อนทับขอบ
    // ════════════════════════════════════════
    const sigRow = lastContentRow + 3;
    sheet.setRowHeight(sigRow,     20);
    sheet.setRowHeight(sigRow + 1, 20);
    sheet.setRowHeight(sigRow + 2, 18);
    sheet.setRowHeight(sigRow + 3, 18);
    sheet.getRange(sigRow, 18, 1, 9).merge()
      .setValue('ลงชื่อ ......................................................')
      .setFontSize(9.5).setHorizontalAlignment('center').setFontColor('#212121');
    sheet.getRange(sigRow + 1, 18, 1, 9).merge()
      .setValue('( กภ.พลอยไพลิน  ประทีปพงศ์ )')
      .setFontSize(9.5).setHorizontalAlignment('center').setFontWeight('bold').setFontColor('#1565C0');
    sheet.getRange(sigRow + 2, 18, 1, 9).merge()
      .setValue('นักกายภาพบำบัดปฏิบัติการ')
      .setFontSize(9).setHorizontalAlignment('center').setFontColor('#424242');
    sheet.getRange(sigRow + 3, 18, 1, 9).merge()
      .setValue('โรงพยาบาลส่งเสริมสุขภาพตำบลบางขะแยง  อบจ.ปทุมธานี')
      .setFontSize(9).setHorizontalAlignment('center').setFontColor('#424242');
    sheet.getRange(sigRow - 1, 18, 6, 9)
      .setBorder(true, true, true, true, null, null, '#90A4AE', SpreadsheetApp.BorderStyle.SOLID);

    // ── footer ระบบ (ล่างสุด กว้างเต็มหน้า)
    const footerRow = sigRow + 6;
    sheet.setRowHeight(footerRow, 16);
    sheet.getRange(footerRow, 1, 1, 26).merge()
      .setValue(`สร้างโดยระบบ PT Station V18  ·  ${exportDateStr} น.`)
      .setFontSize(8).setFontStyle('italic').setFontColor('#9E9E9E').setHorizontalAlignment('center');

    SpreadsheetApp.flush();
    Utilities.sleep(2500);

    // ── Export PDF แนวนอน (landscape) A4 — ไม่ scale ให้เนื้อหาเต็มหน้าจริง
    const ssId      = newSS.getId();
    const shId      = sheet.getSheetId();
    const exportUrl = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export'
      + '?format=pdf&size=A4&portrait=false'
      + '&scale=3'
      + '&gridlines=false&printtitle=false&sheetnames=false'
      + '&top_margin=0.20&bottom_margin=0.20&left_margin=0.10&right_margin=0.10'
      + '&horizontal_alignment=CENTER&vertical_alignment=TOP'
      + '&gid=' + shId;
    const oauthToken = ScriptApp.getOAuthToken();
    const resp = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: 'Bearer ' + oauthToken },
      muteHttpExceptions: true
    });

    let pdfFile;
    if (resp.getResponseCode() === 200) {
      pdfFile = DriveApp.createFile(resp.getBlob().setName(`รายงาน KPI ${yearMonth}.pdf`));
    } else {
      pdfFile = DriveApp.createFile(newSS.getAs('application/pdf').setName(`รายงาน KPI ${yearMonth}.pdf`));
    }
    DriveApp.getFileById(ssId).setTrashed(true);
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return pdfFile.getDownloadUrl();

  } catch (e) {
    Logger.log('Export KPI Error: ' + e.message);
    return { error: e.message };
  }
}



function forceAuthorizeDrive() {
  try {
    const file = DriveApp.createFile(Utilities.newBlob('Test', 'text/plain', 'auth_test.txt'));
    file.setTrashed(true);
    return 'Authorized successfully';
  } catch (e) { return e.message; }
}

// ===================================
// PT OUTCOMES
// ===================================
// ===================================
// ✅ V15.2: helpers สำหรับบันทึก Outcomes
// ===================================
function clearOutcomeCaches_() {
  try {
    const sc = CacheService.getScriptCache();
    sc.remove('kpi_trend_12m_v1'); sc.remove('kpi_trend_12m_v2'); sc.remove('kpi_trend_12m_v3');
  } catch (e) {}
}

// หา therapistId ของ booking (Bookings col E) — ใช้เติมให้ Outcomes เมื่อ frontend ไม่ได้ส่งมา
function lookupBookingTherapistId_(bookingId) {
  try {
    const bs = BOOKINGS_SHEET();
    if (!bs) return '';
    const bid = String(bookingId || '').trim();
    if (!bid) return '';
    const data = bs.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1] || '').trim() === bid) return data[i][4] || '';
    }
  } catch (e) { Logger.log('lookupBookingTherapistId_: ' + e.message); }
  return '';
}

// แปลงค่า VAS/Barthel เป็นตัวเลข (ว่างหรือไม่ใช่ตัวเลข = '')
function numOrBlank_(v) {
  if (v === undefined || v === null || v === '') return '';
  const n = Number(v);
  return isNaN(n) ? '' : n;
}

function diffOrBlank_(before, after) {
  const b = numOrBlank_(before), a = numOrBlank_(after);
  return (b === '' || a === '') ? '' : (b - a);
}

function saveOutcomeCore_(d) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (le) {
    return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองใหม่อีกครั้ง' };
  }
  try {
    const sheet = OUTCOMES_SHEET();
    if (!sheet) return { success: false, message: 'ไม่พบ Sheet Outcomes — รัน setupNewSheets() ก่อน' };
    if (!d || !d.bookingId) return { success: false, message: 'ไม่พบ bookingId' };

    const vb = numOrBlank_(d.vas_before !== undefined ? d.vas_before : d.vas1_before);
    const va = numOrBlank_(d.vas_after  !== undefined ? d.vas_after  : d.vas1_after);
    const bt = numOrBlank_(d.barthel_score);
    const diff = diffOrBlank_(vb, va);
    const goal = d.goal_met ? 'yes' : 'no';
    const bidStr = String(d.bookingId).trim();

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1] || '').trim() === bidStr) {
        // F..L = vas_before, vas_after, barthel, goal_met, note, createdAt, vas1_diff
        sheet.getRange(i + 1, 6, 1, 7).setValues([[ vb, va, bt, goal, d.note || '', new Date(), diff ]]);
        // เติม therapistId ถ้ายังว่าง (ไม่เขียนทับของเดิม)
        if (!data[i][4]) {
          const tid = d.therapistId || lookupBookingTherapistId_(bidStr);
          if (tid) sheet.getRange(i + 1, 5).setValue(tid);
        }
        clearOutcomeCaches_();
        return { success: true, updated: true };
      }
    }
    const oid    = Utilities.getUuid();
    const hnNorm = normalizeHN(d.hn);
    const tid    = d.therapistId || lookupBookingTherapistId_(bidStr);
    // ✅ V15.1: บันทึก date เป็น timestamp ณ เวลาบันทึก (new Date()) แทนวันนัด (new Date(d.date))
    sheet.appendRow([
      oid, bidStr, hnNorm, new Date(), tid,
      vb, va, bt, goal, d.note || '', new Date(), diff
    ]);
    clearOutcomeCaches_();
    return { success: true, outcomeId: oid };
  } catch (e) {
    Logger.log('saveOutcome: ' + e.message);
    return { success: false, message: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// ===================================
// PT OUTCOMES — DUAL DIAGNOSIS (VAS1 + VAS2)
// ===================================
// บันทึก/อัปเดต outcome พร้อม VAS แยกตาม ICD-10 หลัก (vas1) และ ICD-10 รอง (vas2)
// Schema จริงของ Outcomes sheet (16 คอลัมน์, A1:P1):
//  0 outcomeId   1 bookingId   2 hn        3 date        4 therapistId
//  5 vas1_before 6 vas1_after  7 barthel_score 8 goal_met 9 note
// 10 createdAt   11 vas1_diff  12 vas2_before  13 vas2_after  14 vas2_diff
// 15 (ไม่ใช้งาน — คอลัมน์ซ้ำจากการแก้ schema ครั้งก่อน)
function saveOutcome_dualCore_(d) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (le) {
    return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองใหม่อีกครั้ง' };
  }
  try {
    const sheet = OUTCOMES_SHEET();
    if (!sheet) return { success: false, message: 'ไม่พบ Sheet Outcomes — รัน setupNewSheets() ก่อน' };
    if (!d || !d.bookingId) return { success: false, message: 'ไม่พบ bookingId' };

    // รองรับทั้ง vas1_before/vas1_after (ชื่อใหม่) และ vas_before/vas_after (เผื่อ caller เดิม)
    const vas1Before = numOrBlank_(d.vas1_before !== undefined && d.vas1_before !== null ? d.vas1_before : d.vas_before);
    const vas1After  = numOrBlank_(d.vas1_after  !== undefined && d.vas1_after  !== null ? d.vas1_after  : d.vas_after);
    const vas2Before = numOrBlank_(d.vas2_before);
    const vas2After  = numOrBlank_(d.vas2_after);
    const hasVas2    = (vas2Before !== '' && vas2After !== '');
    const vas1Diff   = diffOrBlank_(vas1Before, vas1After);
    const vas2Diff   = hasVas2 ? (vas2Before - vas2After) : '';
    const bt         = numOrBlank_(d.barthel_score);
    const goal       = d.goal_met ? 'yes' : 'no';
    const bidStr     = String(d.bookingId).trim();

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1] || '').trim() === bidStr) {
        // คอลัมน์ 6 (F) ถึง 15 (O) = vas1_before..vas2_diff (10 คอลัมน์)
        sheet.getRange(i + 1, 6, 1, 10).setValues([[
          vas1Before, vas1After, bt,
          goal, d.note || '', new Date(),
          vas1Diff,
          hasVas2 ? vas2Before : '',
          hasVas2 ? vas2After  : '',
          vas2Diff
        ]]);
        if (!data[i][4]) {
          const tid = d.therapistId || lookupBookingTherapistId_(bidStr);
          if (tid) sheet.getRange(i + 1, 5).setValue(tid);
        }
        clearOutcomeCaches_();
        return { success: true, updated: true };
      }
    }

    const oid    = Utilities.getUuid();
    const hnNorm = normalizeHN(d.hn);
    const tid    = d.therapistId || lookupBookingTherapistId_(bidStr);
    // ✅ V15.1: บันทึก date เป็น timestamp ณ เวลาบันทึก (new Date()) แทนวันนัด (new Date(d.date))
    sheet.appendRow([
      oid, bidStr, hnNorm, new Date(), tid,
      vas1Before, vas1After, bt,
      goal, d.note || '', new Date(),
      vas1Diff,
      hasVas2 ? vas2Before : '',
      hasVas2 ? vas2After  : '',
      vas2Diff
    ]);
    clearOutcomeCaches_();
    return { success: true, outcomeId: oid };
  } catch (e) {
    Logger.log('saveOutcome_dual: ' + e.message);
    return { success: false, message: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// ===================================
// ✅ V15.1: formatOutcomeDateCol
// รันครั้งเดียวจาก Apps Script Editor เพื่อจัดรูปแบบ
// คอลัมน์ date (col D) ใน Outcomes sheet ให้แสดงเป็น timestamp
// ===================================
function formatOutcomeDateCol() {
  const sheet = OUTCOMES_SHEET();
  if (!sheet) { Logger.log('ไม่พบ Sheet Outcomes'); return; }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('ไม่มีข้อมูลใน Outcomes'); return; }
  sheet.getRange(2, 4, lastRow - 1, 1)
    .setNumberFormat('dd/MM/yyyy HH:mm:ss');
  Logger.log('✅ formatOutcomeDateCol: จัดรูปแบบ col D แถว 2–' + lastRow + ' เรียบร้อย');
}

// ===================================
// ✅ V15.2: repairOutcomesData — รันครั้งเดียวจาก Apps Script Editor
// แก้ข้อมูลย้อนหลังใน Outcomes sheet:
//   1) ลบแถวขยะ (col A = diagnosis1_icd10 / diagnosis1_label / diagnosis2_icd10 / diagnosis2_label และ bookingId ว่าง)
//   2) เติม therapistId ที่ว่าง จาก Bookings
//   3) เติม vas1_diff (col L) / vas2_diff (col O) ที่ว่างแต่มีค่า VAS ก่อน-หลัง
//   4) goal_met = 'yes' ถ้า PTDATA มี goal_met ในรายการเป้าหมาย
//   5) เปลี่ยนหัวคอลัมน์ P ที่ซ้ำชื่อ goal_met เป็น unused
// รันซ้ำได้ปลอดภัย (ไม่เขียนทับค่าที่มีอยู่แล้ว) — ถ้าต้องการดูผลก่อนให้เรียก repairOutcomesData(true)
// ===================================
function repairOutcomesData(dryRun) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = OUTCOMES_SHEET();
    if (!sheet) { Logger.log('ไม่พบ Sheet Outcomes'); return { success: false, message: 'ไม่พบ Sheet Outcomes' }; }
    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(sheet.getLastColumn(), 16);
    if (lastRow < 2) return { success: true, message: 'ไม่มีข้อมูล' };

    const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const junkRe = /^diagnosis[12]_(icd10|label)$/;

    // 1) ลบแถวขยะ (วนจากล่างขึ้นบน)
    const junkRows = [];
    for (let i = values.length - 1; i >= 1; i--) {
      const a = String(values[i][0] || '').trim();
      const bid = String(values[i][1] || '').trim();
      if (!bid && junkRe.test(a)) junkRows.push(i + 1);
    }

    // ตัดแถวขยะออกจากข้อมูลที่จะประมวลผล
    const keepIdx = [];
    for (let i = 1; i < values.length; i++) {
      if (junkRows.indexOf(i + 1) === -1) keepIdx.push(i);
    }

    // map bookingId → therapistId
    const tMap = {};
    const bs = BOOKINGS_SHEET();
    if (bs) {
      const bd = bs.getDataRange().getValues();
      for (let i = 1; i < bd.length; i++) {
        const k = String(bd[i][1] || '').trim();
        if (k) tMap[k] = bd[i][4] || '';
      }
    }

    let fixTid = 0, fixDiff1 = 0, fixDiff2 = 0, fixGoal = 0;
    keepIdx.forEach(function(i) {
      const row = values[i];
      const bid = String(row[1] || '').trim();
      if (!bid) return;
      if (!row[4] && tMap[bid]) { row[4] = tMap[bid]; fixTid++; }
      if ((row[11] === '' || row[11] === null || row[11] === undefined) &&
          row[5] !== '' && row[6] !== '' && !isNaN(Number(row[5])) && !isNaN(Number(row[6]))) {
        row[11] = Number(row[5]) - Number(row[6]); fixDiff1++;
      }
      if ((row[14] === '' || row[14] === null || row[14] === undefined) &&
          row[12] !== '' && row[13] !== '' && row[12] !== null && row[13] !== null &&
          !isNaN(Number(row[12])) && !isNaN(Number(row[13]))) {
        row[14] = Number(row[12]) - Number(row[13]); fixDiff2++;
      }
      if (row[8] !== 'yes' && outcomeGoalMetFromPtd_(parsePtData_(row[9] || ''))) {
        row[8] = 'yes'; fixGoal++;
      }
    });

    const summary = {
      success: true, dryRun: !!dryRun,
      junkRowsRemoved: junkRows.length, therapistIdFilled: fixTid,
      vas1DiffFilled: fixDiff1, vas2DiffFilled: fixDiff2, goalMetFixed: fixGoal
    };
    if (dryRun) { Logger.log('DRY RUN: ' + JSON.stringify(summary)); return summary; }

    // เขียนกลับเฉพาะคอลัมน์ที่แก้ (E, I, L, O) ทีละคอลัมน์ ก่อนลบแถวขยะ
    const n = values.length - 1;
    const colE = [], colI = [], colL = [], colO = [];
    for (let i = 1; i < values.length; i++) {
      colE.push([values[i][4]]); colI.push([values[i][8]]);
      colL.push([values[i][11]]); colO.push([values[i][14]]);
    }
    sheet.getRange(2, 5,  n, 1).setValues(colE);
    sheet.getRange(2, 9,  n, 1).setValues(colI);
    sheet.getRange(2, 12, n, 1).setValues(colL);
    sheet.getRange(2, 15, n, 1).setValues(colO);

    // 5) หัวคอลัมน์ P ซ้ำ
    const hdrP = String(sheet.getRange(1, 16).getValue() || '').trim();
    if (hdrP === 'goal_met') sheet.getRange(1, 16).setValue('unused');

    // 1) ลบแถวขยะ (จากล่างขึ้นบน เพื่อไม่ให้ index เลื่อน)
    junkRows.sort(function(a, b) { return b - a; }).forEach(function(r) { sheet.deleteRow(r); });

    clearOutcomeCaches_();
    Logger.log('✅ repairOutcomesData: ' + JSON.stringify(summary));
    return summary;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ===================================
// DIAGNOSIS (ICD-10)
// ===================================
function updateDiagnosis(bookingId, diagnosis, diagnosis2) {
  try {
    const sheet = BOOKINGS_SHEET();
    const data  = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] !== bookingId) continue;
      // col 14 = diagnosis (หลัก)
      sheet.getRange(i + 1, 14).setValue(diagnosis ? JSON.stringify(diagnosis) : '');
      // col 15 = diagnosis2 (รอง) — เขียนเฉพาะถ้าส่งมา (รองรับ caller เดิมที่ส่งแค่ 2 args)
      if (diagnosis2 !== undefined) {
        sheet.getRange(i + 1, 15).setValue(diagnosis2 ? JSON.stringify(diagnosis2) : '');
      }
      return { success: true };
    }
    return { success: false, message: 'ไม่พบ bookingId' };
  } catch (e) { return { success: false, message: e.message }; }
}

function getDiagnosisStats(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const startStr = `${year}-${String(month).padStart(2,'0')}-01`;
  const endStr   = dateToStr(new Date(year, month, 0));
  const data     = BOOKINGS_SHEET().getDataRange().getValues();
  const groupCount = {}, icdCount = {};
  let total = 0;

  function countDiag(raw) {
    if (!raw) return;
    try {
      const diag = JSON.parse(raw);
      const grp  = (diag.group || 'ไม่ระบุ').replace(/^[\u{1F300}-\u{1FFFF}\u2600-\u27FF]\s*/u, '').trim();
      groupCount[grp] = (groupCount[grp] || 0) + 1;
      if (diag.icd10) {
        const icdKey = diag.icd10 + ' ' + (diag.label || '');
        icdCount[icdKey] = (icdCount[icdKey] || 0) + 1;
      }
      total++;
    } catch(e) {}
  }

  for (let i = 1; i < data.length; i++) {
    const d = data[i][2];
    if (!(d instanceof Date)) continue;
    const ds = dateToStr(d);
    if (ds < startStr || ds > endStr) continue;
    if (normalizeHN(data[i][6]) === 'BLOCK') continue;
    countDiag(data[i][13]);  // diagnosis หลัก
    countDiag(data[i][14]);  // diagnosis2 รอง ✅ NEW
  }

  return {
    total,
    groups: Object.entries(groupCount)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, pct: total ? parseFloat((count/total*100).toFixed(1)) : 0 })),
    topICDs: Object.entries(icdCount)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, count]) => ({ name, count, pct: total ? parseFloat((count/total*100).toFixed(1)) : 0 }))
  };
}

// ===================================
// EPISODES
// ===================================
function getOrCreateEpisode(hn, diagnosis, startDate) {
  const hnNorm = normalizeHN(hn);
  const sheet  = EPISODES_SHEET();
  if (!sheet) return { success: false, message: 'ไม่พบ Sheet Episodes' };
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normalizeHN(data[i][1]) === hnNorm && data[i][6] === 'active') {
      return { success: true, episodeId: data[i][0], existing: true };
    }
  }
  const eid = Utilities.getUuid();
  sheet.appendRow([eid, hnNorm, new Date(startDate || new Date()), '', JSON.stringify(diagnosis || {}), 0, 'active', '']);
  return { success: true, episodeId: eid, existing: false };
}

function closeEpisode(hn, status, note) {
  const hnNorm = normalizeHN(hn);
  const sheet  = EPISODES_SHEET();
  if (!sheet) return { success: false };
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normalizeHN(data[i][1]) === hnNorm && data[i][6] === 'active') {
      sheet.getRange(i+1, 4).setValue(new Date());
      sheet.getRange(i+1, 7).setValue(status);
      if (note) sheet.getRange(i+1, 8).setValue(note);
      try { CacheService.getScriptCache().remove('kpi_trend_12m_v3'); } catch(e) {}
      return { success: true };
    }
  }
  return { success: false, message: 'ไม่พบ active episode' };
}

function getEpisodesForHN(hn) {
  const hnNorm = normalizeHN(hn);
  const sheet  = EPISODES_SHEET();
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    if (normalizeHN(data[i][1]) !== hnNorm) continue;
    let diag = {};
    try { diag = JSON.parse(data[i][4] || '{}'); } catch(e) {}
    list.push({
      episodeId:   data[i][0],
      startDate:   data[i][2] instanceof Date ? dateToStr(data[i][2]) : '',
      endDate:     data[i][3] instanceof Date ? dateToStr(data[i][3]) : '',
      diagnosis:   diag,
      totalVisits: parseInt(data[i][5]) || 0,
      status:      data[i][6] || 'active',
      note:        data[i][7] || '',
      ...epExtra_(data[i])
    });
  }
  return list.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

function getEpisodeStats(yearMonth) {
  const sheet = EPISODES_SHEET();
  if (!sheet) return { active: 0, completed: 0, dropout: 0, avgVisits: 0 };
  const [year, month] = yearMonth.split('-').map(Number);
  const startStr = `${year}-${String(month).padStart(2,'0')}-01`;
  const endStr   = dateToStr(new Date(year, month, 0));
  const data     = sheet.getDataRange().getValues();
  let active = 0, completed = 0, dropout = 0, other = 0, totalVisits = 0, count = 0;
  for (let i = 1; i < data.length; i++) {
    const sd = data[i][2] instanceof Date ? dateToStr(data[i][2]) : '';
    if (!sd || sd > endStr) continue;
    const ed = data[i][3] instanceof Date ? dateToStr(data[i][3]) : '';
    if (ed && ed < startStr) continue;
    const s = data[i][6];
    if (s === 'active')    active++;
    else if (s === 'completed') completed++;
    else if (s === 'dropout')   dropout++;
    else if (s)                 other++;   // ✅ V18: referred / patient_stop / other
    totalVisits += parseInt(data[i][5]) || 0;
    count++;
  }
  return { active, completed, dropout, other, avgVisits: count > 0 ? parseFloat((totalVisits/count).toFixed(1)) : 0 };
}

function getRecentEpisodes(limit) {
  const sheet = EPISODES_SHEET();
  if (!sheet) return [];
  limit = limit || 20;

  const epData   = sheet.getDataRange().getValues();
  const patData  = PATIENTS_SHEET() ? PATIENTS_SHEET().getDataRange().getValues() : [];
  const bookData = BOOKINGS_SHEET().getDataRange().getValues();

  const nameMap = {};
  for (let i = 1; i < patData.length; i++) {
    if (patData[i][1]) nameMap[normalizeHN(patData[i][1])] = patData[i][2] || '';
  }
  for (let i = 1; i < bookData.length; i++) {
    const hn = normalizeHN(bookData[i][6]);
    if (hn && hn !== 'BLOCK' && !nameMap[hn] && bookData[i][7]) {
      nameMap[hn] = bookData[i][7].toString().trim();
    }
  }

  const list = [];
  for (let i = 1; i < epData.length; i++) {
    const row = epData[i];
    if (!row[0]) continue;
    let diag = {};
    try { diag = JSON.parse(row[4] || '{}'); } catch(e) {}
    const hn = normalizeHN(row[1]);
    list.push({
      episodeId:   row[0].toString(), hn,
      patientName: nameMap[hn] || hn || 'ไม่ระบุ',
      startDate:   row[2] instanceof Date ? dateToStr(row[2]) : (row[2] || '').toString(),
      endDate:     row[3] instanceof Date ? dateToStr(row[3]) : (row[3] || '').toString(),
      diagnosis:   diag,
      totalVisits: parseInt(row[5]) || 0,
      status:      row[6] || 'active',
      note:        row[7] || '',
      ...epExtra_(row)
    });
  }
  list.sort((a, b) => b.startDate.localeCompare(a.startDate));
  return list.slice(0, limit);
}

function deleteEpisode(episodeId) {
  try {
    const sheet = EPISODES_SHEET();
    if (!sheet) return { success: false, message: 'ไม่พบ Sheet Episodes' };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString() === episodeId.toString()) {
        sheet.deleteRow(i + 1);
        try { CacheService.getScriptCache().remove('kpi_trend_12m_v3'); } catch(e) {}
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบ Episode: ' + episodeId };
  } catch (e) { return { success: false, message: e.message }; }
}

// ===================================
// PUBLIC LINK MANAGEMENT
// ===================================
function getOrCreatePublicToken() {
  const props = PropertiesService.getScriptProperties();
  let token   = props.getProperty('publicViewToken');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').substring(0, 32);
    props.setProperty('publicViewToken', token);
  }
  return token;
}

function revokeAndRegenerateToken() {
  const newToken = Utilities.getUuid().replace(/-/g, '').substring(0, 32);
  PropertiesService.getScriptProperties().setProperty('publicViewToken', newToken);
  return { success: true, token: newToken };
}

function isValidPublicToken(token) {
  if (!token) return false;
  const stored = PropertiesService.getScriptProperties().getProperty('publicViewToken');
  return stored && stored === token;
}

function getPublicShareInfo() {
  try {
    const token = getOrCreatePublicToken();
    const props = PropertiesService.getScriptProperties();
    let baseUrl = props.getProperty('webAppUrl') || '';
    if (!baseUrl) {
      try {
        const svcUrl = ScriptApp.getService().getUrl();
        if (svcUrl && svcUrl.indexOf('/exec') !== -1) {
          baseUrl = svcUrl.split('?')[0];
          props.setProperty('webAppUrl', baseUrl);
        }
      } catch(e2) {}
    }
    if (!baseUrl) {
      return {
        success: false,
        message: '⚠️ ยังไม่พบ Web App URL\n\nวิธีแก้ไข:\n1. เปิด Web App ในเบราว์เซอร์ 1 ครั้ง แล้วกลับมากดปุ่มนี้ใหม่\n2. หรือรัน setWebAppUrlManually() ใน Script Editor'
      };
    }
    return { success: true, url: baseUrl + '?view=public&token=' + token, token };
  } catch (e) { return { success: false, message: e.message }; }
}

// ✅ NEW: คืนลิงก์หน้าเว็บไซต์สาธารณะ (Web.html) สำหรับปุ่ม "หน้าเว็บไซต์" ใน index.html
function getLandingPageUrl() {
  try {
    // ✅ ปุ่ม "หน้าเว็บไซต์" พาไปยังเว็บไซต์สาธารณะของหน่วยงานบน GitHub Pages โดยตรง
    return {
      success: true,
      url: 'https://ploypailinphysicaltherapy.github.io/Ploypailin-Physical-Therapy/'
    };
  } catch (e) { return { success: false, message: e.message }; }
}

function regeneratePublicLink() {
  try { revokeAndRegenerateToken(); return getPublicShareInfo(); }
  catch (e) { return { success: false, message: e.message }; }
}

function setWebAppUrlManually() {
  const YOUR_WEBAPP_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID_HERE/exec';
  if (YOUR_WEBAPP_URL.indexOf('YOUR_DEPLOYMENT_ID_HERE') !== -1) return '❌ กรุณาแก้ URL ก่อน';
  PropertiesService.getScriptProperties().setProperty('webAppUrl', YOUR_WEBAPP_URL);
  return '✅ บันทึกแล้ว: ' + YOUR_WEBAPP_URL;
}

function getPublicAvailability(token, yearMonth) {
  if (!isValidPublicToken(token)) return { success: false, error: 'TOKEN_INVALID' };
  try {
    // ✅ V15 SPEED: cache key ไม่ใส่ token (stable) + TTL 10 นาที (เดิม 5 นาที)
    const cacheKey = 'pub_av2_' + yearMonth;
    const cache    = CacheService.getScriptCache();
    const cached   = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    let [year, month] = yearMonth.split('-').map(Number);
    if (year > 2400) year -= 543;

    const lastDay = new Date(year, month, 0).getDate();
    const padM    = String(month).padStart(2, '0');

    const therapists   = getAllMasseusesConfig();
    const slotsData    = SLOTS_SHEET().getDataRange().getValues();
    const hData        = HOLIDAYS_SHEET().getDataRange().getValues();
    const bData        = BOOKINGS_SHEET().getDataRange().getValues();
    const exSheet      = EXTRA_SLOTS_SHEET();
    const extraData    = exSheet ? exSheet.getDataRange().getValues() : [];

    const holidaySet = {};
    for (let hi = 1; hi < hData.length; hi++) {
      const hd = parseFlexDate(hData[hi][0]);
      if (hd && !holidaySet[dateToStr(hd)]) {
        holidaySet[dateToStr(hd)] = hData[hi][1] || 'วันหยุด';
      }
    }

    const slotsMap = {};
    for (let si = 1; si < slotsData.length; si++) {
      const row = slotsData[si];
      if (row[0] === undefined || row[0] === null || row[0] === '') continue;
      const key = row[0] + '_' + row[2];
      if (!slotsMap[key]) slotsMap[key] = [];
      const t = normalizeTime(row[1]);
      if (t && t !== '00:00') slotsMap[key].push(t);
    }

    const extraMap = {};
    for (let ei = 1; ei < extraData.length; ei++) {
      const er = extraData[ei];
      if (!er[0] || !er[2] || !er[1] || er[1].toString() === 'undefined') continue;
      const ekey = er[0] + '_' + er[2];
      if (!extraMap[ekey]) extraMap[ekey] = [];
      const et = normalizeTime(er[1]);
      if (et && et !== '00:00') extraMap[ekey].push(et);
    }

    const bookedSet = {};
    const monthStr  = year + '-' + padM;
    for (let bi = 1; bi < bData.length; bi++) {
      const br = bData[bi];
      const bd = parseFlexDate(br[2]);
      if (!bd) continue;
      const bds  = dateToStr(bd);
      if (bds.substring(0, 7) !== monthStr) continue;
      const apptType = (br[12] || 'OPD').toString().trim().toUpperCase();
      if (apptType !== 'OPD' && apptType !== 'BLOCK') continue;
      const btime = normalizeTime(br[3]);
      bookedSet[bds + '|' + br[4] + '|' + btime] = true;
    }

    // ✅ V15.2 FIX: เพิ่ม pending PublicRequests เข้า bookedSet
    // slot ที่มีคำขอ pending = ถือว่า "อยู่ในการดำเนินการ" ยังไม่ว่าง
    // slot ที่ cancelled/approved = ปล่อยว่างคืน
    try {
      const prSheet = PUBLIC_REQUESTS_SHEET();
      const prData  = prSheet.getDataRange().getValues();
      if (prData.length > 1) {
        const hdr      = prData[0].map(function(h){ return (h||'').toString().toLowerCase().trim(); });
        const hasReqId = hdr[0] === 'requestid';
        const C = hasReqId
          ? { date:2, time:3, therapist:4, status:9 }
          : { date:1, time:2, therapist:3, status:7 };
        for (let pi = 1; pi < prData.length; pi++) {
          const pr     = prData[pi];
          const status = (pr[C.status] || '').toString().trim();
          if (status !== 'pending') continue;
          const pd = parseFlexDate(pr[C.date]);
          if (!pd) continue;
          const pds = dateToStr(pd);
          if (pds.substring(0, 7) !== monthStr) continue;
          const ptime      = normalizeTime(pr[C.time]);
          const therapistN = (pr[C.therapist] || '').toString().trim().toUpperCase();
          if (!ptime) continue;
          // match therapist แบบ fuzzy: ชื่อใน config ตัดเว้นวรรค/OPD prefix
          const tObj = therapists.find(function(t) {
            const tName = t.name.toUpperCase();
            return tName === therapistN ||
              therapistN.indexOf(tName) !== -1 ||
              tName.indexOf(therapistN) !== -1 ||
              therapistN.replace(/^OPD\s*/,'').indexOf(tName.replace(/^OPD\s*/,'')) !== -1;
          });
          if (tObj) {
            bookedSet[pds + '|' + tObj.id + '|' + ptime] = true;
          } else {
            // fallback: ถ้าหา therapist ไม่เจอ ให้ mark ทุก OPD therapist เพื่อความปลอดภัย
            opdTherapists.forEach(function(t) {
              bookedSet[pds + '|' + t.id + '|' + ptime] = true;
            });
          }
        }
      }
    } catch(prErr) { Logger.log('PublicRequests bookedSet: ' + prErr.message); }

    const hiddenTimes  = { '12:00': true, '13:30': true, '14:00': true };
    const opdTherapists = therapists.filter(t => t.name.toUpperCase().indexOf('HOME') === -1);

    const days = [];
    for (let day = 1; day <= lastDay; day++) {
      const ds  = year + '-' + padM + '-' + String(day).padStart(2, '0');
      const dow = new Date(ds).getDay();

      if (dow === 0 || dow === 6 || holidaySet[ds]) {
        days.push({ date: ds, closed: true, reason: holidaySet[ds] || 'วันหยุดสัปดาห์', slots: [] });
        continue;
      }

      let totalFree = 0;
      const therapistSlots = [];
      opdTherapists.forEach(t => {
        const baseKey  = dow + '_' + t.id;
        const extraKey = ds + '_' + t.id;
        const allTimes = (slotsMap[baseKey] || []).concat(extraMap[extraKey] || []);
        const freeTimes = [];
        allTimes.forEach(time => {
          if (hiddenTimes[time]) return;
          if (!bookedSet[ds + '|' + t.id + '|' + time]) freeTimes.push(time);
        });
        freeTimes.sort();
        totalFree += freeTimes.length;
        therapistSlots.push({ therapistName: t.name, color: t.color, freeTimes });
      });
      days.push({ date: ds, closed: false, totalFree, slots: therapistSlots });
    }

    const result = { success: true, yearMonth: year + '-' + padM, generated: new Date().toISOString(), days };
    // ✅ V15 SPEED: เก็บ cache 10 นาที (เดิม 5 นาที)
    try { cache.put(cacheKey, JSON.stringify(result), 600); } catch(ce) {}
    return result;
  } catch (e) {
    Logger.log('getPublicAvailability: ' + e.message);
    return { success: false, error: 'SERVER_ERROR' };
  }
}

function clearPublicAvailabilityCache() {
  try {
    const today  = new Date();
    const keys   = [];
    for (let i = -1; i <= 1; i++) {
      const d  = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const ym = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      // ✅ V15: key ใหม่ไม่มี token prefix
      keys.push('pub_av2_' + ym);
      // compat: ลบ key เก่าด้วย (ถ้ายังมี)
      const token = PropertiesService.getScriptProperties().getProperty('publicViewToken') || '';
      if (token) keys.push('pub_avail_' + ym + '_' + token.substring(0, 8));
    }
    CacheService.getScriptCache().removeAll(keys);
  } catch(e) {}
}

function clearTrendCache() {
  CacheService.getScriptCache().removeAll(['kpi_trend_12m_v1','kpi_trend_12m_v2','kpi_trend_12m_v3']);
}

// ===================================
// SETUP & MAINTENANCE
// ===================================
function setupNewSheets() {
  const ss = getSpreadsheet();
  if (!ss.getSheetByName('Outcomes')) {
    const s = ss.insertSheet('Outcomes');
    s.getRange('A1:K1').setValues([[
      'outcomeId','bookingId','hn','date','therapistId',
      'vas_before','vas_after','barthel_score','goal_met','note','createdAt'
    ]]).setFontWeight('bold').setBackground('#1565C0').setFontColor('#fff');
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName('Episodes')) {
    const s2 = ss.insertSheet('Episodes');
    s2.getRange('A1:H1').setValues([[
      'episodeId','hn','startDate','endDate','diagnosisJson','totalVisits','status','note'
    ]]).setFontWeight('bold').setBackground('#1565C0').setFontColor('#fff');
    s2.setFrozenRows(1);
  }
  // ✅ Ensure Bookings col 14 (diagnosis) header
  const bSheet = BOOKINGS_SHEET();
  if (!bSheet.getRange(1, 14).getValue()) {
    bSheet.getRange(1, 14).setValue('diagnosis').setFontWeight('bold');
  }
  // ✅ NEW V16: ตั้งค่า sheet สำหรับระบบรายได้/ICD9 ไปพร้อมกัน
  setupRevenueSheets();

  clearKPICache();
  return '✅ Setup V14 สำเร็จ — Sheets: Outcomes, Episodes พร้อมใช้';
}

// ===================================
// ✅ NEW: syncMainViews — Time-based trigger เพื่อ clear cache ทุก 30 นาที
// ตั้ง trigger ใน Apps Script: Functions > syncMainViews > Time-driven > 30 min
// ===================================
function syncMainViews() {
  try {
    clearKPICache();
    clearPublicAvailabilityCache();
    try { warmMonthlyBundles_(); } catch (we) { Logger.log('warmMonthlyBundles_: ' + we.message); } // ✅ V17
    Logger.log('[PT Station V15] syncMainViews: cache cleared at ' + new Date());
  } catch (e) {
    Logger.log('syncMainViews error: ' + e.message);
  }
}

// ===================================
// ✅ NEW: setupSyncTrigger — ตั้ง trigger อัตโนมัติสำหรับ syncMainViews
// รัน 1 ครั้งหลัง deploy เพื่อตั้งค่า
// ===================================
function setupSyncTrigger() {
  // ลบ trigger เก่าก่อน (ถ้ามี)
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncMainViews') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // สร้าง trigger ใหม่ทุก 30 นาที
  ScriptApp.newTrigger('syncMainViews')
    .timeBased()
    .everyMinutes(30)
    .create();
  return '✅ Sync trigger ตั้งแล้ว: syncMainViews ทุก 30 นาที';
}

// ===================================
// ✅ FIX V15.2: getPublicPendingRequests
// แก้ date/time ที่ Sheets แปลงเป็น Date object อัตโนมัติ
//   - date (Date obj)  → 'yyyy-MM-dd'  เช่น 2026-05-19
//   - time (Date obj)  → 'HH:mm'       เช่น 10:30
// รองรับ Sheet ทั้ง 2 รูปแบบ:
//   แบบเก่า (8 col): timestamp|date|time|therapistName|name|phone|note|status
//   แบบใหม่ (10 col): requestId|timestamp|date|time|therapistName|name|phone|visitStatus|note|status
// ===================================
function getPublicPendingRequests() {
  try {
    const sh   = PUBLIC_REQUESTS_SHEET();
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return { success: true, count: 0, requests: [] };

    // ตรวจ schema จาก header row
    const header   = data[0].map(function(h) { return (h || '').toString().toLowerCase().trim(); });
    const hasReqId = header[0] === 'requestid';

    // map column index ตาม schema
    const COL = hasReqId
      ? { reqId:0, ts:1, date:2, time:3, therapist:4, name:5, phone:6, visitStatus:7, note:8, status:9 }
      : { reqId:-1, ts:0, date:1, time:2, therapist:3, name:4, phone:5, visitStatus:-1, note:6, status:7 };

    // ✅ helper: แปลง cell value เป็น date string 'yyyy-MM-dd'
    function cellToDateStr(v) {
      if (!v) return '';
      if (v instanceof Date) return Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd');
      return v.toString().trim();
    }

    // ✅ helper: แปลง cell value เป็น time string 'HH:mm'
    function cellToTimeStr(v) {
      if (!v) return '';
      if (v instanceof Date) return Utilities.formatDate(v, TIMEZONE, 'HH:mm');
      // อาจเป็น string เช่น "10:30", "10.30", "1030"
      return normalizeTime(v);
    }

    const list = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[COL.ts] && !row[COL.date]) continue;
      const status = (row[COL.status] || '').toString().trim();
      if (status !== 'pending') continue;

      const reqId = (COL.reqId >= 0 && row[COL.reqId])
        ? row[COL.reqId].toString()
        : ('ROW-' + (i + 1));

      const ts = row[COL.ts];
      list.push({
        requestId:     reqId,
        timestamp:     ts instanceof Date ? Utilities.formatDate(ts, TIMEZONE, 'dd/MM/yy HH:mm') : (ts || '').toString(),
        date:          cellToDateStr(row[COL.date]),
        time:          cellToTimeStr(row[COL.time]),
        therapistName: COL.therapist >= 0 ? (row[COL.therapist] || 'OPD').toString() : 'OPD',
        name:          COL.name >= 0 ? (row[COL.name] || '').toString() : '',
        phone:         COL.phone >= 0 ? (row[COL.phone] || '').toString() : '',
        visitStatus:   COL.visitStatus >= 0 ? (row[COL.visitStatus] || '').toString() : '',
        note:          COL.note >= 0 ? (row[COL.note] || '').toString() : '',
        status:        status,
        rowIndex:      i + 1
      });
    }
    list.reverse();
    return { success: true, count: list.length, requests: list, schema: hasReqId ? 'new' : 'old' };
  } catch (e) {
    Logger.log('getPublicPendingRequests: ' + e.message);
    return { success: false, error: e.message, requests: [] };
  }
}

// ===================================
// ✅ FIX V15.1: approvePublicRequest
// รองรับทั้ง requestId (schema ใหม่) และ ROW-N (schema เก่า)
// ===================================
function approvePublicRequest(requestId) {
  try {
    const sh   = PUBLIC_REQUESTS_SHEET();
    const data = sh.getDataRange().getValues();
    const header = data[0].map(function(h) { return (h||'').toString().toLowerCase().trim(); });
    const hasReqId = header[0] === 'requestid';
    const statusCol = hasReqId ? 10 : 8; // 1-based column number

    // ROW-N shortcut (schema เก่า)
    if (requestId.startsWith('ROW-')) {
      const rowNum = parseInt(requestId.replace('ROW-', ''));
      if (rowNum >= 2 && rowNum <= data.length) {
        sh.getRange(rowNum, statusCol).setValue('approved');
        return { success: true };
      }
      return { success: false, error: 'ไม่พบแถว ' + requestId };
    }

    // schema ใหม่ — หา requestId ใน col A
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString() === requestId) {
        sh.getRange(i + 1, statusCol).setValue('approved');
        return { success: true };
      }
    }
    return { success: false, error: 'ไม่พบรหัสคำขอ: ' + requestId };
  } catch (e) { return { success: false, error: e.message }; }
}

function fixExistingOutcomeHN() {
  const sheet = OUTCOMES_SHEET();
  if (!sheet) { Logger.log('ไม่พบ Outcomes sheet'); return; }
  const data  = sheet.getDataRange().getValues();
  let fixed   = 0;
  for (let i = 1; i < data.length; i++) {
    const raw  = data[i][2];
    const norm = normalizeHN(raw);
    if (raw !== undefined && raw !== null && raw.toString() !== norm) {
      sheet.getRange(i + 1, 3).setValue(norm);
      fixed++;
    }
  }
  Logger.log('✅ fixExistingOutcomeHN: ' + fixed + ' แถว');
  return '✅ แก้ไข ' + fixed + ' แถว';
}

function fixExistingBookingHN() {
  const sheet = BOOKINGS_SHEET();
  const data  = sheet.getDataRange().getValues();
  let fixed   = 0;
  for (let i = 1; i < data.length; i++) {
    const raw  = data[i][6];
    const norm = normalizeHN(raw);
    if (raw !== undefined && raw !== null && raw.toString() !== norm && norm) {
      sheet.getRange(i + 1, 7).setValue(norm);
      fixed++;
    }
  }
  Logger.log('✅ fixExistingBookingHN: ' + fixed + ' แถว');
  return '✅ แก้ไข Booking HN ' + fixed + ' แถว';
}

// Legacy helpers
function getMonthlyData(year, month) {
  month = month.padStart(2, '0');
  const start   = `${year}-${month}-01`;
  const endDate = new Date(year, parseInt(month), 0);
  const end     = Utilities.formatDate(endDate, TIMEZONE, 'yyyy-MM-dd');
  const rangeData  = getBookingsRange(start, end);
  const therapists = getAllMasseusesConfig();
  const docMap     = {}, docSlotsMap = {};
  therapists.forEach(t => {
    docMap[t.name]      = t.id;
    docSlotsMap[t.name] = getAvailableSlotsForTherapist(start, t.id).map(s => s.time);
  });
  const sortedSlots = [...new Set(Object.values(docSlotsMap).flat())].sort((a,b)=>a.localeCompare(b));
  return { bookings: rangeData.bookings, holidays: rangeData.holidays, sortedSlots, docMap, docSlotsMap };
}

function toggleHoliday(dateStr) {
  const existing = getHoliday(dateStr);
  if (existing) { setHoliday(dateStr, '', false); return { success: true, action: 'removed' }; }
  setHoliday(dateStr, 'ปิดทำการ', true);
  return { success: true, action: 'added' };
}

function checkIfDayIsOpen(dateStr) {
  const dow      = new Date(dateStr).getDay();
  const slotsData = SLOTS_SHEET().getDataRange().getValues();
  for (let i = 1; i < slotsData.length; i++) {
    if (slotsData[i][0] === dow && slotsData[i][2]) return true;
  }
  return false;
}

// ===================================
// ✅ NEW V15.3: checkPendingStatus
// ตรวจสอบว่า requestId ยังมีสถานะ 'pending' อยู่จริงไหม
// ใช้โดย client ลิงค์คิวว่าง เพื่อ sync PEND กับข้อมูลจริง
// ===================================
function checkPendingStatus(token, idsStr) {
  try {
    if (!isValidPublicToken(token)) return { success: false, error: 'invalid token' };
    if (!idsStr) return { success: true, active: {} };
    const ids = idsStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    if (!ids.length) return { success: true, active: {} };

    const sh   = PUBLIC_REQUESTS_SHEET();
    const data = sh.getDataRange().getValues();
    const header   = data[0].map(function(h) { return (h || '').toString().toLowerCase().trim(); });
    const hasReqId = header[0] === 'requestid';
    const COL_REQ_ID = hasReqId ? 0 : -1;
    const COL_STATUS = hasReqId ? 9 : 7;

    // สร้าง map requestId → status
    const statusMap = {};
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rid = COL_REQ_ID >= 0 ? (row[COL_REQ_ID] || '').toString() : ('ROW-' + (i + 1));
      if (rid) statusMap[rid] = (row[COL_STATUS] || '').toString().trim();
    }

    const active = {};
    ids.forEach(function(id) {
      // active = true เฉพาะถ้ายังอยู่ใน sheet และสถานะยังเป็น pending
      active[id] = (statusMap[id] === 'pending');
    });
    return { success: true, active: active };
  } catch (e) {
    Logger.log('checkPendingStatus: ' + e.message);
    return { success: false, error: e.message, active: {} };
  }
}

function getPublicViewHtml() {
  try {
    const page = HtmlService.createHtmlOutputFromFile('PublicSlots').getContent();
    if (page && page.indexOf('__INLINE_DATA__') !== -1) return page;
  } catch (e) {
    Logger.log('getPublicViewHtml: ไม่พบ PublicSlots.html ใช้หน้าเดิมแทน — ' + e.message);
  }
  return getPublicViewHtmlLegacy_();
}

function getPublicViewHtmlLegacy_() {
  // ไม่เปลี่ยนแปลงจาก V13
  var L = [];
  L.push("<!DOCTYPE html><html lang=\"th\"><head><base target=\"_top\">");
  L.push("<meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">");
  L.push("<title>ตรวจสอบคิวว่าง — PT Station</title>");
  L.push("<link href=\"https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">");
  L.push("<link href=\"https://fonts.googleapis.com/icon?family=Material+Icons+Outlined\" rel=\"stylesheet\">");
  L.push("<style>");
  L.push(":root{--pr:#1a56db;--pr-l:#ebf0ff;--tl:#0d9488;--tl-l:#ccfbf1;--ok:#059669;--ok-l:#d1fae5;--wn:#d97706;--wn-l:#fef3c7;--er:#dc2626;--er-l:#fee2e2;--g1:#f9fafb;--g2:#f3f4f6;--g3:#e5e7eb;--g4:#9ca3af;--g5:#6b7280;--g7:#374151;--g9:#111827;--fd:'Sarabun','Noto Sans Thai',sans-serif;--r:12px}");
  L.push("*{margin:0;padding:0;box-sizing:border-box}button,input,select,textarea{font-family:inherit}body{font-family:'Sarabun','Noto Sans Thai',sans-serif;background:var(--g2);color:var(--g9);min-height:100vh;font-size:15px;line-height:1.6}");
  L.push(".hdr{background:linear-gradient(135deg,#1a56db,#0ea5e9);color:#fff;padding:20px 20px 28px;text-align:center}.hdr h1{font-family:var(--fd);font-size:1.25rem;font-weight:700;margin-bottom:4px}.hdr p{font-size:.875rem;opacity:.85}");
  L.push(".badge{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:4px 14px;font-size:.8rem;margin-top:10px}.dot{width:7px;height:7px;background:#4ade80;border-radius:50%;animation:blink 2s infinite}@keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}");
  L.push(".hdr-bottom{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:10px}");
  L.push(".rfbtn{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.22);border:1.5px solid rgba(255,255,255,.45);border-radius:999px;padding:5px 16px;font-size:.8rem;font-weight:600;color:#fff;cursor:pointer;transition:background .15s;font-family:'Sarabun',sans-serif}.rfbtn:hover{background:rgba(255,255,255,.35)}.rfbtn:disabled{opacity:.6;cursor:default}.rfbtn .material-icons-outlined{font-size:16px}.rfbtn.spinning .material-icons-outlined{animation:spin 1s linear infinite}");
  L.push(".cdown{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:4px 12px;font-size:.78rem;color:rgba(255,255,255,.85)}");
  L.push(".cdown-bar-wrap{width:60px;height:4px;background:rgba(255,255,255,.25);border-radius:2px;overflow:hidden}.cdown-bar{height:100%;background:#4ade80;border-radius:2px;transition:width 1s linear}");
  L.push(".mnav{background:#fff;border-bottom:1px solid var(--g3);padding:14px 20px;display:flex;align-items:center;justify-content:center;gap:12px;position:sticky;top:0;z-index:50}.mbtn{width:36px;height:36px;border:1.5px solid var(--g3);background:var(--g1);border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--g5)}.mlbl{font-family:var(--fd);font-size:1.0625rem;font-weight:600;color:var(--g9);min-width:140px;text-align:center}");
  L.push(".notice{margin:16px;padding:14px 16px;background:var(--wn-l);border:1px solid #fcd34d;border-radius:var(--r);display:flex;gap:10px;align-items:flex-start;font-size:.875rem;color:#92400e}");
  L.push(".cont{padding:8px 16px 32px;max-width:680px;margin:0 auto}@keyframes spin{100%{transform:rotate(360deg)}}");
  L.push(".dc{background:#fff;border-radius:var(--r);border:1px solid var(--g3);margin-bottom:10px;overflow:hidden}.dh{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer}.dhl{display:flex;align-items:center;gap:12px}.dn{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-family:var(--fd);font-size:1.125rem;font-weight:700;flex-shrink:0}.dn.open{background:var(--ok-l);color:var(--ok)}.dn.full{background:var(--er-l);color:var(--er)}.dn.cls{background:var(--g2);color:var(--g4)}");
  L.push(".dbadge{padding:4px 12px;border-radius:999px;font-size:.8rem;font-weight:700}.dbadge.free{background:var(--ok-l);color:var(--ok)}.dbadge.full{background:var(--er-l);color:var(--er)}.dbadge.cls{background:var(--g2);color:var(--g4)}");
  L.push(".xi{color:var(--g4);font-size:20px;transition:transform .2s;margin-left:8px}.dc.exp .xi{transform:rotate(180deg)}.db{display:none;border-top:1px solid var(--g3);padding:14px 16px;background:var(--g1)}.dc.exp .db{display:block}");
  L.push(".tr{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;padding:10px 12px;background:#fff;border-radius:8px;border:1px solid var(--g3)}.tdot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:5px}.tnm{font-weight:600;font-size:.9rem;color:var(--g7);min-width:130px}.tcs{display:flex;flex-wrap:wrap;gap:6px;flex:1}");
  L.push(".tc{background:var(--tl-l);color:var(--tl);padding:5px 12px;border-radius:8px;font-size:.8125rem;font-weight:600;cursor:pointer;border:1.5px solid transparent;display:inline-flex;align-items:center;gap:4px}.tc:hover{background:var(--tl);color:#fff}");
  L.push(".tc.pending{background:#fef3c7;color:#92400e;border-color:#fcd34d;cursor:default;pointer-events:none}");
  L.push(".tc.cancel-btn{background:#fee2e2;color:#dc2626;border-color:#fca5a5;cursor:pointer;pointer-events:auto;font-size:.75rem;padding:3px 8px;border-radius:6px}");
  L.push(".pending-wrap{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}");
  L.push(".nst{font-size:.8125rem;color:var(--g4);font-style:italic}");
  L.push(".ms{background:#fff;border-radius:var(--r);border:1px solid var(--g3);padding:16px;margin-bottom:16px;display:flex;gap:12px;flex-wrap:wrap}.si{flex:1;min-width:80px;text-align:center;padding:10px;border-radius:8px}.si.open{background:var(--ok-l)}.si.full{background:var(--er-l)}.si.cls{background:var(--g2)}.sv{font-family:var(--fd);font-size:1.5rem;font-weight:700}.si.open .sv{color:var(--ok)}.si.full .sv{color:var(--er)}.si.cls .sv{color:var(--g4)}.sl{font-size:.75rem;color:var(--g5);margin-top:2px}");
  L.push(".cc{margin:0 16px 16px;background:#fff;border-radius:var(--r);border:1.5px solid var(--g3);padding:16px 20px}.cc h3{font-family:var(--fd);font-size:.9rem;font-weight:700;color:var(--g7);margin-bottom:12px}.ci{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--g2);font-size:.875rem}.ci:last-child{border-bottom:none}.cico{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}.cico.ph{background:#d1fae5}.cico.fb{background:#dbeafe}.clb{font-weight:600;color:var(--g7)}.cv a{color:var(--pr);text-decoration:none}");
  L.push(".ftr{text-align:center;padding:20px;font-size:.8125rem;color:var(--g4);border-top:1px solid var(--g3)}.dc.today .dh{background:linear-gradient(135deg,var(--pr-l),#e0f2fe)}.ttag{background:var(--pr);color:#fff;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:6px}");
  L.push(".mo{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:999;display:flex;align-items:center;justify-content:center;padding:20px}.mb{background:#fff;border-radius:16px;padding:24px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.2)}.mt2{font-family:var(--fd);font-size:1.1rem;font-weight:700;color:var(--g9);margin-bottom:4px}.ms2{font-size:.875rem;color:var(--g5);margin-bottom:18px}.mi2{background:var(--tl-l);border-radius:8px;padding:10px 14px;font-size:.875rem;color:#0f766e;margin-bottom:16px;display:flex;gap:8px;align-items:flex-start}");
  L.push(".mf{margin-bottom:14px}.ml2{font-size:.8125rem;font-weight:600;color:var(--g7);margin-bottom:5px;display:block}.inp{width:100%;padding:10px 12px;border:1.5px solid var(--g3);border-radius:8px;font-size:.9375rem;color:var(--g9);outline:none}.inp:focus{border-color:var(--pr)}.ma{display:flex;gap:10px;margin-top:4px}.bc{flex:1;padding:11px;background:var(--pr);color:#fff;border:none;border-radius:8px;font-size:.9375rem;font-weight:600;cursor:pointer}.bc:disabled{background:var(--g4);cursor:not-allowed}.bx{flex:1;padding:11px;background:var(--g2);color:var(--g7);border:none;border-radius:8px;font-size:.9375rem;font-weight:600;cursor:pointer}");
  L.push(".radio-grp{display:flex;gap:10px;margin-bottom:4px}.radio-opt{flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1.5px solid var(--g3);border-radius:8px;cursor:pointer;transition:all .15s;font-size:.875rem;color:var(--g7)}.radio-opt.selected{border-color:var(--pr);background:var(--pr-l);color:var(--pr);font-weight:600}.radio-opt input{display:none}.radio-dot{width:16px;height:16px;border-radius:50%;border:2px solid var(--g4);flex-shrink:0;display:flex;align-items:center;justify-content:center}.radio-opt.selected .radio-dot{border-color:var(--pr);background:var(--pr)}.radio-dot-inner{width:6px;height:6px;border-radius:50%;background:#fff}");
  L.push(".toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);color:#fff;padding:12px 24px;border-radius:999px;font-size:.9rem;font-weight:500;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.3);opacity:0;transition:opacity .3s;pointer-events:none;background:#111827}.toast.show{opacity:1}.toast.ok{background:#059669}.toast.er{background:#dc2626}.toast.info{background:#1a56db}");
  L.push("</style></head><body>");
  L.push("<div class=\"hdr\"><h1>ตารางคิวว่าง OPD — กายภาพบำบัด</h1><p>รพ.สต.บางขะแยง · PT Station</p><div class=\"hdr-bottom\"><div class=\"badge\"><span class=\"dot\"></span>ข้อมูลแบบ Real-time</div><button class=\"rfbtn\" id=\"rfbtn\" onclick=\"manualRefresh()\"><span class=\"material-icons-outlined\">refresh</span>รีเฟรชข้อมูล</button><div class=\"cdown\" id=\"cdown\"><div class=\"cdown-bar-wrap\"><div class=\"cdown-bar\" id=\"cdown-bar\"></div></div><span id=\"cdown-txt\">60 วิ</span></div></div></div>");
  L.push("<div class=\"mnav\"><button class=\"mbtn\" id=\"bp\"><span class=\"material-icons-outlined\">chevron_left</span></button><div class=\"mlbl\" id=\"ml\">กำลังโหลด...</div><button class=\"mbtn\" id=\"bn\"><span class=\"material-icons-outlined\">chevron_right</span></button></div>");
  L.push("<div class=\"notice\"><span class=\"material-icons-outlined\">info</span><div><strong>หมายเหตุ:</strong> กดที่ <strong>เวลาที่ต้องการ</strong> เพื่อแจ้งขอนัดหมาย เจ้าหน้าที่จะติดต่อกลับเพื่อยืนยัน</div></div>");
  L.push("<div class=\"cont\"><div id=\"mc\"><div style=\"text-align:center;padding:60px 20px;color:#9ca3af\"><span class=\"material-icons-outlined\" style=\"font-size:3rem;animation:spin 1s linear infinite\">refresh</span><p style=\"margin-top:12px\">กำลังโหลด...</p></div></div></div>");
  L.push("<div class=\"cc\"><h3>📞 ติดต่อนัดหมาย</h3><div class=\"ci\"><div class=\"cico ph\">📱</div><div><div class=\"clb\">โทรศัพท์</div><div class=\"cv\"><a href=\"tel:025982723\">02-598-2723</a></div></div></div><div class=\"ci\"><div class=\"cico fb\">📘</div><div><div class=\"clb\">Facebook</div><div class=\"cv\"><a href=\"https://www.facebook.com/rong.phyabal.sng.serimsukh.phaph.tabl.ba.754116\" target=\"_blank\">โรงพยาบาลส่งเสริมสุขภาพตำบลบางขะแยง</a></div></div></div></div>");
  L.push("<div class=\"ftr\">ข้อมูลนี้ไม่มีข้อมูลส่วนตัวผู้รับบริการ · สร้างโดย PT Station V15</div>");
  L.push("<div class=\"mo\" id=\"bm\" style=\"display:none\"><div class=\"mb\">");
  L.push("<div class=\"mt2\">📅 แจ้งขอนัดหมาย</div><div class=\"ms2\">กรอกข้อมูลเพื่อให้เจ้าหน้าที่ติดต่อกลับ</div>");
  L.push("<div class=\"mi2\"><span class=\"material-icons-outlined\" style=\"font-size:18px;margin-top:1px\">schedule</span><div id=\"msi\"></div></div>");
  L.push("<div class=\"mf\"><label class=\"ml2\">ชื่อ-นามสกุล <span style=\"color:#dc2626\">*</span></label><input class=\"inp\" id=\"rn\" type=\"text\" placeholder=\"เช่น นายสมชาย ใจดี\"></div>");
  L.push("<div class=\"mf\"><label class=\"ml2\">เบอร์โทรศัพท์ <span style=\"color:#dc2626\">*</span></label><input class=\"inp\" id=\"rp\" type=\"tel\" placeholder=\"0xx-xxx-xxxx\"></div>");
  L.push("<div class=\"mf\"><label class=\"ml2\">สถานะการพบแพทย์ <span style=\"color:#dc2626\">*</span></label><div class=\"radio-grp\"><label class=\"radio-opt selected\" id=\"ro1\" onclick=\"selRadio('doc')\"><span class=\"radio-dot\"><span class=\"radio-dot-inner\"></span></span>พบแพทย์แล้ว</label><label class=\"radio-opt\" id=\"ro2\" onclick=\"selRadio('wait')\"><span class=\"radio-dot\"></span>รอตรวจจากแพทย์อีกครั้ง</label></div></div>");
  L.push("<div class=\"mf\"><label class=\"ml2\">หมายเหตุ (ไม่บังคับ)</label><input class=\"inp\" id=\"rnote\" type=\"text\" placeholder=\"เช่น อาการ หรือความต้องการพิเศษ\"></div>");
  L.push("<div class=\"ma\"><button class=\"bx\" id=\"bcx\">ยกเลิก</button><button class=\"bc\" id=\"bcs\">📨 ส่งคำขอนัด</button></div>");
  L.push("</div></div>");
  L.push("<div class=\"toast\" id=\"toast\"></div>");
  L.push("<script>");
  L.push("var AU='__APP_URL__', TK='__TOKEN__', cy, cm, PS=null, VS='doc';");
  L.push("(function(){var n=new Date();cy=n.getFullYear();cm=n.getMonth()+1})();");
  L.push("var TM=['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];");
  L.push("var TD=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];");
  L.push("var PEND={};try{var _ps=sessionStorage.getItem('ptPend');if(_ps)PEND=JSON.parse(_ps)}catch(e){}");  
  L.push("function savePend(){try{sessionStorage.setItem('ptPend',JSON.stringify(PEND))}catch(e){}}"); 
  L.push("var _INLINE=__INLINE_DATA__;");
  L.push("document.getElementById('bp').onclick=function(){chg(-1)};");
  L.push("document.getElementById('bn').onclick=function(){chg(1)};");
  L.push("document.getElementById('bcx').onclick=function(){hm()};");
  L.push("document.getElementById('bcs').onclick=function(){sr()};");
  L.push("document.getElementById('bm').onclick=function(e){if(e.target===this)hm()};");
  L.push("function selRadio(v){VS=v;document.getElementById('ro1').className='radio-opt'+(v==='doc'?' selected':'');document.getElementById('ro2').className='radio-opt'+(v==='wait'?' selected':'');var d1=document.querySelector('#ro1 .radio-dot'),d2=document.querySelector('#ro2 .radio-dot');d1.innerHTML=v==='doc'?'<span class=\"radio-dot-inner\"></span>':'';;d2.innerHTML=v==='wait'?'<span class=\"radio-dot-inner\"></span>':'';}");
  L.push("function ym(){return cy+'-'+('0'+cm).slice(-2)}");
  L.push("function ul(){document.getElementById('ml').textContent=TM[cm]+' '+(cy+543)}");
  L.push("function chg(d){cm+=d;if(cm>12){cm=1;cy++}if(cm<1){cm=12;cy--}ul();ld()}");
  L.push("function ld(){var ymNow=ym();if(_INLINE&&_INLINE.yearMonth===ymNow){rd(_INLINE);return}var c=document.getElementById('mc');c.innerHTML='<div style=\"text-align:center;padding:48px 20px;color:#9ca3af\"><span class=\"material-icons-outlined\" style=\"font-size:3rem;animation:spin 1s linear infinite\">refresh</span><p style=\"margin-top:12px\">กำลังโหลด...</p></div>';fetch(AU+'?action=getAvailability&token='+encodeURIComponent(TK)+'&ym='+encodeURIComponent(ymNow)).then(function(r){return r.json()}).then(rd).catch(function(){c.innerHTML='<p style=\"text-align:center;padding:40px;color:#dc2626\">โหลดไม่สำเร็จ กรุณาลองใหม่</p>'})}");
  L.push("function rd(data){var c=document.getElementById('mc');if(!data||!data.success){c.innerHTML='<p style=\"text-align:center;padding:40px;color:#dc2626\">ลิงก์ไม่ถูกต้อง</p>';return}var today=new Date().toISOString().slice(0,10),od=0,fd=0,cd=0;data.days.forEach(function(d){if(d.closed)cd++;else if(d.totalFree>0)od++;else fd++});c.innerHTML='<div class=\"ms\"><div class=\"si open\"><div class=\"sv\">'+od+'</div><div class=\"sl\">วันที่มีคิวว่าง</div></div><div class=\"si full\"><div class=\"sv\">'+fd+'</div><div class=\"sl\">คิวเต็มทุกช่วง</div></div><div class=\"si cls\"><div class=\"sv\">'+cd+'</div><div class=\"sl\">วันหยุด</div></div></div><div id=\"daylist\"></div>';var dl=document.getElementById('daylist');data.days.forEach(function(day){var dobj=new Date(day.date+'T00:00:00'),dn=dobj.getDate(),dn2=TD[dobj.getDay()],it=(day.date===today);if(day.closed){dl.innerHTML+='<div class=\"dc\"><div class=\"dh\" style=\"cursor:default\"><div class=\"dhl\"><div class=\"dn cls\">'+dn+'</div><div><div class=\"dname\">วัน'+dn2+'</div><div class=\"dsub\">'+day.date+'</div></div></div><span class=\"dbadge cls\">'+day.reason+'</span></div></div>';return}var hf=(day.totalFree>0),ttag=it?'<span class=\"ttag\">วันนี้</span>':'';;dl.innerHTML+='<div class=\"dc'+(it?' today':'')+'\"><div id=\"DC'+day.date+'\" class=\"dh\" data-d=\"'+ day.date+'\"><div class=\"dhl\"><div class=\"dn '+(hf?'open':'full')+'\">'+dn+'</div><div><div class=\"dname\">วัน'+dn2+ttag+'</div><div class=\"dsub\">'+day.date+'</div></div></div><div style=\"display:flex;align-items:center;gap:4px\"><span class=\"dbadge '+(hf?'free':'full')+'\">'+(hf?'✓ ว่าง '+day.totalFree+' ช่วง':'✕ คิวเต็ม')+'</span><span class=\"material-icons-outlined xi\">expand_more</span></div></div><div class=\"db\">'+rs(day.slots,day.date)+'</div></div>'});dl.querySelectorAll('.dh[data-d]').forEach(function(el){el.addEventListener('click',function(){tog(this.getAttribute('data-d'))})});dl.querySelectorAll('.tc[data-d]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();om(this.getAttribute('data-d'),this.getAttribute('data-t'),this.getAttribute('data-n'))})});dl.querySelectorAll('.cancel-btn[data-rid]').forEach(function(el){el.addEventListener('click',function(e){e.stopPropagation();cnl(this.getAttribute('data-rid'),this.getAttribute('data-key'))})});var td2=document.getElementById('DC'+today);if(td2){td2.parentElement.classList.add('exp');setTimeout(function(){td2.scrollIntoView({behavior:'smooth',block:'center'})},80)}}");
  L.push("function rs(slots,date){if(!slots||!slots.length)return'<p class=\"nst\">ไม่มีข้อมูล</p>';var os=slots.filter(function(t){return t.therapistName.toUpperCase().indexOf('HOME')===-1});if(!os.length)return'<p class=\"nst\">ไม่มีคิวว่าง OPD</p>';return os.map(function(t){var nm=t.therapistName.replace(/^OPD\\s+/i,'').trim();var cs=t.freeTimes.length?t.freeTimes.map(function(time){var k=date+'|'+time+'|'+nm;if(PEND[k]){return'<span class=\"pending-wrap\"><span class=\"tc pending\"><span class=\"material-icons-outlined\" style=\"font-size:13px\">hourglass_empty</span>'+time+' — อยู่ในการดำเนินการ</span><span class=\"tc cancel-btn\" data-rid=\"'+ PEND[k]+'\" data-key=\"'+ k+'\"><span class=\"material-icons-outlined\" style=\"font-size:12px\">close</span>ยกเลิกคำขอ</span></span>'}return'<span class=\"tc\" data-d=\"'+ date+'\" data-t=\"'+ time+'\" data-n=\"'+ nm+'\"><span class=\"material-icons-outlined\" style=\"font-size:14px\">add_circle_outline</span>'+time+'</span>'}).join(''):'<span class=\"nst\">คิวเต็ม</span>';return'<div class=\"tr\"><div class=\"tdot\" style=\"background:'+(t.color||'#0d9488')+'\"></div><div class=\"tnm\">'+nm+'</div><div class=\"tcs\">'+cs+'</div></div>'}).join('')}");
  L.push("function tog(d){var el=document.getElementById('DC'+d);if(el)el.parentElement.classList.toggle('exp')}");
  L.push("function om(date,time,nm){PS={date:date,time:time,nm:nm};var d=new Date(date+'T00:00:00');document.getElementById('msi').textContent='วัน'+TD[d.getDay()]+' ที่ '+d.getDate()+' '+TM[d.getMonth()+1]+' '+(d.getFullYear()+543)+' เวลา '+time+' น. ('+nm+')';['rn','rp','rnote'].forEach(function(id){document.getElementById(id).value=''});VS='doc';selRadio('doc');document.getElementById('bm').style.display='flex';setTimeout(function(){document.getElementById('rn').focus()},100);}");
  L.push("function hm(){document.getElementById('bm').style.display='none';PS=null}");
  L.push("function sr(){if(!PS)return;var n=document.getElementById('rn').value.trim();var p=document.getElementById('rp').value.trim();var nt=document.getElementById('rnote').value.trim();if(!n||!p){st('⚠️ กรุณากรอกชื่อและเบอร์โทร','er');return}if(!/^[0-9]{9,10}$/.test(p.replace(/-/g,''))){st('⚠️ เบอร์โทรไม่ถูกต้อง','er');return}var btn=document.getElementById('bcs');btn.disabled=true;btn.textContent='กำลังส่ง...';var vs=VS==='doc'?'พบแพทย์แล้ว':'รอการตรวจจากแพทย์อีกครั้ง';fetch(AU+'?action=submitPublicRequest'+'&token='+encodeURIComponent(TK)+'&date='+encodeURIComponent(PS.date)+'&time='+encodeURIComponent(PS.time)+'&therapistName='+encodeURIComponent(PS.nm)+'&visitStatus='+encodeURIComponent(vs)+'&name='+encodeURIComponent(n)+'&phone='+encodeURIComponent(p)+'&note='+encodeURIComponent(nt)).then(function(r){return r.json()}).then(function(res){btn.disabled=false;btn.textContent='📨 ส่งคำขอนัด';if(res.success){var k=PS.date+'|'+PS.time+'|'+PS.nm;PEND[k]=res.requestId;savePend();hm();st('✅ ส่งคำขอสำเร็จ! เจ้าหน้าที่จะติดต่อกลับ','ok');_INLINE=null;setTimeout(function(){ld()},800);}else{st('❌ '+(res.error||'ลองใหม่อีกครั้ง'),'er')}}).catch(function(){btn.disabled=false;btn.textContent='📨 ส่งคำขอนัด';st('❌ เกิดข้อผิดพลาด','er')});}");
  L.push("function cnl(rid,key){if(!confirm('ยืนยันการยกเลิกคำขอนัดหมายนี้?'))return;st('กำลังยกเลิก...','info');fetch(AU+'?action=cancelPublicRequest&token='+encodeURIComponent(TK)+'&requestId='+encodeURIComponent(rid)).then(function(r){return r.json()}).then(function(res){if(res.success){delete PEND[key];savePend();st('✅ ยกเลิกคำขอสำเร็จ คิวว่างแล้ว','ok');_INLINE=null;setTimeout(function(){ld()},600);}else{st('❌ '+(res.error||'ไม่สามารถยกเลิกได้'),'er')}}).catch(function(){st('❌ เกิดข้อผิดพลาด กรุณาลองใหม่','er')});}");
  L.push("function st(msg,type){var t=document.getElementById('toast');t.textContent=msg;t.className='toast '+(type||'')+'';t.classList.add('show');setTimeout(function(){t.classList.remove('show')},4500)}");
  L.push("ul();ld();");
  // =====================================================================
  // ✅ V15.3: Auto-refresh + Countdown + PEND sync
  // =====================================================================
  L.push("var _RF_TOTAL=60,_rf_left=_RF_TOTAL,_rf_timer=null,_rf_busy=false;");
  L.push("function _rfTick(){");
  L.push("  _rf_left--;");
  L.push("  var bar=document.getElementById('cdown-bar');");
  L.push("  var txt=document.getElementById('cdown-txt');");
  L.push("  if(bar)bar.style.width=(_rf_left/_RF_TOTAL*100)+'%';");
  L.push("  if(txt)txt.textContent=_rf_left+' วิ';");
  L.push("  if(_rf_left<=0){_rf_left=_RF_TOTAL;doRefresh();}");
  L.push("}");
  L.push("function _startCdown(){clearInterval(_rf_timer);_rf_left=_RF_TOTAL;var bar=document.getElementById('cdown-bar');if(bar)bar.style.width='100%';var txt=document.getElementById('cdown-txt');if(txt)txt.textContent=_RF_TOTAL+' วิ';_rf_timer=setInterval(_rfTick,1000);}");
  // sync PEND: ตรวจสอบ requestId ใน sessionStorage กับ server
  L.push("function syncPend(cb){");
  L.push("  var ids=Object.values(PEND).filter(function(v){return v&&typeof v==='string'&&v.indexOf('ROW-')!==0});");
  L.push("  if(!ids.length){if(cb)cb();return;}");
  L.push("  fetch(AU+'?action=checkPendingStatus&token='+encodeURIComponent(TK)+'&ids='+encodeURIComponent(ids.join(','))).then(function(r){return r.json()}).then(function(res){");
  L.push("    if(res&&res.success&&res.active){");
  L.push("      var changed=false;");
  L.push("      Object.keys(PEND).forEach(function(k){var id=PEND[k];if(id&&res.active[id]===false){delete PEND[k];changed=true;}});");
  L.push("      if(changed){savePend();st('🔄 ข้อมูลถูกอัพเดทจากระบบหลัก','info');}");
  L.push("    }");
  L.push("    if(cb)cb();");
  L.push("  }).catch(function(){if(cb)cb();});");
  L.push("}");
  // doRefresh: sync PEND แล้ว force reload ข้อมูล
  L.push("function doRefresh(){");
  L.push("  if(_rf_busy)return;");
  L.push("  _rf_busy=true;");
  L.push("  var btn=document.getElementById('rfbtn');");
  L.push("  if(btn){btn.disabled=true;btn.classList.add('spinning');}");
  L.push("  syncPend(function(){");
  L.push("    _INLINE=null;");
  L.push("    ld();");
  L.push("    _rf_busy=false;");
  L.push("    if(btn){btn.disabled=false;btn.classList.remove('spinning');}");
  L.push("    _startCdown();");
  L.push("  });");
  L.push("}");
  // ปุ่ม manual refresh — reset countdown ด้วย
  L.push("function manualRefresh(){_rf_left=_RF_TOTAL+1;doRefresh();}");
  // เริ่ม countdown
  L.push("_startCdown();");
  L.push("<\/script></body></html>");
  return L.join('\n');
}
function addDualDiagnosisColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Outcomes');
  
  if (!sheet) {
    Logger.log('ไม่พบ Sheet Outcomes');
    return;
  }
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // ตรวจสอบว่ามี columns เหล่านี้หรือยัง
  const newColumns = [
    'diagnosis1_icd10', 'diagnosis1_label',
    'diagnosis2_icd10', 'diagnosis2_label',
    'vas1_before', 'vas1_after', 'vas1_diff',
    'vas2_before', 'vas2_after', 'vas2_diff'
  ];
  
  newColumns.forEach(col => {
    if (!headers.includes(col)) {
      sheet.appendRow([col]);
      Logger.log(`เพิ่ม column: ${col}`);
    }
  });
  
  // ย้าย columns ใหม่ไปตำแหน่งที่ถูกต้อง (หลัง therapistId)
  const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const targetOrder = [
    'outcomeId', 'bookingId', 'hn', 'date', 'therapistId',
    'diagnosis1_icd10', 'diagnosis1_label',
    'diagnosis2_icd10', 'diagnosis2_label',
    'vas1_before', 'vas1_after', 'vas1_diff',
    'vas2_before', 'vas2_after', 'vas2_diff',
    'barthel_score', 'goal_met', 'note', 'createdAt'
  ];
  
  // เรียง columns ใหม่
  const colMap = {};
  currentHeaders.forEach((h, i) => colMap[h] = i + 1);
  
  const newOrder = targetOrder.map(h => colMap[h] || null);
  const maxCol = Math.max(...newOrder.filter(n => n));
  
  // สร้าง temporary data
  const data = sheet.getRange(1, 1, sheet.getLastRow(), maxCol).getValues();
  const newData = data.map(row => newOrder.map(idx => idx ? row[idx - 1] : ''));
  
  // ล้างและเขียนใหม่
  sheet.clear();
  sheet.getRange(1, 1, newData.length, newData[0].length).setValues(newData);
  
  Logger.log('✅ ปรับโครงสร้าง Sheet เสร็จสิ้น');
}
// -------------------------------------------------------------------
// resyncBookingRevenueIfAuto_ — เรียกจาก updateBooking() เมื่อแก้ไข booking
// จะ re-generate RevenueLog ใหม่ "เฉพาะกรณีที่ของเดิมเป็น source='auto'"
// (ถ้า user เคยแก้ไขรายการเองในหน้า Revenue Dashboard แล้ว source จะเป็น
// 'manual' หรือ 'backfill' — จะไม่ถูกทับ เพื่อรักษาการแก้ไขของผู้ใช้)
// -------------------------------------------------------------------
function resyncBookingRevenueIfAuto_(bookingId, dateObj, hn, name, rights, therapistId, treatmentTypeRaw, appointmentType) {
  ensureRevenueSheetsReady_();
  const sheet = REVENUE_LOG_SHEET();
  const data  = sheet.getDataRange().getValues();
  const existingRows = [];
  let hasNonAuto = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === bookingId) {
      existingRows.push(i + 1);
      if (data[i][11] !== 'auto') hasNonAuto = true;
    }
  }
  if (hasNonAuto) return; // ผู้ใช้แก้ไขเองแล้ว ไม่แตะ

  // ลบของเดิม (auto) แล้วสร้างใหม่
  existingRows.sort((a,b) => b - a).forEach(r => sheet.deleteRow(r));
  autoLogBookingRevenue_(bookingId, dateObj, hn, name, rights, therapistId, treatmentTypeRaw, appointmentType);
}

// ===================================================================
// ✅ NEW V16: ระบบสรุปรายได้ประจำวันและการลงบัญชี (Revenue & ICD-9 Billing)
// -------------------------------------------------------------------
// แนวคิด:
//   - ตาราง ICD9Price (sheet ใหม่) เก็บ master ราคาหัตถการ ผูกกับ
//     "ค่าหัตถการ" (treatmentValue) ที่ตรงกับ data-val ใน index.html
//     เพื่อให้ map กับ Bookings.treatmentType (comma-separated) ได้ตรงตัว
//   - 1 ราคา/หัตถการ ไม่แยกตามสิทธิ (ตามที่ผู้ใช้ยืนยัน)
//   - RevenueLog (sheet ใหม่) เก็บราย "บรรทัดหัตถการ" ต่อ booking 1 แถว
//     เพื่อให้แก้ไขราย item ได้ (แก้รายการ/แก้ราคา) และ sum ได้ง่าย
//   - getDailyRevenueSummary() ดึงข้อมูลจาก Bookings โดยตรงแบบ "on the fly"
//     (ไม่ต้องพึ่ง RevenueLog) สำหรับ booking ที่ยังไม่ backfill
//     แต่ RevenueLog จะถูกใช้เป็น "บันทึกจริงที่แก้ไขได้" เมื่อ user กด
//     ยืนยัน backfill หรือเมื่อมี booking ใหม่เข้ามา (auto-generate)
// ===================================================================

const ICD9_PRICE_SHEET_NAME   = 'ICD9Price';
const REVENUE_LOG_SHEET_NAME  = 'RevenueLog';

// ===================================================================
// ✅ NEW V16.1 — RIGHTS-AWARE REVENUE RULES (ตามที่ผู้ใช้ระบุ)
// ===================================================================
// ปัญหา: ระบบเดิมคิด "รายได้" จากราคาหัตถการ (ICD9) เท่านั้น โดยไม่สนใจว่า
// สิทธิการรักษาของผู้ป่วยเป็นแบบไหน — ทำให้ตัวเลข "รายได้" ที่แสดงไม่ตรงกับ
// เงินที่หน่วยบริการได้รับจริงในปัจจุบัน เพราะ:
//
//   1) สิทธิ UC/บัตรทอง (กลุ่ม WEL/UCS ใน สปสช.) จ่ายเป็น "เหมาจ่ายรายหัว"
//      ที่ สปสช. สรุปและโอนให้หลังปิดปีงบประมาณ ไม่ใช่จ่ายตามรายครั้งที่ให้บริการ
//      ดังนั้นแม้จะ "เบิกได้" แต่ไม่ใช่เงินที่เข้าหน่วยบริการ ณ ปัจจุบัน
//      → ต้องแยกออกจาก "รายได้รับจริง" เป็น "รายได้รอเฉลี่ยรายหัว (ปลายปีงบ)"
//
//   2) การเยี่ยมบ้าน (Home Visit) ของสิทธิ UC ได้รับเงินจริงแบบเหมา
//      150 บาท/เคส เท่านั้น ไม่ว่าจะทำหัตถการกี่รายการ (ไม่ใช่ sum ราคาหัตถการ)
//
//   3) IMC ดูแยกในระบบรัฐ — ไม่นับรายได้ในระบบนี้
//      ให้เลือกหัตถการนี้ในหน้าจอง (มีไว้ใน master list เพื่ออ้างอิงเท่านั้น)
//
// แนวทาง: ไม่ลบของเดิม แต่เพิ่มชั้น "การจัดประเภทรายได้" ทับการคำนวณราคา
// หัตถการเดิม — ทุกอย่างยัง config ได้จากในนี้ ไม่ต้องแก้โค้ดหลายที่
// ===================================================================

// สิทธิที่ถือเป็น "เหมาจ่ายรายหัว / รอสรุปปลายปีงบ" — ไม่นับเป็นรายได้รับจริง
// (ชื่อใน Bookings.rights ตรงกับ rightsOptions ของ index.html)
// ✅ V16.2 FIX: จากข้อมูลรายงานจริง (พ.ค.69) — สิทธิ UCS/WEL/UC/ผู้สูงอายุ
// ได้รับเงิน 150 บาท/ครั้ง ต่อ session จาก สปสช. โดยตรง (ราคาที่จ่ายจริง = 150 บาท)
// ไม่ใช่ "รอสรุปปลายปีงบ" ต่อ session — แต่ภาพรวมงบรายหัวปลายปีงบอาจปรับได้
// ดังนั้น: ทุกสิทธิถือเป็น "realized" (รับจริง) — แยกแสดงเป็นกลุ่มสีต่างกันเพื่อ tracking
// (เดิมตั้ง ['บัตรทอง','ผู้สูงอายุ'] แต่ข้อมูลจริงแสดงว่าจ่ายต่อ session จริง)
const CAPITATION_PENDING_RIGHTS = []; // ✅ ไม่มีสิทธิที่ต้องรอสรุปรายหัวแล้ว (ชั่วคราว)

// คำที่ถ้าเจอใน "สิทธิ" (rights) หรือ "สิทธิหลัก" ของ สปสช. ให้ถือเป็นกลุ่มเดียวกัน
// ใช้เผื่อข้อมูล backfill ที่อาจมีคำสะกด/รูปแบบอื่น เช่น UC, UCS, WEL, สปสช, 30 บาท
const CAPITATION_PENDING_KEYWORDS = []; // ✅ V16.2: ล้างออก — ทุกสิทธิรับจริงต่อ session แล้ว

// อัตราเหมาจ่ายจริงสำหรับ "เยี่ยมบ้าน" ต่อเคส (ไม่ขึ้นกับจำนวนหัตถการที่ทำ)
// — ใช้กับทุกสิทธิเมื่อ appointmentType เป็น Home/เยี่ยมบ้าน ตามข้อมูลรายงานจริง
// ✅ V16.2 FIX: จากรายงานจริงพ.ค.69 — เยี่ยมบ้าน IMC = H9339.1(450) + H9340(200) = 650/เคส
const HOME_VISIT_FLAT_RATE = 650; // แก้จาก 150 → 650 บาท/เคส (IMC H9339.1+H9340)

// อัตราค่าบริการ OPD UC/WEL ต่อครั้ง = 150 บาท (ตามรายงาน ราคาที่จ่ายจริง/ครั้ง)
const OPD_UC_FLAT_RATE = 150;

// ✅ V15.1: IMC OPD — เหมาจ่าย 450 บาท/ครั้ง (ไม่นับตามหัตถการ)
// (เดิม exclude ทั้งหมด แต่ความจริงได้ 450 บาทต่อครั้ง จากระบบรัฐ)
const IMC_OPD_FLAT_RATE = 450;

// IMC tag ใน treatmentType — ตรวจจากรายการหัตถการที่จองมา
// ✅ V15.1: ไม่ exclude อีกต่อไป — คิดเป็น flat rate IMC_OPD_FLAT_RATE แทน
const IMC_REVENUE_EXCLUDED = false; // เปลี่ยนจาก true → false
// tag ที่ถูก exclude ออกจากการคิดรายได้ (ยังบันทึกได้ในจอง)
// ✅ V15.1: ล้าง IMC ออกจาก excluded — ย้ายไปคิดเป็น flat rate แทน
const REVENUE_EXCLUDED_TAGS = []; // เดิม ['IMC'] → [] แล้ว

// สิทธิที่ต้องชำระเงิน (200 บาท/ครั้ง) — แยก group ในรายงาน
const PAID_RIGHTS = ['ข้าราชการ', 'กรมบัญชีกลาง', 'ประกันสังคม', 'ชำระเงินเอง'];
// สิทธิ UC/สปสช. (150 บาท/ครั้ง) — เหมาจ่ายต่อ session
const UC_RIGHTS   = ['บัตรทอง', 'ผู้สูงอายุ', 'ผู้พิการ', 'อสม.', 'อื่นๆ', 'ไม่ระบุ'];

// ── normalize สิทธิให้เป็นมาตรฐานเดียว ──
// พบว่าในระบบมีชื่อซ้ำซ้อน เช่น สูงอายุ/ผู้สูงอายุ, อสม/อสม., พิการ/ผู้พิการ
const RIGHTS_NORMALIZE_MAP = {
  'สูงอายุ'       : 'ผู้สูงอายุ',
  'อสม'           : 'อสม.',
  'พิการ'         : 'ผู้พิการ',
  'ภิกษุ'         : 'บัตรทอง',   // พระภิกษุใช้สิทธิ UC
  'UC'            : 'บัตรทอง',
  'ไม่พบข้อมูล'  : 'ไม่ระบุ',
  'None'          : 'ไม่ระบุ',
  '-'             : 'ไม่ระบุ',
  ''              : 'ไม่ระบุ',
};
function normalizeRights_(raw) {
  const s = (raw || '').toString().trim();
  return RIGHTS_NORMALIZE_MAP[s] || s || 'ไม่ระบุ';
}

// ฟังก์ชันช่วยตรวจว่าสิทธิที่ระบุเข้าเงื่อนไข "เหมาจ่ายรายหัว/รอสรุปปลายปีงบ" หรือไม่
function isCapitationPendingRights_(rights) {
  if (!rights) return false;
  const r = rights.toString().trim();
  if (CAPITATION_PENDING_RIGHTS.indexOf(r) !== -1) return true;
  const rLower = r.toLowerCase();
  return CAPITATION_PENDING_KEYWORDS.some(kw => rLower.indexOf(kw.toLowerCase()) !== -1);
}

// ฟังก์ชันช่วยตรวจว่า booking นี้เป็นการเยี่ยมบ้านหรือไม่ (รองรับทั้ง 'Home' และ 'เยี่ยมบ้าน')
function isHomeVisitAppt_(appointmentType) {
  return appointmentType === 'Home' || appointmentType === 'เยี่ยมบ้าน';
}

// ✅ V15.1: ตรวจว่า treatmentType มี IMC เป็น tag หลัก (เดี่ยวหรือรวมกับอื่น)
// → ถ้ามี IMC ใน treatment → คิดเป็น flat rate IMC_OPD_FLAT_RATE (450 บ./ครั้ง)
// → เยี่ยมบ้านที่มี IMC ยังคิดจาก HOME_VISIT_FLAT_RATE (650 บ./เคส) เหมือนเดิม
function hasIMCTag_(treatmentTypeRaw) {
  if (!treatmentTypeRaw) return false;
  return splitTreatmentType_(treatmentTypeRaw).some(t => t === 'IMC' || t.startsWith('IMC'));
}

// -------------------------------------------------------------------
// CONSTANTS: ICD9 Master price list (จากตารางอัตราหัตถการที่ รพ.สต.
// บางขะแยง ใช้งานจริง — รหัสเบิกตรง / ICD9 / ราคา)
// หมายเหตุ: ราคาเป็นราคาเดียวทุกสิทธิ ไม่แยกกรมบัญชีกลาง/ประกันสังคม
// (การแยกตาม "สิทธิ" สำหรับ "รับรู้รายได้จริง vs รอสรุปรายหัว" อยู่ในชั้น
//  CAPITATION_PENDING_RIGHTS ด้านบน — ไม่ใช่ราคาหัตถการที่ต่างกัน)
// -------------------------------------------------------------------
// ✅ V16.3: เพิ่มคอลัมน์ priceUC (ราคา สปสช./บัตรทอง 30 ต่อครั้ง) — ตามตารางลายมือ
//           ต่อท้ายทุกแถว [..., note, priceUC] — ใช้เมื่อคิดรายได้ของสิทธิกลุ่ม UC_RIGHTS
//           (ผู้สูงอายุ/บัตรทอง/อสม./ผู้พิการ/อื่นๆ/ไม่ระบุ) แทนราคามาตรฐาน
const ICD9_MASTER_LIST = [
  // [no, nameEn, nameTh, claimCode, icd9, price, treatmentValue, note, priceUC(สปสช.)]
  [1,  'Active exercise',              'การออกกำลังกายทั่วไป (Exercise)',      '56009', '9312', 90,  '',                    '', 90],
  [2,  'ROM exercise / PROM',          '',                                       '56009', '9314', 90,  'ROM Exercise',        '', 90],
  [3,  'Vertebral mobilization',       'การจัด ดึง ข้อต่อ (Manipulation & Mobilization)', '57102', '9315', 260, '',           '', 90],
  [4,  'Peripheral Mobilization',      '',                                       '57016', '9316', 260, '',                    '', 90],
  [5,  'Passive exercise (PROM)',      'การเคลื่อนไหวข้อต่างๆ',                 '56701', '9317', 90,  '',                    '', 90],
  [6,  'Breathing exercise',           '',                                       '56301', '9318', 90,  '',                    '', 100],
  [7,  'Cervical traction',            'การดึงคอด้วยเครื่อง',                   '56120', '9321', 140, 'ดึงคอ (CT)',          '', 75],
  [8,  'Lumbar / Pelvic traction',     'การดึงหลังด้วยเครื่อง',                 '56121', '9321', 140, 'ดึงหลัง (LT)',        '', 75],
  [9,  'Ambulation & Gait training',   'การเดิน',                                '56111', '9322', 90,  'Ambulation Training', '', 90],
  [10, 'Hand function training',       'การฝึกการหยิบจับสิ่งของ',                '57702', '9325', 90,  '',                    '', 70],
  [11, 'Stretching exercise',          'การออกกำลังกายโดยการยืดเหยียด',          '56701', '9327', 90,  '',                    '', 90],
  [12, 'Passive Stretching',           '',                                       '57028', '9333', 90,  '',                    '', 90],
  [13, 'Hot pack',                     'การประคบด้วยแผ่นความร้อน',               '56001', '9335', 60,  'ประคบอุ่น (HP)',      '', 60],
  [14, 'Paraffin',                     'การแช่พาราฟิน',                          '56006', '9335', 100, '',                    '', 130],
  [15, 'Ultrasound',                   'การรักษาด้วยคลื่นเสียง',                 '56003', '9334', 120, 'อัลตราซาวน์ (US)',    '', 65],
  [16, 'Shortwave',                    'การรักษาด้วยคลื่นสั้น',                  '56004', '9334', 130, '',                    '', 75],
  [18, 'ES / IFC / TENS / HVPC',       'การกระตุ้นด้วยกระแสไฟฟ้า',               '56002', '9339', 120, 'กระตุ้นไฟฟ้า (ES)',   '', 65],
  [19, 'Magnetic field therapy (PMS)', 'การกระตุ้นด้วยคลื่นแม่เหล็ก',            '56002', '9339', 260, '',                    '⚠️ ICD9 เติมให้อัตโนมัติ (เดิมไม่มีในตารางต้นฉบับ) — โปรดตรวจสอบ', 260],
  [20, 'LASER',                        'การรักษาด้วยเลเซอร์',                    '56005', '9339', 300, '',                    '', 55],
  [21, 'Taping',                       'การพันเทป',                              '56008', '9359', 170, '',                    '', 105],
  [22, 'Advice & Home program',        '',                                       '56020', '9382', 100, 'HOME PROGRAM',        '', 65],
  [23, 'ADL training',                 '',                                       '57001', '9383', 80,  '',                    '', 110],
  [24, 'Bicycle',                      '',                                       '56011', '9389', 100, '',                    '', 80],
  [25, 'Balance training',             'การฝึกการทรงตัว',                        '57101', '9389', 100, '',                    '', 90],
  [26, 'Tilt table',                   'การฝึกยืนด้วยเตียงฝึกยืน',               '56110', '9389', 120, '',                    '', 90],
  [27, 'Amputation training',          '',                                       '57701', '9389', 80,  '',                    '', 80],
  [28, 'Percussion & Vibration',       '',                                       '56301', '9389', 100, '',                    '', 100],
  [29, 'Cough training',               '',                                       '56301', '9399', 100, '',                    '', 100],
  [30, 'Massage / Deep friction',      '',                                       '56007', '9995', 80,  '',                    '', 80],
  // หัตถการที่มีใช้จริงในแบบฟอร์มจองแต่ไม่อยู่ในตารางต้นฉบับ — เพิ่มให้ครบ
  // เพื่อให้ map รายได้ได้ทุก tag ที่กดได้จริงในหน้าจอง (priceUC ไม่มีในตารางลายมือ → ใช้ราคาเดิมเป็นค่าตั้งต้น)
  [31, 'IMC (Intermittent Compression)', 'การกดด้วยเครื่องลม',                  '56002', '9339', 100, 'IMC',                 '⚠️ เพิ่มใหม่ ไม่อยู่ในตารางต้นฉบับ — โปรดตรวจสอบราคา', 0],
  [32, 'AE (Aerobic)',                  'การออกกำลังกายแอโรบิก',                '56009', '9312', 90,  'AE (Aerobic)',        '⚠️ เพิ่มใหม่ ไม่อยู่ในตารางต้นฉบับ — โปรดตรวจสอบราคา', 90],
  [33, 'AM (Active Move)',              'การออกกำลังกายแบบ Active',             '56009', '9312', 90,  'AM (Active Move)',    '⚠️ เพิ่มใหม่ ไม่อยู่ในตารางต้นฉบับ — โปรดตรวจสอบราคา', 90],
  [34, 'AE/AM',                         'การออกกำลังกายแบบ AE/AM',              '56009', '9312', 90,  'AE/AM',               '⚠️ เพิ่มใหม่ ไม่อยู่ในตารางต้นฉบับ — โปรดตรวจสอบราคา', 90],
  [35, 'Follow-up',                     'ติดตามการรักษา (ไม่มีหัตถการเพิ่ม)',    '',      '',     0,   'ติดตามการรักษา',      'รายการนี้ไม่คิดราคา (เป็นแค่สถานะติดตาม)', 0],
  [36, 'Other / อื่นๆ',                 'หัตถการอื่นๆ ที่ไม่ระบุ',               '',      '',     0,   'อื่นๆ',               'ไม่คิดราคาอัตโนมัติ — ผู้ใช้ต้องระบุราคาเองในหน้าแก้ไขรายการ', 0]
];

// ✅ force ลบข้อมูลเก่าทิ้งแล้ว seed ใหม่ทั้งหมด — ใช้เมื่อต้องการอัปเดต master list
function forceReseedICD9Price() {
  const ss = getSpreadsheet();
  let icdSheet = ss.getSheetByName(ICD9_PRICE_SHEET_NAME);
  if (!icdSheet) icdSheet = ss.insertSheet(ICD9_PRICE_SHEET_NAME);
  icdSheet.clearContents();
  const icdHeader = ['no','nameEn','nameTh','claimCode','icd9','price','treatmentValue','note','priceUC','updatedAt'];
  icdSheet.getRange(1, 1, 1, icdHeader.length).setValues([icdHeader])
    .setFontWeight('bold').setBackground('#00897b').setFontColor('#fff');
  icdSheet.setFrozenRows(1);
  const rows = ICD9_MASTER_LIST.map(r => [...r, new Date()]);
  icdSheet.getRange(2, 1, rows.length, icdHeader.length).setValues(rows);
  icdSheet.autoResizeColumns(1, icdHeader.length);
  clearRevenueCache();
  return { success: true, message: '✅ Reseed ICD9Price สำเร็จ — ' + rows.length + ' รายการ' };
}

// -------------------------------------------------------------------
// SETUP: สร้าง sheet ICD9Price และ RevenueLog อัตโนมัติ (ถ้ายังไม่มี)
// -------------------------------------------------------------------
function setupRevenueSheets() {
  let createdICD9 = false, createdLog = false, reseeded = false;
  const ss = getSpreadsheet();

  // ---- ICD9Price ----
  let icdSheet = ss.getSheetByName(ICD9_PRICE_SHEET_NAME);
  if (!icdSheet) {
    icdSheet = ss.insertSheet(ICD9_PRICE_SHEET_NAME);
    createdICD9 = true;
  }
  const icdHeader = ['no','nameEn','nameTh','claimCode','icd9','price','treatmentValue','note','priceUC','updatedAt'];

  // ✅ เขียน header เสมอ (ไม่ว่าจะมีหรือไม่)
  icdSheet.getRange(1, 1, 1, icdHeader.length).setValues([icdHeader])
    .setFontWeight('bold').setBackground('#00897b').setFontColor('#fff');
  icdSheet.setFrozenRows(1);

  // ✅ seed ข้อมูลถ้าแถวข้อมูลว่างเปล่า (lastRow <= 1)
  // ✅ V16.3: ถ้ามีข้อมูลเดิมแต่ยังไม่มีคอลัมน์ priceUC (schema เก่า) → reseed ใหม่ทั้งหมด
  //    เพื่อให้ราคา สปสช. ที่เพิ่งอัปเดตจากตารางลายมือ ถูกเขียนลง sheet จริง
  const lastRow = icdSheet.getLastRow();
  const hasOldSchema = lastRow > 1 && (icdSheet.getRange(2, 9).getValue() === '' || icdSheet.getRange(2, 9).getValue() === null)
    && ICD9_MASTER_LIST.some(r => Number(r[8]) > 0); // แถวที่ 2 คอลัมน์ priceUC ว่าง แต่ master list มีค่า → schema เก่า
  if (lastRow <= 1 || hasOldSchema) {
    if (hasOldSchema) icdSheet.getRange(2, 1, Math.max(lastRow - 1, 0), icdHeader.length).clearContent();
    const rows = ICD9_MASTER_LIST.map(r => [...r, new Date()]);
    icdSheet.getRange(2, 1, rows.length, icdHeader.length).setValues(rows);
    icdSheet.autoResizeColumns(1, icdHeader.length);
    reseeded = true;
  }

  // ---- RevenueLog ----
  let logSheet = ss.getSheetByName(REVENUE_LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(REVENUE_LOG_SHEET_NAME);
    createdLog = true;
  }
  const logHeader = [
    'logId','bookingId','date','hn','name','rights','therapistId',
    'treatmentValue','icd9','claimCode','price','source','note','createdAt','updatedAt'
  ];
  const logFirstRow = logSheet.getRange(1, 1, 1, logHeader.length).getValues()[0];
  if (logFirstRow.join('') === '') {
    logSheet.getRange(1, 1, 1, logHeader.length).setValues([logHeader])
      .setFontWeight('bold').setBackground('#1565C0').setFontColor('#fff');
    logSheet.setFrozenRows(1);
    logSheet.autoResizeColumns(1, logHeader.length);
  }

  clearRevenueCache();
  return {
    success: true,
    message: '✅ Setup สำเร็จ — ' +
      (createdICD9 ? 'สร้าง ICD9Price ใหม่' : reseeded ? 'Seed ข้อมูล ICD9Price แล้ว (' + ICD9_MASTER_LIST.length + ' รายการ)' : 'ICD9Price มีข้อมูลอยู่แล้ว') + ' | ' +
      (createdLog  ? 'สร้าง RevenueLog ใหม่' : 'RevenueLog มีอยู่แล้ว')
  };
}

function ICD9_PRICE_SHEET()  { return getSheet(ICD9_PRICE_SHEET_NAME); }
function REVENUE_LOG_SHEET() { return getSheet(REVENUE_LOG_SHEET_NAME); }

// -------------------------------------------------------------------
// manageSheets() — ตรวจสอบและซ่อม sheet ทั้งหมดในระบบ
// เรียกได้จาก Admin panel หรือ Apps Script Editor
// -------------------------------------------------------------------
function manageSheets() {
  try {
    const ss = getSpreadsheet();
    const report = [];

    // Sheet ที่ควรมีและ expected headers
    const REQUIRED_SHEETS = [
      { name: 'Bookings',    headers: ['Timestamp','BookingID','Date','time','TherapistID','PatientID','HN','Name','Phone','Rights','TreatmentType','Status','AppointmentType','diagnosis','diagnosis2'] },
      { name: 'Patients',    headers: ['PatientID (UUID)','HN','Name','Phone','Rights'] },
      { name: 'Config',      headers: ['TherapistID','Name','Color'] },
      { name: 'Slots',       headers: ['DayOfWeek','Time','TherapistID','Type','Status'] },
      { name: 'Holidays',    headers: ['Date','Reason'] },
      { name: 'Outcomes',    headers: ['outcomeId','bookingId','hn','date','therapistId','vas1_before','vas1_after','barthel_score','goal_met','note','createdAt','vas1_diff','vas2_before','vas2_after','vas2_diff'] },
      { name: 'Episodes',    headers: ['episodeId','hn','startDate','endDate','diagnosisJson','totalVisits','status','note'] },
      { name: 'RevenueLog',  headers: ['logId','bookingId','date','hn','name','rights','therapistId','treatmentValue','icd9','claimCode','price','source','note','createdAt','updatedAt'] },
      { name: 'ICD9Price',   headers: ['no','nameEn','nameTh','claimCode','icd9','price','treatmentValue','note','priceUC','updatedAt'] },
      { name: 'ExtraSlots',  headers: ['วันที่','เวลา','Therapist ID'] },
      { name: 'PublicRequests', headers: ['requestId','timestamp','date','time','therapistName','name','phone','visitStatus','note','status'] },
      // ✅ V16.4: โมดูลเยี่ยมบ้าน GPS
      { name: 'HVHouses',     headers: ['Timestamp','HouseID','HN (เชื่อมโยงผู้ป่วยเดิม)','ชื่อเจ้าของบ้าน/ผู้ป่วย','ที่อยู่','กลุ่มเป้าหมาย','Lat','Lng','เบอร์โทร','สถานะเยี่ยม','เยี่ยมล่าสุด','เจ้าหน้าที่เยี่ยมล่าสุด','QR Text','หมายเหตุ'] },
      { name: 'HVStaff',      headers: ['Timestamp','StaffID','ชื่อ-นามสกุล','ตำแหน่ง','เบอร์โทร','สถานะ','Lat','Lng','อัพเดทตำแหน่งล่าสุด','จำนวนเยี่ยมวันนี้'] },
      { name: 'HVVisitLog',   headers: ['Timestamp','VisitID','StaffID','ชื่อเจ้าหน้าที่','HouseID','ชื่อบ้าน','HN','Lat เช็คอิน','Lng เช็คอิน','ระยะห่างจากบ้าน (ม.)','หมายเหตุ'] },
      { name: 'HVPhotos',     headers: ['Timestamp','PhotoID','HouseID','ชื่อบ้าน','StaffID','ชื่อเจ้าหน้าที่','VisitID','ประเภท','URL รูปภาพ','Drive File ID'] },
      { name: 'HVFacilities', headers: ['Timestamp','FacilityID','ชื่อหน่วยบริการ','ประเภท','ที่อยู่','Lat','Lng','เบอร์โทร','รายละเอียด'] },
    ];

    // Sheet ที่ deprecated / ไม่ได้ใช้แล้ว (แจ้งเตือนแต่ไม่ลบ)
    const DEPRECATED_SHEETS = ['OPD','Home','Logคิว','ผลงาน','link'];

    REQUIRED_SHEETS.forEach(def => {
      let sh = ss.getSheetByName(def.name);
      if (!sh) {
        sh = ss.insertSheet(def.name);
        sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers])
          .setFontWeight('bold').setBackground('#1565C0').setFontColor('#fff');
        sh.setFrozenRows(1);
        report.push({ sheet: def.name, action: 'สร้างใหม่', detail: 'header: ' + def.headers.join(', ') });
      } else {
        // ตรวจ header row
        const cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), def.headers.length)).getValues()[0];
        const missing = def.headers.filter((h, i) => (cur[i] || '').toString().trim() !== h);
        if (missing.length) {
          def.headers.forEach((h, i) => { if ((cur[i] || '').toString().trim() !== h) sh.getRange(1, i+1).setValue(h); });
          sh.getRange(1, 1, 1, def.headers.length).setFontWeight('bold').setBackground('#1565C0').setFontColor('#fff');
          sh.setFrozenRows(1);
          report.push({ sheet: def.name, action: 'แก้ไข header', detail: 'แก้: ' + missing.join(', ') });
        } else {
          report.push({ sheet: def.name, action: 'ปกติ', detail: 'header ครบ (' + def.headers.length + ' col)' });
        }
      }
    });

    // ตรวจ deprecated sheets
    DEPRECATED_SHEETS.forEach(name => {
      if (ss.getSheetByName(name)) {
        report.push({ sheet: name, action: '⚠️ deprecated', detail: 'ไม่ได้ใช้งานแล้ว — เก็บไว้เพื่อ reference ปลอดภัย' });
      }
    });

    // ซ่อม ensureBookingsHeader เพิ่มเติม
    ensureBookingsHeader();

    // ซ่อม RevenueLog + ICD9Price
    setupRevenueSheets();

    return { success: true, message: '✅ ตรวจสอบ Sheet เสร็จสิ้น', total: REQUIRED_SHEETS.length, report };
  } catch (e) {
    Logger.log('manageSheets ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ตรวจสอบว่า sheet พร้อมใช้งานหรือยัง เรียกใช้ทุกครั้งก่อนอ่าน/เขียนข้อมูลการเงิน
function ensureRevenueSheetsReady_() {
  if (!ICD9_PRICE_SHEET() || !REVENUE_LOG_SHEET()) {
    setupRevenueSheets();
  }
}

// ✅ NEW: normalize รหัส ICD-9 ให้เทียบกันได้เสมอ ไม่ว่าชีตจะเก็บเป็น number (9339.0) หรือ string ("9339")
//    หรือมีช่องว่างเกิน — ใช้จุดเดียวกันทุกที่ที่ต้องเทียบ/lookup รหัส ICD-9 (ป้องกันบั๊ก type mismatch)
function normIcd9_(v) {
  if (v === null || v === undefined || v === '') return '';
  return String(v).trim().replace(/\.0+$/, '');
}

// -------------------------------------------------------------------
// อ่าน ICD9 Price Map จาก sheet (cache 10 นาที เพราะ master list แก้ไม่บ่อย)
// คืนค่า: { byTreatmentValue: {value: {icd9, claimCode, price, nameTh,...}}, all: [...] }
// -------------------------------------------------------------------
function getICD9PriceMap_() {
  ensureRevenueSheetsReady_();
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'icd9_price_map_v3'; // ✅ V16.3: bump เพราะเพิ่มฟิลด์ priceUC / ✅ bump v3: บังคับล้าง cache เก่าหลังแก้บั๊ก nameTh ไม่แสดง (type mismatch string/number)
  const cached   = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const data = ICD9_PRICE_SHEET().getDataRange().getValues();
  const byTreatmentValue = {};
  const all = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[1] && !row[2]) continue; // แถวว่าง
    const price = Number(row[5]) || 0;
    // ✅ V16.3: priceUC = ราคา สปสช./บัตรทอง 30 (คอลัมน์ที่ 9 ใน sheet, index 8)
    //    ถ้ายังว่าง (สมุดข้อมูลเก่ายังไม่ reseed) ให้ fallback เป็นราคามาตรฐาน
    const priceUCRaw = row[8];
    const priceUC = (priceUCRaw === '' || priceUCRaw === null || priceUCRaw === undefined)
      ? price : (Number(priceUCRaw) || 0);
    const item = {
      no: row[0], nameEn: row[1], nameTh: row[2],
      claimCode: (row[3] || '').toString(), icd9: normIcd9_(row[4]),
      price: price, treatmentValue: (row[6] || '').toString(),
      note: row[7] || '', priceUC: priceUC
    };
    all.push(item);
    if (item.treatmentValue) byTreatmentValue[item.treatmentValue] = item;
  }
  const result = { byTreatmentValue, all };
  cache.put(cacheKey, JSON.stringify(result), 600);
  return result;
}

function clearRevenueCache() {
  const cache = CacheService.getScriptCache();
  cache.removeAll(['icd9_price_map_v1', 'icd9_price_map_v2']);
  // ล้าง cache รายเดือนของสรุปรายได้แบบกว้างๆ (best-effort)
  // ✅ FIX: ต้องตรงกับ cacheKey จริงที่ใช้ใน getRevenueSummary คือ
  //         `rev_summary_v2_${period}_${value}` เช่น 'rev_summary_v2_month_2026-05'
  //         ของเดิมสร้าง key ผิดรูปแบบ (ไม่มี period ต่อหน้า) ทำให้ไม่เคยลบได้จริง
  const today = new Date();
  const keys = [];
  for (let i = -2; i <= 1; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    keys.push('rev_summary_v2_month_' + ym);
    keys.push('rev_summary_v2_day_' + dateToStr(d)); // เผื่อ cache รายวันของวันที่ 1 เดือนนั้น
  }
  // ล้าง cache รายวันของวันนี้ (ใช้บ่อยสุดตอนแก้ booking/backfill)
  keys.push('rev_summary_v2_day_' + dateToStr(today));
  cache.removeAll(keys);
}

// -------------------------------------------------------------------
// แยก treatmentType string ("ES, HP, ติดตามการรักษา") ออกเป็น array
// รองรับทั้ง ', ' และ ',' และ trim ช่องว่าง
// -------------------------------------------------------------------
function splitTreatmentType_(raw) {
  if (!raw) return [];
  return raw.toString().split(',').map(s => s.trim()).filter(s => s);
}

// -------------------------------------------------------------------
// คำนวณรายได้ของ 1 booking จาก treatmentType string
// คืนค่า: { items: [{value, icd9, claimCode, price, matched}], total, isFlatRate, flatRateReason }
//
// ✅ NEW V16.1: รองรับ "เยี่ยมบ้าน" (appointmentType = Home/เยี่ยมบ้าน)
//    → ได้เงินจริงแบบเหมา HOME_VISIT_FLAT_RATE บาท/เคส เสมอ ไม่ว่าจะ
//      เลือกหัตถการกี่รายการในระบบจอง (รายการหัตถการยังถูกบันทึกไว้เพื่อ
//      ใช้เป็นข้อมูลคลินิก/สถิติ แต่ "total" ที่ใช้คิดรายได้จะถูก override
//      เป็นอัตราเหมาเสมอ ตามข้อมูลรายงานจริงที่ใช้เป็นต้นแบบ)
// -------------------------------------------------------------------
function calcBookingRevenue_(treatmentTypeRaw, priceMap, appointmentType, useUCPricing) {
  const values = splitTreatmentType_(treatmentTypeRaw);
  const items = [];
  let total = 0;
  const COLD_PACK_NAMES = ['Cold pack', 'cold pack', 'Cold Pack'];
  values.forEach(v => {
    // ✅ Cold pack — ไม่มีอุปกรณ์ในสถานบริการ ข้ามทุกกรณี
    if (COLD_PACK_NAMES.includes(v)) return;
    // ✅ V15.1: IMC — ไม่คิดตามราคาหัตถการ แต่จะคิด flat rate ภายหลัง
    // บันทึก item ไว้เพื่อแสดงในรายการ แต่ price = 0 (ยอดจริงจาก IMC_OPD_FLAT_RATE)
    if (v === 'IMC' || v.startsWith('IMC')) {
      items.push({ value: v, icd9: '9339', claimCode: '56002', price: 0, nameTh: 'IMC (เหมาจ่าย)', matched: true, isIMC: true });
      return;
    }
    const found = priceMap.byTreatmentValue[v];
    if (found) {
      // ✅ V16.3: ถ้าเป็นสิทธิ สปสช./บัตรทอง 30 (useUCPricing) ใช้ราคาตามตารางลายมือ (priceUC)
      //    แทนราคามาตรฐาน (price) — fallback เป็น price ถ้าไม่มีข้อมูล priceUC
      const usePrice = useUCPricing ? (found.priceUC != null ? found.priceUC : found.price) : found.price;
      items.push({
        value: v, icd9: found.icd9, claimCode: found.claimCode,
        price: usePrice, nameTh: found.nameTh || found.nameEn, matched: true
      });
      total += usePrice;
    } else {
      items.push({ value: v, icd9: '', claimCode: '', price: 0, nameTh: '', matched: false });
    }
  });

  // ✅ เยี่ยมบ้าน — เหมาจ่าย HOME_VISIT_FLAT_RATE เสมอ (ไม่ว่าจะมี IMC หรือไม่)
  if (isHomeVisitAppt_(appointmentType)) {
    return { items, total: HOME_VISIT_FLAT_RATE, isFlatRate: true, flatRateReason: 'เยี่ยมบ้าน (เหมาจ่ายรายเคส)', rawItemsTotal: total, isHome: true };
  }
  // ✅ V15.1: OPD ที่มี IMC — เหมาจ่าย IMC_OPD_FLAT_RATE (450 บ./ครั้ง) ไม่นับหัตถการอื่น
  const imcInItems = items.some(it => it.isIMC);
  if (imcInItems) {
    return { items, total: IMC_OPD_FLAT_RATE, isFlatRate: true, flatRateReason: 'IMC (เหมาจ่าย 450 บ./ครั้ง)', rawItemsTotal: total, isIMC: true };
  }
  return { items, total, isFlatRate: false, flatRateReason: '', rawItemsTotal: total };
}

// -------------------------------------------------------------------
// ✅ NEW V16.1 — จัดประเภทการรับรู้รายได้ตาม "สิทธิการรักษา"
// คืนค่า: { recognized: boolean, bucket: 'realized'|'pending', label }
//   realized = เงินที่หน่วยบริการได้รับ/เบิกได้จริง ณ ปัจจุบัน
//              (ข้าราชการ, ประกันสังคม, อสม., ผู้พิการ, ชำระเงินเอง, อื่นๆ)
//   pending  = สิทธิเหมาจ่ายรายหัว ที่ สปสช. สรุปและโอนให้ปลายปีงบ
//              (บัตรทอง/UC, ผู้สูงอายุ ตาม CAPITATION_PENDING_RIGHTS)
// หมายเหตุ: ใช้ "สิทธิ" ของผู้ป่วย (Bookings.rights) เป็นตัวตัดสิน ไม่ใช่ราคา
//           หัตถการ — ราคาที่คำนวณได้ยังคงเหมือนเดิมเพื่อใช้อ้างอิง/เบิกจ่าย
//           แต่จะถูกแยกกล่อง "รับจริง" vs "รอเฉลี่ยรายหัว" ในรายงานสรุป
// -------------------------------------------------------------------
function classifyRevenueRecognition_(rights) {
  const pending = isCapitationPendingRights_(rights);
  return {
    recognized: !pending,
    bucket: pending ? 'pending' : 'realized',
    label: pending ? 'รอเฉลี่ยรายหัว (ปลายปีงบ)' : 'รับจริง'
  };
}

// ===================================================================
// หน้าสรุปรายได้ประจำวันและการลงบัญชี (Revenue Dashboard)
// ===================================================================

// -------------------------------------------------------------------
// getDailyRevenueDetail(dateStr) — รายละเอียดทุก booking ในวันนั้น
// พร้อมรายได้แยกตามหัตถการ (อ่านจาก RevenueLog ถ้ามี ไม่งั้นคำนวณสด
// จาก Bookings.treatmentType)
// -------------------------------------------------------------------
function getDailyRevenueDetail(dateStr) {
  try {
    ensureRevenueSheetsReady_();
    const priceMap = getICD9PriceMap_();

    // 1) โหลด RevenueLog ของวันนั้น (ถ้ามีการ backfill/บันทึกไว้แล้ว)
    const logData = REVENUE_LOG_SHEET().getDataRange().getValues();
    const logByBooking = {}; // bookingId -> [rows...]
    for (let i = 1; i < logData.length; i++) {
      const row = logData[i];
      const ds = row[2] instanceof Date ? dateToStr(row[2]) : (row[2] || '').toString();
      if (ds !== dateStr) continue;
      const bid = row[1];
      if (!logByBooking[bid]) logByBooking[bid] = [];
      logByBooking[bid].push({
        logId: row[0], bookingId: row[1], date: ds, hn: row[3], name: row[4],
        rights: row[5], therapistId: row[6], treatmentValue: row[7],
        icd9: normIcd9_(row[8]), claimCode: (row[9] || '').toString(), price: Number(row[10]) || 0,
        source: row[11], note: row[12], rowIndex: i + 1
      });
    }

    // 2) โหลด Bookings ของวันนั้น
    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    const bookings = [];
    for (let i = 1; i < bData.length; i++) {
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds = dateToStr(bd);
      if (ds !== dateStr) continue;
      const hn = normalizeHN(bData[i][6]);
      if (hn === 'BLOCK') continue;

      const bid = bData[i][1];
      const treatmentTypeRaw = bData[i][10] || '';
      const apptType = bData[i][12] || 'OPD';
      const rights   = normalizeRights_(bData[i][9]);
      let items, total, source, isFlatRate = false, flatRateReason = '';

      if (logByBooking[bid] && logByBooking[bid].length) {
        // ใช้ข้อมูลจาก RevenueLog (แก้ไขแล้ว หรือ backfill แล้ว)
        items = logByBooking[bid].map(r => ({
          value: r.treatmentValue, icd9: r.icd9, claimCode: r.claimCode,
          price: r.price, nameTh: '', matched: true, logId: r.logId
        }));
        total = items.reduce((s, it) => s + it.price, 0);
        source = 'log';
        // ✅ เยี่ยมบ้าน: แม้ RevenueLog จะถูก backfill ด้วยราคาหัตถการแยกชิ้นไว้
        //    (เพื่อใช้เป็นข้อมูลคลินิก) แต่ยอดที่ใช้คิด "รายได้รับจริง" ของเคส
        //    เยี่ยมบ้านต้องเป็นอัตราเหมาเสมอ ตามข้อเท็จจริงของระบบเบิกจ่าย
        //    ข้อยกเว้น: ถ้าผู้ใช้แก้ไขรายการเองแล้ว (source='manual') ให้เคารพ
        //    การแก้ไขนั้น ไม่บังคับทับด้วยอัตราเหมา
        const hasManualEdit = logByBooking[bid].some(r => r.source === 'manual');
        if (isHomeVisitAppt_(apptType) && !hasManualEdit) {
          total = HOME_VISIT_FLAT_RATE;
          isFlatRate = true;
          flatRateReason = 'เยี่ยมบ้าน (เหมาจ่ายรายเคส)';
        }
      } else {
        // คำนวณสดจาก treatmentType (ยังไม่บันทึกลง RevenueLog)
        const calc = calcBookingRevenue_(treatmentTypeRaw, priceMap, apptType);
        items = calc.items;
        total = calc.total;
        isFlatRate = calc.isFlatRate;
        flatRateReason = calc.flatRateReason;
        source = 'live';
      }

      const recognition = classifyRevenueRecognition_(rights);

      bookings.push({
        bookingId: bid,
        time: timeValueToStr(bData[i][3]),
        therapistId: bData[i][4],
        therapistName: getTherapistNameById(bData[i][4]),
        hn, name: bData[i][7], rights,
        appointmentType: apptType,
        treatmentTypeRaw, items, total, source,
        isFlatRate, flatRateReason,
        recognized: recognition.recognized,
        revenueBucket: recognition.bucket,
        revenueBucketLabel: recognition.label
      });
    }

    bookings.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const grandTotal = bookings.reduce((s, b) => s + b.total, 0);
    // ✅ NEW V16.1: แยกยอด "รับจริง" vs "รอเฉลี่ยรายหัว (ปลายปีงบ)"
    const realizedTotal = bookings.filter(b => b.recognized).reduce((s, b) => s + b.total, 0);
    const pendingTotal  = bookings.filter(b => !b.recognized).reduce((s, b) => s + b.total, 0);
    const unmatchedItems = [];
    bookings.forEach(b => b.items.forEach(it => {
      if (!it.matched) unmatchedItems.push({ bookingId: b.bookingId, name: b.name, value: it.value });
    }));

    return { success: true, date: dateStr, bookings, grandTotal, realizedTotal, pendingTotal, unmatchedItems };
  } catch (e) {
    Logger.log('getDailyRevenueDetail ERROR: ' + e.message);
    return { success: false, message: e.message, bookings: [], grandTotal: 0, realizedTotal: 0, pendingTotal: 0 };
  }
}

// -------------------------------------------------------------------
// getRevenueSummary(period, value, filterRights?) — วิเคราะห์แบบ วัน/เดือน/ไตรมาส/ปีงบประมาณ
//   period      : 'day' | 'month' | 'quarter' | 'fiscalYear'
//   value       : 'yyyy-MM-dd' | 'yyyy-MM' | 'yyyy-Q1'..'Q4' | fiscal year (พ.ศ.)
//   filterRights: [] = ทุกสิทธิ, ['ข้าราชการ','ประกันสังคม',...] = เฉพาะสิทธิที่ระบุ
// -------------------------------------------------------------------
function getRevenueSummary(period, value, filterRights) {
  try {
    ensureRevenueSheetsReady_();
    const range = getDateRangeForPeriod_(period, value);
    if (!range) return { success: false, message: 'ช่วงเวลาไม่ถูกต้อง' };

    const rightsFilter = Array.isArray(filterRights) && filterRights.length ? filterRights : null;
    const cacheKey = `rev_summary_v7_${period}_${value}` + (rightsFilter ? '_' + rightsFilter.join(',') : ''); // ✅ bump v7: บังคับล้าง cache เก่าหลังแก้บั๊ก nameTh ไม่แสดง
    const cache    = CacheService.getScriptCache();
    const cached   = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const priceMap = getICD9PriceMap_();
    const logData  = REVENUE_LOG_SHEET().getDataRange().getValues();
    const logByBooking = {};
    for (let i = 1; i < logData.length; i++) {
      const row = logData[i];
      const ds  = row[2] instanceof Date ? dateToStr(row[2]) : (row[2] || '').toString();
      if (ds < range.start || ds > range.end) continue;
      const bid = row[1];
      if (!logByBooking[bid]) logByBooking[bid] = [];
      logByBooking[bid].push({ treatmentValue: row[7], icd9: normIcd9_(row[8]), price: Number(row[10]) || 0, source: row[11] });
    }

    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    // ✅ NEW V16.1: แยก "รายได้รวม (ตามมูลค่าหัตถการที่เบิกได้)" ออกจาก
    //    "รายได้รับจริง" (realizedRevenue) และ "รอเฉลี่ยรายหัว" (pendingRevenue)
    let totalRevenue = 0, realizedRevenue = 0, pendingRevenue = 0, totalVisits = 0;
    let homeVisitCount = 0, homeVisitRevenue = 0;
    const byDay = {};            // ds -> { realized, pending }
    const byICD9 = {};           // icd9 -> { count, revenue, nameTh } (อ้างอิงมูลค่าหัตถการ ไม่ใช่ยอดรับจริง)
    const byRights = {};         // rights -> { revenue, bucket, label, count }

    for (let i = 1; i < bData.length; i++) {
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds = dateToStr(bd);
      if (ds < range.start || ds > range.end) continue;
      const hn = normalizeHN(bData[i][6]);
      if (hn === 'BLOCK') continue;

      const bid      = bData[i][1];
      const rights   = normalizeRights_(bData[i][9]);
      const apptType = bData[i][12] || 'OPD';
      const isHome   = isHomeVisitAppt_(apptType);

      // ✅ นับเยี่ยมบ้านแยก — ไม่ขึ้นกับ rights filter
      // (เยี่ยมบ้านเป็นตัวชี้วัดภาระงานแยกจากรายได้ตามสิทธิ)
      if (isHome) {
        const hasManualEditHome = (logByBooking[bid] || []).some(it => it.source === 'manual');
        const homeTotal = hasManualEditHome
          ? (logByBooking[bid] || []).reduce((s, it) => s + it.price, 0)
          : HOME_VISIT_FLAT_RATE;
        homeVisitCount++;
        homeVisitRevenue += homeTotal;
      }

      // ✅ กรองเฉพาะสิทธิที่ต้องการ (ถ้า filterRights ระบุ) — สำหรับ revenue/ICD9
      if (rightsFilter && !rightsFilter.includes(rights)) continue;
      let items;
      if (logByBooking[bid] && logByBooking[bid].length) {
        items = logByBooking[bid];
      } else {
        items = calcBookingRevenue_(bData[i][10] || '', priceMap, apptType).items
          .filter(it => it.matched);
      }
      if (!items.length && !isHome) continue;

      totalVisits++;

      // มูลค่าหัตถการ (ใช้แสดงในตาราง "รายได้แยกตามหัตถการ")
      // ✅ กรอง Cold pack ออก — ไม่มีอุปกรณ์ในสถานบริการนี้
      const EXCLUDED_TREATMENTS = ['Cold pack', 'cold pack', 'Cold Pack'];
      items.filter(it => !EXCLUDED_TREATMENTS.includes(it.value)).forEach(it => {
        const icdKey = it.icd9 || 'ไม่ระบุ';
        if (!byICD9[icdKey]) {
          const master = priceMap.all.find(m => m.icd9 === it.icd9);
          byICD9[icdKey] = { icd9: icdKey, nameTh: master ? master.nameTh || master.nameEn : '', count: 0, revenue: 0 };
        }
        byICD9[icdKey].count++;
        byICD9[icdKey].revenue += it.price;
      });

      // ✅ ยอดที่ใช้คิด "รายได้" ของ booking นี้ (หลังกรองสิทธิแล้ว):
      const hasManualEdit = (logByBooking[bid] || []).some(it => it.source === 'manual');
      let bookingTotal;
      if (isHome && !hasManualEdit) {
        bookingTotal = HOME_VISIT_FLAT_RATE;
      } else if (!isHome && !hasManualEdit && hasIMCTag_(bData[i][10] || '')) {
        // ✅ V15.1: IMC OPD — เหมาจ่าย 450 บ./ครั้ง ไม่นับตามหัตถการ
        bookingTotal = IMC_OPD_FLAT_RATE;
      } else {
        bookingTotal = items.reduce((s, it) => s + it.price, 0);
      }

      const recognition = classifyRevenueRecognition_(rights);
      totalRevenue += bookingTotal;
      if (recognition.recognized) {
        realizedRevenue += bookingTotal;
      } else {
        pendingRevenue += bookingTotal;
      }

      if (!byDay[ds]) byDay[ds] = { realized: 0, pending: 0 };
      if (recognition.recognized) byDay[ds].realized += bookingTotal;
      else byDay[ds].pending += bookingTotal;

      if (!byRights[rights]) {
        byRights[rights] = { revenue: 0, count: 0, bucket: recognition.bucket, label: recognition.label };
      }
      byRights[rights].revenue += bookingTotal;
      byRights[rights].count++;
    }

    const result = {
      success: true, period, value, range,
      filterRights: rightsFilter || [],
      totalRevenue, totalVisits,
      realizedRevenue, pendingRevenue,
      homeVisitCount, homeVisitRevenue,
      avgPerVisit: totalVisits ? parseFloat((totalRevenue / totalVisits).toFixed(2)) : 0,
      byDay: Object.entries(byDay).sort((a,b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({ date, revenue: v.realized + v.pending, realized: v.realized, pending: v.pending })),
      byICD9: Object.values(byICD9).sort((a,b) => b.revenue - a.revenue),
      byRights: Object.entries(byRights).sort((a,b) => b[1].revenue - a[1].revenue)
        .map(([rights, v]) => ({ rights, revenue: v.revenue, count: v.count, bucket: v.bucket, label: v.label }))
    };
    cache.put(cacheKey, JSON.stringify(result), 900);
    return result;
  } catch (e) {
    Logger.log('getRevenueSummary ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// -------------------------------------------------------------------
// แปลง period/value เป็นช่วงวันที่ start/end (string 'yyyy-MM-dd')
// ปีงบประมาณไทย: ต.ค. ปีก่อนหน้า (พ.ศ.) ถึง ก.ย. ปีนั้น
// -------------------------------------------------------------------
function getDateRangeForPeriod_(period, value) {
  if (period === 'day') {
    return { start: value, end: value };
  }
  if (period === 'month') {
    const [y, m] = value.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2,'0')}-01`;
    const end   = dateToStr(new Date(y, m, 0));
    return { start, end };
  }
  if (period === 'week') {
    // ✅ ใช้โดยสรุปรายสัปดาห์ผ่าน LINE — value = วันจันทร์ของสัปดาห์นั้น (YYYY-MM-DD)
    // คลินิกเปิดเฉพาะวันจันทร์-ศุกร์ จึงตัดจบที่ศุกร์ (ไม่รวมเสาร์-อาทิตย์)
    const monday = new Date(value + 'T00:00:00');
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    return { start: value, end: dateToStr(friday) };
  }
  if (period === 'quarter') {
    // value เช่น '2026-Q1' (ไตรมาสปฏิทิน) — Q1=1-3, Q2=4-6, Q3=7-9, Q4=10-12
    const [yStr, qStr] = value.split('-Q');
    const y = Number(yStr), q = Number(qStr);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth   = startMonth + 2;
    const start = `${y}-${String(startMonth).padStart(2,'0')}-01`;
    const end   = dateToStr(new Date(y, endMonth, 0));
    return { start, end };
  }
  if (period === 'fiscalYear') {
    // value = ปีงบประมาณ พ.ศ. เช่น 2569 หมายถึง ต.ค. 2568 (ค.ศ. 2025) - ก.ย. 2569 (ค.ศ. 2026)
    const fiscalBE = Number(value);
    const fiscalCE = fiscalBE - 543;
    const start = `${fiscalCE - 1}-10-01`;
    const end   = `${fiscalCE}-09-30`;
    return { start, end };
  }
  return null;
}

// -------------------------------------------------------------------
// แก้ไขรายการหัตถการ/ราคาของ booking หนึ่งรายการ (จากหน้า Revenue Dashboard)
// d = { bookingId, date, hn, name, rights, therapistId, items: [{value, icd9, claimCode, price}] }
// บันทึกลง RevenueLog: ลบของเก่าทั้งหมดของ bookingId นี้ในวันนั้นก่อน แล้วเขียนใหม่
// -------------------------------------------------------------------
function updateBookingRevenue(d) {
  try {
    ensureRevenueSheetsReady_();
    if (!d || !d.bookingId) return { success: false, message: 'ไม่พบ bookingId' };

    const sheet = REVENUE_LOG_SHEET();
    const data  = sheet.getDataRange().getValues();
    const rowsToDelete = [];
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][1] === d.bookingId) rowsToDelete.push(i + 1);
    }
    rowsToDelete.forEach(r => sheet.deleteRow(r));

    const now = new Date();
    const newRows = (d.items || []).map(it => [
      Utilities.getUuid(), d.bookingId, d.date, d.hn, d.name, d.rights,
      d.therapistId || '', it.value || '', it.icd9 || '', it.claimCode || '',
      Number(it.price) || 0, 'manual', d.note || '', now, now
    ]);
    if (newRows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    }
    clearRevenueCache();
    return { success: true, message: 'บันทึกรายการรายได้สำเร็จ', total: newRows.reduce((s,r)=>s+r[10],0) };
  } catch (e) {
    Logger.log('updateBookingRevenue ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// -------------------------------------------------------------------
// ดึง master list ICD9/ราคา ทั้งหมด (สำหรับ dropdown แก้ไขรายการในหน้า UI)
// -------------------------------------------------------------------
function getICD9MasterList() {
  ensureRevenueSheetsReady_();
  return getICD9PriceMap_().all;
}

// -------------------------------------------------------------------
// บันทึก/แก้ไข 1 แถวใน ICD9Price master (สำหรับหน้า settings แก้ราคา)
// d = { no, nameEn, nameTh, claimCode, icd9, price, treatmentValue, note }
// -------------------------------------------------------------------
function saveICD9PriceItem(d) {
  try {
    ensureRevenueSheetsReady_();
    const sheet = ICD9_PRICE_SHEET();
    const data  = sheet.getDataRange().getValues();
    let targetRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (Number(data[i][0]) === Number(d.no)) { targetRow = i + 1; break; }
    }
    const rowValues = [
      d.no, d.nameEn || '', d.nameTh || '', d.claimCode || '',
      d.icd9 || '', Number(d.price) || 0, d.treatmentValue || '', d.note || '', new Date()
    ];
    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, rowValues.length).setValues([rowValues]);
    }
    clearRevenueCache();
    return { success: true, message: 'บันทึกราคา/ICD9 สำเร็จ' };
  } catch (e) {
    Logger.log('saveICD9PriceItem ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ===================================================================
// BACKFILL — จัดการข้อมูลย้อนหลังที่ไม่มีราคา (มีแต่ treatmentType/ICD9 text)
// แนวทาง: preview ก่อนยืนยันเสมอ (ไม่เขียนทับข้อมูลโดยไม่ผ่าน user)
// ===================================================================

// -------------------------------------------------------------------
// previewBackfillRevenue(startDate, endDate)
// คำนวณรายได้ย้อนหลังจาก Bookings.treatmentType ในช่วงวันที่ระบุ
// "โดยไม่เขียนข้อมูลใดๆ" — ใช้ดู preview ก่อนกดยืนยัน
// คืนค่ารายการสรุป + รายละเอียดราย booking + รายการที่ map ไม่ได้ (unmatched)
// -------------------------------------------------------------------
function previewBackfillRevenue(startDate, endDate) {
  try {
    ensureRevenueSheetsReady_();
    const priceMap = getICD9PriceMap_();

    // เช็คว่า booking ไหนมี RevenueLog อยู่แล้ว (จะไม่ทับโดยไม่ระบุ)
    const logData = REVENUE_LOG_SHEET().getDataRange().getValues();
    const existingBookingIds = new Set();
    for (let i = 1; i < logData.length; i++) existingBookingIds.add(logData[i][1]);

    const bData = BOOKINGS_SHEET().getDataRange().getValues();
    const preview = [];
    const unmatchedSet = {};
    let totalNew = 0, alreadyLogged = 0, skippedNoTreatment = 0;

    for (let i = 1; i < bData.length; i++) {
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds = dateToStr(bd);
      if (ds < startDate || ds > endDate) continue;
      const hn = normalizeHN(bData[i][6]);
      if (hn === 'BLOCK') continue;

      const bid = bData[i][1];
      const treatmentTypeRaw = bData[i][10] || '';
      const apptType = bData[i][12] || 'OPD';
      const isHome = isHomeVisitAppt_(apptType);

      if (existingBookingIds.has(bid)) { alreadyLogged++; continue; }
      // ✅ เคสเยี่ยมบ้านได้เงินเหมาเสมอ แม้ไม่มีหัตถการระบุ จึงไม่ข้าม
      if (!treatmentTypeRaw && !isHome) { skippedNoTreatment++; continue; }

      const calc = calcBookingRevenue_(treatmentTypeRaw, priceMap, apptType);
      calc.items.forEach(it => { if (!it.matched) unmatchedSet[it.value] = (unmatchedSet[it.value]||0)+1; });

      preview.push({
        bookingId: bid, date: ds, hn, name: bData[i][7], rights: normalizeRights_(bData[i][9]),
        therapistId: bData[i][4], treatmentTypeRaw, appointmentType: apptType,
        items: calc.items, total: calc.total, isFlatRate: calc.isFlatRate, flatRateReason: calc.flatRateReason
      });
      totalNew += calc.total;
    }

    preview.sort((a, b) => a.date.localeCompare(b.date));
    return {
      success: true, startDate, endDate,
      bookingCount: preview.length, totalRevenue: totalNew,
      alreadyLogged, skippedNoTreatment,
      unmatchedValues: Object.entries(unmatchedSet).map(([value, count]) => ({ value, count })),
      preview
    };
  } catch (e) {
    Logger.log('previewBackfillRevenue ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// -------------------------------------------------------------------
// confirmBackfillRevenue(startDate, endDate)
// เขียนผลลัพธ์จาก previewBackfillRevenue ลง RevenueLog จริง
// (เรียกหลัง user กดยืนยันบนหน้า preview เท่านั้น)
// จะข้าม booking ที่มี RevenueLog อยู่แล้วเสมอ (ไม่ทับข้อมูลเดิม)
// -------------------------------------------------------------------
function confirmBackfillRevenue(startDate, endDate) {
  try {
    ensureRevenueSheetsReady_();
    const previewResult = previewBackfillRevenue(startDate, endDate);
    if (!previewResult.success) return previewResult;

    const sheet = REVENUE_LOG_SHEET();
    const now = new Date();
    const newRows = [];
    previewResult.preview.forEach(b => {
      if (b.isFlatRate) {
        // ✅ เคสเยี่ยมบ้าน: บันทึกแถวเหมาจ่าย (คือยอดรายได้จริง) ก่อน
        newRows.push([
          Utilities.getUuid(), b.bookingId, b.date, b.hn, b.name, b.rights,
          b.therapistId || '', 'เยี่ยมบ้าน (เหมาจ่าย)', '', '',
          HOME_VISIT_FLAT_RATE, 'backfill', 'home_visit_flat_rate', now, now
        ]);
        // หัตถการที่ทำจริง บันทึกเป็นข้อมูลอ้างอิง price=0 ไม่ให้นับซ้ำ
        b.items.forEach(it => {
          if (!it.matched) return;
          newRows.push([
            Utilities.getUuid(), b.bookingId, b.date, b.hn, b.name, b.rights,
            b.therapistId || '', it.value, it.icd9, it.claimCode,
            0, 'backfill', 'home_visit_item_ref_only', now, now
          ]);
        });
        return;
      }
      b.items.forEach(it => {
        if (!it.matched) return; // ข้ามรายการที่ map ไม่ได้ (ต้องแก้มือทีหลัง)
        newRows.push([
          Utilities.getUuid(), b.bookingId, b.date, b.hn, b.name, b.rights,
          b.therapistId || '', it.value, it.icd9, it.claimCode,
          it.price, 'backfill', '', now, now
        ]);
      });
    });

    if (newRows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    }
    clearRevenueCache();

    return {
      success: true,
      message: `✅ Backfill สำเร็จ — บันทึก ${previewResult.bookingCount} booking (${newRows.length} รายการ) รวม ${previewResult.totalRevenue.toLocaleString()} บาท`,
      bookingCount: previewResult.bookingCount,
      lineCount: newRows.length,
      totalRevenue: previewResult.totalRevenue,
      unmatchedValues: previewResult.unmatchedValues
    };
  } catch (e) {
    Logger.log('confirmBackfillRevenue ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// -------------------------------------------------------------------
// auto-generate RevenueLog ทันทีที่มี booking ใหม่ (เรียกจาก submitBooking)
// เพื่อให้ข้อมูลใหม่ไม่ต้อง backfill ในอนาคต — best-effort, ไม่ throw error
//
// ✅ NEW V16.1: รับ appointmentType เพิ่ม — ถ้าเป็นเยี่ยมบ้าน (Home/เยี่ยมบ้าน)
//    จะบันทึกแถวพิเศษ 1 แถว มูลค่า HOME_VISIT_FLAT_RATE เสมอ (treatmentValue
//    = 'เยี่ยมบ้าน (เหมาจ่าย)') แม้ว่าหัตถการที่เลือกจะ map ราคาไม่ได้เลยก็ตาม
//    เพราะรายได้จริงของเคสเยี่ยมบ้านไม่ได้ขึ้นกับหัตถการ แต่เป็นอัตราเหมา
//    ส่วนรายการหัตถการที่ matched ยังถูกบันทึกแยกไว้ด้วย (price=0) เพื่อเก็บ
//    เป็นข้อมูลคลินิกว่าทำหัตถการอะไรไปบ้าง โดยไม่ถูกนับซ้ำเป็นรายได้
// -------------------------------------------------------------------
function autoLogBookingRevenue_(bookingId, dateObj, hn, name, rights, therapistId, treatmentTypeRaw, appointmentType) {
  try {
    ensureRevenueSheetsReady_();
    const isHome = isHomeVisitAppt_(appointmentType);
    if (!treatmentTypeRaw && !isHome) return;

    const priceMap = getICD9PriceMap_();
    const calc = calcBookingRevenue_(treatmentTypeRaw, priceMap, appointmentType);
    const sheet = REVENUE_LOG_SHEET();
    const now = new Date();
    const ds = dateToStr(dateObj);
    const rows = [];

    if (isHome) {
      // แถวเดียว = อัตราเหมาเยี่ยมบ้าน (คือ "รายได้" ที่ใช้คิดจริง)
      rows.push([
        Utilities.getUuid(), bookingId, ds, hn, name, rights, therapistId || '',
        'เยี่ยมบ้าน (เหมาจ่าย)', '', '', HOME_VISIT_FLAT_RATE, 'auto', 'home_visit_flat_rate', now, now
      ]);
      // หัตถการที่ทำจริง (ถ้ามี) บันทึกไว้เป็นข้อมูลอ้างอิง price=0 ไม่ให้ซ้ำกับอัตราเหมา
      calc.items.filter(it => it.matched).forEach(it => {
        rows.push([
          Utilities.getUuid(), bookingId, ds, hn, name, rights, therapistId || '',
          it.value, it.icd9, it.claimCode, 0, 'auto', 'home_visit_item_ref_only', now, now
        ]);
      });
    } else {
      const matchedItems = calc.items.filter(it => it.matched);
      if (!matchedItems.length) return;
      matchedItems.forEach(it => rows.push([
        Utilities.getUuid(), bookingId, ds, hn, name, rights, therapistId || '',
        it.value, it.icd9, it.claimCode, it.price, 'auto', '', now, now
      ]));
    }

    if (!rows.length) return;
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    clearRevenueCache();
  } catch (e) {
    Logger.log('autoLogBookingRevenue_ ERROR (non-fatal): ' + e.message);
  }
}

// -------------------------------------------------------------------
// exportRevenueAsExcel(period, value, filterRights?, includeSPSC?)
// รูปแบบ: รายงานรายได้กายภาพบำบัด แบ่ง 3 ส่วน
//   1) OPD + ฟื้นฟูทั่วไป (สิทธิกลุ่ม สปสช./บัตรทอง 30 — คิดตามอัตรา สปสช. รายหัตถการ)
//   2) สิทธิที่ต้องชำระเงิน (ข้าราชการ / ประกันสังคม — 200 บ./ครั้ง)
//   3) เยี่ยมบ้าน (Home Visit — เหมาจ่ายรายเคส)
//   IMC ดูแยกในระบบรัฐ — ไม่รวมในรายงานนี้
//   ✅ V16.3: includeSPSC (default true) — ติ๊กเลือกได้ว่าจะรวมสิทธิกลุ่ม สปสช./บัตรทอง 30
//      (ผู้สูงอายุ/บัตรทอง/อสม./ผู้พิการ/อื่นๆ/ไม่ระบุ) ในรายงานนี้หรือไม่ ถ้าไม่รวม
//      section OPD จะถูกข้าม (booking กลุ่มนี้จะไม่ถูกนับในรายงาน)
// -------------------------------------------------------------------
function exportRevenueAsExcel(period, value, filterRights, includeSPSC) {
  try {
    // ถ้าไม่ระบุ filterRights ให้ดึงทุกสิทธิ (ยกเว้น IMC ถูก exclude ใน calcBookingRevenue_ แล้ว)
    const includeSPSCFlag = includeSPSC === false ? false : true; // default = true
    const summary = getRevenueSummary(period, value, filterRights || []);
    if (!summary.success) return summary;

    const ss = getSpreadsheet();
    const monthLabel = value.length === 7
      ? (() => {
          const [y, m] = value.split('-');
          const thMonths = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                            'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
          const thYear = parseInt(y) + 543;
          return thMonths[parseInt(m)] + thYear;
        })()
      : value;

    const sheetName = ('รายได้_' + monthLabel).substring(0, 90);
    let sheet = ss.getSheetByName(sheetName);
    if (sheet) ss.deleteSheet(sheet);
    sheet = ss.insertSheet(sheetName);

    // ── แยก booking ตามกลุ่ม ──
    const bData    = BOOKINGS_SHEET().getDataRange().getValues();
    const priceMap = getICD9PriceMap_();
    const range    = summary.range;

    // รายการ OPD
    const rowsOPD     = [];  // สิทธิ UC (ผู้สูงอายุ บัตรทอง อสม. ผู้พิการ)
    const rowsPaid    = [];  // สิทธิชำระเงิน (ข้าราชการ ประกันสังคม ฯ)
    const rowsHome    = [];  // เยี่ยมบ้าน
    const rowsIMC     = [];  // ✅ V15.1: IMC OPD — เหมาจ่าย 450 บ./ครั้ง แยก section

    for (let i = 1; i < bData.length; i++) {
      const bd = parseFlexDate(bData[i][2]);
      if (!bd) continue;
      const ds = dateToStr(bd);
      if (ds < range.start || ds > range.end) continue;
      const hn = normalizeHN(bData[i][6]);
      if (hn === 'BLOCK') continue;

      const rights     = normalizeRights_(bData[i][9]);
      const apptType   = bData[i][12] || 'OPD';
      const isHome     = isHomeVisitAppt_(apptType);
      const treatRaw   = bData[i][10] || '';
      const isIMC      = !isHome && hasIMCTag_(treatRaw); // ✅ V15.1: IMC OPD เท่านั้น (ไม่ใช่เยี่ยมบ้าน)
      const isPaidRight = PAID_RIGHTS.some(pr => rights.includes(pr));
      // ✅ V16.3: สิทธิกลุ่ม สปสช./บัตรทอง 30 = ไม่ใช่เยี่ยมบ้าน ไม่ใช่ IMC และไม่ใช่สิทธิชำระเงิน
      const isSPSC     = !isHome && !isIMC && !isPaidRight;

      // ✅ ถ้าปิดตัวเลือก "รวมสิทธิ สปสช./บัตรทอง 30" ให้ข้าม booking กลุ่มนี้ไปเลย
      if (isSPSC && !includeSPSCFlag) continue;

      const name       = bData[i][7] || '';
      const time       = bData[i][3] || '';
      // ✅ V16.3: สิทธิกลุ่ม สปสช. คิดราคาตามตาราง priceUC (ลายมือ) แทนราคามาตรฐาน
      const calc       = calcBookingRevenue_(treatRaw, priceMap, apptType, isSPSC);
      const total      = calc.total;
      const treatments = splitTreatmentType_(treatRaw).join(', ');

      const row = [ds, time, hn, name, rights, treatments, total];

      if (isHome) {
        rowsHome.push(row);
      } else if (isIMC) {
        rowsIMC.push(row);  // ✅ V15.1: แยก IMC OPD ออกจาก OPD ปกติ
      } else if (isPaidRight) {
        rowsPaid.push(row);
      } else {
        rowsOPD.push(row);
      }
    }

    // ── เขียน Google Sheet ──
    const HDR_BG   = { title: '#1565C0', sec1: '#2E7D32', sec2: '#6A1B9A', sec3: '#E65100' };
    const COL_HDR  = ['วันที่','เวลา','HN','ชื่อ-สกุล','สิทธิ','ประเภทการรักษา','ยอด (บาท)'];
    let r = 1;

    // ── ชื่อรายงาน ──
    sheet.getRange(r, 1, 1, 7).merge()
      .setValue('รายงานรายได้กายภาพบำบัด — ' + monthLabel)
      .setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center')
      .setBackground(HDR_BG.title).setFontColor('#FFFFFF');
    sheet.setRowHeight(r, 28); r++;

    sheet.getRange(r, 1, 1, 7).merge()
      .setValue('ช่วงเวลา: ' + range.start + ' ถึง ' + range.end + '   |   สร้างโดย PT Station V16.3   |   หมายเหตุ: IMC ดูแยกในระบบรัฐ (ไม่รวมในรายงานนี้)'
        + (includeSPSCFlag ? '   |   รวมสิทธิ สปสช./บัตรทอง 30 (คิดตามอัตรา สปสช.)' : '   |   ⚠️ ไม่รวมสิทธิ สปสช./บัตรทอง 30 ในรายงานนี้'))
      .setFontSize(9).setFontStyle('italic').setHorizontalAlignment('center').setFontColor('#555');
    r += 2;

    // ── Helper: เขียนแต่ละ section ──
    function writeSection(label, rows, bgColor, rateNote) {
      // หัว section
      sheet.getRange(r, 1, 1, 7).merge()
        .setValue(label + (rateNote ? '  (' + rateNote + ')' : ''))
        .setFontSize(11).setFontWeight('bold').setBackground(bgColor).setFontColor('#FFFFFF')
        .setHorizontalAlignment('left');
      sheet.setRowHeight(r, 22); r++;

      // header col
      sheet.getRange(r, 1, 1, 7).setValues([COL_HDR])
        .setFontWeight('bold').setBackground(bgColor).setFontColor('#FFFFFF').setFontSize(10)
        .setHorizontalAlignment('center');
      sheet.setRowHeight(r, 18); r++;

      if (!rows.length) {
        sheet.getRange(r, 1, 1, 7).merge().setValue('ไม่มีข้อมูล')
          .setFontStyle('italic').setFontColor('#999').setHorizontalAlignment('center');
        r += 2; return 0;
      }

      // ข้อมูล
      let sectionTotal = 0;
      rows.forEach((row, idx) => {
        const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8F9FA';
        sheet.getRange(r, 1, 1, 7).setValues([row]).setBackground(bg)
          .setFontSize(10).setHorizontalAlignment('center');
        sheet.getRange(r, 4).setHorizontalAlignment('left'); // ชื่อ left
        sheet.getRange(r, 6).setHorizontalAlignment('left'); // treatment left
        sheet.getRange(r, 7).setNumberFormat('#,##0').setFontWeight('bold');
        sectionTotal += Number(row[6]) || 0;
        sheet.setRowHeight(r, 17); r++;
      });

      // รวม section
      sheet.getRange(r, 1, 1, 6).merge().setValue('รวม ' + label + ' (' + rows.length + ' ครั้ง)')
        .setFontWeight('bold').setBackground(bgColor + '33').setHorizontalAlignment('right');
      sheet.getRange(r, 7).setValue(sectionTotal).setFontWeight('bold').setFontSize(11)
        .setNumberFormat('#,##0').setBackground(bgColor + '33');
      sheet.setRowHeight(r, 20); r += 2;
      return sectionTotal;
    }

    const totalOPD  = includeSPSCFlag
      ? writeSection('OPD + ฟื้นฟูทั่วไป (สิทธิ สปสช./บัตรทอง 30)', rowsOPD, HDR_BG.sec1, 'ตามอัตรา สปสช. รายหัตถการ')
      : 0;
    const totalPaid = writeSection('สิทธิชำระเงิน (ข้าราชการ / ประกันสังคม)', rowsPaid, HDR_BG.sec2, '200 บ./ครั้ง');
    // ✅ V15.1: IMC OPD — เหมาจ่าย 450 บ./ครั้ง แยก section
    const totalIMC  = writeSection('IMC (Intermittent Compression) OPD', rowsIMC, '#00838F', IMC_OPD_FLAT_RATE + ' บ./ครั้ง');
    const totalHome = writeSection('เยี่ยมบ้าน (Home Visit)', rowsHome, HDR_BG.sec3, HOME_VISIT_FLAT_RATE + ' บ./เคส');

    // ── สรุปรวมทั้งหมด ──
    const grandTotal = totalOPD + totalPaid + totalIMC + totalHome;
    sheet.getRange(r, 1, 1, 6).merge()
      .setValue('รวมรายได้ทั้งหมด (' + (rowsOPD.length + rowsPaid.length + rowsIMC.length + rowsHome.length) + ' ครั้ง/เคส)')
      .setFontWeight('bold').setFontSize(12).setBackground('#212121').setFontColor('#FFFFFF')
      .setHorizontalAlignment('right');
    sheet.getRange(r, 7).setValue(grandTotal).setFontWeight('bold').setFontSize(12)
      .setNumberFormat('#,##0').setBackground('#212121').setFontColor('#FFEB3B');
    sheet.setRowHeight(r, 26); r++;

    sheet.getRange(r, 1, 1, 7).merge()
      .setValue('📌 หมายเหตุ: IMC = เหมาจ่าย ' + IMC_OPD_FLAT_RATE + ' บ./ครั้ง | เยี่ยมบ้าน = เหมาจ่าย ' + HOME_VISIT_FLAT_RATE + ' บ./เคส (ไม่นับตามหัตถการ)')
      .setFontStyle('italic').setFontColor('#555').setFontSize(9);
    r++;

    // ── ปรับ column width ──
    sheet.setColumnWidth(1, 90);  // วันที่
    sheet.setColumnWidth(2, 55);  // เวลา
    sheet.setColumnWidth(3, 70);  // HN
    sheet.setColumnWidth(4, 130); // ชื่อ
    sheet.setColumnWidth(5, 90);  // สิทธิ
    sheet.setColumnWidth(6, 200); // ประเภทการรักษา
    sheet.setColumnWidth(7, 85);  // ยอด

    sheet.setFrozenRows(3);

    // ── flush ก่อน export ──
    SpreadsheetApp.flush();
    Utilities.sleep(1500);

    // ── สร้าง download link จาก sheet ในไฟล์เดิม ──
    const ssId  = ss.getId();
    const shId  = sheet.getSheetId();
    const exportUrl = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export'
      + '?format=xlsx'
      + '&gid=' + shId;
    const oauthToken = ScriptApp.getOAuthToken();
    const resp = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: 'Bearer ' + oauthToken },
      muteHttpExceptions: true
    });

    let downloadUrl = '';
    if (resp.getResponseCode() === 200) {
      const blob = resp.getBlob()
        .setName('รายงานรายได้_' + monthLabel + '.xlsx')
        .setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const xlsxFile = DriveApp.createFile(blob);
      xlsxFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      downloadUrl = xlsxFile.getDownloadUrl();
    }

    return {
      success: true,
      downloadUrl: downloadUrl,
      sheetName: sheetName,
      grandTotal: grandTotal,
      includeSPSC: includeSPSCFlag,
      breakdown: { opd: totalOPD, paid: totalPaid, imc: totalIMC, home: totalHome },
      message: 'รวม ' + grandTotal.toLocaleString() + ' บาท | ' + (includeSPSCFlag ? ('สปสช./บัตรทอง 30 ' + totalOPD.toLocaleString()) : 'ไม่รวม สปสช./บัตรทอง 30') + ' | ชำระเงิน ' + totalPaid.toLocaleString() + ' | IMC ' + totalIMC.toLocaleString() + ' | บ้าน ' + totalHome.toLocaleString()
    };
  } catch (e) {
    Logger.log('exportRevenueAsExcel ERROR: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// ✅ V16.4: โมดูล "เยี่ยมบ้าน GPS/GIS Real-time" — ผนวกเข้าระบบหลัก PT Station
//   ดัดแปลงจากโปรเจกต์ HomeVisit เดิม (เคยเป็น Web App แยกต่างหาก) ให้ใช้
//   Spreadsheet เดียวกับระบบหลัก (getSpreadsheet()) และเรียกผ่าน google.script.run
//   แทนการ fetch ไป WEB_APP_URL แยก — เพื่อให้ฐานข้อมูลรวมศูนย์เดียวกันทั้งระบบ
//   ✅ เชื่อมโยงกับข้อมูลผู้ป่วยเดิม (Patients: HN/Name/Phone/Rights) ผ่าน hn
//      เวลาลงทะเบียนบ้านเยี่ยม — ลดการกรอกข้อมูลซ้ำซ้อน ต่อยอดฐานข้อมูลเดิม
// ═══════════════════════════════════════════════════════════════════

const HV_MAX_DISTANCE_M    = 150;  // ระยะเตือนหากพิกัดเช็คอินห่างจากบ้านที่ลงทะเบียน (เมตร)
// จุดฐาน (รพ.สต.บางขะแยง) — ใช้คำนวณระยะทาง/เวลาโดยประมาณของแต่ละบ้าน และปักหมุดแสดงบนแผนที่เสมอ
// โดยไม่ต้องพึ่งการลงทะเบียนในชีต HVFacilities (กันลืมตั้งค่า)
const HV_HOME_BASE = { name: 'รพ.สต.บางขะแยง', address: 'ถ.ปทุมธานี-สายนอก ต.บางขะแยง อ.เมืองปทุมธานี จ.ปทุมธานี 12000', lat: 13.956069390827691, lng: 100.52610589069728 };
const HV_AVG_SPEED_KMH = 30; // ความเร็วเฉลี่ยโดยประมาณสำหรับคำนวณเวลาเดินทาง (ถนนในพื้นที่/ผสมมอเตอร์ไซค์-รถยนต์)
const HV_PHOTO_FOLDER_NAME = 'รูปภาพเยี่ยมบ้าน (PT Station Home Visit)';

function HV_HOUSES_SHEET()     { return getSheet('HVHouses'); }
function HV_STAFF_SHEET()      { return getSheet('HVStaff'); }
function HV_VISITLOG_SHEET()   { return getSheet('HVVisitLog'); }
function HV_PHOTOS_SHEET()     { return getSheet('HVPhotos'); }
function HV_FACILITIES_SHEET() { return getSheet('HVFacilities'); }

// คอลัมน์ (1-based) — ให้ตรงกับ header ที่ประกาศใน REQUIRED_SHEETS ของ manageSheets()
const HV_COL_HOUSE = { TS:1, ID:2, HN:3, NAME:4, ADDRESS:5, CATEGORY:6, LAT:7, LNG:8,
                        PHONE:9, STATUS:10, LAST_VISIT:11, LAST_STAFF:12, QR:13, NOTE:14,
                        QR_IMG_URL:15, QR_IMG_CELL:16 }; // ✅ ใหม่ — เก็บลิงก์รูป QR ถาวร (Drive) + แสดงรูปจริงในเซลล์ของชีต
const HV_COL_STAFF = { TS:1, ID:2, NAME:3, POSITION:4, PHONE:5, STATUS:6, LAT:7, LNG:8,
                        LOC_UPDATED:9, TODAY_COUNT:10 };
const HV_COL_VISIT = { TS:1, ID:2, STAFF_ID:3, STAFF_NAME:4, HOUSE_ID:5, HOUSE_NAME:6, HN:7,
                        LAT:8, LNG:9, DISTANCE:10, NOTE:11 };
const HV_COL_PHOTO = { TS:1, ID:2, HOUSE_ID:3, HOUSE_NAME:4, STAFF_ID:5, STAFF_NAME:6,
                        VISIT_ID:7, TYPE:8, URL:9, FILE_ID:10 };
const HV_COL_FACILITY = { TS:1, ID:2, NAME:3, TYPE:4, ADDRESS:5, LAT:6, LNG:7, PHONE:8, DETAIL:9 };

function hvNow_() { return Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm:ss'); }
function hvQrUrlFor_(text) { return 'https://quickchart.io/qr?text=' + encodeURIComponent(text) + '&size=300&margin=2&ecLevel=M'; }

// ── ✅ ใหม่ — บันทึกรูป QR เป็นไฟล์ถาวรใน Google Drive (กัน QR หายเวลาเน็ตล่ม/quickchart.io ล่ม หรือทำกระดาษ QR หาย
//    ต้องการค้นย้อนหลังทีหลัง) — เก็บไว้ในโฟลเดอร์เดียวกับรูปเยี่ยมบ้าน แยกโฟลเดอร์ย่อยชัดเจน
const HV_QR_FOLDER_NAME = 'QR Code เยี่ยมบ้าน (PT Station Home Visit)';

function hvGetQrFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('HV_QR_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) { /* fall through — โฟลเดอร์เดิมอาจถูกลบ สร้างใหม่ */ }
  }
  const it = DriveApp.getFoldersByName(HV_QR_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(HV_QR_FOLDER_NAME);
  props.setProperty('HV_QR_FOLDER_ID', folder.getId());
  return folder;
}

// คืนค่า { fileId, viewUrl, thumbUrl } หรือ null ถ้าบันทึกไม่สำเร็จ (ไม่ throw — ไม่ให้การลงทะเบียนบ้าน/เจ้าหน้าที่ล้มเหลวเพราะเรื่องนี้)
function hvSaveQrImage_(qrText, idHint) {
  try {
    const resp = UrlFetchApp.fetch(hvQrUrlFor_(qrText), { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    const blob = resp.getBlob().setName('QR_' + String(idHint || qrText).replace(/[^A-Za-z0-9\-_]/g, '_') + '_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmmss') + '.png');
    const file = hvGetQrFolder_().createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shareErr) { /* ตามนโยบายองค์กร — ยังใช้งานได้ภายในองค์กรเดียวกัน */ }
    const fileId = file.getId();
    return {
      fileId: fileId,
      viewUrl: 'https://drive.google.com/uc?export=view&id=' + fileId,   // ใช้แสดงใน <img> ของหน้าเว็บแอป
      thumbUrl: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400' // ใช้แสดงเป็นรูปในเซลล์ของ Google Sheet (โหลดเสถียรกว่า)
    };
  } catch (e) {
    return null; // ✅ กันพัง — ถ้าบันทึกรูปไม่สำเร็จ (เช่น โควต้า Drive เต็ม) ยังคงให้ลงทะเบียนบ้าน/เจ้าหน้าที่ต่อได้ตามปกติ ใช้ QR แบบสดแทน
  }
}

// ── ✅ ใหม่ — เขียนรูป QR ลงในเซลล์ของ Google Sheet โดยตรง (เห็นรูปจริงในชีต ไม่ต้องเปิดลิงก์)
function hvWriteQrToSheetCell_(sheet, row, col, thumbUrl, altTitle) {
  try {
    const image = SpreadsheetApp.newCellImage().setSourceUrl(thumbUrl).setAltTextTitle(altTitle || 'QR Code').build();
    sheet.getRange(row, col).setValue(image);
  } catch (e) {
    // ✅ กันพัง — บาง account/เวอร์ชันอาจยังไม่รองรับ CellImage หรือรูปโหลดจาก Drive ยังไม่พร้อมทันที ข้ามไปโดยไม่กระทบข้อมูลหลัก
  }
}

function hvDistanceMeters_(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v === '' || v === null || v === undefined || isNaN(v))) return null;
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function hvGenerateId_(prefix, sheet, col) {
  const last = sheet.getLastRow();
  const existing = last >= 2
    ? sheet.getRange(2, col, last - 1, 1).getValues().map(r => String(r[0]).trim())
    : [];
  let id;
  do { id = prefix + '-' + Math.floor(Math.random()*9000+1000); } while (existing.includes(id));
  return id;
}

function hvFindRowById_(sheet, idCol, id) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const ids = sheet.getRange(2, idCol, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) return i + 2;
  }
  return -1;
}

// ── [1] ตั้งค่า Sheet (สร้างครบ + จัดรูปแบบ) — เรียกได้จากเมนู "จัดการระบบ" ──
function setupHomeVisitSheets() {
  const ss = getSpreadsheet();
  let created = [];

  const hs = ss.getSheetByName('HVHouses') || (created.push('HVHouses'), ss.insertSheet('HVHouses'));
  if (hs.getLastRow() < 1) {
    const hHdr = ['Timestamp','HouseID','HN (เชื่อมโยงผู้ป่วยเดิม)','ชื่อเจ้าของบ้าน/ผู้ป่วย','ที่อยู่','กลุ่มเป้าหมาย','Lat','Lng','เบอร์โทร','สถานะเยี่ยม','เยี่ยมล่าสุด','เจ้าหน้าที่เยี่ยมล่าสุด','QR Text','หมายเหตุ','QR รูปภาพ (ลิงก์ถาวร)','QR รูปภาพ (ดูในชีต)'];
    hs.getRange(1,1,1,hHdr.length).setValues([hHdr]).setFontWeight('bold').setBackground('#2d5a3d').setFontColor('#fff');
    hs.setFrozenRows(1);
    hs.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('เยี่ยมแล้ว')
        .setBackground('#dcfce7').setFontColor('#166534').setBold(true)
        .setRanges([hs.getRange('J2:J2000')]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ยังไม่เยี่ยม')
        .setBackground('#fde8df').setFontColor('#b6432f')
        .setRanges([hs.getRange('J2:J2000')]).build()
    ]);
  } else if (hs.getLastColumn() < HV_COL_HOUSE.QR_IMG_CELL) {
    // ✅ Migration — ชีตเดิมที่เคยสร้างไว้ก่อนมีฟีเจอร์รูป QR ถาวร: เติมหัวคอลัมน์ใหม่ต่อท้ายโดยไม่กระทบข้อมูลเดิมที่มีอยู่
    if (hs.getLastColumn() < HV_COL_HOUSE.QR_IMG_URL) {
      hs.getRange(1, HV_COL_HOUSE.QR_IMG_URL).setValue('QR รูปภาพ (ลิงก์ถาวร)').setFontWeight('bold').setBackground('#2d5a3d').setFontColor('#fff');
    }
    hs.getRange(1, HV_COL_HOUSE.QR_IMG_CELL).setValue('QR รูปภาพ (ดูในชีต)').setFontWeight('bold').setBackground('#2d5a3d').setFontColor('#fff');
  }

  const st = ss.getSheetByName('HVStaff') || (created.push('HVStaff'), ss.insertSheet('HVStaff'));
  if (st.getLastRow() < 1) {
    const sHdr = ['Timestamp','StaffID','ชื่อ-นามสกุล','ตำแหน่ง','เบอร์โทร','สถานะ','Lat','Lng','อัพเดทตำแหน่งล่าสุด','จำนวนเยี่ยมวันนี้'];
    st.getRange(1,1,1,sHdr.length).setValues([sHdr]).setFontWeight('bold').setBackground('#2d5a3d').setFontColor('#fff');
    st.setFrozenRows(1);
  }

  const vs = ss.getSheetByName('HVVisitLog') || (created.push('HVVisitLog'), ss.insertSheet('HVVisitLog'));
  if (vs.getLastRow() < 1) {
    const vHdr = ['Timestamp','VisitID','StaffID','ชื่อเจ้าหน้าที่','HouseID','ชื่อบ้าน','HN','Lat เช็คอิน','Lng เช็คอิน','ระยะห่างจากบ้าน (ม.)','หมายเหตุ'];
    vs.getRange(1,1,1,vHdr.length).setValues([vHdr]).setFontWeight('bold').setBackground('#1e3f2a').setFontColor('#fff');
    vs.setFrozenRows(1);
  }

  const ps = ss.getSheetByName('HVPhotos') || (created.push('HVPhotos'), ss.insertSheet('HVPhotos'));
  if (ps.getLastRow() < 1) {
    const pHdr = ['Timestamp','PhotoID','HouseID','ชื่อบ้าน','StaffID','ชื่อเจ้าหน้าที่','VisitID','ประเภท','URL รูปภาพ','Drive File ID'];
    ps.getRange(1,1,1,pHdr.length).setValues([pHdr]).setFontWeight('bold').setBackground('#1e3f2a').setFontColor('#fff');
    ps.setFrozenRows(1);
  }

  const fs = ss.getSheetByName('HVFacilities') || (created.push('HVFacilities'), ss.insertSheet('HVFacilities'));
  if (fs.getLastRow() < 1) {
    const fHdr = ['Timestamp','FacilityID','ชื่อหน่วยบริการ','ประเภท','ที่อยู่','Lat','Lng','เบอร์โทร','รายละเอียด'];
    fs.getRange(1,1,1,fHdr.length).setValues([fHdr]).setFontWeight('bold').setBackground('#7c2d12').setFontColor('#fff');
    fs.setFrozenRows(1);
  }

  return { success: true, created: created, message: created.length ? ('สร้างชีตใหม่: ' + created.join(', ')) : 'มีชีตครบทั้งหมดอยู่แล้ว' };
}

// ── [2] เชื่อมโยงฐานข้อมูลผู้ป่วยเดิม (Patients) — ค้นหาเพื่อเติมข้อมูลอัตโนมัติตอนลงทะเบียนบ้าน ──
// ✅ ดึงเฉพาะผู้ป่วยที่เคยมีรายการนัด "เยี่ยมบ้าน (HOME)" เท่านั้น — ไม่ดึงผู้ป่วย OPD ทั่วไปมาปน
function getHomeVisitHNSet_() {
  const set = {};
  const data = BOOKINGS_SHEET().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const apptType = (data[i][12] || 'OPD').toString().trim();
    if (apptType !== 'Home' && apptType !== 'เยี่ยมบ้าน') continue;
    const hn = normalizeHN(data[i][6]);
    if (hn) set[hn] = true;
  }
  return set;
}

function searchPatientForHV(query) {
  try {
    const sheet = PATIENTS_SHEET();
    if (!sheet) return { success: true, results: [] };
    const last = sheet.getLastRow();
    if (last < 2) return { success: true, results: [] };
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { success: true, results: [] };
    const homeHNSet = getHomeVisitHNSet_();
    const data = sheet.getRange(2, 1, last - 1, 5).getValues(); // PatientID, HN, Name, Phone, Rights
    const map = {};   // hn -> record (dedupe ป้องกันรายชื่อซ้ำเมื่อชีต Patients มีแถวซ้ำ)
    const order = [];
    for (let i = 0; i < data.length; i++) {
      const hn = normalizeHN(data[i][1]);
      if (!hn) continue;
      if (!homeHNSet[hn]) continue; // ✅ กรองเฉพาะผู้ป่วยที่มีประวัติเยี่ยมบ้าน
      const name = String(data[i][2] || '');
      const phone = String(data[i][3] || '');
      if (hn.toLowerCase().includes(q) || name.toLowerCase().includes(q) || phone.includes(q)) {
        const rec = { hn: hn, name: name, phone: phone, rights: data[i][4] || '' };
        if (map[hn]) {
          const prev = map[hn];
          map[hn] = {
            hn,
            name:   rec.name   || prev.name,
            phone:  rec.phone  || prev.phone,
            rights: rec.rights || prev.rights
          };
        } else {
          map[hn] = rec;
          order.push(hn);
        }
      }
      if (order.length >= 15) break;
    }
    const results = order.map(hn => map[hn]);
    return { success: true, results: results };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ── [3] ลงทะเบียนบ้าน / เจ้าหน้าที่ / หน่วยบริการ ──
// ✅ FIX: หาแถวของ HVHouses ที่ตรงกับ HN (normalize แล้ว) — คืน { row, values } ของแถวแรกที่เจอ หรือ null
//    ใช้เป็นแกนกลางของการทำ "upsert" (อัปเดตของเดิมถ้ามี แทนที่จะสร้างซ้ำ) ทั่วทั้งโมดูลเยี่ยมบ้าน
function hvFindHouseRowByHN_(sheet, hnNorm) {
  if (!hnNorm) return null;
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const data = sheet.getRange(2, 1, last - 1, HV_COL_HOUSE.NOTE).getValues();
  for (let i = 0; i < data.length; i++) {
    if (normalizeHN(data[i][HV_COL_HOUSE.HN - 1]) === hnNorm) {
      return { row: i + 2, values: data[i] };
    }
  }
  return null;
}

// ✅ NEW: ให้หน้าฟอร์ม "ปักหมุดบ้านใหม่" เช็คก่อนบันทึกว่า HN นี้เคยมีหมุดอยู่แล้วหรือยัง
//    กันไม่ให้ปักหมุดซ้ำโดยไม่ตั้งใจ (ต้นตอของปัญหา "ปักหมุดแล้วแต่ครั้งถัดไปขึ้นว่ายังไม่ได้ปักหมุด")
function checkHVHouseByHN(hn) {
  try {
    const hnNorm = normalizeHN(hn || '');
    if (!hnNorm) return { found: false };
    const sheet = HV_HOUSES_SHEET();
    if (!sheet) return { found: false };
    const hit = hvFindHouseRowByHN_(sheet, hnNorm);
    if (!hit) return { found: false };
    const v = hit.values;
    return {
      found: true,
      houseId: v[HV_COL_HOUSE.ID - 1],
      name: v[HV_COL_HOUSE.NAME - 1],
      address: v[HV_COL_HOUSE.ADDRESS - 1],
      category: v[HV_COL_HOUSE.CATEGORY - 1],
      phone: v[HV_COL_HOUSE.PHONE - 1],
      note: v[HV_COL_HOUSE.NOTE - 1],
      lat: v[HV_COL_HOUSE.LAT - 1],
      lng: v[HV_COL_HOUSE.LNG - 1],
      status: v[HV_COL_HOUSE.STATUS - 1],
      lastVisit: v[HV_COL_HOUSE.LAST_VISIT - 1] ? String(v[HV_COL_HOUSE.LAST_VISIT - 1]) : '',
      registeredAt: v[HV_COL_HOUSE.TS - 1] ? String(v[HV_COL_HOUSE.TS - 1]) : ''
    };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

// ✅ FIX (โมดูลเยี่ยมบ้าน GPS — แก้ปัญหา "ปักหมุดแล้วแต่ครั้งถัดไปขึ้นว่ายังไม่ได้ปักหมุด"):
//    เดิมฟังก์ชันนี้ "เพิ่มแถวใหม่" ทุกครั้งไม่ว่า HN นั้นจะเคยมีหมุดอยู่แล้วหรือไม่ ทำให้เกิดแถวซ้ำ
//    หลายแถวต่อ HN เดียวกัน แล้วจุดที่ค้นหาพิกัดบ้าน (getTodayFast/getHVCheckinList ฯลฯ) สร้าง map
//    โดยวนอ่านทุกแถวแล้ว "ทับค่าเดิมด้วยแถวหลังสุดเสมอ" — ถ้าแถวหลังสุดของ HN นั้นเกิดปัญหา (เช่น
//    ถูกแก้ไขมือในชีตจนพิกัดว่าง หรือลำดับแถวถูกสลับ) หน้าจอจะรายงานผิดว่า "ยังไม่ได้ปักหมุด" ทั้งที่จริง
//    เคยปักไว้แล้ว ตอนนี้เปลี่ยนเป็น "upsert": ถ้า HN นี้มีหมุดอยู่แล้ว จะ "อัปเดต" แถวเดิมแทนการสร้างใหม่
//    (houseId/QR เดิมยังใช้ได้ต่อเนื่อง ไม่กระทบประวัติการเยี่ยม/รูปภาพที่ผูกกับ houseId เดิม)
//    ถ้าต้องการปักหมุด "บ้านหลังใหม่แยกต่างหาก" ของ HN เดิมจริง ๆ (กรณีพิเศษ เช่น มี 2 ที่อยู่) ให้ส่ง
//    p.forceNew = true มาชัดเจน
function registerHVHouse(p) {
  try {
    let name    = String(p.name || '').trim();
    let phone   = String(p.phone || '').trim();
    const hn    = normalizeHN(p.hn || '');
    const address  = String(p.address || '').trim();
    const category = String(p.category || '').trim();
    const note     = String(p.note || '').trim();
    const lat = parseFloat(p.lat), lng = parseFloat(p.lng);
    const forceNew = !!p.forceNew;

    // ✅ ถ้าระบุ HN และไม่ได้กรอกชื่อ/เบอร์ ให้ดึงจากฐานข้อมูลผู้ป่วยเดิมอัตโนมัติ
    if (hn && (!name || !phone)) {
      const pSheet = PATIENTS_SHEET();
      if (pSheet && pSheet.getLastRow() >= 2) {
        const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 5).getValues();
        const match = data.find(r => normalizeHN(r[1]) === hn);
        if (match) { if (!name) name = match[2] || ''; if (!phone) phone = match[3] || ''; }
      }
    }

    if (!name) return { status: 'error', message: 'กรุณากรอกชื่อเจ้าของบ้าน/ผู้ป่วย หรือระบุ HN ที่มีในระบบ' };
    if (!address) return { status: 'error', message: 'กรุณากรอกที่อยู่' };
    if (isNaN(lat) || isNaN(lng)) return { status: 'error', message: 'กรุณาปักหมุดตำแหน่ง GPS ของบ้าน' };

    const sheet = HV_HOUSES_SHEET();
    if (!sheet) return { status: 'error', message: 'ไม่พบชีต HVHouses — กรุณากด "ตั้งค่าโมดูลเยี่ยมบ้าน" ในหน้าจัดการระบบก่อน' };

    // ✅ FIX: ถ้ามี HN และมีหมุดของ HN นี้อยู่แล้ว (และไม่ได้ตั้งใจสั่ง forceNew) → อัปเดตแถวเดิมแทนการสร้างซ้ำ
    const existing = (hn && !forceNew) ? hvFindHouseRowByHN_(sheet, hn) : null;

    if (existing) {
      const row = existing.row;
      const houseId = existing.values[HV_COL_HOUSE.ID - 1];
      let qrText = String(existing.values[HV_COL_HOUSE.QR - 1] || '').trim();
      if (!qrText) qrText = 'HOME:' + houseId;

      sheet.getRange(row, HV_COL_HOUSE.TS).setValue(hvNow_()); // อัปเดตเวลาล่าสุดที่แก้ไขหมุดนี้
      sheet.getRange(row, HV_COL_HOUSE.NAME).setValue(name);
      sheet.getRange(row, HV_COL_HOUSE.ADDRESS).setValue(address);
      sheet.getRange(row, HV_COL_HOUSE.CATEGORY).setValue(category);
      sheet.getRange(row, HV_COL_HOUSE.LAT).setValue(lat);
      sheet.getRange(row, HV_COL_HOUSE.LNG).setValue(lng);
      sheet.getRange(row, HV_COL_HOUSE.PHONE).setValue(phone);
      if (note) sheet.getRange(row, HV_COL_HOUSE.NOTE).setValue(note);
      // สถานะเยี่ยม/เยี่ยมล่าสุด/เจ้าหน้าที่ล่าสุด: คงค่าเดิมไว้ — การแก้พิกัดไม่ควรลบประวัติการเยี่ยมที่ผ่านมา

      let qrImgUrl = String(sheet.getLastColumn() >= HV_COL_HOUSE.QR_IMG_URL
        ? (sheet.getRange(row, HV_COL_HOUSE.QR_IMG_URL).getValue() || '') : '').trim();

      return {
        status: 'ok', updated: true, houseId: houseId, qrText: qrText,
        qrUrl: hvQrUrlFor_(qrText), qrImgUrl: qrImgUrl, name: name, hn: hn,
        message: 'อัปเดตพิกัดบ้านเดิมของ HN ' + hn + ' เรียบร้อย (ไม่ได้สร้างหมุดซ้ำ)'
      };
    }

    const houseId = hvGenerateId_('HOME', sheet, HV_COL_HOUSE.ID);
    const row = sheet.getLastRow() + 1;
    const qrText = 'HOME:' + houseId;

    sheet.getRange(row, HV_COL_HOUSE.TS).setValue(hvNow_());
    sheet.getRange(row, HV_COL_HOUSE.ID).setValue(houseId);
    sheet.getRange(row, HV_COL_HOUSE.HN).setValue(hn);
    sheet.getRange(row, HV_COL_HOUSE.NAME).setValue(name);
    sheet.getRange(row, HV_COL_HOUSE.ADDRESS).setValue(address);
    sheet.getRange(row, HV_COL_HOUSE.CATEGORY).setValue(category);
    sheet.getRange(row, HV_COL_HOUSE.LAT).setValue(lat);
    sheet.getRange(row, HV_COL_HOUSE.LNG).setValue(lng);
    sheet.getRange(row, HV_COL_HOUSE.PHONE).setValue(phone);
    sheet.getRange(row, HV_COL_HOUSE.STATUS).setValue('ยังไม่เยี่ยม');
    sheet.getRange(row, HV_COL_HOUSE.QR).setValue(qrText);
    sheet.getRange(row, HV_COL_HOUSE.NOTE).setValue(note);

    // ✅ ใหม่ — บันทึกรูป QR เป็นไฟล์ถาวร (กัน QR หาย/สแกนไม่ได้ทีหลัง) + แปะรูปจริงลงในชีตให้เห็นเลยโดยไม่ต้องเปิดลิงก์
    let qrImgUrl = '';
    const qrImg = hvSaveQrImage_(qrText, houseId);
    if (qrImg) {
      qrImgUrl = qrImg.viewUrl;
      sheet.getRange(row, HV_COL_HOUSE.QR_IMG_URL).setValue(qrImg.viewUrl);
      hvWriteQrToSheetCell_(sheet, row, HV_COL_HOUSE.QR_IMG_CELL, qrImg.thumbUrl, 'QR ' + name + ' (' + houseId + ')');
      sheet.setRowHeight(row, 90); // ให้แถวสูงพอเห็นรูป QR ในชีตชัดเจน
    }

    return { status: 'ok', updated: false, houseId: houseId, qrText: qrText, qrUrl: hvQrUrlFor_(qrText), qrImgUrl: qrImgUrl, name: name, hn: hn };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ✅ NEW (เครื่องมือแก้ไขข้อมูลเดิม — รันครั้งเดียวจาก Apps Script Editor เพื่อ "ล้าง" ข้อมูลเก่าที่อาจ
//    เพี้ยนอยู่ก่อนแล้ว ก่อนที่การแก้ไข code ด้านบนจะป้องกันปัญหาใหม่ไม่ให้เกิดซ้ำอีก):
// 1) fixExistingHVHouseHN()  — normalize คอลัมน์ HN ของชีต HVHouses ให้เป็นรูปแบบเดียวกันทั้งหมด
//    (ตามแบบเดียวกับ fixExistingBookingHN / fixExistingOutcomeHN ที่มีอยู่แล้วในระบบ)
// 2) hvDedupeHouses()        — รวมหมุดที่ซ้ำ HN เดียวกันหลายแถว (ที่อาจเกิดจากบั๊กเดิมก่อนแก้)
//    ให้เหลือแถวเดียว โดยเลือกแถวที่ "ข้อมูลดีที่สุด" เป็นแถวหลัก (มีพิกัด + เคยเยี่ยมแล้ว + ล่าสุด)
//    แล้วย้ายประวัติการเยี่ยม (HVVisitLog) และรูปภาพ (HVPhotos) ของแถวที่ถูกรวม ให้มาอ้างอิง houseId
//    ของแถวหลักแทน ก่อนจะลบแถวส่วนเกินทิ้ง — ป้องกันประวัติ/รูปหาย
function fixExistingHVHouseHN() {
  const sheet = HV_HOUSES_SHEET();
  if (!sheet) return 'ไม่พบชีต HVHouses';
  const last = sheet.getLastRow();
  if (last < 2) return 'ไม่มีข้อมูล';
  const data = sheet.getRange(2, 1, last - 1, HV_COL_HOUSE.NOTE).getValues();
  let fixed = 0;
  for (let i = 0; i < data.length; i++) {
    const raw = data[i][HV_COL_HOUSE.HN - 1];
    const norm = normalizeHN(raw);
    if (raw !== undefined && raw !== null && raw.toString() !== norm && norm) {
      sheet.getRange(i + 2, HV_COL_HOUSE.HN).setValue(norm);
      fixed++;
    }
  }
  Logger.log('✅ fixExistingHVHouseHN: ' + fixed + ' แถว');
  return '✅ แก้ไข HN ในชีต HVHouses ' + fixed + ' แถว';
}

function hvDedupeHouses() {
  const sheet = HV_HOUSES_SHEET();
  if (!sheet) return { status: 'error', message: 'ไม่พบชีต HVHouses' };
  const last = sheet.getLastRow();
  if (last < 2) return { status: 'ok', merged: 0, message: 'ไม่มีข้อมูล' };

  const data = sheet.getRange(2, 1, last - 1, HV_COL_HOUSE.NOTE).getValues();
  const groups = {}; // hnNorm -> [ {rowIndex(0-based ในdata), values} ]
  for (let i = 0; i < data.length; i++) {
    const hn = normalizeHN(data[i][HV_COL_HOUSE.HN - 1]);
    if (!hn) continue; // ไม่มี HN (บ้านของคนไข้ที่ไม่มี HN ในระบบ) — ข้าม ไม่รวมอัตโนมัติ กันรวมผิดคน
    if (!groups[hn]) groups[hn] = [];
    groups[hn].push({ idx: i, values: data[i] });
  }

  const idMap = {};       // houseId ของแถวที่ถูกรวม (ถูกลบ) -> houseId ของแถวหลักที่เก็บไว้
  const rowsToDelete = []; // เลขแถวจริงในชีต (1-based) ที่จะลบ หลังย้ายประวัติเสร็จแล้ว
  let mergedCount = 0;

  Object.keys(groups).forEach(hn => {
    const group = groups[hn];
    if (group.length < 2) return; // ไม่ซ้ำ ไม่ต้องทำอะไร

    // เลือกแถวหลัก: ให้คะแนนตามคุณภาพข้อมูล แล้วเลือกคะแนนสูงสุด (ถ้าเสมอ เลือกแถวล่าสุด)
    function score(v) {
      let s = 0;
      const lat = v[HV_COL_HOUSE.LAT - 1], lng = v[HV_COL_HOUSE.LNG - 1];
      if (lat !== '' && lng !== '' && lat != null && lng != null && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) s += 10;
      if (v[HV_COL_HOUSE.STATUS - 1] === 'เยี่ยมแล้ว') s += 5;
      if (String(v[HV_COL_HOUSE.ADDRESS - 1] || '').trim() && v[HV_COL_HOUSE.ADDRESS - 1] !== 'ปักหมุดอัตโนมัติจากการเช็คอินเยี่ยมบ้าน') s += 3;
      if (String(v[HV_COL_HOUSE.PHONE - 1] || '').trim()) s += 1;
      return s;
    }
    let primary = group[0];
    for (let k = 1; k < group.length; k++) {
      const a = score(group[k].values), b = score(primary.values);
      if (a > b || (a === b && group[k].idx > primary.idx)) primary = group[k];
    }
    const primaryId = primary.values[HV_COL_HOUSE.ID - 1];

    group.forEach(item => {
      if (item === primary) return;
      const dupId = item.values[HV_COL_HOUSE.ID - 1];
      idMap[dupId] = primaryId;
      rowsToDelete.push(item.idx + 2); // +2 = ชดเชย header row + 0-based → 1-based
      mergedCount++;
    });
  });

  if (mergedCount === 0) return { status: 'ok', merged: 0, message: 'ไม่พบหมุดซ้ำ HN' };

  // ย้ายประวัติการเยี่ยม (HVVisitLog) ให้ชี้ไป houseId หลัก
  const visitSheet = HV_VISITLOG_SHEET();
  if (visitSheet && visitSheet.getLastRow() >= 2) {
    const vLast = visitSheet.getLastRow();
    const vIds = visitSheet.getRange(2, HV_COL_VISIT.HOUSE_ID, vLast - 1, 1).getValues();
    for (let i = 0; i < vIds.length; i++) {
      const id = vIds[i][0];
      if (idMap[id]) visitSheet.getRange(i + 2, HV_COL_VISIT.HOUSE_ID).setValue(idMap[id]);
    }
  }
  // ย้ายรูปภาพ (HVPhotos) ให้ชี้ไป houseId หลัก
  const photoSheet = HV_PHOTOS_SHEET();
  if (photoSheet && photoSheet.getLastRow() >= 2) {
    const pLast = photoSheet.getLastRow();
    const pIds = photoSheet.getRange(2, HV_COL_PHOTO.HOUSE_ID, pLast - 1, 1).getValues();
    for (let i = 0; i < pIds.length; i++) {
      const id = pIds[i][0];
      if (idMap[id]) photoSheet.getRange(i + 2, HV_COL_PHOTO.HOUSE_ID).setValue(idMap[id]);
    }
  }

  // ลบแถวส่วนเกินจากมากไปน้อย กันเลขแถวเลื่อน
  rowsToDelete.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));

  Logger.log('✅ hvDedupeHouses: รวม ' + mergedCount + ' แถวซ้ำ');
  return { status: 'ok', merged: mergedCount, message: '✅ รวมหมุดซ้ำ HN แล้ว ' + mergedCount + ' แถว (ประวัติเยี่ยม/รูปภาพถูกย้ายไปแถวหลักให้อัตโนมัติ)' };
}

function registerHVStaff(p) {
  try {
    const name = String(p.name || '').trim();
    const position = String(p.position || '').trim();
    const phone = String(p.phone || '').trim();
    if (!name) return { status: 'error', message: 'กรุณากรอกชื่อเจ้าหน้าที่' };

    const sheet = HV_STAFF_SHEET();
    if (!sheet) return { status: 'error', message: 'ไม่พบชีต HVStaff — กรุณากด "ตั้งค่าโมดูลเยี่ยมบ้าน" ในหน้าจัดการระบบก่อน' };

    const staffId = hvGenerateId_('STAFF', sheet, HV_COL_STAFF.ID);
    const row = sheet.getLastRow() + 1;
    sheet.getRange(row, HV_COL_STAFF.TS).setValue(hvNow_());
    sheet.getRange(row, HV_COL_STAFF.ID).setValue(staffId);
    sheet.getRange(row, HV_COL_STAFF.NAME).setValue(name);
    sheet.getRange(row, HV_COL_STAFF.POSITION).setValue(position);
    sheet.getRange(row, HV_COL_STAFF.PHONE).setValue(phone);
    sheet.getRange(row, HV_COL_STAFF.STATUS).setValue('ออฟไลน์');
    sheet.getRange(row, HV_COL_STAFF.TODAY_COUNT).setValue(0);

    return { status: 'ok', staffId: staffId, qrText: 'STAFF:' + staffId, qrUrl: hvQrUrlFor_('STAFF:' + staffId), name: name };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function registerHVFacility(p) {
  try {
    const name = String(p.name || '').trim();
    const type = String(p.type || '').trim();
    const address = String(p.address || '').trim();
    const phone = String(p.phone || '').trim();
    const detail = String(p.detail || '').trim();
    const lat = parseFloat(p.lat), lng = parseFloat(p.lng);
    if (!name) return { status: 'error', message: 'กรุณากรอกชื่อหน่วยบริการ' };
    if (isNaN(lat) || isNaN(lng)) return { status: 'error', message: 'กรุณาปักหมุดตำแหน่งหน่วยบริการ' };

    const sheet = HV_FACILITIES_SHEET();
    if (!sheet) return { status: 'error', message: 'ไม่พบชีต HVFacilities — กรุณากด "ตั้งค่าโมดูลเยี่ยมบ้าน" ในหน้าจัดการระบบก่อน' };

    const facilityId = hvGenerateId_('FAC', sheet, HV_COL_FACILITY.ID);
    const row = sheet.getLastRow() + 1;
    sheet.getRange(row, HV_COL_FACILITY.TS).setValue(hvNow_());
    sheet.getRange(row, HV_COL_FACILITY.ID).setValue(facilityId);
    sheet.getRange(row, HV_COL_FACILITY.NAME).setValue(name);
    sheet.getRange(row, HV_COL_FACILITY.TYPE).setValue(type);
    sheet.getRange(row, HV_COL_FACILITY.ADDRESS).setValue(address);
    sheet.getRange(row, HV_COL_FACILITY.LAT).setValue(lat);
    sheet.getRange(row, HV_COL_FACILITY.LNG).setValue(lng);
    sheet.getRange(row, HV_COL_FACILITY.PHONE).setValue(phone);
    sheet.getRange(row, HV_COL_FACILITY.DETAIL).setValue(detail);

    return { status: 'ok', facilityId: facilityId, name: name };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ── [4] ค้นหา / lookup ──
function searchHVHouse(query) {
  try {
    const sheet = HV_HOUSES_SHEET();
    if (!sheet) return { status: 'ok', results: [] };
    const last = sheet.getLastRow();
    if (last < 2) return { status: 'ok', results: [] };
    const q = String(query || '').trim().toLowerCase();
    const data = sheet.getRange(2, 1, last - 1, HV_COL_HOUSE.NOTE).getValues();
    const results = [];
    for (let i = 0; i < data.length; i++) {
      const id = String(data[i][HV_COL_HOUSE.ID-1]);
      const hn = String(data[i][HV_COL_HOUSE.HN-1]);
      const name = String(data[i][HV_COL_HOUSE.NAME-1]);
      const addr = String(data[i][HV_COL_HOUSE.ADDRESS-1]);
      if (!q || [id,hn,name,addr].some(v => v.toLowerCase().includes(q))) {
        const latV = data[i][HV_COL_HOUSE.LAT-1];
        const lngV = data[i][HV_COL_HOUSE.LNG-1];
        results.push({
          houseId: id, hn: hn, name: name, address: addr,
          status: data[i][HV_COL_HOUSE.STATUS-1],
          lat: (latV === '' || latV === null || isNaN(latV)) ? null : Number(latV),
          lng: (lngV === '' || lngV === null || isNaN(lngV)) ? null : Number(lngV)
        });
      }
      if (results.length >= 500) break;
    }
    return { status: 'ok', results: results };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function lookupHVStaff(staffId) {
  const sheet = HV_STAFF_SHEET();
  const row = sheet ? hvFindRowById_(sheet, HV_COL_STAFF.ID, staffId) : -1;
  if (row === -1) return { status: 'error', message: 'ไม่พบเจ้าหน้าที่รหัสนี้' };
  const v = sheet.getRange(row, 1, 1, HV_COL_STAFF.TODAY_COUNT).getValues()[0];
  return { status: 'ok', staffId: v[HV_COL_STAFF.ID-1], name: v[HV_COL_STAFF.NAME-1], position: v[HV_COL_STAFF.POSITION-1] };
}

function lookupHVHouse(houseId) {
  const sheet = HV_HOUSES_SHEET();
  const row = sheet ? hvFindRowById_(sheet, HV_COL_HOUSE.ID, houseId) : -1;
  if (row === -1) return { status: 'error', message: 'ไม่พบบ้านรหัสนี้' };
  const v = sheet.getRange(row, 1, 1, HV_COL_HOUSE.NOTE).getValues()[0];
  return {
    status: 'ok', houseId: v[HV_COL_HOUSE.ID-1], hn: v[HV_COL_HOUSE.HN-1], name: v[HV_COL_HOUSE.NAME-1],
    address: v[HV_COL_HOUSE.ADDRESS-1], category: v[HV_COL_HOUSE.CATEGORY-1],
    lat: v[HV_COL_HOUSE.LAT-1], lng: v[HV_COL_HOUSE.LNG-1],
    visitStatus: v[HV_COL_HOUSE.STATUS-1], lastVisit: v[HV_COL_HOUSE.LAST_VISIT-1]
  };
}

// ── ✅ ใหม่ — ดูรหัส QR ย้อนหลังของบ้าน/ผู้ป่วยรายใดก็ได้ที่เคยลงทะเบียนไว้แล้ว (เผื่อกรณีทำ QR ที่พิมพ์ไว้หาย)
//    คืนทั้งลิงก์รูปถาวรใน Drive (ถ้าเคยบันทึกไว้) และลิงก์ QR แบบสด (fallback เผื่อยังไม่เคยบันทึกรูปไว้)
function getHVHouseQr(houseId) {
  try {
    const sheet = HV_HOUSES_SHEET();
    const row = sheet ? hvFindRowById_(sheet, HV_COL_HOUSE.ID, houseId) : -1;
    if (row === -1) return { status: 'error', message: 'ไม่พบบ้าน/ผู้ป่วยรหัสนี้' };
    const lastCol = Math.max(sheet.getLastColumn(), HV_COL_HOUSE.NOTE);
    const v = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
    let qrText = String(v[HV_COL_HOUSE.QR-1] || '').trim();
    if (!qrText) qrText = 'HOME:' + String(v[HV_COL_HOUSE.ID-1] || houseId); // ✅ กันเหนียว — ข้อมูลเก่ามากบางแถวอาจไม่มี QR Text บันทึกไว้
    let qrImgUrl = lastCol >= HV_COL_HOUSE.QR_IMG_URL ? String(v[HV_COL_HOUSE.QR_IMG_URL-1] || '').trim() : '';

    // ✅ ถ้ายังไม่เคยมีรูปถาวรบันทึกไว้ (ข้อมูลเก่าก่อนอัปเดตฟีเจอร์นี้) ให้สร้าง+บันทึกให้ทันทีตอนที่ถูกเรียกดู แล้วเก็บไว้ใช้ครั้งถัดไป
    if (!qrImgUrl) {
      const qrImg = hvSaveQrImage_(qrText, String(v[HV_COL_HOUSE.ID-1] || houseId));
      if (qrImg) {
        qrImgUrl = qrImg.viewUrl;
        if (lastCol >= HV_COL_HOUSE.QR_IMG_URL) sheet.getRange(row, HV_COL_HOUSE.QR_IMG_URL).setValue(qrImg.viewUrl);
        if (lastCol >= HV_COL_HOUSE.QR_IMG_CELL) {
          hvWriteQrToSheetCell_(sheet, row, HV_COL_HOUSE.QR_IMG_CELL, qrImg.thumbUrl, 'QR ' + v[HV_COL_HOUSE.NAME-1] + ' (' + v[HV_COL_HOUSE.ID-1] + ')');
          sheet.setRowHeight(row, 90);
        }
      }
    }

    return {
      status: 'ok', houseId: v[HV_COL_HOUSE.ID-1], hn: v[HV_COL_HOUSE.HN-1], name: v[HV_COL_HOUSE.NAME-1],
      address: v[HV_COL_HOUSE.ADDRESS-1], qrText: qrText, qrUrl: hvQrUrlFor_(qrText), qrImgUrl: qrImgUrl
    };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ── ✅ ใหม่ — สร้าง/บันทึกรูป QR ย้อนหลังให้ครบทุกบ้านที่ยังไม่มีรูปถาวร (ใช้ครั้งเดียวตอนอัปเดตระบบครั้งแรก
//    หรือกดซ้ำได้เรื่อยๆ แบบปลอดภัย — ข้ามรายการที่มีรูปอยู่แล้วเสมอ ไม่สร้างซ้ำ) ──
function hvBackfillQrImages() {
  try {
    const sheet = HV_HOUSES_SHEET();
    if (!sheet) return { status: 'error', message: 'ไม่พบชีต HVHouses — กด "ตั้งค่าโมดูล" ก่อน' };
    if (sheet.getLastColumn() < HV_COL_HOUSE.QR_IMG_CELL) return { status: 'error', message: 'กรุณากด "ตั้งค่าโมดูลเยี่ยมบ้าน" ก่อน เพื่อเพิ่มคอลัมน์รูป QR ให้ชีตนี้' };
    const last = sheet.getLastRow();
    if (last < 2) return { status: 'ok', done: 0, message: 'ยังไม่มีบ้านที่ลงทะเบียนไว้' };
    const data = sheet.getRange(2, 1, last - 1, HV_COL_HOUSE.QR_IMG_CELL).getValues();
    let done = 0, failed = 0;
    for (let i = 0; i < data.length; i++) {
      const row = i + 2;
      const existingImg = String(data[i][HV_COL_HOUSE.QR_IMG_URL-1] || '').trim();
      if (existingImg) continue; // ✅ มีอยู่แล้ว ข้าม
      const houseId = String(data[i][HV_COL_HOUSE.ID-1] || '').trim();
      if (!houseId) continue;
      let qrText = String(data[i][HV_COL_HOUSE.QR-1] || '').trim();
      if (!qrText) qrText = 'HOME:' + houseId;
      const qrImg = hvSaveQrImage_(qrText, houseId);
      if (!qrImg) { failed++; continue; }
      sheet.getRange(row, HV_COL_HOUSE.QR_IMG_URL).setValue(qrImg.viewUrl);
      hvWriteQrToSheetCell_(sheet, row, HV_COL_HOUSE.QR_IMG_CELL, qrImg.thumbUrl, 'QR ' + data[i][HV_COL_HOUSE.NAME-1] + ' (' + houseId + ')');
      sheet.setRowHeight(row, 90);
      done++;
      Utilities.sleep(150); // ✅ เว้นจังหวะเล็กน้อยกันยิง UrlFetch/Drive ถี่เกินไปเวลามีหลายร้อยแถว
    }
    return { status: 'ok', done: done, failed: failed, message: 'สร้างรูป QR ย้อนหลังสำเร็จ ' + done + ' รายการ' + (failed ? (' (ล้มเหลว ' + failed + ' รายการ ลองกดซ้ำได้)') : '') };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ── [5] ตำแหน่งสด (GPS) ของเจ้าหน้าที่ ──
function updateHVStaffLocation(staffId, lat, lng) {
  try {
    const sheet = HV_STAFF_SHEET();
    const row = sheet ? hvFindRowById_(sheet, HV_COL_STAFF.ID, staffId) : -1;
    if (row === -1) return { status: 'error', message: 'ไม่พบเจ้าหน้าที่รหัสนี้' };
    sheet.getRange(row, HV_COL_STAFF.STATUS).setValue('ออกปฏิบัติงาน');
    sheet.getRange(row, HV_COL_STAFF.LAT).setValue(parseFloat(lat));
    sheet.getRange(row, HV_COL_STAFF.LNG).setValue(parseFloat(lng));
    sheet.getRange(row, HV_COL_STAFF.LOC_UPDATED).setValue(hvNow_());
    return { status: 'ok' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function hvStaffGoOffline(staffId) {
  try {
    const sheet = HV_STAFF_SHEET();
    const row = sheet ? hvFindRowById_(sheet, HV_COL_STAFF.ID, staffId) : -1;
    if (row === -1) return { status: 'error', message: 'ไม่พบเจ้าหน้าที่รหัสนี้' };
    sheet.getRange(row, HV_COL_STAFF.STATUS).setValue('ออฟไลน์');
    return { status: 'ok' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ── [6] เช็คอินเยี่ยมบ้าน (จับคู่เจ้าหน้าที่ + บ้าน + พิกัด GPS จริง) ──
function processHVVisitCheckin(staffId, houseId, lat, lng, note) {
  try {
    const staffSheet = HV_STAFF_SHEET(), houseSheet = HV_HOUSES_SHEET(), visitSheet = HV_VISITLOG_SHEET();
    if (!staffSheet || !houseSheet || !visitSheet) return { status: 'error', message: 'ยังไม่ได้ตั้งค่าโมดูลเยี่ยมบ้าน' };

    const sRow = hvFindRowById_(staffSheet, HV_COL_STAFF.ID, staffId);
    if (sRow === -1) return { status: 'error', message: 'ไม่พบเจ้าหน้าที่ กรุณาเลือกเจ้าหน้าที่ก่อน' };
    const hRow = hvFindRowById_(houseSheet, HV_COL_HOUSE.ID, houseId);
    if (hRow === -1) return { status: 'error', message: 'ไม่พบบ้านรหัสนี้ในระบบ' };

    const staffName = staffSheet.getRange(sRow, HV_COL_STAFF.NAME).getValue();
    const houseName = houseSheet.getRange(hRow, HV_COL_HOUSE.NAME).getValue();
    const hn        = houseSheet.getRange(hRow, HV_COL_HOUSE.HN).getValue();
    const houseLat  = houseSheet.getRange(hRow, HV_COL_HOUSE.LAT).getValue();
    const houseLng  = houseSheet.getRange(hRow, HV_COL_HOUSE.LNG).getValue();
    const dist = hvDistanceMeters_(parseFloat(lat), parseFloat(lng), parseFloat(houseLat), parseFloat(houseLng));

    const visitId = 'VISIT-' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMddHHmmss');
    const vRow = visitSheet.getLastRow() + 1;
    visitSheet.getRange(vRow, HV_COL_VISIT.TS).setValue(hvNow_());
    visitSheet.getRange(vRow, HV_COL_VISIT.ID).setValue(visitId);
    visitSheet.getRange(vRow, HV_COL_VISIT.STAFF_ID).setValue(staffId);
    visitSheet.getRange(vRow, HV_COL_VISIT.STAFF_NAME).setValue(staffName);
    visitSheet.getRange(vRow, HV_COL_VISIT.HOUSE_ID).setValue(houseId);
    visitSheet.getRange(vRow, HV_COL_VISIT.HOUSE_NAME).setValue(houseName);
    visitSheet.getRange(vRow, HV_COL_VISIT.HN).setValue(hn);
    visitSheet.getRange(vRow, HV_COL_VISIT.LAT).setValue(parseFloat(lat));
    visitSheet.getRange(vRow, HV_COL_VISIT.LNG).setValue(parseFloat(lng));
    visitSheet.getRange(vRow, HV_COL_VISIT.DISTANCE).setValue(dist === null ? '' : dist);
    visitSheet.getRange(vRow, HV_COL_VISIT.NOTE).setValue(note || '');

    houseSheet.getRange(hRow, HV_COL_HOUSE.STATUS).setValue('เยี่ยมแล้ว');
    houseSheet.getRange(hRow, HV_COL_HOUSE.LAST_VISIT).setValue(hvNow_());
    houseSheet.getRange(hRow, HV_COL_HOUSE.LAST_STAFF).setValue(staffName);

    const curCount = staffSheet.getRange(sRow, HV_COL_STAFF.TODAY_COUNT).getValue();
    staffSheet.getRange(sRow, HV_COL_STAFF.TODAY_COUNT).setValue((parseInt(curCount) || 0) + 1);

    const warning = (dist !== null && dist > HV_MAX_DISTANCE_M);
    return {
      status: 'ok', visitId: visitId, houseName: houseName, staffName: staffName, hn: hn,
      distance: dist, warning: warning,
      message: warning
        ? 'บันทึกการเยี่ยมสำเร็จ แต่ตำแหน่ง GPS ห่างจากบ้านที่ลงทะเบียนไว้ ' + dist + ' เมตร กรุณาตรวจสอบ'
        : 'บันทึกการเยี่ยม ' + houseName + ' สำเร็จ'
    };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ── [6b] เวอร์ชันย่อสำหรับหน้าเช็คอิน — ใช้ "พลอยไพลิน" คนเดียว + ดึงคนไข้ HOME จาก Bookings ──
const HV_STAFF_DEFAULT_NAME = 'พลอยไพลิน ประทีปพงศ์';

function hvGetOrCreatePloyStaffId_() {
  const sheet = HV_STAFF_SHEET();
  if (!sheet) return null;
  const last = sheet.getLastRow();
  if (last >= 2) {
    const data = sheet.getRange(2, 1, last - 1, HV_COL_STAFF.TODAY_COUNT).getValues();
    for (let i = 0; i < data.length; i++) {
      const nm = String(data[i][HV_COL_STAFF.NAME - 1] || '');
      if (nm.indexOf('พลอยไพลิน') !== -1) return data[i][HV_COL_STAFF.ID - 1];
    }
  }
  const staffId = hvGenerateId_('STAFF', sheet, HV_COL_STAFF.ID);
  const row = sheet.getLastRow() + 1;
  sheet.getRange(row, HV_COL_STAFF.TS).setValue(hvNow_());
  sheet.getRange(row, HV_COL_STAFF.ID).setValue(staffId);
  sheet.getRange(row, HV_COL_STAFF.NAME).setValue(HV_STAFF_DEFAULT_NAME);
  sheet.getRange(row, HV_COL_STAFF.POSITION).setValue('นักกายภาพบำบัด');
  sheet.getRange(row, HV_COL_STAFF.STATUS).setValue('ออนไลน์');
  sheet.getRange(row, HV_COL_STAFF.TODAY_COUNT).setValue(0);
  return staffId;
}

// ดึงรายชื่อผู้รับบริการประเภท "เยี่ยมบ้าน (HOME)" ของวันที่ระบุ จาก Bookings
// แล้วจับคู่กับหมุดบ้าน (HVHouses) ที่มีอยู่แล้วผ่าน HN — ถ้ายังไม่มีหมุด hasPin จะเป็น false
function getHVCheckinList(dateStr) {
  try {
    if (!dateStr) dateStr = dateToStr(new Date());
    const bookings = getDailyList(dateStr).filter(function (b) {
      return b.appointmentType === 'Home' || b.appointmentType === 'เยี่ยมบ้าน';
    });

    const houseByHN = {};
    const houseByPhone = {};  // ✅ FIX: กุญแจสำรอง กันกรณี HN ของ booking พิมพ์คลาดจาก HN ที่เคยปักหมุดไว้
    const houseByName = {};   // ✅ FIX: กุญแจสำรองอีกชั้น
    const houseSheet = HV_HOUSES_SHEET();
    if (houseSheet && houseSheet.getLastRow() >= 2) {
      houseSheet.getRange(2, 1, houseSheet.getLastRow() - 1, HV_COL_HOUSE.NOTE).getValues().forEach(function (r) {
        const hn = normalizeHN(r[HV_COL_HOUSE.HN - 1]);
        const rec = {
          houseId: r[HV_COL_HOUSE.ID - 1], address: r[HV_COL_HOUSE.ADDRESS - 1],
          lat: r[HV_COL_HOUSE.LAT - 1], lng: r[HV_COL_HOUSE.LNG - 1], status: r[HV_COL_HOUSE.STATUS - 1]
        };
        if (hn) houseByHN[hn] = rec;
        const ph = hvNormalizePhone_(r[HV_COL_HOUSE.PHONE - 1]);
        if (ph) houseByPhone[ph] = rec;
        const nm = hvNormalizeName_(r[HV_COL_HOUSE.NAME - 1]);
        if (nm) houseByName[nm] = rec;
      });
    }

    // เช็คว่า HN ไหนเช็คอินไปแล้ว "วันนี้" (เทียบจาก timestamp ของ HVVisitLog)
    const visitedTodayHN = {};
    const visitSheet = HV_VISITLOG_SHEET();
    const todayPart = Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy');
    const isToday = (dateStr === dateToStr(new Date()));
    if (isToday && visitSheet && visitSheet.getLastRow() >= 2) {
      visitSheet.getRange(2, 1, visitSheet.getLastRow() - 1, HV_COL_VISIT.NOTE).getValues().forEach(function (r) {
        const ts = String(r[HV_COL_VISIT.TS - 1] || '');
        if (ts.indexOf(todayPart) === 0) {
          const hn = normalizeHN(r[HV_COL_VISIT.HN - 1]);
          if (hn) visitedTodayHN[hn] = true;
        }
      });
    }

    const list = bookings.map(function (b) {
      const hn = normalizeHN(b.hn);
      let house = houseByHN[hn] || null;
      let hnMismatch = false;
      // ✅ FIX: หา HN ตรง ๆ ไม่เจอ → ลองเทียบเบอร์โทร/ชื่อแทน ก่อนจะสรุปว่า "ยังไม่ได้ปักหมุด"
      if (!house) {
        const ph = hvNormalizePhone_(b.phone);
        if (ph && houseByPhone[ph]) { house = houseByPhone[ph]; hnMismatch = true; }
        else {
          const nm = hvNormalizeName_(b.name);
          if (nm && houseByName[nm]) { house = houseByName[nm]; hnMismatch = true; }
        }
      }
      const lat = house ? house.lat : null;
      const lng = house ? house.lng : null;

      // ── ระยะทาง/เวลาโดยประมาณจาก รพ.สต.บางขะแยง (HV_HOME_BASE) ──
      let distanceKm = null, etaMin = null;
      if (lat !== null && lng !== null && lat !== '' && lng !== '' && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) {
        const distM = hvDistanceMeters_(HV_HOME_BASE.lat, HV_HOME_BASE.lng, parseFloat(lat), parseFloat(lng));
        if (distM !== null) {
          distanceKm = Math.round((distM / 1000) * 10) / 10;
          etaMin = Math.max(1, Math.round((distM / 1000) / HV_AVG_SPEED_KMH * 60));
        }
      }

      return {
        bookingId: b.bookingId, time: b.time, name: b.name, hn: hn, phone: b.phone,
        houseId: house ? house.houseId : '', address: house ? house.address : '',
        lat: lat, lng: lng,
        hasPin: !!house, checkedInToday: !!visitedTodayHN[hn],
        hnMismatch: hnMismatch, // ✅ true = เจอหมุดจากชื่อ/เบอร์ ไม่ใช่จาก HN ตรง ๆ — ควรตรวจ/แก้ HN ของ booking นี้
        distanceKm: distanceKm, etaMin: etaMin
      };
    });

    // เรียงลิสต์ตามระยะทางใกล้-ไกลจาก รพ.สต. — บ้านที่ยังไม่มีหมุด (คำนวณระยะทางไม่ได้) จะถูกดันไปท้ายลิสต์
    list.sort(function (a, b) {
      if (a.distanceKm === null && b.distanceKm === null) return 0;
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });

    return { success: true, date: dateStr, list: list };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// เช็คอินแบบง่าย: เจ้าหน้าที่ล็อกเป็นพลอยไพลินอัตโนมัติ, ผูกกับหมุดบ้านเดิมถ้ามี (จาก HN)
// ถ้ายังไม่เคยมีหมุด จะปักหมุดใหม่ให้อัตโนมัติด้วยพิกัด GPS ที่จับได้ตอนเช็คอิน
function processHVQuickCheckin(p) {
  try {
    const hn = normalizeHN(p.hn || '');
    const name = String(p.name || '').trim();
    const phone = String(p.phone || '').trim();
    const lat = parseFloat(p.lat), lng = parseFloat(p.lng);
    const note = String(p.note || '').trim();
    if (isNaN(lat) || isNaN(lng)) return { status: 'error', message: 'กรุณาจับตำแหน่ง GPS ก่อนเช็คอิน' };

    const staffId = hvGetOrCreatePloyStaffId_();
    if (!staffId) return { status: 'error', message: 'ยังไม่ได้ตั้งค่าโมดูลเยี่ยมบ้าน — กด "ตั้งค่าโมดูล" ก่อน' };

    const houseSheet = HV_HOUSES_SHEET();
    if (!houseSheet) return { status: 'error', message: 'ยังไม่ได้ตั้งค่าโมดูลเยี่ยมบ้าน — กด "ตั้งค่าโมดูล" ก่อน' };

    let houseId = String(p.houseId || '').trim();
    if (!houseId && hn) {
      const hit = hvFindHouseRowByHN_(houseSheet, hn); // ✅ FIX: ใช้ตัวช่วยกลางตัวเดียวกับ registerHVHouse
      if (hit) houseId = hit.values[HV_COL_HOUSE.ID - 1];
    }
    // ✅ FIX: หา HN ตรง ๆ ไม่เจอ → ลองเทียบเบอร์โทร/ชื่อก่อนตัดสินใจสร้างหมุดใหม่ กันหมุดซ้ำ/ข้อมูลกระจัดกระจาย
    //    เมื่อ HN ที่พิมพ์มาตอนเช็คอินคลาดจาก HN ที่เคยใช้ตอนปักหมุดครั้งแรก
    if (!houseId && (name || phone)) {
      const last = houseSheet.getLastRow();
      if (last >= 2) {
        const data = houseSheet.getRange(2, 1, last - 1, HV_COL_HOUSE.NOTE).getValues();
        const phN = hvNormalizePhone_(phone), nmN = hvNormalizeName_(name);
        for (let i = 0; i < data.length; i++) {
          const rowPh = hvNormalizePhone_(data[i][HV_COL_HOUSE.PHONE - 1]);
          const rowNm = hvNormalizeName_(data[i][HV_COL_HOUSE.NAME - 1]);
          if ((phN && rowPh === phN) || (nmN && rowNm === nmN)) { houseId = data[i][HV_COL_HOUSE.ID - 1]; break; }
        }
      }
    }

    if (!houseId) {
      // ยังไม่เคยมีหมุดของคนไข้รายนี้ — ปักหมุดใหม่ให้อัตโนมัติที่ตำแหน่ง GPS ปัจจุบัน
      const reg = registerHVHouse({
        hn: hn, name: name, phone: phone,
        address: (p.address || '').trim() || 'ปักหมุดอัตโนมัติจากการเช็คอินเยี่ยมบ้าน',
        category: '', note: 'สร้างหมุดอัตโนมัติจากเช็คอินเยี่ยมบ้าน', lat: lat, lng: lng
      });
      if (reg.status !== 'ok') return reg;
      houseId = reg.houseId;
    }

    return processHVVisitCheckin(staffId, houseId, lat, lng, note);
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ── [7] รูปภาพประกอบหมุด (Google Drive) ──
function hvGetPhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('HV_PHOTO_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) { /* fall through */ }
  }
  const it = DriveApp.getFoldersByName(HV_PHOTO_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(HV_PHOTO_FOLDER_NAME);
  props.setProperty('HV_PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

// p = { houseId, staffId, visitId, type ('registration'|'visit'), base64, mimeType, fileName }
function uploadHVPhoto(p) {
  try {
    const houseId = String(p.houseId || '').trim();
    if (!houseId) return { status: 'error', message: 'ไม่พบรหัสบ้าน' };
    if (!p.base64) return { status: 'error', message: 'ไม่มีข้อมูลรูปภาพ' };

    const houseSheet = HV_HOUSES_SHEET();
    const hRow = houseSheet ? hvFindRowById_(houseSheet, HV_COL_HOUSE.ID, houseId) : -1;
    if (hRow === -1) return { status: 'error', message: 'ไม่พบบ้านรหัสนี้' };
    const houseName = houseSheet.getRange(hRow, HV_COL_HOUSE.NAME).getValue();

    const staffId = String(p.staffId || '').trim();
    let staffName = '';
    if (staffId) {
      const staffSheet = HV_STAFF_SHEET();
      const sRow = hvFindRowById_(staffSheet, HV_COL_STAFF.ID, staffId);
      if (sRow !== -1) staffName = staffSheet.getRange(sRow, HV_COL_STAFF.NAME).getValue();
    }

    const mime = p.mimeType || 'image/jpeg';
    const bytes = Utilities.base64Decode(p.base64);
    const fileName = p.fileName || (houseId + '_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmmss'));
    const blob = Utilities.newBlob(bytes, mime, fileName);

    const folder = hvGetPhotoFolder_();
    const file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shareErr) { /* ตามนโยบายองค์กร */ }
    const url = 'https://drive.google.com/uc?export=view&id=' + file.getId();

    const photoSheet = HV_PHOTOS_SHEET();
    const photoId = 'PHOTO-' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMddHHmmss');
    const row = photoSheet.getLastRow() + 1;
    photoSheet.getRange(row, HV_COL_PHOTO.TS).setValue(hvNow_());
    photoSheet.getRange(row, HV_COL_PHOTO.ID).setValue(photoId);
    photoSheet.getRange(row, HV_COL_PHOTO.HOUSE_ID).setValue(houseId);
    photoSheet.getRange(row, HV_COL_PHOTO.HOUSE_NAME).setValue(houseName);
    photoSheet.getRange(row, HV_COL_PHOTO.STAFF_ID).setValue(staffId);
    photoSheet.getRange(row, HV_COL_PHOTO.STAFF_NAME).setValue(staffName);
    photoSheet.getRange(row, HV_COL_PHOTO.VISIT_ID).setValue(String(p.visitId || ''));
    photoSheet.getRange(row, HV_COL_PHOTO.TYPE).setValue(p.type || 'visit');
    photoSheet.getRange(row, HV_COL_PHOTO.URL).setValue(url);
    photoSheet.getRange(row, HV_COL_PHOTO.FILE_ID).setValue(file.getId());

    return { status: 'ok', photoId: photoId, url: url };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function getHVHousePhotos(houseId) {
  try {
    const sheet = HV_PHOTOS_SHEET();
    if (!sheet) return { status: 'ok', photos: [] };
    const last = sheet.getLastRow();
    if (last < 2) return { status: 'ok', photos: [] };
    const data = sheet.getRange(2, 1, last - 1, HV_COL_PHOTO.FILE_ID).getValues();
    const photos = data
      .filter(r => String(r[HV_COL_PHOTO.HOUSE_ID-1]).trim() === String(houseId).trim())
      .map(r => ({ timestamp: String(r[HV_COL_PHOTO.TS-1]), staffName: r[HV_COL_PHOTO.STAFF_NAME-1], type: r[HV_COL_PHOTO.TYPE-1], url: r[HV_COL_PHOTO.URL-1] }))
      .reverse();
    return { status: 'ok', photos: photos };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ── [8] ข้อมูลแผนที่สด + Dashboard ──
function getHVLiveMapData() {
  // ✅ V16.5 — แก้บั๊ก "แสดงหมุดทั้งหมด" ไม่ขึ้นเลย: เดิมทั้งฟังก์ชันอยู่ใน try/catch ก้อนเดียว
  //    ถ้าส่วนใดส่วนหนึ่ง (เช่น อ่านชีต HVStaff) พังแม้แค่แถวเดียว จะทำให้ "ทุกอย่าง" ที่ยังไม่ได้ประมวลผล
  //    (รวมถึงบ้านและ รพ.สต.บางขะแยง) หายไปหมดโดยไม่มีใครแจ้งเตือน
  //    ➜ แยก try/catch เป็นรายส่วน (staff / houses / facilities) และรายแถว เพื่อให้ 1 แถวเสีย ไม่ทำให้ข้อมูลทั้งหมดหาย
  const out = { staff: [], houses: [], facilities: [], time: hvNow_(), error: null, errors: [] };
  const staffSheet = HV_STAFF_SHEET(), houseSheet = HV_HOUSES_SHEET(), facilitySheet = HV_FACILITIES_SHEET();

  try {
    if (staffSheet && staffSheet.getLastRow() >= 2) {
      staffSheet.getRange(2, 1, staffSheet.getLastRow()-1, HV_COL_STAFF.TODAY_COUNT).getValues().forEach(r => {
        try {
          const lat = Number(r[HV_COL_STAFF.LAT-1]), lng = Number(r[HV_COL_STAFF.LNG-1]);
          if (r[HV_COL_STAFF.LAT-1] === '' || r[HV_COL_STAFF.LNG-1] === '' || r[HV_COL_STAFF.LAT-1] == null || r[HV_COL_STAFF.LNG-1] == null || isNaN(lat) || isNaN(lng)) return;
          out.staff.push({ staffId: String(r[HV_COL_STAFF.ID-1]||''), name: String(r[HV_COL_STAFF.NAME-1]||''), position: String(r[HV_COL_STAFF.POSITION-1]||''),
            lat: lat, lng: lng, status: String(r[HV_COL_STAFF.STATUS-1]||''), updated: String(r[HV_COL_STAFF.LOC_UPDATED-1]||''),
            todayCount: Number(r[HV_COL_STAFF.TODAY_COUNT-1]) || 0 });
        } catch (rowErr) { out.errors.push('staff row: ' + rowErr.message); }
      });
    }
  } catch (e) { out.errors.push('staff sheet: ' + e.message); }

  try {
    if (houseSheet && houseSheet.getLastRow() >= 2) {
      houseSheet.getRange(2, 1, houseSheet.getLastRow()-1, HV_COL_HOUSE.NOTE).getValues().forEach(r => {
        try {
          const lat = Number(r[HV_COL_HOUSE.LAT-1]), lng = Number(r[HV_COL_HOUSE.LNG-1]);
          if (r[HV_COL_HOUSE.LAT-1] === '' || r[HV_COL_HOUSE.LNG-1] === '' || r[HV_COL_HOUSE.LAT-1] == null || r[HV_COL_HOUSE.LNG-1] == null || isNaN(lat) || isNaN(lng)) return;
          out.houses.push({ houseId: String(r[HV_COL_HOUSE.ID-1]||''), hn: String(r[HV_COL_HOUSE.HN-1]||''), name: String(r[HV_COL_HOUSE.NAME-1]||''), address: String(r[HV_COL_HOUSE.ADDRESS-1]||''),
            category: String(r[HV_COL_HOUSE.CATEGORY-1]||''), lat: lat, lng: lng,
            status: String(r[HV_COL_HOUSE.STATUS-1]||''),
            lastVisit: r[HV_COL_HOUSE.LAST_VISIT-1] instanceof Date ? Utilities.formatDate(r[HV_COL_HOUSE.LAST_VISIT-1], TIMEZONE, 'dd/MM/yyyy HH:mm') : String(r[HV_COL_HOUSE.LAST_VISIT-1]||''),
            lastStaff: String(r[HV_COL_HOUSE.LAST_STAFF-1]||'') });
        } catch (rowErr) { out.errors.push('house row: ' + rowErr.message); }
      });
    }
  } catch (e) { out.errors.push('house sheet: ' + e.message); }

  try {
    if (facilitySheet && facilitySheet.getLastRow() >= 2) {
      facilitySheet.getRange(2, 1, facilitySheet.getLastRow()-1, HV_COL_FACILITY.DETAIL).getValues().forEach(r => {
        try {
          const lat = Number(r[HV_COL_FACILITY.LAT-1]), lng = Number(r[HV_COL_FACILITY.LNG-1]);
          if (r[HV_COL_FACILITY.LAT-1] === '' || r[HV_COL_FACILITY.LNG-1] === '' || r[HV_COL_FACILITY.LAT-1] == null || r[HV_COL_FACILITY.LNG-1] == null || isNaN(lat) || isNaN(lng)) return;
          out.facilities.push({ facilityId: String(r[HV_COL_FACILITY.ID-1]||''), name: String(r[HV_COL_FACILITY.NAME-1]||''), type: String(r[HV_COL_FACILITY.TYPE-1]||''),
            address: String(r[HV_COL_FACILITY.ADDRESS-1]||''), lat: lat, lng: lng, phone: String(r[HV_COL_FACILITY.PHONE-1]||''), detail: String(r[HV_COL_FACILITY.DETAIL-1]||'') });
        } catch (rowErr) { out.errors.push('facility row: ' + rowErr.message); }
      });
    }
  } catch (e) { out.errors.push('facility sheet: ' + e.message); }

  // ✅ รพ.สต.บางขะแยง (จุดฐาน HV_HOME_BASE) ต้องปรากฏบนแผนที่เสมอด้วยไอคอนเด่นชัด แม้ยังไม่ได้ลงทะเบียนในชีต HVFacilities
  //    แยก try/catch ของตัวเองเพื่อให้แสดงเสมอ แม้ชีต HVFacilities จะอ่านไม่สำเร็จก็ตาม
  try {
    const hasMainFacility = out.facilities.some(f => String(f.name||'').indexOf('บางขะแยง') !== -1);
    if (!hasMainFacility) {
      out.facilities.push({ facilityId: 'HOME_BASE', name: HV_HOME_BASE.name, type: 'หน่วยบริการหลัก',
        address: HV_HOME_BASE.address, lat: HV_HOME_BASE.lat, lng: HV_HOME_BASE.lng, phone: '', detail: '' });
    }
  } catch (e) { out.errors.push('main facility fallback: ' + e.message); }

  if (out.errors.length) out.error = out.errors.join(' | '); // ✅ ไม่ throw ออกไป — ส่งกลับ object ที่มีโครงสร้างถูกต้องเสมอ กัน client พังตอนอ่าน .houses
  return out;
}

// ── เสริมความทนทาน: แหล่งข้อมูลบ้านสำรอง สำหรับวาดหมุดบนแผนที่ (คืนค่าเฉพาะบ้านที่มีพิกัดเท่านั้น)
//    ใช้กรณี getHVLiveMapData มีปัญหาบางส่วน ฝั่ง client จะรวมผลลัพธ์ทั้งสองแหล่งกัน ไม่ให้หมุดบ้านหายไปเฉยๆ อีก ──
function getHVAllHousePins() {
  try {
    const sheet = HV_HOUSES_SHEET();
    const out = [];
    if (!sheet || sheet.getLastRow() < 2) return { status: 'ok', houses: out };
    sheet.getRange(2, 1, sheet.getLastRow()-1, HV_COL_HOUSE.NOTE).getValues().forEach(r => {
      try {
        const lat = Number(r[HV_COL_HOUSE.LAT-1]), lng = Number(r[HV_COL_HOUSE.LNG-1]);
        if (r[HV_COL_HOUSE.LAT-1] === '' || r[HV_COL_HOUSE.LNG-1] === '' || r[HV_COL_HOUSE.LAT-1] == null || r[HV_COL_HOUSE.LNG-1] == null || isNaN(lat) || isNaN(lng)) return;
        out.push({ houseId: String(r[HV_COL_HOUSE.ID-1]||''), hn: String(r[HV_COL_HOUSE.HN-1]||''), name: String(r[HV_COL_HOUSE.NAME-1]||''), address: String(r[HV_COL_HOUSE.ADDRESS-1]||''),
          category: String(r[HV_COL_HOUSE.CATEGORY-1]||''), lat: lat, lng: lng, status: String(r[HV_COL_HOUSE.STATUS-1]||''),
          lastVisit: r[HV_COL_HOUSE.LAST_VISIT-1] instanceof Date ? Utilities.formatDate(r[HV_COL_HOUSE.LAST_VISIT-1], TIMEZONE, 'dd/MM/yyyy HH:mm') : String(r[HV_COL_HOUSE.LAST_VISIT-1]||''),
          lastStaff: String(r[HV_COL_HOUSE.LAST_STAFF-1]||'') });
      } catch (rowErr) { /* ข้ามแถวเสีย */ }
    });
    return { status: 'ok', houses: out };
  } catch (e) {
    return { status: 'error', message: e.message, houses: [] };
  }
}

function getHVDashboard() {
  const houseSheet = HV_HOUSES_SHEET(), staffSheet = HV_STAFF_SHEET(), visitSheet = HV_VISITLOG_SHEET();
  const out = { totalHouses: 0, visited: 0, notVisited: 0, activeStaff: 0, recentVisits: [], time: hvNow_() };

  if (houseSheet && houseSheet.getLastRow() >= 2) {
    houseSheet.getRange(2, HV_COL_HOUSE.STATUS, houseSheet.getLastRow()-1, 1).getValues().forEach(r => {
      out.totalHouses++;
      if (String(r[0]).trim() === 'เยี่ยมแล้ว') out.visited++; else out.notVisited++;
    });
  }
  if (staffSheet && staffSheet.getLastRow() >= 2) {
    staffSheet.getRange(2, HV_COL_STAFF.STATUS, staffSheet.getLastRow()-1, 1).getValues().forEach(r => {
      if (String(r[0]).trim() === 'ออกปฏิบัติงาน') out.activeStaff++;
    });
  }
  if (visitSheet && visitSheet.getLastRow() >= 2) {
    const last = visitSheet.getLastRow();
    const start = Math.max(2, last - 19);
    out.recentVisits = visitSheet.getRange(start, 1, last - start + 1, HV_COL_VISIT.NOTE).getValues()
      .reverse()
      .map(r => ({ time: r[HV_COL_VISIT.TS-1], staff: r[HV_COL_VISIT.STAFF_NAME-1], house: r[HV_COL_VISIT.HOUSE_NAME-1], hn: r[HV_COL_VISIT.HN-1], distance: r[HV_COL_VISIT.DISTANCE-1] }));
  }
  return out;
}

// ── [9] รวม staff + house สำหรับ dropdown เลือกในหน้าเช็คอิน ──
function getHVPickerData() {
  const staffSheet = HV_STAFF_SHEET(), houseSheet = HV_HOUSES_SHEET();
  const staff = [], houses = [];
  if (staffSheet && staffSheet.getLastRow() >= 2) {
    staffSheet.getRange(2, 1, staffSheet.getLastRow()-1, HV_COL_STAFF.TODAY_COUNT).getValues().forEach(r => {
      staff.push({ staffId: r[HV_COL_STAFF.ID-1], name: r[HV_COL_STAFF.NAME-1], position: r[HV_COL_STAFF.POSITION-1] });
    });
  }
  if (houseSheet && houseSheet.getLastRow() >= 2) {
    houseSheet.getRange(2, 1, houseSheet.getLastRow()-1, HV_COL_HOUSE.NOTE).getValues().forEach(r => {
      houses.push({ houseId: r[HV_COL_HOUSE.ID-1], hn: r[HV_COL_HOUSE.HN-1], name: r[HV_COL_HOUSE.NAME-1], address: r[HV_COL_HOUSE.ADDRESS-1], status: r[HV_COL_HOUSE.STATUS-1] });
    });
  }
  return { success: true, staff: staff, houses: houses };
}

// ═══════════════════════════════════════════════════════════════
// ✅ รายงานสรุปการเยี่ยมบ้านรายเดือน (PDF) — ใช้ pattern เดียวกับ exportKPIAsExcel
//    (สร้าง Spreadsheet ชั่วคราว จัดรูปแบบ แล้ว export เป็น PDF ผ่าน URL ของ Sheets)
// ═══════════════════════════════════════════════════════════════
const HV_TH_MONTHS_ = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function hvParseVisitDate_(ts) {
  const datePart = String(ts || '').trim().split(' ')[0];
  const parts = datePart.split('/');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10), month = parseInt(parts[1], 10), year = parseInt(parts[2], 10);
  if (!day || !month || !year) return null;
  return { day: day, month: month, year: year };
}

// ── ดึงรายการเยี่ยมบ้านทั้งหมดของเดือนที่ระบุ (yearMonth = 'yyyy-MM') พร้อมกลุ่มเป้าหมายที่ join จาก HVHouses ──
function hvGetMonthlyVisits_(yearMonth) {
  const [y, m] = String(yearMonth).split('-').map(Number);
  const visits = [];
  const visitSheet = HV_VISITLOG_SHEET();
  if (visitSheet && visitSheet.getLastRow() >= 2) {
    visitSheet.getRange(2, 1, visitSheet.getLastRow() - 1, HV_COL_VISIT.NOTE).getValues().forEach(r => {
      const d = hvParseVisitDate_(r[HV_COL_VISIT.TS - 1]);
      if (!d || d.year !== y || d.month !== m) return;
      visits.push({
        ts: String(r[HV_COL_VISIT.TS - 1] || ''), day: d.day,
        staffName: r[HV_COL_VISIT.STAFF_NAME - 1] || '',
        houseId: r[HV_COL_VISIT.HOUSE_ID - 1] || '',
        houseName: r[HV_COL_VISIT.HOUSE_NAME - 1] || '',
        hn: r[HV_COL_VISIT.HN - 1] || '',
        distance: r[HV_COL_VISIT.DISTANCE - 1],
        note: r[HV_COL_VISIT.NOTE - 1] || ''
      });
    });
  }

  const categoryByHouseId = {};
  const houseSheet = HV_HOUSES_SHEET();
  if (houseSheet && houseSheet.getLastRow() >= 2) {
    houseSheet.getRange(2, 1, houseSheet.getLastRow() - 1, HV_COL_HOUSE.NOTE).getValues().forEach(r => {
      categoryByHouseId[r[HV_COL_HOUSE.ID - 1]] = r[HV_COL_HOUSE.CATEGORY - 1] || 'ไม่ระบุกลุ่ม';
    });
  }
  visits.forEach(v => { v.category = categoryByHouseId[v.houseId] || 'ไม่ระบุกลุ่ม'; });
  visits.sort((a, b) => (a.ts < b.ts ? -1 : (a.ts > b.ts ? 1 : 0)));
  return visits;
}

// ── สร้าง Spreadsheet รายงาน + export เป็น PDF (คืนไฟล์ PDF ที่ยังไม่ setSharing และสรุปสถิติ) ──
function hvExportMonthlyReportPdf_(yearMonth) {
  const [year, month] = String(yearMonth).split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) throw new Error('รูปแบบเดือนไม่ถูกต้อง (ต้องเป็น yyyy-MM)');

  const visits = hvGetMonthlyVisits_(yearMonth);
  const uniqueHouses = new Set(), uniqueStaff = new Set(), workingDays = new Set();
  const categoryCount = {};
  let distanceSum = 0, distanceN = 0;
  visits.forEach(v => {
    uniqueHouses.add(v.houseId || ('HN:' + v.hn));
    if (v.staffName) uniqueStaff.add(v.staffName);
    workingDays.add(v.day);
    categoryCount[v.category] = (categoryCount[v.category] || 0) + 1;
    if (typeof v.distance === 'number' && !isNaN(v.distance)) { distanceSum += v.distance; distanceN++; }
  });

  const monthLabel = HV_TH_MONTHS_[month] + ' ' + (year + 543);
  const stats = {
    yearMonth: yearMonth, monthLabel: monthLabel,
    totalVisits: visits.length, uniqueHouses: uniqueHouses.size,
    uniqueStaff: uniqueStaff.size, workingDays: workingDays.size,
    avgDistance: distanceN ? Math.round(distanceSum / distanceN) : null,
    categoryCount: categoryCount
  };

  // ── สร้าง Spreadsheet ชั่วคราว ──
  const newSS = SpreadsheetApp.create('รายงานเยี่ยมบ้าน ' + yearMonth);
  const sheet = newSS.getActiveSheet();
  sheet.setName('HV Monthly Report');

  let row = 1;
  sheet.getRange(row, 1, 1, 7).merge()
    .setValue('รายงานสรุปการเยี่ยมบ้าน (Home Visit) — ' + monthLabel)
    .setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center')
    .setBackground('#2d5a3d').setFontColor('#fff');
  sheet.setRowHeight(row, 30); row++;
  sheet.getRange(row, 1, 1, 7).merge()
    .setValue('รพ.สต.บางขะแยง · นางสาวพลอยไพลิน ประทีปพงศ์')
    .setFontSize(10).setHorizontalAlignment('center').setFontColor('#555');
  row += 2;

  sheet.getRange(row, 1, 1, 7).merge().setValue('สรุปภาพรวม')
    .setFontWeight('bold').setBackground('#e8f5e9');
  row++;
  [
    ['จำนวนครั้งที่เยี่ยม', stats.totalVisits + ' ครั้ง'],
    ['บ้านที่เยี่ยม (ไม่ซ้ำ)', stats.uniqueHouses + ' หลัง'],
    ['วันที่ออกเยี่ยม', stats.workingDays + ' วัน'],
    ['ระยะห่างพิกัดเฉลี่ยตอนเช็คอิน', (stats.avgDistance !== null ? stats.avgDistance + ' เมตร' : '-')]
  ].forEach(([label, val]) => {
    sheet.getRange(row, 1, 1, 2).merge().setValue(label).setFontWeight('bold').setFontColor('#374151');
    sheet.getRange(row, 3, 1, 2).merge().setValue(val).setFontColor('#1a56db').setFontWeight('bold');
    row++;
  });
  row++;

  sheet.getRange(row, 1, 1, 7).merge().setValue('จำนวนเยี่ยมแยกตามกลุ่มเป้าหมาย')
    .setFontWeight('bold').setBackground('#e8f5e9');
  row++;
  const catEntries = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]);
  if (catEntries.length) {
    catEntries.forEach(([cat, count]) => {
      sheet.getRange(row, 1, 1, 4).merge().setValue(cat);
      sheet.getRange(row, 5, 1, 2).merge().setValue(count + ' ครั้ง');
      row++;
    });
  } else {
    sheet.getRange(row, 1, 1, 7).merge().setValue('— ไม่มีข้อมูล —').setFontColor('#9ca3af');
    row++;
  }
  row++;

  const headers = ['วันที่/เวลา', 'เจ้าหน้าที่', 'ชื่อบ้าน/ผู้ป่วย', 'HN', 'กลุ่มเป้าหมาย', 'ระยะห่างพิกัด (ม.)', 'หมายเหตุ'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1e3f2a').setFontColor('#fff');
  sheet.setFrozenRows(row);
  row++;
  if (visits.length) {
    const dataRows = visits.map(v => [v.ts, v.staffName, v.houseName, v.hn, v.category, (typeof v.distance === 'number' ? v.distance : ''), v.note]);
    sheet.getRange(row, 1, dataRows.length, headers.length).setValues(dataRows);
    row += dataRows.length;
  } else {
    sheet.getRange(row, 1, 1, headers.length).merge()
      .setValue('ไม่มีข้อมูลการเยี่ยมบ้านในเดือนนี้').setHorizontalAlignment('center').setFontColor('#9ca3af');
    row++;
  }

  sheet.autoResizeColumns(1, 7);
  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(3, 170);
  sheet.setColumnWidth(7, 200);

  const exportDateStr = Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm');
  row += 1;
  sheet.getRange(row, 1, 1, 7).merge()
    .setValue('สร้างโดยระบบ PT Station · ' + exportDateStr + ' น.')
    .setFontSize(8).setFontStyle('italic').setFontColor('#9e9e9e').setHorizontalAlignment('center');

  SpreadsheetApp.flush();
  Utilities.sleep(1500);

  // ── Export PDF แนวตั้ง (portrait) A4 — fit ความกว้างให้พอดีหน้า ──
  const ssId = newSS.getId();
  const shId = sheet.getSheetId();
  const exportUrl = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export'
    + '?format=pdf&size=A4&portrait=true&scale=2'
    + '&gridlines=false&printtitle=false&sheetnames=false'
    + '&top_margin=0.3&bottom_margin=0.3&left_margin=0.3&right_margin=0.3'
    + '&horizontal_alignment=CENTER&vertical_alignment=TOP'
    + '&gid=' + shId;
  const oauthToken = ScriptApp.getOAuthToken();
  const resp = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: 'Bearer ' + oauthToken },
    muteHttpExceptions: true
  });

  let pdfFile;
  if (resp.getResponseCode() === 200) {
    pdfFile = DriveApp.createFile(resp.getBlob().setName('รายงานเยี่ยมบ้าน ' + yearMonth + '.pdf'));
  } else {
    pdfFile = DriveApp.createFile(newSS.getAs('application/pdf').setName('รายงานเยี่ยมบ้าน ' + yearMonth + '.pdf'));
  }
  DriveApp.getFileById(ssId).setTrashed(true);

  return { pdfFile: pdfFile, stats: stats };
}

// ── เรียกจากปุ่มในหน้าเว็บ: สร้าง PDF, แชร์ลิงก์, คืน URL ให้ดาวน์โหลด/เปิดดู ──
function exportHVMonthlyReportPDF(yearMonth) {
  try {
    const { pdfFile } = hvExportMonthlyReportPdf_(yearMonth);
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return pdfFile.getDownloadUrl();
  } catch (e) {
    Logger.log('exportHVMonthlyReportPDF Error: ' + e.message);
    return { error: e.message };
  }
}

// ── ใช้โดย trigger อัตโนมัติ: สร้าง PDF แล้วส่งอีเมลแนบไฟล์ทันที (ไม่เก็บสำเนาถาวรใน Drive) ──
function sendHVMonthlyReportEmail_(yearMonth) {
  try {
    const { pdfFile, stats } = hvExportMonthlyReportPdf_(yearMonth);
    const blob = pdfFile.getBlob();
    const subject = 'รายงานสรุปการเยี่ยมบ้าน ' + stats.monthLabel + ' — รพ.สต.บางขะแยง';
    const body = 'เรียนผู้เกี่ยวข้อง\n\n'
      + 'ระบบสรุปข้อมูลการเยี่ยมบ้านประจำเดือน ' + stats.monthLabel + ' โดยอัตโนมัติ ดังนี้\n\n'
      + '- จำนวนครั้งที่เยี่ยม: ' + stats.totalVisits + ' ครั้ง\n'
      + '- บ้านที่เยี่ยม (ไม่ซ้ำ): ' + stats.uniqueHouses + ' หลัง\n'
      + '- วันที่ออกเยี่ยม: ' + stats.workingDays + ' วัน\n'
      + '- ระยะห่างพิกัดเฉลี่ยตอนเช็คอิน: ' + (stats.avgDistance !== null ? stats.avgDistance + ' เมตร' : '-') + '\n\n'
      + 'รายละเอียดทั้งหมดอยู่ในไฟล์ PDF ที่แนบมาพร้อมนี้\n\n'
      + '— ระบบ PT Station (ส่งอัตโนมัติ ไม่ต้องตอบกลับอีเมลฉบับนี้)';
    GmailApp.sendEmail(NOTIFY_EMAIL, subject, body, { attachments: [blob], name: 'ระบบเยี่ยมบ้าน PT Station' });
    pdfFile.setTrashed(true);
    return { success: true, stats: stats };
  } catch (e) {
    Logger.log('sendHVMonthlyReportEmail_ Error: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── ฟังก์ชันที่ trigger รายเดือนเรียก: ส่งรายงานของ "เดือนก่อนหน้า" ทุกวันที่ 1 ──
function runHVMonthlyReportAutoSend() {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yearMonth = Utilities.formatDate(prevMonth, TIMEZONE, 'yyyy-MM');
  const result = sendHVMonthlyReportEmail_(yearMonth);
  Logger.log('[HV Monthly Report] auto-send ' + yearMonth + ': ' + JSON.stringify(result));
  return result;
}

// ── รันครั้งเดียวหลัง deploy เพื่อตั้ง trigger อัตโนมัติ (ทุกวันที่ 1 ของเดือน ~07:00 น.) ──
function setupHVMonthlyReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runHVMonthlyReportAutoSend') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runHVMonthlyReportAutoSend')
    .timeBased()
    .onMonthDay(1)
    .atHour(7)
    .create();
  return '✅ ตั้ง trigger ส่งรายงานเยี่ยมบ้านอัตโนมัติแล้ว: ทุกวันที่ 1 ของเดือน ช่วงเวลา ~07:00 น. (ส่งอีเมลสรุปของเดือนก่อนหน้าไปที่ ' + NOTIFY_EMAIL + ')';
}
// ════════════════════════════════════════════════════════════════════════
// ═══  ไฟล์รวม: LineDailyNotify.gs  (ผสานเข้ากับ Code.gs หลักเป็นไฟล์เดียว)  ═══
// ════════════════════════════════════════════════════════════════════════

// ============================================================
//  LineDailyNotify.gs — PT Station: แจ้งเตือนรายชื่อผู้ป่วยประจำวัน ผ่าน LINE
// ------------------------------------------------------------
//  ออกแบบสำหรับส่งสรุปงานประจำวัน (OPD + เยี่ยมบ้าน) ให้ "ผู้ดูแลระบบ/
//  นักกายภาพบำบัด" ทุกคนที่ลงทะเบียนผ่าน LINE โดยอัตโนมัติ ทุกเช้า
//  เวลา 07:00–08:00 น. พร้อมปุ่ม "ดูรายละเอียด" ต่อเคส (postback)
//
//  ไฟล์นี้เป็นไฟล์ "เพิ่มเติม" ในโปรเจกต์ Apps Script เดียวกับ Code.gs
//  ของระบบ PT Station เดิม จึงเรียกใช้ฟังก์ชัน/ค่าคงที่ที่มีอยู่แล้ว
//  ได้ทันที (ไม่ประกาศซ้ำ เพื่อไม่ให้ชนกัน): TIMEZONE, getSheet(),
//  getSpreadsheet(), dateToStr(), parseFlexDate(), normalizeHN(),
//  buildTherapistMap(), getBookingsForDate(), getHoliday(), isWeekend(),
//  getHVCheckinList(), getVisitFullDetail(), getNotificationSummary(),
//  getWorkloadSummary(), NOTIFY_EMAIL, HV_COL_HOUSE, HV_HOUSES_SHEET()
//
//  ✅ ตรวจสอบความเข้ากันได้กับ Code.gs (PT Station V15.1) แล้ว:
//     ฟังก์ชัน/ค่าคงที่ทั้งหมดที่เรียกใช้มีอยู่จริงและคืนค่าตรงตาม
//     โครงสร้างที่โค้ดนี้คาดหวัง ไม่มีการประกาศ doPost ซ้ำใน Code.gs
//
//  ⚠️ ความปลอดภัยของข้อมูลผู้ป่วย (PDPA):
//   - ข้อความสรุปจะ "บังนามสกุล" ของผู้ป่วยเป็นค่าเริ่มต้น
//     (ปิดได้ด้วย ptlnSetMaskNames(false) ถ้าต้องการเห็นชื่อเต็ม)
//   - ผู้ที่แอดไลน์เข้ามาใหม่จะถูกตั้งสถานะ "pending" เสมอ ต้องให้
//     แอดมินเข้าไปเปลี่ยนเป็น "active" ในชีต LineStaff ก่อน จึงจะเริ่ม
//     ได้รับข้อมูลผู้ป่วย — กันคนนอกที่ไม่เกี่ยวข้องเห็นข้อมูลสุขภาพ
//
//  🔐 โทเคน/ความลับของช่องทาง LINE (Channel Access Token, Channel
//     Secret) ต้องถูกเก็บไว้ใน Project Settings ▸ Script Properties
//     เท่านั้น (คีย์ชื่อ LINE_CHANNEL_ACCESS_TOKEN) — ห้ามฝังในโค้ด
//     ห้ามวางในแชทหรือเอกสารที่แชร์ต่อ หากเคยพิมพ์/วางโทเคนไว้ที่ใด
//     ก็ตามนอกเหนือจาก Script Properties ให้ถือว่าหลุดแล้วและไป
//     Reissue token ใหม่ทันทีที่ LINE Developers Console
// ============================================================

// ════════════════════════════════════════════════════════════
//  0) CONFIG
// ════════════════════════════════════════════════════════════
const PTLN_LINE_TOKEN_ = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '';

const PTLN_SHEET_STAFF_    = 'LineStaff';                 // ชีตเก็บรายชื่อผู้รับแจ้งเตือน (แอดมิน/นักกายภาพ)
const PTLN_STAFF_HEADERS_  = ['UserId', 'ชื่อที่แสดง', 'บทบาท', 'สถานะ', 'ลงทะเบียนเมื่อ', 'อัปเดตล่าสุด'];

const PTLN_PROP_ENABLED_   = 'LN_DAILY_NOTIFY_ENABLED';   // 'true' | 'false'
const PTLN_PROP_MASK_      = 'LN_MASK_PATIENT_NAMES';     // 'true' | 'false' (ค่าเริ่มต้น = true)
const PTLN_TRIGGER_FN_     = 'ptlnRunDailyNotify';

// ── V2: สรุปพรุ่งนี้ 20:00 + ตรวจสอบการลงข้อมูล 15:30 ──
const PTLN_PROP_EVENING_ENABLED_  = 'LN_EVENING_NOTIFY_ENABLED';  // ค่าเริ่มต้น = เปิด
const PTLN_PROP_AUDIT_ENABLED_    = 'LN_AUDIT_NOTIFY_ENABLED';    // ค่าเริ่มต้น = เปิด
const PTLN_TRIGGER_TICK_FN_       = 'ptlnTick';
const PTLN_AUDIT_CUTOFF_HHMM_     = '15:30';  // นัดที่เริ่มตั้งแต่เวลานี้เป็นต้นไป = ยังไม่ถึงเวลา ไม่นับว่าตกหล่น
const PTLN_AUDIT_SEND_WHEN_CLEAN_ = true;     // true = ส่งการ์ด "ลงครบทุกราย" ด้วย (ยืนยันว่า audit ทำงานจริง)
const PTLN_COLOR_EVE_             = '#3F51B5'; // น้ำเงินคราม (การ์ดพรุ่งนี้ — แยกสายตาจากการ์ดสรุปเช้า)
const PTLN_COLOR_AUDIT_           = '#D9822B'; // ส้ม (รายงานตรวจสอบ)
const PTLN_SCHEDULE_ = [
  // audit รายวัน 15:30 — วันทำการสุดท้ายของสัปดาห์ (ปกติ=ศุกร์) ให้สรุปสัปดาห์ตรวจแทน (ฝังเป็นการ์ดสุดท้าย) จะได้ข้อความเดียว
  { job: 'audit',   hour: 15, minute: 30, windowMin: 14,
    skipWhen: function (todayStr) { return ptlnIsWeeklyNotifyEnabled_() && ptlnWkIsLastWorkday_(todayStr); },
    run: function (o) { return ptlnRunAuditReport(o); } },
  { job: 'evening', hour: 20, minute: 0,  windowMin: 14, run: function (o) { return ptlnRunEveningPreview(o); } },
  // สรุปสัปดาห์เชิงคลินิก 15:30 — ส่งเฉพาะวันทำการสุดท้ายของสัปดาห์ (LineBooking.gs)
  { job: 'weeklyclin', hour: 15, minute: 30, windowMin: 14,
    onlyWhen: function (todayStr) { return ptlnWkIsLastWorkday_(todayStr); },
    run: function (o) { return ptlnRunWeeklyClinical(o); } }
];

const PTLN_ROWS_PER_BUBBLE_ = 8;   // จำนวนแถวผู้ป่วยต่อ 1 การ์ด ก่อนขึ้นการ์ดใหม่
const PTLN_BUBBLES_PER_MSG_ = 12;  // ข้อจำกัดของ LINE: carousel 1 ข้อความ ≤ 12 การ์ด
const PTLN_MSGS_PER_CALL_   = 5;   // ข้อจำกัดของ LINE: multicast/push ≤ 5 ข้อความ/ครั้ง

// สีธีม (ให้เข้ากับแบรนด์ "พลอยไพลิน กายภาพบำบัด")
const PTLN_COLOR_BRAND_      = '#B23A63'; // กุหลาบเข้ม (หัวข้อสรุป)
const PTLN_COLOR_BRAND_SOFT_ = '#FBE7EC'; // ชมพูอ่อน (พื้นหลังตัวเลข)
const PTLN_COLOR_OPD_        = '#0D6E6E'; // เขียวอมฟ้า (โซน OPD)
const PTLN_COLOR_HOME_       = '#B36B00'; // ส้มทอง (โซนเยี่ยมบ้าน)
const PTLN_COLOR_WARN_       = '#C0392B'; // แดง (แจ้งเตือน/คำขอค้าง)
const PTLN_COLOR_TEXT_SOFT_  = '#8A8A8A';

const PTLN_TH_DAYS_   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const PTLN_TH_MONTHS_ = ['', 'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                          'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

// ════════════════════════════════════════════════════════════
//  1) TOGGLE เปิด/ปิดการส่งอัตโนมัติ
// ════════════════════════════════════════════════════════════
function ptlnSetDailyNotifyEnabled(on) {
  PropertiesService.getScriptProperties().setProperty(PTLN_PROP_ENABLED_, on ? 'true' : 'false');
  return (on ? '✅ เปิด' : '⏸️ ปิด') + 'การส่งแจ้งเตือนอัตโนมัติประจำวันแล้ว';
}
function ptlnIsDailyNotifyEnabled_() {
  return PropertiesService.getScriptProperties().getProperty(PTLN_PROP_ENABLED_) === 'true';
}
// เรียกจาก Apps Script Editor เพื่อเปิด/ปิดแบบเร็ว ๆ
function ptlnEnable()  { return ptlnSetDailyNotifyEnabled(true); }
function ptlnDisable() { return ptlnSetDailyNotifyEnabled(false); }

// ── mask ชื่อผู้ป่วย (ค่าเริ่มต้น = ปิด ตามที่ผู้ใช้ขอให้แสดงชื่อเต็ม) ──
function ptlnSetMaskNames(on) {
  PropertiesService.getScriptProperties().setProperty(PTLN_PROP_MASK_, on ? 'true' : 'false');
  return 'ตั้งค่าการบังชื่อผู้ป่วย: ' + (on ? 'เปิด' : 'ปิด');
}
function ptlnIsMaskNamesOn_() {
  const v = PropertiesService.getScriptProperties().getProperty(PTLN_PROP_MASK_);
  return v === 'true'; // ยังไม่เคยตั้งค่า -> แสดงชื่อเต็ม (ตามที่ขอ) — เปิดบังชื่อได้ด้วย ptlnSetMaskNames(true)
}

// ════════════════════════════════════════════════════════════
//  2) ตั้ง/ลบ Trigger เวลา 07:00–08:00 น. ทุกวัน
//     (Apps Script atHour(7) จะสุ่มรันภายในช่วง 07:00–07:59 น. ให้เอง)
// ════════════════════════════════════════════════════════════
function ptlnSetupDailyTrigger() {
  ptlnRemoveDailyTrigger();
  ScriptApp.newTrigger(PTLN_TRIGGER_FN_)
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(0)
    .inTimezone(Session.getScriptTimeZone() || 'Asia/Bangkok')
    .create();
  return '✅ ตั้งเวลาส่งแจ้งเตือนอัตโนมัติแล้ว: ช่วง 07:00–08:00 น. (โค้ดข้ามวันเสาร์–อาทิตย์ให้อัตโนมัติ) (ฟังก์ชัน ' + PTLN_TRIGGER_FN_ + ')';
}
function ptlnRemoveDailyTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === PTLN_TRIGGER_FN_) { ScriptApp.deleteTrigger(t); removed++; }
  });
  return removed ? ('ลบ trigger เดิม ' + removed + ' รายการ') : 'ไม่มี trigger เดิม';
}

// ════════════════════════════════════════════════════════════
//  3) ฟังก์ชันหลัก — เรียกจาก Trigger ทุกเช้า
// ════════════════════════════════════════════════════════════
function ptlnRunDailyNotify(trigEvent) {
  // trigEvent = event object จาก trigger (มีค่าเมื่อ trigger เรียก / ว่างเมื่อรันเองจาก Editor)
  var auto = !!(trigEvent && typeof trigEvent === 'object');
  if (!ptlnIsDailyNotifyEnabled_()) {
    Logger.log('[LineDailyNotify] ปิดใช้งานอยู่ (ptlnSetDailyNotifyEnabled(false)) — ข้ามการส่ง');
    return;
  }
  var todayKey = dateToStr(new Date());
  // ✅ V2: ไม่ส่งสรุปประจำวันในวันเสาร์–อาทิตย์ (ใช้กับ trigger อัตโนมัติ; รันเองจาก Editor/พิมพ์ "สรุปวันนี้" ยังส่งได้)
  if (auto && ptlnIsWeekendStr_(todayKey)) {
    Logger.log('[LineDailyNotify] วันเสาร์/อาทิตย์ — ข้ามการส่งสรุปประจำวัน');
    return;
  }
  // ✅ V2: กัน trigger ยิงซ้ำ → ส่งซ้ำสองรอบ
  if (auto && !ptlnClaimRun_('daily', todayKey)) {
    Logger.log('[LineDailyNotify] ส่งของวันที่ ' + todayKey + ' ไปแล้ว — ข้าม');
    return;
  }
  try {
    var userIds = ptlnGetActiveStaffIds_();
    if (!userIds.length) {
      Logger.log('[LineDailyNotify] ยังไม่มีผู้รับที่สถานะ active ในชีต ' + PTLN_SHEET_STAFF_);
      if (auto) ptlnReleaseRun_('daily', todayKey);
      return;
    }

    var dateStr   = dateToStr(new Date());
    var data      = ptlnBuildDailyData_(dateStr);
    var bubbles   = ptlnBuildDailyBubbles_(data);
    var messages  = ptlnPackBubblesToMessages_(bubbles, '📋 สรุปงานวันนี้ ' + data.thaiDateLabel);

    ptlnSendMessagesToMany_(userIds, messages);
    Logger.log('[LineDailyNotify] ส่งสำเร็จถึง ' + userIds.length + ' คน สำหรับวันที่ ' + dateStr);

  } catch (e) {
    if (auto && !(e && e.sentAny)) ptlnReleaseRun_('daily', todayKey); // ส่งไม่ออกเลย → ปล่อยให้ลองใหม่ได้
    Logger.log('[LineDailyNotify] ERROR: ' + e.message);
    try {
      GmailApp.sendEmail(NOTIFY_EMAIL,
        '⚠️ [PT Station] ส่งแจ้งเตือน LINE ประจำวันไม่สำเร็จ',
        'เกิดข้อผิดพลาดตอนส่งสรุปงานประจำวันผ่าน LINE:\n\n' + e.message +
        '\n\nกรุณาตรวจสอบ Apps Script Editor > Executions');
    } catch (mailErr) { /* เงียบไว้ ไม่ให้ล้มซ้อนกัน */ }
  }
}

// ════════════════════════════════════════════════════════════
//  4) รวบรวมข้อมูลผู้ป่วยวันนี้ (ใช้ฟังก์ชันเดิมของระบบทั้งหมด)
// ════════════════════════════════════════════════════════════
function ptlnBuildDailyData_(dateStr, mode) {
  var d = new Date(dateStr + 'T00:00:00');
  var thaiDateLabel = 'วัน' + PTLN_TH_DAYS_[d.getDay()] + 'ที่ ' + d.getDate() + ' ' +
    PTLN_TH_MONTHS_[d.getMonth() + 1] + ' ' + (d.getFullYear() + 543);

  var holiday   = getHoliday(dateStr);             // ฟังก์ชันเดิมใน Code.gs
  var isClosed  = !!holiday || ptlnIsWeekendStr_(dateStr);  // ✅ V2: ไม่พึ่ง new Date('yyyy-mm-dd') แบบ UTC

  var opdList = [], homeList = [];

  if (!isClosed) {
    var tMap = buildTherapistMap();               // ฟังก์ชันเดิมใน Code.gs
    var all  = getBookingsForDate(dateStr);        // ฟังก์ชันเดิมใน Code.gs

    all.forEach(function (b) {
      if (normalizeHN(b.hn) === 'BLOCK') return;
      var row = {
        bookingId: b.bookingId, time: b.time, name: b.name || '',
        hn: normalizeHN(b.hn), rights: b.rights || '',
        treatmentType: b.treatmentType || '',
        therapistName: tMap[b.therapistId] || 'ไม่ระบุ',
        status: b.status || ''
      };
      if (b.appointmentType === 'Home' || b.appointmentType === 'เยี่ยมบ้าน') homeList.push(row);
      else opdList.push(row);
    });

    opdList.sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });

    // ✅ ใช้ getHVCheckinList() เดิม เพื่อได้ระยะทาง/เวลาโดยประมาณจาก รพ.สต. มาด้วย (เรียงใกล้→ไกล)
    try {
      var hv = getHVCheckinList(dateStr);
      if (hv && hv.success && hv.list) {
        var hvByBooking = {};
        hv.list.forEach(function (h) { hvByBooking[h.bookingId] = h; });
        homeList.forEach(function (row) {
          var h = hvByBooking[row.bookingId];
          if (h) { row.address = h.address || ''; row.distanceKm = h.distanceKm; row.etaMin = h.etaMin; row.hasPin = h.hasPin; }
        });
        homeList.sort(function (a, b) {
          var da = (a.distanceKm === undefined || a.distanceKm === null) ? 9999 : a.distanceKm;
          var db = (b.distanceKm === undefined || b.distanceKm === null) ? 9999 : b.distanceKm;
          return da - db;
        });
      }
    } catch (hvErr) { Logger.log('ptlnBuildDailyData_ HV merge (ไม่ร้ายแรง): ' + hvErr.message); }
  }

  // ✅ ใช้ getNotificationSummary() เดิม เพื่อดึงจำนวนคำขอจองที่รอดำเนินการ
  var pendingRequests = 0;
  try {
    var ns = getNotificationSummary();
    if (ns && ns.success) pendingRequests = ns.pendingRequests || 0;
  } catch (nsErr) { /* ไม่ร้ายแรง */ }

  return {
    dateStr: dateStr, mode: mode || 'today', thaiDateLabel: thaiDateLabel, isClosed: isClosed,
    holidayReason: holiday || (ptlnIsWeekendStr_(dateStr) ? 'วันหยุดสุดสัปดาห์' : ''),
    opdList: opdList, homeList: homeList,
    opdCount: opdList.length, homeCount: homeList.length,
    totalCount: opdList.length + homeList.length,
    pendingRequests: pendingRequests
  };
}

// ════════════════════════════════════════════════════════════
//  5) สร้าง Flex Message (การ์ดสรุป + การ์ดรายชื่อ)
// ════════════════════════════════════════════════════════════
function ptlnBuildDailyBubbles_(data) {
  var bubbles = [ptlnBuildSummaryBubble_(data)];
  if (!data.isClosed) {
    bubbles = bubbles.concat(ptlnBuildListBubbles_(data.opdList,  { icon: '🏥', title: 'ผู้ป่วยนอก (OPD)',        color: PTLN_COLOR_OPD_,  dateStr: data.dateStr, kind: 'opd'  }));
    bubbles = bubbles.concat(ptlnBuildListBubbles_(data.homeList, { icon: '🏠', title: 'เยี่ยมบ้าน (Home Visit)', color: PTLN_COLOR_HOME_, dateStr: data.dateStr, kind: 'home' }));
  }
  return bubbles;
}

// ── การ์ดที่ 1: สรุปภาพรวมวันนี้ ──
function ptlnBuildSummaryBubble_(data) {
  var bodyContents;
  var isTomorrow = data.mode === 'tomorrow';

  if (data.isClosed) {
    bodyContents = [
      { type: 'text', text: '📅 ' + data.thaiDateLabel, weight: 'bold', size: 'md', color: '#111111', wrap: true },
      { type: 'text', text: isTomorrow ? 'พรุ่งนี้หยุดทำการ' : 'วันนี้หยุดทำการ', color: PTLN_COLOR_WARN_, weight: 'bold', size: 'lg', margin: 'lg' },
      { type: 'text', text: 'เหตุผล: ' + (data.holidayReason || '-'), size: 'sm', color: PTLN_COLOR_TEXT_SOFT_, wrap: true, margin: 'sm' }
    ];
  } else {
    bodyContents = [
      { type: 'text', text: '📅 ' + data.thaiDateLabel, weight: 'bold', size: 'md', color: '#111111', wrap: true },
      { type: 'text', text: isTomorrow ? 'ตารางนัดล่วงหน้า (พรุ่งนี้)' : 'สรุปงานกายภาพบำบัดวันนี้', size: 'sm', color: PTLN_COLOR_TEXT_SOFT_, margin: 'xs' },
      {
        type: 'box', layout: 'horizontal', margin: 'lg', spacing: 'sm',
        contents: [
          ptlnStatBox_('รวมทั้งหมด', data.totalCount, PTLN_COLOR_BRAND_),
          ptlnStatBox_('OPD', data.opdCount, PTLN_COLOR_OPD_),
          ptlnStatBox_('เยี่ยมบ้าน', data.homeCount, PTLN_COLOR_HOME_)
        ]
      }
    ];

    if (data.pendingRequests > 0) {
      bodyContents.push({ type: 'separator', margin: 'lg' });
      bodyContents.push({
        type: 'box', layout: 'horizontal', margin: 'lg', spacing: 'sm', alignItems: 'center',
        contents: [
          { type: 'text', text: '⏳', flex: 0 },
          { type: 'text', text: 'มีคำขอนัดใหม่รอตรวจสอบ ' + data.pendingRequests + ' รายการ', size: 'sm', color: PTLN_COLOR_WARN_, wrap: true, weight: 'bold' }
        ]
      });
    }

    bodyContents.push({ type: 'separator', margin: 'lg' });
    bodyContents.push({ type: 'text', text: 'แตะรายชื่อในการ์ดถัดไปเพื่อดูรายละเอียดแต่ละเคส', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'md', wrap: true });
  }

  return {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: isTomorrow ? PTLN_COLOR_EVE_ : PTLN_COLOR_BRAND_, paddingAll: '20px',
      contents: [
        { type: 'text', text: isTomorrow ? 'PT STATION • 🌙 ล่วงหน้า' : 'PT STATION', color: '#FFFFFFAA', size: 'xs', weight: 'bold' },
        { type: 'text', text: isTomorrow ? 'ตารางนัดพรุ่งนี้' : 'สรุปงานประจำวัน', color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'sm' }
      ]
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: bodyContents }
  };
}

function ptlnStatBox_(label, value, color) {
  return {
    type: 'box', layout: 'vertical', flex: 1, backgroundColor: PTLN_COLOR_BRAND_SOFT_,
    cornerRadius: '10px', paddingAll: '10px', alignItems: 'center',
    contents: [
      { type: 'text', text: String(value), size: 'xl', weight: 'bold', color: color, align: 'center' },
      { type: 'text', text: label, size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, align: 'center', margin: 'xs', wrap: true }
    ]
  };
}

// ── การ์ดรายชื่อ (แบ่งเป็นชุดละ PTLN_ROWS_PER_BUBBLE_ แถว) ──
function ptlnBuildListBubbles_(list, opt) {
  if (!list.length) return [];
  var chunks = [];
  for (var i = 0; i < list.length; i += PTLN_ROWS_PER_BUBBLE_) chunks.push(list.slice(i, i + PTLN_ROWS_PER_BUBBLE_));

  return chunks.map(function (chunk, idx) {
    var pageLabel = chunks.length > 1 ? ' (' + (idx + 1) + '/' + chunks.length + ')' : '';
    var rows = [];
    chunk.forEach(function (item, i) {
      if (i > 0) rows.push({ type: 'separator', margin: 'md' });
      rows.push(ptlnBuildRow_(item, opt));
    });

    return {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'horizontal', backgroundColor: opt.color, paddingAll: '16px', alignItems: 'center',
        contents: [
          { type: 'text', text: opt.icon + ' ' + opt.title + pageLabel, color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true, flex: 1 },
          { type: 'text', text: String(list.length) + ' ราย', color: '#FFFFFFCC', size: 'xs', align: 'end' }
        ]
      },
      body: { type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'md', contents: rows }
    };
  });
}

function ptlnBuildRow_(item, opt) {
  var displayName = ptlnIsMaskNamesOn_() ? ptlnMaskThaiName_(item.name) : item.name;
  var subLine = 'HN ' + item.hn + (item.rights ? ' • ' + item.rights : '');
  var thirdLine = opt.kind === 'opd'
    ? (item.therapistName || '') + (item.treatmentType ? ' • ' + item.treatmentType : '')
    : (item.address ? item.address : 'ยังไม่ปักหมุดที่อยู่') + (typeof item.distanceKm === 'number' ? '  •  ~' + item.distanceKm + ' กม.' : '');

  var tapRow = {
    type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center',
    action: { type: 'postback', data: 'act=case&kind=' + opt.kind + '&b=' + encodeURIComponent(item.bookingId) + '&d=' + opt.dateStr, displayText: '📋 ' + displayName },
    contents: [
      { type: 'box', layout: 'vertical', flex: 0, width: '54px', alignItems: 'center', justifyContent: 'center', backgroundColor: PTLN_COLOR_BRAND_SOFT_, cornerRadius: '8px', paddingAll: '6px',
        contents: [{ type: 'text', text: item.time || '-', size: 'xs', weight: 'bold', color: opt.color, align: 'center' }] },
      { type: 'box', layout: 'vertical', flex: 1,
        contents: [
          { type: 'text', text: displayName || 'ไม่ระบุชื่อ', weight: 'bold', size: 'sm', wrap: true, color: '#111111' },
          { type: 'text', text: subLine, size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, wrap: true, margin: 'xs' },
          { type: 'text', text: thirdLine, size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, wrap: true, margin: 'xs' }
        ] },
      { type: 'text', text: '›', size: 'lg', color: PTLN_COLOR_TEXT_SOFT_, flex: 0, gravity: 'center' }
    ]
  };

  // ✅ NEW: ปุ่ม "ดูประวัติล่าสุด" แยกไว้ใต้แถวเลย กดได้ทันทีจากข้อความสรุปประจำวัน
  // ไม่ต้องกดเข้าไปดูรายละเอียดเต็มก่อนแล้วค่อยกดปุ่มในนั้นอีกที (act=history ตัวเดียวกับ
  // ที่ใช้ในการ์ดรายละเอียด → ptlnBuildHistoryBubble_) เป็น action แยกจาก action ของ tapRow
  // ด้านบน เพราะเป็นคนละ component กัน (sibling) กดโดนปุ่มนี้จะไม่ไปโดน action ของแถวหลัก
  var historyBtn = {
    type: 'box', layout: 'horizontal', paddingStart: '66px', margin: 'sm',
    contents: [
      { type: 'button', style: 'link', height: 'sm', gravity: 'center', color: opt.color,
        action: {
          type: 'postback',
          label: '📜 ดูประวัติล่าสุด',
          data: 'act=history&hn=' + encodeURIComponent(item.hn) + '&b=' + encodeURIComponent(item.bookingId) + '&kind=' + opt.kind,
          displayText: '📜 ดูประวัติล่าสุด: ' + displayName
        } }
    ]
  };

  return { type: 'box', layout: 'vertical', spacing: 'none', contents: [tapRow, historyBtn] };
}

// ════════════════════════════════════════════════════════════
// ✅ NEW: พิมพ์ "ปักหมุด" → การ์ดเลือกผู้ป่วยเยี่ยมบ้านของวันนี้ เพื่อเลือกคนที่จะปักหมุดพิกัด GPS ให้
// จำกัดเฉพาะ kind='home' เพราะมีแต่เคสเยี่ยมบ้านเท่านั้นที่ต้องการพิกัด GPS ของบ้าน
// ════════════════════════════════════════════════════════════
function ptlnBuildPinPickerBubbles_(homeList, dateStr) {
  if (!homeList.length) return [];
  var chunks = [];
  for (var i = 0; i < homeList.length; i += PTLN_ROWS_PER_BUBBLE_) chunks.push(homeList.slice(i, i + PTLN_ROWS_PER_BUBBLE_));

  return chunks.map(function (chunk, idx) {
    var pageLabel = chunks.length > 1 ? ' (' + (idx + 1) + '/' + chunks.length + ')' : '';
    var rows = [];
    chunk.forEach(function (item, i) {
      if (i > 0) rows.push({ type: 'separator', margin: 'md' });
      rows.push(ptlnBuildPinPickRow_(item, dateStr));
    });

    return {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'horizontal', backgroundColor: PTLN_COLOR_HOME_, paddingAll: '16px', alignItems: 'center',
        contents: [
          { type: 'text', text: '📍 เลือกผู้ป่วยเพื่อปักหมุด' + pageLabel, color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true, flex: 1 },
          { type: 'text', text: String(homeList.length) + ' ราย', color: '#FFFFFFCC', size: 'xs', align: 'end' }
        ]
      },
      body: { type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'md', contents: rows }
    };
  });
}

function ptlnBuildPinPickRow_(item, dateStr) {
  var displayName = ptlnIsMaskNamesOn_() ? ptlnMaskThaiName_(item.name) : item.name;
  var pinStatus = item.hasPin
    ? { text: '📍 มีหมุดแล้ว • แตะเพื่อปักหมุดใหม่', color: PTLN_COLOR_TEXT_SOFT_ }
    : { text: '⚠️ ยังไม่ได้ปักหมุด • แตะเพื่อปักหมุด', color: PTLN_COLOR_WARN_ };

  return {
    type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center',
    action: {
      type: 'postback',
      data: 'act=pinstart&hn=' + encodeURIComponent(item.hn) + '&b=' + encodeURIComponent(item.bookingId) + '&d=' + dateStr,
      displayText: '📍 ปักหมุด: ' + displayName
    },
    contents: [
      { type: 'box', layout: 'vertical', flex: 0, width: '54px', alignItems: 'center', justifyContent: 'center', backgroundColor: PTLN_COLOR_BRAND_SOFT_, cornerRadius: '8px', paddingAll: '6px',
        contents: [{ type: 'text', text: item.time || '-', size: 'xs', weight: 'bold', color: PTLN_COLOR_HOME_, align: 'center' }] },
      { type: 'box', layout: 'vertical', flex: 1,
        contents: [
          { type: 'text', text: displayName || 'ไม่ระบุชื่อ', weight: 'bold', size: 'sm', wrap: true, color: '#111111' },
          { type: 'text', text: 'HN ' + item.hn, size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, wrap: true, margin: 'xs' },
          { type: 'text', text: pinStatus.text, size: 'xxs', color: pinStatus.color, wrap: true, margin: 'xs' }
        ] },
      { type: 'text', text: '›', size: 'lg', color: PTLN_COLOR_TEXT_SOFT_, flex: 0, gravity: 'center' }
    ]
  };
}

// ════════════════════════════════════════════════════════════
//  6) การ์ดรายละเอียดรายเคส (เปิดเมื่อแตะแถวผู้ป่วย)
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// ✅ NEW: ค้นหานัดหมายล่าสุดจากชื่อ/HN ที่พิมพ์เข้ามาทางแชท (ไม่จำกัดแค่วันนี้)
// ใช้กับฟีเจอร์ "พิมพ์ชื่อ/HN ผู้ป่วย → ได้การ์ดรายละเอียด + ประวัติครั้งล่าสุดแนบมาด้วย"
// ════════════════════════════════════════════════════════════
// ✅ NEW: ตัดอีโมจิ/สัญลักษณ์ที่นำหน้าข้อความ (เช่น "📋 ", "📜 ") ออกก่อนค้นหา
// เคสนี้เกิดเวลาผู้ใช้ "แตะค้าง" ข้อความ displayText เดิม (จากตอนกดแถว/ปุ่ม) แล้วคัดลอก/พิมพ์ส่งกลับมาอีกที
// เช่น "📋 สายยัณ เนียมน้อย" → เหลือ "สายยัณ เนียมน้อย" พอดีกับที่ใช้ค้นหา
// ไม่กระทบชื่อไทยปกติ เพราะช่วงอักขระไทย (ภาษาไทย) อยู่นอกช่วงที่ตัดทิ้ง
function ptlnStripQueryPrefix_(text) {
  var s = String(text || '');
  s = s.replace(/^[\uD800-\uDFFF\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uFE0F\u200D]+[\s:\uFF1A\-\u2013\u2014.]*/g, '');
  return s.trim();
}

// ✅ NEW: แคชรายการนัดหมาย (เฉพาะคอลัมน์ที่ใช้ค้นหา) ไว้ใน CacheService สั้นๆ
// เพื่อให้ "พิมพ์ชื่อ/HN แล้วเจอ" ไวขึ้นเวลามีการค้นหาถี่ๆ ในช่วงเวลาใกล้กัน
// โดยไม่ต้องเปิดอ่าน Bookings sheet ทั้งชีตซ้ำทุกครั้ง (จำกัด TTL 60 วิ กัน
// ข้อมูลเก่าเกินไปเวลามีนัดใหม่เข้ามาระหว่างนั้น)
var PTLN_SEARCH_CACHE_KEY_     = 'ptln_search_index_v1';
var PTLN_SEARCH_CACHE_TTL_SEC_ = 60;

// ✅ NEW: ระยะเวลาที่ระบบ "จำ" ไว้ว่าผู้ใช้คนนี้กำลังปักหมุดให้ HN ไหนอยู่ (นับจากกดเลือกผู้ป่วยจนกว่า
// จะส่งตำแหน่ง GPS มาจริง) ถ้าเกินเวลานี้แล้วยังไม่ส่งตำแหน่งมา ต้องพิมพ์ "ปักหมุด" แล้วเลือกใหม่
var PTLN_PIN_PENDING_TTL_SEC_ = 600; // 10 นาที

function ptlnGetSearchIndex_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(PTLN_SEARCH_CACHE_KEY_);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* แคชอ่านไม่ได้ ข้ามไปอ่านชีตใหม่ */ }
  }

  var sheet = BOOKINGS_SHEET();
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();

  var index = [];
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][11] || '');
    if (/ยกเลิก|cancel/i.test(status)) continue; // ข้ามนัดที่ถูกยกเลิก เหมือนของเดิม
    index.push([
      data[i][1],                                                          // 0: bookingId
      normalizeHN(data[i][6]),                                             // 1: hn (normalize แล้ว)
      String(data[i][7] || ''),                                            // 2: ชื่อ
      String(data[i][2] || ''),                                            // 3: วันที่ (ดิบ, parse ตอนใช้)
      (data[i][12] === 'Home' || data[i][12] === 'เยี่ยมบ้าน') ? 'home' : 'opd' // 4: kind
    ]);
  }

  try {
    var json = JSON.stringify(index);
    // CacheService จำกัดค่าละ ~100KB — เผื่อไว้ที่ 95KB ถ้าใหญ่เกินก็แค่ไม่แคช ไม่ error
    if (json.length < 95000) cache.put(PTLN_SEARCH_CACHE_KEY_, json, PTLN_SEARCH_CACHE_TTL_SEC_);
  } catch (e) { /* แคชพังไม่กระทบผลลัพธ์หลัก แค่ช้าลงเป็นปกติ */ }

  return index;
}

function ptlnFindLatestBookingByQuery_(query) {
  var q = ptlnStripQueryPrefix_(query);
  if (!q || q.length < 2) return null;
  var qHN = normalizeHN(q);

  var index = ptlnGetSearchIndex_();

  var best = null, bestTime = -Infinity;
  for (var i = 0; i < index.length; i++) {
    var row = index[i];
    var hn = row[1], name = row[2], rawDate = row[3], kind = row[4];

    var hitByHN   = qHN && hn === qHN;
    var hitByName = name && name.indexOf(q) !== -1;
    if (!hitByHN && !hitByName) continue;

    var bd = parseFlexDate(rawDate);
    var t  = bd ? bd.getTime() : 0;
    if (t >= bestTime) { // >= เพื่อให้แถวหลังสุดในชีต (มักถูกเพิ่ม/แก้ไขล่าสุด) ชนะเวลาเท่ากัน
      bestTime = t;
      best = { bookingId: row[0], kind: kind };
    }
  }
  return best;
}

function ptlnBuildCaseDetailBubble_(bookingId, kind) {
  var detail = getVisitFullDetail(bookingId); // ฟังก์ชันเดิมใน Code.gs
  if (!detail || !detail.success) {
    return { type: 'bubble', body: { type: 'box', layout: 'vertical', paddingAll: '20px',
      contents: [{ type: 'text', text: '⚠️ ไม่พบข้อมูลการนัดหมายนี้ อาจถูกยกเลิก/แก้ไขไปแล้ว', wrap: true, color: PTLN_COLOR_WARN_ }] } };
  }

  var themeColor  = kind === 'home' ? PTLN_COLOR_HOME_ : PTLN_COLOR_OPD_;
  var displayName = ptlnIsMaskNamesOn_() ? ptlnMaskThaiName_(detail.name) : detail.name;

  var rows = [
    ptlnDetailRow_('⏰ เวลานัด', detail.time + ' น.'),
    ptlnDetailRow_('🆔 HN', detail.hn),
    ptlnDetailRow_('🩺 นักกายภาพ', detail.doctor),
    ptlnDetailRow_('💳 สิทธิ', detail.rights || '-'),
    ptlnDetailRow_('🧾 ประเภทหัตถการ', detail.treatmentType || '-')
  ];
  if (detail.diagnosis  && detail.diagnosis.label)  rows.push(ptlnDetailRow_('📌 การวินิจฉัยหลัก', detail.diagnosis.label));
  if (detail.diagnosis2 && detail.diagnosis2.label) rows.push(ptlnDetailRow_('📌 การวินิจฉัยรอง', detail.diagnosis2.label));

  // ✅ NEW: แสดง "ครั้งก่อนหน้า" แบบย่อไว้ในการ์ดรายละเอียดเลย โดยไม่ต้องกดปุ่มเพิ่ม
  // (ปุ่ม 📜 ด้านล่างไว้เปิดดูประวัติแบบเต็ม 5 ครั้งล่าสุด) — ครอบ try/catch กันพังทั้งการ์ด
  // ถ้าชีต/ข้อมูลมีปัญหา จะเงียบแค่ส่วนนี้ ไม่ทำให้การ์ดรายละเอียดหลักหายไปด้วย
  try {
    var prevPeek = getPreviousVisitHistory(detail.hn, bookingId, 1);
    if (prevPeek && prevPeek.success) {
      rows.push({ type: 'separator', margin: 'lg' });
      if (prevPeek.totalVisitsBefore > 0 && prevPeek.list && prevPeek.list[0]) {
        var pv = prevPeek.list[0];
        rows.push({ type: 'text', text: '📜 ครั้งก่อนหน้า (ทั้งหมด ' + prevPeek.totalVisitsBefore + ' ครั้ง)', size: 'xs', weight: 'bold', color: '#111111', margin: 'lg' });
        rows.push(ptlnDetailRow_('วันที่', (pv.date || '-') + (pv.time ? ' ' + pv.time + ' น.' : '')));
        if (pv.treatmentType) rows.push(ptlnDetailRow_('หัตถการ', pv.treatmentType));
        if (pv.hasOutcome && pv.vas_before !== '' && pv.vas_before !== undefined && pv.vas_before !== null) {
          rows.push(ptlnDetailRow_('VAS', pv.vas_before + ' → ' + pv.vas_after));
        }
      } else {
        rows.push({ type: 'text', text: '📜 ยังไม่มีประวัติการรักษาครั้งก่อนหน้าในระบบ', size: 'xs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'lg', wrap: true });
      }
    }
  } catch (peekErr) {
    Logger.log('ptlnBuildCaseDetailBubble_ prevPeek error: ' + peekErr.message);
  }

  var footerButtons = [];
  // ✅ NEW: ปุ่มดูประวัติครั้งก่อนหน้า — เช็คได้ทันทีว่าผู้ป่วยรายนี้ครั้งก่อน ๆ ทำอะไรไปบ้าง
  footerButtons.push({ type: 'button', style: 'primary', height: 'sm', color: themeColor,
    action: { type: 'postback',
      label: '📜 ดูประวัติล่าสุด',
      data: 'act=history&hn=' + encodeURIComponent(detail.hn) + '&b=' + encodeURIComponent(bookingId) + '&kind=' + kind,
      displayText: '📜 ดูประวัติล่าสุด: ' + (displayName || 'ผู้ป่วย') } });
  // ➕ นัดครั้งต่อไป — เติมข้อมูลเดิมให้ทั้งหมด (HN/ชื่อ/เบอร์/สิทธิ/หัตถการ/ICD-10/นักกายภาพ) ไม่มี displayText แชทไม่รก
  footerButtons.push({ type: 'button', style: 'secondary', height: 'sm',
    action: { type: 'postback', label: '➕ นัดครั้งต่อไป', data: 'act=bk&s=dy&h=' + encodeURIComponent(detail.hn) } });
  if (detail.phone) {
    footerButtons.push({ type: 'button', style: 'secondary', height: 'sm',
      action: { type: 'uri', label: '📞 โทรหาผู้ป่วย', uri: 'tel:' + detail.phone.toString().replace(/[^0-9+]/g, '') } });
  }

  if (kind === 'home') {
    var house = ptlnGetHouseByHN_(detail.hn);
    if (house && house.lat && house.lng) {
      rows.push(ptlnDetailRow_('📍 ที่อยู่', house.address || '-'));
      footerButtons.push({ type: 'button', style: 'primary', height: 'sm', color: themeColor,
        action: { type: 'uri', label: '🗺️ เปิดแผนที่ไปบ้านผู้ป่วย', uri: 'https://www.google.com/maps/search/?api=1&query=' + house.lat + ',' + house.lng } });
    } else {
      rows.push(ptlnDetailRow_('📍 ที่อยู่', 'ยังไม่ปักหมุด GPS — เพิ่มได้ที่เมนู "เยี่ยมบ้าน GPS"'));
    }
  }

  if (detail.outcome && (detail.outcome.vas_before !== '' && detail.outcome.vas_before !== undefined)) {
    rows.push({ type: 'separator', margin: 'lg' });
    rows.push(ptlnDetailRow_('📊 VAS ครั้งก่อน', detail.outcome.vas_before + ' → ' + detail.outcome.vas_after));
  }

  return {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: themeColor, paddingAll: '18px',
      contents: [
        { type: 'text', text: (kind === 'home' ? '🏠 รายละเอียดเคสเยี่ยมบ้าน' : '🏥 รายละเอียดเคส OPD'), color: '#FFFFFFCC', size: 'xs', weight: 'bold' },
        { type: 'text', text: displayName || 'ไม่ระบุชื่อ', color: '#FFFFFF', size: 'lg', weight: 'bold', wrap: true, margin: 'sm' }
      ]
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '18px', spacing: 'md', contents: rows },
    footer: footerButtons.length ? { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: footerButtons } : undefined
  };
}

function ptlnDetailRow_(label, value) {
  return {
    type: 'box', layout: 'baseline', spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'xs', color: PTLN_COLOR_TEXT_SOFT_, flex: 4 },
      { type: 'text', text: String(value || '-'), size: 'xs', color: '#111111', flex: 6, wrap: true, weight: 'bold' }
    ]
  };
}

// ════════════════════════════════════════════════════════════
// ✅ NEW: ข้อความล้วน (plain text) สำรอง — ใช้เป็น "ทางสุดท้าย" เวลา Flex การ์ดส่งไม่สำเร็จ
// (เช่น LINE ปฏิเสธ JSON ของการ์ด) เพื่อให้ผู้ใช้ยังเห็นข้อมูลอย่างน้อยที่สุด
// แทนที่จะไม่มีอะไรขึ้นมาเลย — ข้อความล้วนแทบไม่มีทางถูกปฏิเสธเพราะโครงสร้างง่ายมาก
// ════════════════════════════════════════════════════════════
function ptlnCaseDetailPlainText_(bookingId, kind) {
  var detail = getVisitFullDetail(bookingId);
  if (!detail || !detail.success) return '⚠️ ไม่พบข้อมูลการนัดหมายนี้ อาจถูกยกเลิก/แก้ไขไปแล้ว';

  var lines = [
    (kind === 'home' ? '🏠 รายละเอียดเคสเยี่ยมบ้าน' : '🏥 รายละเอียดเคส OPD'),
    '👤 ' + (detail.name || 'ไม่ระบุชื่อ'),
    '⏰ เวลานัด: ' + detail.time + ' น.',
    '🆔 HN: ' + detail.hn,
    '🩺 นักกายภาพ: ' + detail.doctor,
    '💳 สิทธิ: ' + (detail.rights || '-'),
    '🧾 หัตถการ: ' + (detail.treatmentType || '-')
  ];
  if (detail.diagnosis && detail.diagnosis.label) lines.push('📌 วินิจฉัยหลัก: ' + detail.diagnosis.label);
  if (detail.diagnosis2 && detail.diagnosis2.label) lines.push('📌 วินิจฉัยรอง: ' + detail.diagnosis2.label);

  try {
    var prev = getPreviousVisitHistory(detail.hn, bookingId, 1);
    if (prev && prev.success) {
      if (prev.totalVisitsBefore > 0 && prev.list && prev.list[0]) {
        var pv = prev.list[0];
        lines.push('');
        lines.push('📜 ครั้งก่อนหน้า (ทั้งหมด ' + prev.totalVisitsBefore + ' ครั้ง)');
        lines.push('วันที่: ' + (pv.date || '-') + (pv.time ? ' ' + pv.time + ' น.' : ''));
        if (pv.treatmentType) lines.push('หัตถการ: ' + pv.treatmentType);
        if (pv.hasOutcome && pv.vas_before !== '' && pv.vas_before !== undefined && pv.vas_before !== null) {
          lines.push('VAS: ' + pv.vas_before + ' → ' + pv.vas_after);
        }
      } else {
        lines.push('');
        lines.push('📜 ยังไม่มีประวัติการรักษาครั้งก่อนหน้าในระบบ');
      }
    }
  } catch (e) { /* ไม่ร้ายแรง — ปล่อยข้อมูลหลักไปก่อน */ }

  return lines.join('\n').substring(0, 4900); // LINE text message จำกัด ~5000 ตัวอักษร
}

function ptlnHistoryPlainText_(hn, excludeBookingId) {
  var res = getPreviousVisitHistory(hn, excludeBookingId, 1);
  if (!res || !res.success) return '⚠️ โหลดประวัติไม่สำเร็จ: ' + ((res && res.error) || 'ไม่ทราบสาเหตุ');
  if (!res.list || !res.list.length) return '📜 ประวัติครั้งก่อนหน้า HN ' + res.hn + '\nยังไม่มีประวัติการรักษาครั้งก่อนหน้าในระบบ';

  var v = res.list[0];
  var lines = [
    '📜 ประวัติครั้งก่อนหน้า HN ' + res.hn + ' (ทั้งหมด ' + res.totalVisitsBefore + ' ครั้ง)',
    'วันที่: ' + (v.date || '-') + (v.time ? ' ' + v.time + ' น.' : ''),
    'นักกายภาพ: ' + (v.therapistName || '-')
  ];
  if (v.treatmentType) lines.push('หัตถการ: ' + v.treatmentType);
  if (v.diagnosis && v.diagnosis.label) lines.push('วินิจฉัย: ' + v.diagnosis.label);
  if (v.hasOutcome) {
    if (v.vas_before !== '' && v.vas_before !== undefined && v.vas_before !== null) lines.push('VAS: ' + v.vas_before + ' → ' + v.vas_after);
    if (v.barthel_score !== '' && v.barthel_score !== undefined && v.barthel_score !== null) lines.push('Barthel: ' + v.barthel_score);
    if (v.note) lines.push('บันทึก: ' + v.note);
  } else {
    lines.push('สถานะ: ยังไม่มีการบันทึกผล (Outcome)');
  }
  return lines.join('\n').substring(0, 4900);
}

// ════════════════════════════════════════════════════════════
//  6b) การ์ด "ประวัติครั้งก่อนหน้า" — เปิดเมื่อกดปุ่ม 📜 จากการ์ดรายละเอียดเคส
//      ให้นักกายภาพเช็คได้ทันทีจากในไลน์ว่าผู้ป่วยรายนี้ครั้งก่อน ๆ ทำอะไรไปบ้าง
//      ใช้ getPreviousVisitHistory() ตัวเดียวกับปุ่ม "ดูประวัติครั้งก่อนหน้า" ในหน้าเว็บ
// ════════════════════════════════════════════════════════════
function ptlnBuildHistoryBubble_(hn, excludeBookingId, kind) {
  var themeColor = kind === 'home' ? PTLN_COLOR_HOME_ : PTLN_COLOR_OPD_;
  var res;
  try {
    res = getPreviousVisitHistory(hn, excludeBookingId, 1); // ✅ ตามที่ขอ: แสดงแค่ครั้งล่าสุด 1 ครั้งพอ
  } catch (e) {
    res = { success: false, error: e.message };
  }

  if (!res || !res.success) {
    return {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: themeColor, paddingAll: '18px',
        contents: [{ type: 'text', text: '📜 ประวัติครั้งก่อนหน้า', color: '#FFFFFF', size: 'lg', weight: 'bold' }] },
      body: { type: 'box', layout: 'vertical', paddingAll: '18px',
        contents: [{ type: 'text', text: '⚠️ โหลดประวัติไม่สำเร็จ: ' + ((res && res.error) || 'ไม่ทราบสาเหตุ'), wrap: true, color: PTLN_COLOR_WARN_, size: 'sm' }] }
    };
  }

  if (!res.list || !res.list.length) {
    return {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: themeColor, paddingAll: '18px',
        contents: [
          { type: 'text', text: '📜 ประวัติครั้งก่อนหน้า', color: '#FFFFFFCC', size: 'xs', weight: 'bold' },
          { type: 'text', text: 'HN ' + res.hn, color: '#FFFFFF', size: 'lg', weight: 'bold', margin: 'sm' }
        ] },
      body: { type: 'box', layout: 'vertical', paddingAll: '18px',
        contents: [{ type: 'text', text: 'ผู้ป่วยรายนี้ยังไม่มีประวัติการรักษาครั้งก่อนหน้าในระบบ', wrap: true, color: PTLN_COLOR_TEXT_SOFT_, size: 'sm' }] }
    };
  }

  var rows = [];
  res.list.forEach(function (v, idx) {
    if (idx > 0) rows.push({ type: 'separator', margin: 'lg' });
    var isHome = (v.appointmentType === 'Home' || v.appointmentType === 'เยี่ยมบ้าน');
    rows.push({
      type: 'box', layout: 'horizontal', margin: idx === 0 ? 'none' : 'lg', alignItems: 'center',
      contents: [
        { type: 'text', text: (idx === 0 ? '🕐 ล่าสุด · ' : '') + (v.date || '-') + (v.time ? ' ' + v.time + ' น.' : ''), size: 'xs', weight: 'bold', color: '#111111', flex: 4, wrap: true },
        { type: 'text', text: isHome ? '🏠 บ้าน' : '🏥 OPD', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, align: 'end', flex: 2 }
      ]
    });
    rows.push(ptlnDetailRow_('นักกายภาพ', v.therapistName || '-'));
    if (v.treatmentType) rows.push(ptlnDetailRow_('หัตถการ', v.treatmentType));
    if (v.diagnosis && v.diagnosis.label) rows.push(ptlnDetailRow_('วินิจฉัย', v.diagnosis.label));
    if (v.diagnosis2 && v.diagnosis2.label) rows.push(ptlnDetailRow_('วินิจฉัยรอง', v.diagnosis2.label));
    if (v.hasOutcome) {
      var hasVas = v.vas_before !== undefined && v.vas_before !== '' && v.vas_before !== null;
      if (hasVas) rows.push(ptlnDetailRow_('VAS' + (v.vas1_type === 'numbness' ? ' (ชา)' : ''), v.vas_before + ' → ' + v.vas_after));
      var hasVas2 = v.vas2_before !== undefined && v.vas2_before !== '' && v.vas2_before !== null;
      if (hasVas2) rows.push(ptlnDetailRow_('VAS รอง' + (v.vas2_type === 'numbness' ? ' (ชา)' : ''), v.vas2_before + ' → ' + v.vas2_after));
      if (v.barthel_score !== undefined && v.barthel_score !== '') rows.push(ptlnDetailRow_('Barthel', String(v.barthel_score)));
      if (v.goal_met) rows.push(ptlnDetailRow_('เป้าหมาย', '🎯 บรรลุเป้าหมายครั้งนั้น'));
      if (v.note) rows.push(ptlnDetailRow_('บันทึก', v.note));
    } else {
      rows.push(ptlnDetailRow_('สถานะ', 'ยังไม่มีการบันทึกผล (Outcome)'));
    }
  });

  return {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: themeColor, paddingAll: '18px',
      contents: [
        { type: 'text', text: '📜 ประวัติครั้งก่อนหน้า', color: '#FFFFFFCC', size: 'xs', weight: 'bold' },
        { type: 'text', text: 'HN ' + res.hn + ' · พบทั้งหมด ' + res.totalVisitsBefore + ' ครั้ง', color: '#FFFFFF', size: 'md', weight: 'bold', wrap: true, margin: 'sm' }
      ]
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '18px', spacing: 'md', contents: rows }
  };
}

// อ่านที่อยู่/พิกัดบ้านจาก HN (ใช้ชีต/คอลัมน์เดิมของโมดูลเยี่ยมบ้าน GPS)
function ptlnGetHouseByHN_(hn) {
  try {
    var sheet = HV_HOUSES_SHEET();
    if (!sheet || sheet.getLastRow() < 2) return null;
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HV_COL_HOUSE.NOTE).getValues();
    var hnNorm = normalizeHN(hn);
    for (var i = 0; i < data.length; i++) {
      if (normalizeHN(data[i][HV_COL_HOUSE.HN - 1]) === hnNorm) {
        return { address: data[i][HV_COL_HOUSE.ADDRESS - 1], lat: data[i][HV_COL_HOUSE.LAT - 1], lng: data[i][HV_COL_HOUSE.LNG - 1] };
      }
    }
    return null;
  } catch (e) { return null; }
}

// ════════════════════════════════════════════════════════════
//  7) บังชื่อผู้ป่วยบางส่วน (PDPA) — เก็บชื่อจริงไว้ในเว็บระบบหลักเท่านั้น
// ════════════════════════════════════════════════════════════
function ptlnMaskThaiName_(fullName) {
  if (!fullName) return '';
  var parts = fullName.toString().trim().split(/\s+/);
  function maskWord(w) {
    if (w.length <= 2) return w;
    return w.charAt(0) + '•'.repeat(Math.max(1, w.length - 2)) + w.charAt(w.length - 1);
  }
  if (parts.length >= 2) {
    // คงชื่อต้น (คำแรก) ไว้เต็ม ๆ ให้จำได้ แล้วบังนามสกุล (คำสุดท้าย)
    var last = parts.length - 1;
    parts[last] = maskWord(parts[last]);
    return parts.join(' ');
  }
  return maskWord(parts[0]);
}

// ════════════════════════════════════════════════════════════
//  8) แพ็กการ์ดเป็นข้อความ (จำกัด 12 การ์ด/ข้อความ, 5 ข้อความ/ครั้ง)
// ════════════════════════════════════════════════════════════
function ptlnPackBubblesToMessages_(bubbles, altText) {
  var messages = [];
  for (var i = 0; i < bubbles.length; i += PTLN_BUBBLES_PER_MSG_) {
    var group = bubbles.slice(i, i + PTLN_BUBBLES_PER_MSG_);
    messages.push({
      type: 'flex',
      altText: (altText || 'PT Station').substring(0, 400),
      contents: group.length > 1 ? { type: 'carousel', contents: group } : group[0]
    });
  }
  return messages;
}

// ════════════════════════════════════════════════════════════
//  9) LINE MESSAGING API — ส่งข้อความ
// ════════════════════════════════════════════════════════════
function ptlnApiPost_(url, body) {
  if (!PTLN_LINE_TOKEN_) {
    Logger.log('ptlnApiPost_: ยังไม่ได้ตั้งค่า Script Property "LINE_CHANNEL_ACCESS_TOKEN"');
    return null;
  }
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + PTLN_LINE_TOKEN_ },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    Logger.log('LINE API error ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  return res;
}
function ptlnReply_(replyToken, messages)     { return ptlnApiPost_('https://api.line.me/v2/bot/message/reply',     { replyToken: replyToken, messages: messages }); }
function ptlnPush_(userId, messages)          { return ptlnApiPost_('https://api.line.me/v2/bot/message/push',      { to: userId, messages: messages }); }
function ptlnMulticast_(userIds, messages)    { return ptlnApiPost_('https://api.line.me/v2/bot/message/multicast', { to: userIds, messages: messages }); }

// ✅ NEW: ตอบกลับด้วย reply ก่อน (เร็ว/ไม่กินโควตา push) ถ้าไม่สำเร็จ (เช่น replyToken
// หมดอายุเพราะสร้างการ์ดนานเกินไป หรือใช้ replyToken ซ้ำ) ให้ fallback เป็น push แทนทันที
// กันปัญหา "กดปุ่มจาก LINE แล้วไม่มีอะไรขึ้นมาเลย"
function ptlnReplyOrPush_(ev, messages) {
  var res  = ev.replyToken ? ptlnReply_(ev.replyToken, messages) : null;
  var code = res ? res.getResponseCode() : null;
  if (code === 200) return true;
  var userId = ev.source && ev.source.userId;
  if (!userId) {
    Logger.log('ptlnReplyOrPush_: reply ไม่สำเร็จ (code=' + code + ') และไม่มี userId ให้ fallback push');
    return false;
  }
  Logger.log('ptlnReplyOrPush_: reply ไม่สำเร็จ (code=' + code + ') → fallback เป็น push ให้ ' + userId);
  var pushRes = ptlnPush_(userId, messages);
  return !!(pushRes && pushRes.getResponseCode() === 200);
}

// ส่งหลายข้อความ (เกิน 5 ข้อความ) ให้คนหลายคน (เกิน 500 คน) อย่างปลอดภัย
function ptlnSendMessagesToMany_(userIds, messages) {
  var userChunks = [];
  for (var i = 0; i < userIds.length; i += 500) userChunks.push(userIds.slice(i, i + 500));
  var msgChunks = [];
  for (var j = 0; j < messages.length; j += PTLN_MSGS_PER_CALL_) msgChunks.push(messages.slice(j, j + PTLN_MSGS_PER_CALL_));

  // ✅ V2: เดิมไม่ตรวจผลลัพธ์เลย → LINE ปฏิเสธ (token หมดอายุ/JSON ผิด/เกินโควตา) ก็ไม่มีใครรู้
  //        ตอนนี้นับความสำเร็จ และถ้ามีคำขอที่ล้มเหลวจะ throw เพื่อให้ผู้เรียกแจ้งอีเมลแอดมิน
  var calls = 0, failed = 0, firstErr = '';
  userChunks.forEach(function (uc) {
    msgChunks.forEach(function (mc) {
      calls++;
      var res = null;
      try { res = ptlnMulticast_(uc, mc); } catch (ex) { firstErr = firstErr || ex.message; }
      var code = res ? res.getResponseCode() : 0;
      if (code !== 200) {
        failed++;
        if (!firstErr) firstErr = res ? ('HTTP ' + code + ' ' + String(res.getContentText()).substring(0, 300))
                                      : 'ไม่มี response (ตรวจ Script Property LINE_CHANNEL_ACCESS_TOKEN)';
      }
    });
  });
  if (failed) {
    var err = new Error('ส่ง LINE ไม่สำเร็จ ' + failed + '/' + calls + ' คำขอ — ' + firstErr);
    err.sentAny = (calls - failed) > 0; // ถ้าบางส่วนส่งถึงแล้ว จะไม่ปล่อยให้ retry (กันข้อความซ้ำ)
    throw err;
  }
  return { calls: calls, failed: 0 };
}

function ptlnGetProfile_(userId) {
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId),
      { method: 'get', headers: { Authorization: 'Bearer ' + PTLN_LINE_TOKEN_ }, muteHttpExceptions: true });
    var json = JSON.parse(res.getContentText() || '{}');
    return json.displayName || '';
  } catch (e) { return ''; }
}

// ════════════════════════════════════════════════════════════
// 10) ทะเบียนผู้รับแจ้งเตือน (ชีต LineStaff)
// ════════════════════════════════════════════════════════════
function ptlnGetOrCreateStaffSheet_() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(PTLN_SHEET_STAFF_);
  if (!sheet) {
    sheet = ss.insertSheet(PTLN_SHEET_STAFF_);
    sheet.getRange(1, 1, 1, PTLN_STAFF_HEADERS_.length).setValues([PTLN_STAFF_HEADERS_])
      .setFontWeight('bold').setBackground('#B23A63').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, PTLN_STAFF_HEADERS_.length, 150);
  }
  return sheet;
}

function ptlnRegisterStaff_(userId, displayName) {
  var sheet = ptlnGetOrCreateStaffSheet_();
  var data  = sheet.getDataRange().getValues();
  var now   = Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === userId) {
      sheet.getRange(i + 1, 2).setValue(displayName || data[i][1] || '');
      sheet.getRange(i + 1, 6).setValue(now);
      // ไม่แตะคอลัมน์ "สถานะ" ของคนที่เคยลงทะเบียนแล้ว (เคารพการตั้งค่าที่แอดมินทำไว้)
      return false;
    }
  }
  sheet.appendRow([userId, displayName || '', 'เจ้าหน้าที่', 'pending', now, now]);
  return true;
}

function ptlnSetStaffStatus_(userId, status) {
  var sheet = ptlnGetOrCreateStaffSheet_();
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === userId) { sheet.getRange(i + 1, 4).setValue(status); return; }
  }
}

// ✅ เพิ่มผู้รับแจ้งเตือนด้วยตนเอง โดยไม่ต้องรอ webhook follow event — ใช้เมื่อรู้ userId
// อยู่แล้ว (เช่น ได้จาก ptlnShowLastWebhookPayload()) และต้องการให้เริ่ม active ได้เลย
// เรียกจาก Apps Script Editor เช่น ptlnManuallyRegisterActive('Uxxxxxxxx', 'พี่เอ กายภาพ')
function ptlnManuallyRegisterActive(userId, displayName) {
  userId = (userId || '').toString().trim();
  if (!userId) return 'กรุณาระบุ LINE User ID (ขึ้นต้นด้วย U ตามด้วยตัวอักษร/ตัวเลข 32 ตัว)';
  var isNew = ptlnRegisterStaff_(userId, displayName || '');
  ptlnSetStaffStatus_(userId, PTLN_STATUS_ACTIVE_);
  return (isNew ? '✅ เพิ่ม ' : '✅ อัปเดต ') + userId + ' และตั้งสถานะเป็น active แล้ว';
}

function ptlnGetActiveStaffIds_() {
  var sheet = ptlnGetOrCreateStaffSheet_();
  if (sheet.getLastRow() <= 1) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  return data.filter(function (r) { return String(r[3]).trim() === 'active'; })
             .map(function (r) { return String(r[0]).trim(); })
             .filter(Boolean);
}

// ════════════════════════════════════════════════════════════
// 11) WEBHOOK — รับ event จาก LINE (follow / message / postback / unfollow)
//     ตั้ง Webhook URL ใน LINE Developers Console ให้เป็น URL เดียวกับ
//     เว็บแอป PT Station ที่ deploy อยู่แล้ว (…/exec) ได้เลย เพราะ
//     doGet ใช้จัดการ GET และ doPost (ไฟล์นี้) ใช้จัดการ POST แยกกัน
// ════════════════════════════════════════════════════════════
function doPost(e) {
  // ✅ V30: คำขอ JSON ของศูนย์ยืม-คืน ({action, token, args}) → LoanCenter.gs  |  webhook LINE ({events:[...]}) ทำต่อด้านล่างเหมือนเดิม
  if (typeof lcIsApiRequest_ === 'function' && lcIsApiRequest_(e)) return lcDoPost_(e);
  var payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error' })).setMimeType(ContentService.MimeType.JSON);
  }

  // ✅ DEBUG: เก็บ payload ล่าสุดไว้ตรวจสอบง่ายๆ ผ่าน ptlnShowLastWebhookPayload()
  // (เผื่อ webhook เข้าถึง Apps Script ได้ แต่บันทึกลงชีตไม่สำเร็จด้วยเหตุผลอื่น)
  try {
    PropertiesService.getScriptProperties().setProperty('LN_LAST_WEBHOOK_PAYLOAD', JSON.stringify(payload));
  } catch (dbgErr) { /* ไม่ร้ายแรง */ }

  if (payload && Array.isArray(payload.events)) {
    payload.events.forEach(function (ev) {
      try { ptlnHandleEvent_(ev); } catch (evErr) { Logger.log('ptlnHandleEvent_ error: ' + evErr.message); }
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
}

// ✅ DEBUG: ดู payload ล่าสุดที่ LINE ส่งเข้ามา (event ล่าสุดเท่านั้น) — ใช้ตรวจว่า
// webhook มาถึง Apps Script จริงไหม และดู userId ของคนที่เพิ่งแอด/ทัก โดยไม่ต้องรอ
// ให้บันทึกลงชีตสำเร็จก่อน — รันจาก Apps Script Editor แล้วดูผลที่ Logger
function ptlnShowLastWebhookPayload() {
  var raw = PropertiesService.getScriptProperties().getProperty('LN_LAST_WEBHOOK_PAYLOAD');
  if (!raw) {
    Logger.log('ยังไม่มี webhook เข้ามาเลย — ให้ลองแอดเพื่อน/ทักบอทอีกครั้ง แล้วรันฟังก์ชันนี้ใหม่');
    return 'ยังไม่มี webhook เข้ามาเลย';
  }
  Logger.log(raw);
  try {
    var payload = JSON.parse(raw);
    var ids = (payload.events || []).map(function (ev) {
      return (ev.source && ev.source.userId) ? (ev.type + ': ' + ev.source.userId) : null;
    }).filter(Boolean);
    if (ids.length) Logger.log('LINE User ID ที่พบล่าสุด:\n' + ids.join('\n'));
  } catch (e) {}
  return raw;
}

function ptlnHandleEvent_(ev) {
  var userId = ev.source && ev.source.userId;
  if (!userId) return;

  if (ev.type === 'follow') {
    var name = ptlnGetProfile_(userId);
    ptlnRegisterStaff_(userId, name);
    if (ev.replyToken) {
      ptlnReply_(ev.replyToken, [{ type: 'text', text:
        '👋 สวัสดีค่ะ คุณ' + (name || '') + '\nระบบลงทะเบียนรับแจ้งเตือนผู้ป่วยประจำวันของ PT Station แล้ว\n\n' +
        '⏳ สถานะ: รอแอดมินอนุมัติ\nแอดมินจะเปิดใช้งานให้ภายในระบบ หลังจากนั้นจะได้รับ: สรุปงานเช้า (จันทร์–ศุกร์), รายงานตรวจสอบการลงข้อมูล 15:30 น. และตารางนัดพรุ่งนี้ 20:00 น. ค่ะ' }]);
    }
    return;
  }

  if (ev.type === 'unfollow') { ptlnSetStaffStatus_(userId, 'ยกเลิก'); return; }

  // 🔐 V2 (PDPA): เดิมใครก็ตามที่แอดบอท (แม้สถานะ pending) พิมพ์ชื่อ/HN หรือกดปุ่มแล้วเห็นข้อมูลผู้ป่วยได้
  //    ตอนนี้ต้องเป็นสถานะ active ในชีต LineStaff เท่านั้น ทั้งข้อความ/ปุ่ม/พิกัด
  if ((ev.type === 'postback' || ev.type === 'message') && !ptlnIsActiveStaff_(userId)) {
    Logger.log('[auth] ปฏิเสธ userId ที่ยังไม่ active: ' + userId);
    try {
      ptlnReplyOrPush_(ev, [{ type: 'text', text:
        '🔒 บัญชี LINE นี้ยังไม่ได้รับอนุมัติให้ดูข้อมูลผู้ป่วย\nกรุณาแจ้งผู้ดูแลระบบให้เปลี่ยนสถานะเป็น active ในชีต ' + PTLN_SHEET_STAFF_ + ' ก่อนค่ะ' }]);
    } catch (authErr) { /* เงียบไว้ */ }
    return;
  }

  // 📅 นัดหมายผ่าน LINE + สรุปสัปดาห์เชิงคลินิก + ชื่อคำสั่งจาก Rich Menu (LineBooking.gs) — ผ่านด่านสิทธิ์ active มาแล้ว
  if (typeof ptlnBkHandleEvent_ === 'function' && ptlnBkHandleEvent_(ev, userId)) return;

  if (ev.type === 'postback') {
    var data = ptlnParsePostback_(ev.postback && ev.postback.data);
    Logger.log('[postback] received: ' + JSON.stringify(data) + ' from ' + userId); // ✅ ช่วย debug ว่า event มาถึงจริงไหม
    // ✅ FIX: เดิมถ้า ptlnBuildCaseDetailBubble_/ptlnBuildHistoryBubble_ throw exception
    //    (เช่น ข้อมูลชีตไม่ครบ/HN ไม่ตรงรูปแบบ) ตัว try/catch รอบนอกใน ptlnHandleEvent_
    //    (เรียกจาก doPost) จะจับ error เงียบ ๆ แล้วไม่ตอบอะไรกลับเลย ผู้ใช้จะเห็นว่า
    //    "กดแล้วไม่มีอะไรขึ้น" ทั้งที่จริงมี error เกิดขึ้น (ดูได้แค่ใน Logger)
    //    → ครอบแต่ละ branch ด้วย try/catch ของตัวเอง ถ้าพังให้ตอบข้อความ error ที่เห็นได้จริง
    //    แทนที่จะเงียบไปเฉย ๆ และ log สาเหตุจริงไว้ debug ต่อได้
    // ✅ FIX 2: การ์ดรายละเอียด/ประวัติ ต้องเปิดชีตหลายรอบ (Bookings/Outcomes/Therapists) — ถ้า
    //    Apps Script cold start หรือมีข้อมูลเยอะ อาจใช้เวลานานจน replyToken (ใช้ได้ครั้งเดียว/
    //    หมดอายุเร็วมาก) หมดอายุไปก่อนตอบกลับทัน ptlnReplyOrPush_() จะ fallback ไปส่งแบบ
    //    push ให้ผู้ใช้แทนถ้า reply ไม่สำเร็จ กันปัญหา "กดแล้วเงียบ" อีกชั้นหนึ่ง
    if (data.act === 'case' && data.b) {
      var caseBookingId = decodeURIComponent(data.b);
      try {
        var bubble = ptlnBuildCaseDetailBubble_(caseBookingId, data.kind);
        var okCase = ptlnReplyOrPush_(ev, [{ type: 'flex', altText: 'รายละเอียดเคสผู้ป่วย', contents: bubble }]);
        if (!okCase && userId) { // ✅ การ์ดส่งไม่สำเร็จ (ไม่ใช่ error ตอนสร้าง) → ส่งข้อความล้วนแทนเป็นทางสุดท้าย
          Logger.log('[postback] case flex ส่งไม่สำเร็จ → fallback เป็นข้อความล้วน');
          ptlnPush_(userId, [{ type: 'text', text: ptlnCaseDetailPlainText_(caseBookingId, data.kind) }]);
        }
      } catch (caseErr) {
        Logger.log('ptlnBuildCaseDetailBubble_ error: ' + caseErr.message + '\n' + (caseErr.stack || ''));
        ptlnReplyOrPush_(ev, [{ type: 'text', text: '⚠️ เปิดรายละเอียดเคสไม่สำเร็จ: ' + caseErr.message }]);
      }
    } else if (data.act === 'history' && data.hn) {
      // ✅ NEW: ปุ่ม "ดูประวัติครั้งก่อนหน้า" จากการ์ดรายละเอียดเคส
      var hn = decodeURIComponent(data.hn);
      var excludeBookingId = data.b ? decodeURIComponent(data.b) : '';
      try {
        var histBubble = ptlnBuildHistoryBubble_(hn, excludeBookingId, data.kind);
        var okHist = ptlnReplyOrPush_(ev, [{ type: 'flex', altText: 'ประวัติครั้งก่อนหน้าของผู้ป่วย HN ' + hn, contents: histBubble }]);
        if (!okHist && userId) {
          Logger.log('[postback] history flex ส่งไม่สำเร็จ → fallback เป็นข้อความล้วน');
          ptlnPush_(userId, [{ type: 'text', text: ptlnHistoryPlainText_(hn, excludeBookingId) }]);
        }
      } catch (histErr) {
        Logger.log('ptlnBuildHistoryBubble_ error: ' + histErr.message + '\n' + (histErr.stack || ''));
        ptlnReplyOrPush_(ev, [{ type: 'text', text: '⚠️ โหลดประวัติผู้ป่วย HN ' + hn + ' ไม่สำเร็จ: ' + histErr.message }]);
      }
    } else if (data.act === 'pinstart' && data.hn) {
      // ✅ NEW: ผู้ใช้เลือกผู้ป่วยจากลิสต์ "ปักหมุด" — จำไว้ว่าผู้ใช้คนนี้ (userId) กำลังจะปักหมุดให้ HN ไหน
      // แล้วรอรับ "ข้อความตำแหน่ง" (location message) ข้อความถัดไปจากคนนี้เพื่อบันทึกพิกัดจริง
      var pinHn = decodeURIComponent(data.hn);
      var pinBookingId = data.b ? decodeURIComponent(data.b) : '';
      try {
        var pinDetail = pinBookingId ? getVisitFullDetail(pinBookingId) : null;
        var pinName  = (pinDetail && pinDetail.success) ? pinDetail.name  : pinHn;
        var pinPhone = (pinDetail && pinDetail.success) ? pinDetail.phone : '';
        var pinDisplayName = ptlnIsMaskNamesOn_() ? ptlnMaskThaiName_(pinName) : pinName;

        var pending = { hn: pinHn, name: pinName, phone: pinPhone, bookingId: pinBookingId };
        CacheService.getScriptCache().put('ptln_pending_pin_' + userId, JSON.stringify(pending), PTLN_PIN_PENDING_TTL_SEC_);

        var existingPin = checkHVHouseByHN(pinHn);
        var pinHint = existingPin && existingPin.found
          ? '\n\n📍 ผู้ป่วยรายนี้มีหมุดเดิมอยู่แล้ว — ส่งตำแหน่งใหม่จะเป็นการอัปเดตพิกัดเดิม ไม่สร้างหมุดซ้ำค่ะ'
          : '';
        ptlnReplyOrPush_(ev, [{ type: 'text', text:
          '📍 กำลังปักหมุดให้: ' + pinDisplayName + '\n\n' +
          'กดปุ่ม "+" ที่ช่องแชท → เลือก "ตำแหน่งที่ตั้ง" (Location) → ส่งตำแหน่ง GPS ปัจจุบันที่บ้านผู้ป่วยมาได้เลยค่ะ ระบบจะบันทึกให้อัตโนมัติ' +
          pinHint }]);
      } catch (pinErr) {
        Logger.log('[postback] pinstart error: ' + pinErr.message + '\n' + (pinErr.stack || ''));
        ptlnReplyOrPush_(ev, [{ type: 'text', text: '⚠️ เริ่มปักหมุดไม่สำเร็จ: ' + pinErr.message }]);
      }
    } else {
      Logger.log('[postback] ไม่ตรงเงื่อนไขใด ๆ (act=' + data.act + ') — ตรวจสอบว่า data string ถูก encode/parse ถูกต้องไหม');
    }
    return;
  }


  if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
    var rawText = String(ev.message.text || '').trim();
    Logger.log('[message] ข้อความเข้ามา: "' + rawText + '" จาก ' + userId);

    // ✅ REWRITE: รื้อทั้งบล็อกนี้ใหม่ เทียบเคียงกัน "พิมพ์ชื่อแล้วเงียบ" ที่เกิดขึ้นเพราะ:
    // 1) ทุกเส้นทางต้องตอบด้วย ptlnReplyOrPush_ (มี push สำรองถ้า replyToken หมดอายุ/ส่งไม่สำเร็จ)
    //    — ของเดิมจุด "ไม่พบผู้ป่วย" กับจุดเมนูใช้ ptlnReply_ เฉย ๆ ไม่มี fallback —
    //    ถ้า replyToken หมดอายุพอดีก่อนตอบ (เช่น การค้นหาใช้เวลานาน) จะเงียบหายไปเฉย ๆ เหมือน "ระบบไม่ส่งอะไรมาเลย"
    // 2) ครอบทั้งบล็อกด้วย try/catch ชั้นนอกสุดอีกชั้น — ไม่ว่าจะพังตรงไหน ผู้ใช้ต้องได้ข้อความกลับเสมอ
    // 3) Logger.log เพิ่มทุกขั้นตอน เพื่อให้ดูที่ Executions แล้วรู้ได้ทันทีว่าพังตรงไหน
    try {
      if (rawText === 'สรุปวันนี้' || rawText === 'เมนู' || rawText === 'menu') {
        var data2     = ptlnBuildDailyData_(dateToStr(new Date()));
        var bubbles2  = ptlnBuildDailyBubbles_(data2);
        var messages2 = ptlnPackBubblesToMessages_(bubbles2, '📋 สรุปงานวันนี้ ' + data2.thaiDateLabel);
        var okMenu = ptlnReplyOrPush_(ev, messages2.slice(0, PTLN_MSGS_PER_CALL_));
        if (!okMenu) Logger.log('[message] ส่งสรุปวันนี้ไม่สำเร็จ (ทั้ง reply และ push)');
        return;
      }

      // ✅ V2: พิมพ์ "สรุปพรุ่งนี้" → ตารางนัดพรุ่งนี้ทันที (ใช้ตอนไม่ได้รับข้อความ 20:00 หรืออยากดูซ้ำ)
      if (rawText === 'สรุปพรุ่งนี้' || rawText === 'พรุ่งนี้') {
        var tmStr  = ptlnAddDays_(dateToStr(new Date()), 1);
        var tmData = ptlnBuildDailyData_(tmStr, 'tomorrow');
        var tmMsgs = ptlnPackBubblesToMessages_(ptlnBuildDailyBubbles_(tmData), '🌙 ตารางนัดพรุ่งนี้ ' + tmData.thaiDateLabel);
        ptlnReplyOrPush_(ev, tmMsgs.slice(0, PTLN_MSGS_PER_CALL_));
        return;
      }
      // ✅ V2: พิมพ์ "ตรวจสอบ" → ตรวจว่าวันนี้ใครยังไม่ลงข้อมูล ณ ตอนนี้ (ตัดนัดที่ยังไม่ถึงเวลา)
      if (rawText === 'ตรวจสอบ' || rawText === 'ตรวจข้อมูล' || rawText === 'เช็คข้อมูล') {
        var auData = ptlnBuildAuditData_(dateToStr(new Date()), Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm'));
        var auMsgs = ptlnPackBubblesToMessages_(ptlnBuildAuditBubbles_(auData), '🔎 ตรวจสอบการลงข้อมูล ' + auData.thaiDateLabel);
        ptlnReplyOrPush_(ev, auMsgs.slice(0, PTLN_MSGS_PER_CALL_));
        return;
      }

      // ✅ NEW: พิมพ์ "ปักหมุด" → แสดงรายชื่อผู้ป่วยเยี่ยมบ้านวันนี้ ให้เลือกว่าจะปักหมุด GPS ให้ใคร
      if (rawText === 'ปักหมุด' || rawText === 'ปักหมุดบ้าน') {
        var pinData = ptlnBuildDailyData_(dateToStr(new Date()));
        if (pinData.isClosed) {
          ptlnReplyOrPush_(ev, [{ type: 'text', text: 'วันนี้หยุดทำการค่ะ (' + (pinData.holidayReason || '-') + ') ไม่มีรายชื่อผู้ป่วยเยี่ยมบ้านให้เลือกปักหมุด' }]);
          return;
        }
        if (!pinData.homeList.length) {
          ptlnReplyOrPush_(ev, [{ type: 'text', text: 'วันนี้ไม่มีนัดเยี่ยมบ้าน (Home Visit) เลยค่ะ ไม่มีรายชื่อให้เลือกปักหมุด' }]);
          return;
        }
        var pinBubbles  = ptlnBuildPinPickerBubbles_(pinData.homeList, pinData.dateStr);
        var pinMessages = pinBubbles.map(function (b) { return { type: 'flex', altText: 'เลือกผู้ป่วยเพื่อปักหมุด', contents: b }; });
        var okPin = ptlnReplyOrPush_(ev, pinMessages.slice(0, PTLN_MSGS_PER_CALL_));
        if (!okPin) Logger.log('[message] ส่งลิสต์ปักหมุดไม่สำเร็จ (ทั้ง reply และ push)');
        return;
      }

      // ค้นหาชื่อ/HN ผู้ป่วย → การ์ดรายละเอียดเคส + ประวัติครั้งก่อนหน้า (ptlnFindLatestBookingByQuery_
      // ตัดอีโมจิ/สัญลักษณ์นำหน้า เช่น "📋 " ให้เองอยู่แล้วข้างใน)
      var found = null;
      try {
        found = ptlnFindLatestBookingByQuery_(rawText);
      } catch (searchErr) {
        Logger.log('[message] ptlnFindLatestBookingByQuery_ พัง: ' + searchErr.message + '\n' + (searchErr.stack || ''));
        ptlnReplyOrPush_(ev, [{ type: 'text', text: '⚠️ ค้นหาไม่สำเร็จ (ระบบขัดข้องชั่วคราว): ' + searchErr.message }]);
        return;
      }

      if (found) {
        Logger.log('[message] เจอ bookingId=' + found.bookingId + ' kind=' + found.kind);
        try {
          var searchBubble = ptlnBuildCaseDetailBubble_(found.bookingId, found.kind);
          var okSearch = ptlnReplyOrPush_(ev, [{ type: 'flex', altText: 'รายละเอียดเคสผู้ป่วย', contents: searchBubble }]);
          if (!okSearch) {
            Logger.log('[message] flex ส่งไม่สำเร็จ → ส่งข้อความล้วนแทน');
            ptlnPush_(userId, [{ type: 'text', text: ptlnCaseDetailPlainText_(found.bookingId, found.kind) }]);
          }
        } catch (buildErr) {
          Logger.log('[message] ptlnBuildCaseDetailBubble_ พัง: ' + buildErr.message + '\n' + (buildErr.stack || ''));
          ptlnReplyOrPush_(ev, [{ type: 'text', text: '⚠️ เปิดรายละเอียดเคสไม่สำเร็จ: ' + buildErr.message }]);
        }
        return;
      }

      Logger.log('[message] ไม่เจอผู้ป่วยที่ตรงกับคำค้น: "' + rawText + '"');
      ptlnReplyOrPush_(ev, [{ type: 'text', text: 'ไม่พบผู้ป่วยที่ตรงกับ "' + rawText + '" ลองพิมพ์ชื่อหรือ HN ให้ตรงมากขึ้น หรือพิมพ์ "สรุปวันนี้" เพื่อดูรายชื่อผู้ป่วยวันนี้ค่ะ 😊' }]);

    } catch (fatalErr) {
      // ✅ กันไว้ชั้นสุดท้าย: ไม่ว่าอะไรจะพังตรงไหนในบล็อกนี้ ผู้ใช้ต้องได้รับข้อความกลับเสมอ
      Logger.log('[message] fatal error: ' + fatalErr.message + '\n' + (fatalErr.stack || ''));
      try {
        ptlnReplyOrPush_(ev, [{ type: 'text', text: '⚠️ ระบบขัดข้องชั่วคราว ลองพิมพ์ใหม่อีกครั้ง หรือแจ้งแอดมินถ้ายังไม่ได้ค่ะ' }]);
      } catch (ignoreErr) { /* ส่งไม่ออกจริง ๆ ก็ปล่อยไป เหลือ Logger ไว้เป็นหลักฐาน debug */ }
    }
    return;
  }

  // ✅ NEW: รับ "ข้อความตำแหน่ง" (LINE location message) — ใช้คู่กับฟีเจอร์พิมพ์ "ปักหมุด"
  // ผู้ใช้ต้องกดเลือกผู้ป่วยจากลิสต์ก่อน (act=pinstart) ระบบถึงจะรู้ว่าพิกัดที่ส่งมานี้เป็นของ HN ไหน
  if (ev.type === 'message' && ev.message && ev.message.type === 'location') {
    Logger.log('[location] รับพิกัดจาก ' + userId + ': ' + ev.message.latitude + ',' + ev.message.longitude);
    try {
      var cacheKey = 'ptln_pending_pin_' + userId;
      var pendingRaw = CacheService.getScriptCache().get(cacheKey);
      if (!pendingRaw) {
        ptlnReplyOrPush_(ev, [{ type: 'text', text: 'ได้รับตำแหน่งแล้วค่ะ แต่ยังไม่ได้เลือกว่าจะปักหมุดให้ผู้ป่วยคนไหน (หรือเลือกไว้นานเกิน 10 นาทีแล้ว) พิมพ์ "ปักหมุด" เพื่อเลือกผู้ป่วยก่อนนะคะ 😊' }]);
        return;
      }

      var pending = JSON.parse(pendingRaw);
      var result = registerHVHouse({
        hn: pending.hn,
        name: pending.name,
        phone: pending.phone,
        address: ev.message.address || 'ปักหมุดผ่าน LINE (ไม่มีชื่อที่อยู่จาก GPS)',
        category: '',
        note: 'ปักหมุดผ่าน LINE โดย ' + (ptlnGetProfile_(userId) || 'เจ้าหน้าที่'),
        lat: ev.message.latitude,
        lng: ev.message.longitude
      });

      CacheService.getScriptCache().remove(cacheKey); // ใช้ครั้งเดียวจบ ไม่ให้ตำแหน่งถัดไปหลุดไปทับ HN เดิมโดยไม่ตั้งใจ

      var pinDisplayName2 = ptlnIsMaskNamesOn_() ? ptlnMaskThaiName_(pending.name) : pending.name;
      if (result && result.status === 'ok') {
        var mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + ev.message.latitude + ',' + ev.message.longitude;
        ptlnReplyOrPush_(ev, [{
          type: 'text',
          text: (result.updated ? '✅ อัปเดตพิกัดบ้านของ ' : '✅ ปักหมุดบ้านของ ') + pinDisplayName2 + ' เรียบร้อยค่ะ',
          quickReply: { items: [{ type: 'action', action: { type: 'uri', label: '🗺️ เปิดแผนที่ตรวจสอบ', uri: mapUrl } }] }
        }]);
      } else {
        Logger.log('[location] registerHVHouse ไม่สำเร็จ: ' + JSON.stringify(result));
        ptlnReplyOrPush_(ev, [{ type: 'text', text: '⚠️ บันทึกพิกัดไม่สำเร็จ: ' + (result && result.message ? result.message : 'ไม่ทราบสาเหตุ') }]);
      }
    } catch (locErr) {
      Logger.log('[location] fatal error: ' + locErr.message + '\n' + (locErr.stack || ''));
      try { ptlnReplyOrPush_(ev, [{ type: 'text', text: '⚠️ บันทึกพิกัดไม่สำเร็จ: ' + locErr.message }]); } catch (ignoreErr2) {}
    }
  }
}

// ✅ NEW: จำลองการค้นหาชื่อ/HN โดยไม่ต้องพิมพ์จริงใน LINE เลย — รันจาก Apps Script Editor แล้วดูผลที่ Logger
// ใช้แยกสาเหตุว่าปัญหาอยู่ที่ตัวโค้ดค้นหา (ฟังก์ชันนี้จะบอกได้) หรือที่การตั้งค่า LINE (webhook/Response mode) แทน
// ตัวอย่าง: ptlnTestFindByQuery('📋 สายยัณ เนียมน้อย')
function ptlnTestFindByQuery(query) {
  var q = ptlnStripQueryPrefix_(query);
  Logger.log('input: "' + query + '" → หลังตัด prefix: "' + q + '"');

  var found;
  try {
    found = ptlnFindLatestBookingByQuery_(query);
  } catch (e) {
    Logger.log('❌ ptlnFindLatestBookingByQuery_ error: ' + e.message + '\n' + (e.stack || ''));
    return;
  }

  if (!found) {
    Logger.log('❌ ไม่พบผู้ป่วยที่ตรงกับ "' + query + '" — ถ้ามั่นใจว่ามีชื่อนี้ในชีตจริง ลองลบ cache: CacheService.getScriptCache().remove(PTLN_SEARCH_CACHE_KEY_) แล้วรันใหม่');
    return;
  }

  Logger.log('✅ เจอ: bookingId=' + found.bookingId + ' kind=' + found.kind);
  try {
    var detail = getVisitFullDetail(found.bookingId);
    Logger.log('รายละเอียด: ' + JSON.stringify(detail));
  } catch (e2) {
    Logger.log('❌ getVisitFullDetail error: ' + e2.message);
  }
}

function ptlnParsePostback_(raw) {
  var out = {};
  (raw || '').split('&').forEach(function (kv) {
    var idx = kv.indexOf('=');
    if (idx < 0) return;
    out[kv.substring(0, idx)] = kv.substring(idx + 1);
  });
  return out;
}

// ════════════════════════════════════════════════════════════
// 12) ฟังก์ชันทดสอบ / ตรวจสอบสถานะระบบ — รันจาก Apps Script Editor
// ════════════════════════════════════════════════════════════

// ทดสอบพื้นฐานสุด: เช็คว่า Token ใช้ได้ไหม ส่งข้อความสั้น ๆ ไปหา userId เดียว
function ptlnTestPing(userId) {
  if (!userId) { Logger.log('ใส่ userId ด้วย เช่น ptlnTestPing("Uxxxxxxxx")'); return; }
  ptlnPush_(userId, [{ type: 'text', text: '✅ ทดสอบระบบแจ้งเตือน PT Station สำเร็จ! (' + Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm') + ')' }]);
}

// ทดสอบส่ง "สรุปวันนี้" แบบเต็มรูปแบบ ไปหา userId เดียว (ปลอดภัย ไม่กระทบคนอื่น)
function ptlnTestSendToUser(userId) {
  if (!userId) { Logger.log('ใส่ userId ด้วย เช่น ptlnTestSendToUser("Uxxxxxxxx")'); return; }
  var data     = ptlnBuildDailyData_(dateToStr(new Date()));
  var bubbles  = ptlnBuildDailyBubbles_(data);
  var messages = ptlnPackBubblesToMessages_(bubbles, '📋 (ทดสอบ) สรุปงานวันนี้ ' + data.thaiDateLabel);
  messages.slice(0, PTLN_MSGS_PER_CALL_).forEach(function (m) { ptlnPush_(userId, [m]); });
  Logger.log('ส่งข้อความทดสอบไปที่ ' + userId + ' แล้ว (' + messages.length + ' ข้อความ)');
}

// ✅ NEW: ทดสอบการ์ด "รายละเอียดเคส" ตรง ๆ จาก Apps Script Editor โดยไม่ต้องกดจาก LINE
// ใช้เช็คว่าการ์ดส่งไปถึงจริงไหม และถ้าไม่สำเร็จ ให้ดูสาเหตุจริงที่ Logger (ptlnApiPost_ log
// response code + body ไว้ให้แล้วทุกครั้งที่ส่งไม่สำเร็จ)
// เรียกใช้เช่น ptlnTestCaseDetailToUser('Uxxxxxxxx', '99f282bf-7ac3-46b9-91af-19028285756f', 'home')
function ptlnTestCaseDetailToUser(userId, bookingId, kind) {
  if (!userId || !bookingId) { Logger.log('ใส่ userId และ bookingId ด้วย'); return; }
  try {
    var bubble = ptlnBuildCaseDetailBubble_(bookingId, kind || 'opd');
    var res = ptlnPush_(userId, [{ type: 'flex', altText: 'ทดสอบรายละเอียดเคส', contents: bubble }]);
    var code = res ? res.getResponseCode() : null;
    Logger.log('ptlnTestCaseDetailToUser: ส่งแล้ว, HTTP ' + code + (code === 200 ? ' ✅ สำเร็จ' : ' ❌ ไม่สำเร็จ — ดู body ที่ log ด้านบน'));
  } catch (e) {
    Logger.log('ptlnTestCaseDetailToUser error: ' + e.message + '\n' + (e.stack || ''));
  }
}


// ทดสอบยิงจริงถึงทุกคนที่ status = active (ข้ามการเช็คเวลา/สถานะเปิดปิด) — ใช้ก่อน go-live เท่านั้น
function ptlnTestSendToAllActiveNow() {
  var userIds = ptlnGetActiveStaffIds_();
  if (!userIds.length) { Logger.log('ยังไม่มีผู้รับสถานะ active ในชีต ' + PTLN_SHEET_STAFF_); return; }
  var data     = ptlnBuildDailyData_(dateToStr(new Date()));
  var bubbles  = ptlnBuildDailyBubbles_(data);
  var messages = ptlnPackBubblesToMessages_(bubbles, '📋 สรุปงานวันนี้ ' + data.thaiDateLabel);
  ptlnSendMessagesToMany_(userIds, messages);
  Logger.log('ส่งถึง ' + userIds.length + ' คนแล้ว');
}

// พิมพ์ JSON ของ flex message ออกทาง Logger เฉย ๆ (เอาไว้ debug/ตรวจก่อนส่งจริง)
function ptlnPreviewJson() {
  var data    = ptlnBuildDailyData_(dateToStr(new Date()));
  var bubbles = ptlnBuildDailyBubbles_(data);
  Logger.log(JSON.stringify(bubbles, null, 2));
}

// ✅ ใหม่: ตรวจสถานะระบบทั้งหมดในคำสั่งเดียว — เอาไว้เช็คก่อน go-live หรือเวลามีปัญหา
// รันแล้วดูผลลัพธ์ที่ Logger (Ctrl+Enter หรือ View > Logs)
function ptlnSystemStatus() {
  var props     = PropertiesService.getScriptProperties();
  var trigOn    = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === PTLN_TRIGGER_FN_; });
  var trigWkOn  = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === PTLN_TRIGGER_WEEKLY_FN_; });
  var trigMoOn  = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === PTLN_TRIGGER_MONTHLY_FN_; });
  var trigTickOn = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === PTLN_TRIGGER_TICK_FN_; });
  var staff   = ptlnGetOrCreateStaffSheet_();
  var allRows = staff.getLastRow() > 1 ? staff.getRange(2, 1, staff.getLastRow() - 1, 4).getValues() : [];
  var active  = allRows.filter(function (r) { return String(r[3]).trim() === 'active'; }).length;
  var pending = allRows.filter(function (r) { return String(r[3]).trim() === 'pending'; }).length;

  var report = [
    '════ PT Station LINE Notify — System Status ════',
    'Token ตั้งค่าแล้ว?          : ' + (PTLN_LINE_TOKEN_ ? '✅ ใช่' : '❌ ยังไม่ได้ตั้งค่า (ดู Script Properties)'),
    'บังนามสกุลผู้ป่วย          : ' + (ptlnIsMaskNamesOn_() ? '✅ เปิด (ปลอดภัย)' : '⚠️ ปิด (เห็นชื่อเต็ม)'),
    'ผู้รับสถานะ active         : ' + active + ' คน',
    'ผู้รับสถานะ pending        : ' + pending + ' คน (รออนุมัติในชีต ' + PTLN_SHEET_STAFF_ + ')',
    '── รายวัน (07:00–08:00 น. เฉพาะจันทร์–ศุกร์) ──',
    'เปิดใช้งาน?                : ' + (ptlnIsDailyNotifyEnabled_() ? '✅ เปิดอยู่' : '⏸️ ปิดอยู่'),
    'Trigger ตั้งไว้แล้ว?        : ' + (trigOn ? '✅ ตั้งแล้ว' : '❌ ยังไม่ได้ตั้ง — รัน ptlnSetupDailyTrigger()'),
    '── ตรวจสอบการลงข้อมูล (15:30 น. จันทร์–ศุกร์) ──',
    'เปิดใช้งาน?                : ' + (ptlnIsAuditEnabled_() ? '✅ เปิดอยู่' : '⏸️ ปิดอยู่'),
    '── ตารางนัดพรุ่งนี้ (20:00 น. ส่งเมื่อพรุ่งนี้เป็นวันทำการ) ──',
    'เปิดใช้งาน?                : ' + (ptlnIsEveningEnabled_() ? '✅ เปิดอยู่' : '⏸️ ปิดอยู่'),
    'Ticker (ทุก 5 นาที) ตั้งแล้ว? : ' + (trigTickOn ? '✅ ตั้งแล้ว' : '❌ ยังไม่ได้ตั้ง — รัน ptlnSetupExtraTriggers()'),
    '── สรุปสัปดาห์เชิงคลินิก (ศุกร์ 15:30 น. ผ่าน Ticker — แทน audit รายวันของวันนั้น) ──',
    'เปิดใช้งาน?                : ' + (ptlnIsWeeklyNotifyEnabled_() ? '✅ เปิดอยู่' : '⏸️ ปิดอยู่'),
    'Trigger ศุกร์ 16:00 เดิม     : ' + (trigWkOn ? '⚠️ ยังค้างอยู่ (ไม่ส่งซ้ำ แต่ควรลบ — รัน ptlnSetupWeeklyClinical())' : '✅ ลบแล้ว'),
    '── รายเดือน (วันที่ 1 เวลา 08:00–08:59 น.) ──',
    'เปิดใช้งาน?                : ' + (ptlnIsMonthlyNotifyEnabled_() ? '✅ เปิดอยู่' : '⏸️ ปิดอยู่'),
    'Trigger ตั้งไว้แล้ว?        : ' + (trigMoOn ? '✅ ตั้งแล้ว' : '❌ ยังไม่ได้ตั้ง — รัน ptlnSetupMonthlyTrigger()'),
    '════════════════════════════════════════════════════'
  ].join('\n');

  Logger.log(report);
  return report;
}

// ════════════════════════════════════════════════════════════
// 13) ✅ ใหม่ (ตามคำขอ): ทดสอบ Push LINE API + ระบบเปิด-ปิดรายบุคคล
//     (Toggle switch) — เลือกได้ว่าจะปิดการแจ้งเตือนของ LINE user id ใด
//     โดยไม่กระทบคนอื่น แยกต่างหากจาก "เปิด-ปิดระบบทั้งหมด" ในข้อ 1)
//     ใช้คู่กับหน้า LineNotifySettings.html (เข้าถึงผ่าน ?view=linenotify)
// ════════════════════════════════════════════════════════════

// ── ค่าสถานะที่ใช้ในคอลัมน์ "สถานะ" ของชีต LineStaff ──
const PTLN_STATUS_ACTIVE_   = 'active';     // ✅ เปิด — ได้รับแจ้งเตือนตามปกติ
const PTLN_STATUS_DISABLED_ = 'ปิดใช้งาน';   // ⏸️ แอดมินปิดเอง (ต่างจาก pending / ยกเลิก)
const PTLN_STATUS_PENDING_  = 'pending';    // ⏳ เพิ่งแอดไลน์ รอแอดมินอนุมัติครั้งแรก
const PTLN_STATUS_UNFOLLOW_ = 'ยกเลิก';      // 🚫 ผู้ใช้บล็อก/เลิกติดตามบอทเอง (ระบบตั้งอัตโนมัติ)

/**
 * ✅ (1) ทดสอบส่งข้อความ push ผ่าน LINE Messaging API ไปยัง userId ที่ระบุ
 * ใช้ได้ทั้งจาก Apps Script Editor (เรียกตรง ๆ แล้วดูผลที่ Logger) และจาก
 * หน้าเว็บผ่าน google.script.run.testPushLineMessage(userId, message)
 * @param {string} userId  LINE User ID ปลายทาง (ขึ้นต้นด้วย U...)
 * @param {string} [message] ข้อความที่จะส่ง — ถ้าไม่ระบุจะใช้ข้อความทดสอบมาตรฐาน
 * @return {{success:boolean, message:string}}
 */
function testPushLineMessage(userId, message) {
  try {
    if (!PTLN_LINE_TOKEN_) {
      return { success: false, message: '❌ ยังไม่ได้ตั้งค่า Script Property "LINE_CHANNEL_ACCESS_TOKEN" (Project Settings ▸ Script Properties)' };
    }
    userId = (userId || '').toString().trim();
    if (!userId) return { success: false, message: '❌ กรุณาระบุ LINE User ID' };

    var text = (message && String(message).trim())
      ? String(message).trim()
      : '✅ ทดสอบระบบแจ้งเตือน PT Station สำเร็จ! (' + Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm') + ')';

    var res  = ptlnPush_(userId, [{ type: 'text', text: text }]);
    var code = res ? res.getResponseCode() : null;

    if (code === 200) {
      Logger.log('[testPushLineMessage] ส่งสำเร็จไปยัง ' + userId);
      return { success: true, message: '✅ ส่งข้อความทดสอบสำเร็จไปยัง ' + userId };
    }
    var errBody = res ? res.getContentText() : 'ไม่มีการตอบกลับจาก LINE API (ตรวจสอบ Token / userId อีกครั้ง)';
    Logger.log('[testPushLineMessage] ล้มเหลว HTTP ' + code + ': ' + errBody);
    return { success: false, message: '❌ ส่งไม่สำเร็จ (HTTP ' + code + '): ' + errBody };
  } catch (e) {
    Logger.log('testPushLineMessage error: ' + e.message);
    return { success: false, message: '❌ เกิดข้อผิดพลาด: ' + e.message };
  }
}

/**
 * ✅ (2) คืนรายชื่อผู้ลงทะเบียนรับแจ้งเตือน LINE ทั้งหมด สำหรับแสดงเป็นรายการ
 * พร้อม Toggle switch ในหน้า UI แต่ละแถว:
 * { userId, name, role, status, active, registeredAt, updatedAt }
 */
function getLineStaffListForUI() {
  var sheet = ptlnGetOrCreateStaffSheet_();
  if (sheet.getLastRow() <= 1) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, PTLN_STAFF_HEADERS_.length).getValues();
  return data
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      var status = String(r[3] || '').trim();
      return {
        userId:       String(r[0]).trim(),
        name:         r[1] || '(ไม่ทราบชื่อ)',
        role:         r[2] || 'เจ้าหน้าที่',
        status:       status,
        active:       status === PTLN_STATUS_ACTIVE_,
        registeredAt: r[4] ? String(r[4]) : '',
        updatedAt:    r[5] ? String(r[5]) : ''
      };
    })
    .sort(function (a, b) { return (b.active - a.active) || a.name.localeCompare(b.name, 'th'); });
}

/**
 * ✅ (3) สลับสถานะเปิด/ปิดการรับแจ้งเตือนของ LINE user id รายคน (Toggle switch)
 * isActive = true  -> ตั้งสถานะ 'active'    (เริ่ม/กลับมารับแจ้งเตือนอีกครั้ง)
 * isActive = false -> ตั้งสถานะ 'ปิดใช้งาน'  (หยุดรับแจ้งเตือน แต่ยังอยู่ในระบบ ไม่ถูกลบ)
 * ไม่กระทบผู้ใช้คนอื่น และไม่กระทบสวิตช์ "เปิด-ปิดระบบทั้งหมด" (ptlnSetDailyNotifyEnabled)
 * เรียกจาก google.script.run.setLineUserActive(userId, isActive)
 * @param {string} userId
 * @param {boolean} isActive
 * @return {{success:boolean, message:string, status?:string}}
 */
function setLineUserActive(userId, isActive) {
  try {
    userId = (userId || '').toString().trim();
    if (!userId) return { success: false, message: 'ไม่พบ LINE User ID' };

    var sheet = ptlnGetOrCreateStaffSheet_();
    var data  = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === userId) {
        var newStatus = isActive ? PTLN_STATUS_ACTIVE_ : PTLN_STATUS_DISABLED_;
        sheet.getRange(i + 1, 4).setValue(newStatus);
        sheet.getRange(i + 1, 6).setValue(Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm:ss'));
        var nm = data[i][1] || userId;
        return {
          success: true,
          status: newStatus,
          message: (isActive ? '✅ เปิด' : '⏸️ ปิด') + 'การแจ้งเตือนของ ' + nm + ' แล้ว'
        };
      }
    }
    return { success: false, message: 'ไม่พบผู้ใช้นี้ในระบบ (' + userId + ')' };
  } catch (e) {
    Logger.log('setLineUserActive error: ' + e.message);
    return { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message };
  }
}

/**
 * ✅ (4) คืนสถานะปัจจุบันของระบบแจ้งเตือน LINE ทั้งหมด — ใช้เติมค่าเริ่มต้นในหน้า UI
 * (สวิตช์หลัก / การบังนามสกุล / ตั้งค่า Token ไว้แล้วหรือยัง)
 */
function getLineDailyNotifyMasterStatus() {
  return {
    enabled:   ptlnIsDailyNotifyEnabled_(),
    maskNames: ptlnIsMaskNamesOn_(),
    tokenSet:  !!PTLN_LINE_TOKEN_
  };
}

/**
 * ✅ (5) ตัวห่อสำหรับปุ่ม/สวิตช์ "เปิด-ปิดระบบส่งอัตโนมัติทั้งหมด" ในหน้า UI
 * (คืนค่าเป็น object แทน string เพื่อให้ฝั่งหน้าเว็บเช็ค success ได้ง่าย)
 */
function setLineDailyNotifyMaster(on) {
  var msg = ptlnSetDailyNotifyEnabled(!!on);
  return { success: true, message: msg, enabled: !!on };
}

/**
 * ✅ (6) ทดสอบส่ง "สรุปงานประจำวันจริง" — ข้อความรูปแบบเดียวกับที่ระบบส่งอัตโนมัติ
 * ทุกเช้า 07:00–08:00 น. (การ์ด flex สรุป OPD + เยี่ยมบ้านของวันนี้จริง) ไปยัง
 * userId ที่ระบุ เพื่อเช็คหน้าตา/ข้อมูลก่อน go-live จริง — ไม่กระทบผู้รับคนอื่น
 * และไม่นับเป็นการส่งแจ้งเตือนอัตโนมัติ (ไม่ต้องเปิดสวิตช์หลักก็ทดสอบได้)
 * เรียกจาก google.script.run.testPushDailySummary(userId)
 * @param {string} userId
 * @return {{success:boolean, message:string}}
 */
function testPushDailySummary(userId) {
  try {
    if (!PTLN_LINE_TOKEN_) {
      return { success: false, message: '❌ ยังไม่ได้ตั้งค่า Script Property "LINE_CHANNEL_ACCESS_TOKEN" (Project Settings ▸ Script Properties)' };
    }
    userId = (userId || '').toString().trim();
    if (!userId) return { success: false, message: '❌ กรุณาระบุ LINE User ID' };

    var data     = ptlnBuildDailyData_(dateToStr(new Date()));
    var bubbles  = ptlnBuildDailyBubbles_(data);
    var messages = ptlnPackBubblesToMessages_(bubbles, '📋 (ทดสอบ) สรุปงานวันนี้ ' + data.thaiDateLabel);
    var sendable = messages.slice(0, PTLN_MSGS_PER_CALL_); // ข้อจำกัด LINE: push ≤ 5 ข้อความ/ครั้ง

    var lastRes = null, hadError = false, errBody = '';
    sendable.forEach(function (m) {
      lastRes = ptlnPush_(userId, [m]);
      if (!lastRes || lastRes.getResponseCode() >= 300) {
        hadError = true;
        errBody = lastRes ? lastRes.getContentText() : 'ไม่มีการตอบกลับจาก LINE API';
      }
    });

    if (!sendable.length) {
      return { success: false, message: '⚠️ วันนี้ไม่มีข้อมูล OPD/เยี่ยมบ้าน หรือเป็นวันหยุด — ไม่มีข้อความให้ส่งทดสอบ' };
    }
    if (hadError) {
      return { success: false, message: '❌ ส่งไม่สำเร็จบางส่วน: ' + errBody };
    }
    return { success: true, message: '✅ ส่งสรุปงานประจำวัน (ทดสอบ) ' + sendable.length + ' ข้อความ ไปยัง ' + userId + ' แล้ว — รูปแบบเดียวกับที่ระบบส่งอัตโนมัติทุกเช้า' };
  } catch (e) {
    Logger.log('testPushDailySummary error: ' + e.message);
    return { success: false, message: '❌ เกิดข้อผิดพลาด: ' + e.message };
  }
}

/**
 * ✅ (7) ทดสอบส่ง "สรุปงานประจำสัปดาห์จริง" (จันทร์–ศุกร์ของสัปดาห์นี้)
 * รูปแบบเดียวกับที่ระบบส่งอัตโนมัติ — ใช้เช็คหน้าตา/ข้อมูลก่อน go-live โดยไม่กระทบผู้รับคนอื่น
 * เรียกจาก google.script.run.testPushWeeklySummary(userId)
 * @param {string} userId
 * @return {{success:boolean, message:string}}
 */
function testPushWeeklySummary(userId) {
  try {
    if (!PTLN_LINE_TOKEN_) {
      return { success: false, message: '❌ ยังไม่ได้ตั้งค่า Script Property "LINE_CHANNEL_ACCESS_TOKEN" (Project Settings ▸ Script Properties)' };
    }
    userId = (userId || '').toString().trim();
    if (!userId) return { success: false, message: '❌ กรุณาระบุ LINE User ID' };

    var today  = new Date();
    var dow    = today.getDay();
    var monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1)); // จันทร์ของสัปดาห์นี้

    var data     = ptlnBuildWeeklyData_(dateToStr(monday));
    var bubbles  = ptlnBuildWeeklyBubbles_(data);
    var messages = ptlnPackBubblesToMessages_(bubbles, '📊 (ทดสอบ) สรุปงานประจำสัปดาห์ ' + data.weekLabel);
    var sendable = messages.slice(0, PTLN_MSGS_PER_CALL_); // ข้อจำกัด LINE: push ≤ 5 ข้อความ/ครั้ง

    if (!sendable.length) {
      return { success: false, message: '⚠️ ไม่มีข้อมูลสำหรับสัปดาห์นี้ให้ส่งทดสอบ' };
    }
    var hadError = false, errBody = '';
    sendable.forEach(function (m) {
      var res = ptlnPush_(userId, [m]);
      if (!res || res.getResponseCode() >= 300) {
        hadError = true;
        errBody = res ? res.getContentText() : 'ไม่มีการตอบกลับจาก LINE API';
      }
    });

    if (hadError) return { success: false, message: '❌ ส่งไม่สำเร็จบางส่วน: ' + errBody };
    return { success: true, message: '✅ ส่งสรุปงานประจำสัปดาห์ (ทดสอบ) "' + data.weekLabel + '" ไปยัง ' + userId + ' แล้ว' };
  } catch (e) {
    Logger.log('testPushWeeklySummary error: ' + e.message);
    return { success: false, message: '❌ เกิดข้อผิดพลาด: ' + e.message };
  }
}

/**
 * ✅ (8) ทดสอบส่ง "สรุปงานประจำเดือนจริง" — รูปแบบเดียวกับที่ระบบส่งอัตโนมัติ
 * เรียกจาก google.script.run.testPushMonthlySummary(userId, yearMonth)
 * @param {string} userId
 * @param {string} [yearMonth]  รูปแบบ 'YYYY-MM' — ถ้าไม่ระบุ/รูปแบบผิด จะใช้เดือนปัจจุบันโดยอัตโนมัติ
 * @return {{success:boolean, message:string}}
 */
function testPushMonthlySummary(userId, yearMonth) {
  try {
    if (!PTLN_LINE_TOKEN_) {
      return { success: false, message: '❌ ยังไม่ได้ตั้งค่า Script Property "LINE_CHANNEL_ACCESS_TOKEN" (Project Settings ▸ Script Properties)' };
    }
    userId = (userId || '').toString().trim();
    if (!userId) return { success: false, message: '❌ กรุณาระบุ LINE User ID' };

    yearMonth = (yearMonth || '').toString().trim();
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      yearMonth = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM'); // ค่าเริ่มต้น: เดือนปัจจุบัน
    }

    var data     = ptlnBuildMonthlyData_(yearMonth);
    var bubbles  = ptlnBuildMonthlyBubbles_(data);
    var messages = ptlnPackBubblesToMessages_(bubbles, '🗓️ (ทดสอบ) สรุปงานประจำเดือน ' + data.monthLabel);
    var sendable = messages.slice(0, PTLN_MSGS_PER_CALL_);

    if (!sendable.length) {
      return { success: false, message: '⚠️ ไม่มีข้อมูลสำหรับเดือน ' + yearMonth + ' ให้ส่งทดสอบ' };
    }
    var hadError = false, errBody = '';
    sendable.forEach(function (m) {
      var res = ptlnPush_(userId, [m]);
      if (!res || res.getResponseCode() >= 300) {
        hadError = true;
        errBody = res ? res.getContentText() : 'ไม่มีการตอบกลับจาก LINE API';
      }
    });

    if (hadError) return { success: false, message: '❌ ส่งไม่สำเร็จบางส่วน: ' + errBody };
    return { success: true, message: '✅ ส่งสรุปงานประจำเดือน (ทดสอบ) "' + data.monthLabel + '" ไปยัง ' + userId + ' แล้ว' };
  } catch (e) {
    Logger.log('testPushMonthlySummary error: ' + e.message);
    return { success: false, message: '❌ เกิดข้อผิดพลาด: ' + e.message };
  }
}

// ════════════════════════════════════════════════════════════
// 14) ✅ ใหม่ (ตามคำขอ): สรุปงาน "รายสัปดาห์" (ส่งทุกวันศุกร์ 16:00–17:00 น.)
//     และสรุปงาน "รายเดือน" (ส่งอัตโนมัติหลังสิ้นเดือน — เช้าวันที่ 1 ของเดือนถัดไป)
//     ใช้ผู้รับ/ฟังก์ชันช่วยชุดเดียวกับสรุปรายวัน: ptlnGetActiveStaffIds_,
//     ptlnPush_, ptlnSendMessagesToMany_, ptlnPackBubblesToMessages_, ptlnStatBox_
// ════════════════════════════════════════════════════════════

// ── toggle เปิด/ปิด (แยกอิสระจากสวิตช์รายวัน — ค่าเริ่มต้น = เปิด) ──
const PTLN_PROP_WEEKLY_ENABLED_  = 'LN_WEEKLY_NOTIFY_ENABLED';
const PTLN_PROP_MONTHLY_ENABLED_ = 'LN_MONTHLY_NOTIFY_ENABLED';
const PTLN_TRIGGER_WEEKLY_FN_    = 'ptlnRunWeeklyNotify';
const PTLN_TRIGGER_MONTHLY_FN_   = 'ptlnRunMonthlyNotify';

function ptlnSetWeeklyNotifyEnabled(on) {
  PropertiesService.getScriptProperties().setProperty(PTLN_PROP_WEEKLY_ENABLED_, on ? 'true' : 'false');
  return (on ? '✅ เปิด' : '⏸️ ปิด') + 'การส่งสรุปรายสัปดาห์อัตโนมัติแล้ว';
}
function ptlnIsWeeklyNotifyEnabled_() {
  var v = PropertiesService.getScriptProperties().getProperty(PTLN_PROP_WEEKLY_ENABLED_);
  return v === null ? true : v === 'true';
}
function ptlnSetMonthlyNotifyEnabled(on) {
  PropertiesService.getScriptProperties().setProperty(PTLN_PROP_MONTHLY_ENABLED_, on ? 'true' : 'false');
  return (on ? '✅ เปิด' : '⏸️ ปิด') + 'การส่งสรุปรายเดือนอัตโนมัติแล้ว';
}
function ptlnIsMonthlyNotifyEnabled_() {
  var v = PropertiesService.getScriptProperties().getProperty(PTLN_PROP_MONTHLY_ENABLED_);
  return v === null ? true : v === 'true';
}

// ── ตั้ง/ลบ Trigger — รันฟังก์ชัน setup ครั้งเดียวจาก Apps Script Editor เพื่อเปิดใช้งาน ──
function ptlnSetupWeeklyTrigger() {
  ptlnRemoveWeeklyTrigger();
  if (typeof ptlnRunWeeklyClinical === 'function') return 'ℹ️ สรุปสัปดาห์ย้ายไปส่งศุกร์ 15:30 ผ่าน ticker แล้ว — รัน ptlnSetupWeeklyClinical() แทน (ลบ trigger ศุกร์ 16:00 เดิมให้แล้ว)';
  ScriptApp.newTrigger(PTLN_TRIGGER_WEEKLY_FN_)
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(16)
    .nearMinute(0)
    .inTimezone(Session.getScriptTimeZone() || 'Asia/Bangkok')
    .create();
  return '✅ ตั้งเวลาส่งสรุปรายสัปดาห์แล้ว: ทุกวันศุกร์ ช่วง 16:00–17:00 น. (ฟังก์ชัน ' + PTLN_TRIGGER_WEEKLY_FN_ + ')';
}
function ptlnRemoveWeeklyTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === PTLN_TRIGGER_WEEKLY_FN_) { ScriptApp.deleteTrigger(t); removed++; }
  });
  return removed ? ('ลบ trigger เดิม ' + removed + ' รายการ') : 'ไม่มี trigger เดิม';
}

// หมายเหตุ: Apps Script ไม่มี trigger แบบ "วันสุดท้ายของเดือน" โดยตรง จึงใช้วิธีเดียวกับ
// รายงานเยี่ยมบ้านรายเดือนที่มีอยู่แล้วในระบบ (ดู setupHVMonthlyReportTrigger ด้านบน)
// คือรันเช้าวันที่ 1 ของเดือนถัดไป แล้วสรุปข้อมูลของ "เดือนก่อนหน้า" ย้อนหลัง
// ผลลัพธ์ที่ผู้ใช้ได้รับคือ "สรุปทันทีหลังเดือนสิ้นสุด" ตามที่ต้องการ
function ptlnSetupMonthlyTrigger() {
  ptlnRemoveMonthlyTrigger();
  ScriptApp.newTrigger(PTLN_TRIGGER_MONTHLY_FN_)
    .timeBased()
    .onMonthDay(1)
    .atHour(8)
    .nearMinute(0)
    .inTimezone(Session.getScriptTimeZone() || 'Asia/Bangkok')
    .create();
  return '✅ ตั้งเวลาส่งสรุปรายเดือนแล้ว: วันที่ 1 ของทุกเดือน ช่วง 08:00–08:59 น. (สรุปของเดือนก่อนหน้า, ฟังก์ชัน ' + PTLN_TRIGGER_MONTHLY_FN_ + ')';
}
function ptlnRemoveMonthlyTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === PTLN_TRIGGER_MONTHLY_FN_) { ScriptApp.deleteTrigger(t); removed++; }
  });
  return removed ? ('ลบ trigger เดิม ' + removed + ' รายการ') : 'ไม่มี trigger เดิม';
}

// ════════════════════════════════════════════════════════════
// ฟังก์ชันหลัก — เรียกจาก Trigger
// ════════════════════════════════════════════════════════════
function ptlnRunWeeklyNotify() {
  // ⚠️ แทนที่ด้วย ptlnRunWeeklyClinical (ศุกร์ 15:30 ผ่าน ticker, LineBooking.gs) — กัน trigger ศุกร์ 16:00 เดิมที่ยังค้างอยู่ส่งซ้ำ
  if (typeof ptlnRunWeeklyClinical === 'function') {
    Logger.log('[LineWeeklyNotify] ถูกแทนด้วยสรุปสัปดาห์เชิงคลินิก (ptlnRunWeeklyClinical) — ข้าม (ลบ trigger เดิมด้วย ptlnSetupWeeklyClinical())');
    return;
  }
  if (!ptlnIsWeeklyNotifyEnabled_()) {
    Logger.log('[LineWeeklyNotify] ปิดใช้งานอยู่ — ข้ามการส่ง');
    return;
  }
  try {
    var userIds = ptlnGetActiveStaffIds_();
    if (!userIds.length) {
      Logger.log('[LineWeeklyNotify] ยังไม่มีผู้รับที่สถานะ active');
      return;
    }
    var today  = new Date();
    var dow    = today.getDay();
    var monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1)); // ย้อนกลับไปวันจันทร์ของสัปดาห์นี้

    var data     = ptlnBuildWeeklyData_(dateToStr(monday));
    var bubbles  = ptlnBuildWeeklyBubbles_(data);
    var messages = ptlnPackBubblesToMessages_(bubbles, '📊 สรุปงานประจำสัปดาห์ ' + data.weekLabel);

    ptlnSendMessagesToMany_(userIds, messages);
    Logger.log('[LineWeeklyNotify] ส่งสำเร็จถึง ' + userIds.length + ' คน สำหรับสัปดาห์ ' + data.mondayStr + ' - ' + data.fridayStr);
  } catch (e) {
    Logger.log('[LineWeeklyNotify] ERROR: ' + e.message);
    try {
      GmailApp.sendEmail(NOTIFY_EMAIL, '⚠️ [PT Station] ส่งสรุปรายสัปดาห์ผ่าน LINE ไม่สำเร็จ',
        'เกิดข้อผิดพลาด:\n\n' + e.message + '\n\nกรุณาตรวจสอบ Apps Script Editor > Executions');
    } catch (mailErr) { /* เงียบไว้ */ }
  }
}

function ptlnRunMonthlyNotify() {
  if (!ptlnIsMonthlyNotifyEnabled_()) {
    Logger.log('[LineMonthlyNotify] ปิดใช้งานอยู่ — ข้ามการส่ง');
    return;
  }
  try {
    var userIds = ptlnGetActiveStaffIds_();
    if (!userIds.length) {
      Logger.log('[LineMonthlyNotify] ยังไม่มีผู้รับที่สถานะ active');
      return;
    }
    var now       = new Date();
    var prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1); // เดือนก่อนหน้าที่เพิ่งสิ้นสุด
    var yearMonth = Utilities.formatDate(prevMonth, TIMEZONE, 'yyyy-MM');

    var data     = ptlnBuildMonthlyData_(yearMonth);
    var bubbles  = ptlnBuildMonthlyBubbles_(data);
    var messages = ptlnPackBubblesToMessages_(bubbles, '🗓️ สรุปงานประจำเดือน ' + data.monthLabel);

    ptlnSendMessagesToMany_(userIds, messages);
    Logger.log('[LineMonthlyNotify] ส่งสำเร็จถึง ' + userIds.length + ' คน สำหรับเดือน ' + yearMonth);
  } catch (e) {
    Logger.log('[LineMonthlyNotify] ERROR: ' + e.message);
    try {
      GmailApp.sendEmail(NOTIFY_EMAIL, '⚠️ [PT Station] ส่งสรุปรายเดือนผ่าน LINE ไม่สำเร็จ',
        'เกิดข้อผิดพลาด:\n\n' + e.message + '\n\nกรุณาตรวจสอบ Apps Script Editor > Executions');
    } catch (mailErr) { /* เงียบไว้ */ }
  }
}

// ════════════════════════════════════════════════════════════
// รวบรวมข้อมูล — รายสัปดาห์ (จันทร์–ศุกร์ของสัปดาห์นี้)
// ════════════════════════════════════════════════════════════
function ptlnBuildWeeklyData_(mondayStr) {
  var monday = new Date(mondayStr + 'T00:00:00');
  var friday = new Date(monday); friday.setDate(monday.getDate() + 4);
  var fridayStr = dateToStr(friday);

  var weekLabel = monday.getDate() + ' ' + PTLN_TH_MONTHS_[monday.getMonth() + 1] + ' – ' +
    friday.getDate() + ' ' + PTLN_TH_MONTHS_[friday.getMonth() + 1] + ' ' + (friday.getFullYear() + 543);

  var range = getBookingsRange(mondayStr, fridayStr); // ฟังก์ชันเดิมใน Code.gs
  var opdCount = 0, homeCount = 0, hnSet = {}, byDay = {};

  range.bookings.forEach(function (b) {
    if (b.hn === 'BLOCK') return;
    if (!byDay[b.date]) byDay[b.date] = { opd: 0, home: 0 };
    var isHome = (b.appointmentType === 'Home' || b.appointmentType === 'เยี่ยมบ้าน');
    if (isHome) { homeCount++; byDay[b.date].home++; } else { opdCount++; byDay[b.date].opd++; }
    if (b.hn) hnSet[b.hn] = true;
  });

  var dayRows = [];
  for (var i = 0; i < 5; i++) {
    var d  = new Date(monday); d.setDate(monday.getDate() + i);
    var ds = dateToStr(d);
    var counts = byDay[ds] || { opd: 0, home: 0 };
    dayRows.push({
      dateStr: ds, dayLabel: PTLN_TH_DAYS_[d.getDay()],
      dateLabel: d.getDate() + ' ' + PTLN_TH_MONTHS_[d.getMonth() + 1],
      isHoliday: !!range.holidays[ds], opd: counts.opd, home: counts.home, total: counts.opd + counts.home
    });
  }

  var revenue = null;
  try {
    var rev = getRevenueSummary('week', mondayStr, null); // ฟังก์ชันเดิมใน Code.gs + period 'week' ใหม่
    if (rev && rev.success) revenue = rev;
  } catch (revErr) { Logger.log('ptlnBuildWeeklyData_ revenue (ไม่ร้ายแรง): ' + revErr.message); }

  return {
    mondayStr: mondayStr, fridayStr: fridayStr, weekLabel: weekLabel, dayRows: dayRows,
    opdCount: opdCount, homeCount: homeCount, totalCount: opdCount + homeCount,
    patientCount: Object.keys(hnSet).length, weekTarget: WEEKLY_TARGET, revenue: revenue
  };
}

// ════════════════════════════════════════════════════════════
// รวบรวมข้อมูล — รายเดือน (ทั้งเดือนที่ระบุ, yearMonth = 'YYYY-MM')
// ════════════════════════════════════════════════════════════
function ptlnBuildMonthlyData_(yearMonth) {
  var parts = yearMonth.split('-');
  var y = Number(parts[0]), m = Number(parts[1]);
  var start = yearMonth + '-01';
  var end   = dateToStr(new Date(y, m, 0));
  var monthLabel = PTLN_TH_MONTHS_[m] + ' ' + (y + 543);

  var range = getBookingsRange(start, end); // ฟังก์ชันเดิมใน Code.gs
  var opdCount = 0, homeCount = 0, hnSet = {}, seenDays = {}, workingDays = 0;

  range.bookings.forEach(function (b) {
    if (b.hn === 'BLOCK') return;
    var isHome = (b.appointmentType === 'Home' || b.appointmentType === 'เยี่ยมบ้าน');
    if (isHome) homeCount++; else opdCount++;
    if (b.hn) hnSet[b.hn] = true;
    if (!seenDays[b.date]) { seenDays[b.date] = true; workingDays++; }
  });

  var revenue = null;
  try {
    var rev = getRevenueSummary('month', yearMonth, null); // ฟังก์ชันเดิมใน Code.gs
    if (rev && rev.success) revenue = rev;
  } catch (revErr) { Logger.log('ptlnBuildMonthlyData_ revenue (ไม่ร้ายแรง): ' + revErr.message); }

  return {
    yearMonth: yearMonth, monthLabel: monthLabel, start: start, end: end,
    opdCount: opdCount, homeCount: homeCount, totalCount: opdCount + homeCount,
    patientCount: Object.keys(hnSet).length, workingDays: workingDays,
    targetPatients: MONTHLY_TARGET_PATIENTS, targetHome: MONTHLY_TARGET_HOME, targetOPD: MONTHLY_TARGET_OPD,
    revenue: revenue
  };
}

// ════════════════════════════════════════════════════════════
// ✅ NEW: แยกยอดรายได้ตามสิทธิการรักษา (สปสช./ประกันสังคม/ข้าราชการ ฯลฯ)
// ใช้ร่วมกันทั้งการ์ดรายสัปดาห์และรายเดือน — เพราะ "รายได้รวม" ที่เห็น
// เป็นเพียงตัวเลขรวมที่รอจัดสรรเข้า รพ.สต. ตามสิทธิแต่ละประเภท
// data.revenue.byRights มาจาก getRevenueSummary(): [{rights,revenue,count,bucket,label}, ...]
// ════════════════════════════════════════════════════════════
function ptlnBuildRightsBreakdownRows_(byRights) {
  var rows = [];
  if (!byRights || !byRights.length) return rows;

  rows.push({ type: 'separator', margin: 'lg' });
  rows.push({ type: 'text', text: '📋 แยกรายได้ตามสิทธิการรักษา', size: 'xs', weight: 'bold', color: '#111111', margin: 'lg' });

  byRights.forEach(function (r) {
    var isPending = r.bucket === 'pending';
    var amountColor = isPending ? '#b45309' : PTLN_COLOR_BRAND_;
    var icon = isPending ? '🕗' : '✅';
    rows.push({
      type: 'box', layout: 'horizontal', margin: 'sm', alignItems: 'center',
      contents: [
        { type: 'text', text: icon + ' ' + r.rights + ' (' + r.count + ' ครั้ง)', size: 'xxs', color: '#111111', flex: 3, wrap: true },
        { type: 'text', text: Math.round(r.revenue || 0).toLocaleString('th-TH') + ' บาท', size: 'xxs', weight: 'bold', color: amountColor, align: 'end', flex: 2, wrap: true }
      ]
    });
  });

  rows.push({ type: 'text', text: '🕗 = รอจัดสรร/เฉลี่ยรายหัวปลายปีงบ  •  ✅ = รับจริงแล้ว', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'md', wrap: true });
  return rows;
}

// ════════════════════════════════════════════════════════════
// Flex Message — การ์ดสรุปรายสัปดาห์
// ════════════════════════════════════════════════════════════
function ptlnBuildWeeklyBubbles_(data) {
  var bodyContents = [
    { type: 'text', text: '📊 สรุปงานประจำสัปดาห์', weight: 'bold', size: 'md', color: '#111111', wrap: true },
    { type: 'text', text: data.weekLabel, size: 'sm', color: PTLN_COLOR_TEXT_SOFT_, margin: 'xs' },
    {
      type: 'box', layout: 'horizontal', margin: 'lg', spacing: 'sm',
      contents: [
        ptlnStatBox_('รวมทั้งหมด', data.totalCount, PTLN_COLOR_BRAND_),
        ptlnStatBox_('OPD', data.opdCount, PTLN_COLOR_OPD_),
        ptlnStatBox_('เยี่ยมบ้าน', data.homeCount, PTLN_COLOR_HOME_)
      ]
    },
    { type: 'text', text: 'เป้าหมายสัปดาห์: ' + data.totalCount + ' / ' + data.weekTarget + ' ราย' +
        (data.totalCount >= data.weekTarget ? '  ✅ ถึงเป้าแล้ว' : ''), size: 'xs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'md', wrap: true },
    { type: 'separator', margin: 'lg' }
  ];

  data.dayRows.forEach(function (d) {
    bodyContents.push({
      type: 'box', layout: 'horizontal', margin: 'md', alignItems: 'center',
      contents: [
        { type: 'text', text: 'วัน' + d.dayLabel + ' ' + d.dateLabel, size: 'xs', color: '#111111', flex: 3, wrap: true },
        d.isHoliday
          ? { type: 'text', text: 'หยุด', size: 'xs', color: PTLN_COLOR_TEXT_SOFT_, align: 'end', flex: 2 }
          : { type: 'text', text: d.total + ' ราย (OPD ' + d.opd + ' • บ้าน ' + d.home + ')', size: 'xs', color: PTLN_COLOR_TEXT_SOFT_, align: 'end', flex: 2, wrap: true }
      ]
    });
  });

  if (data.revenue) {
    bodyContents.push({ type: 'separator', margin: 'lg' });
    bodyContents.push({ type: 'text', text: '💰 รายได้ (รับจริง): ' + Math.round(data.revenue.realizedRevenue || 0).toLocaleString('th-TH') + ' บาท', size: 'sm', weight: 'bold', color: PTLN_COLOR_BRAND_, margin: 'lg', wrap: true });
    if (data.revenue.pendingRevenue) {
      bodyContents.push({ type: 'text', text: 'รอเบิก/เฉลี่ย: ' + Math.round(data.revenue.pendingRevenue).toLocaleString('th-TH') + ' บาท', size: 'xs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'xs' });
    }
    // ✅ NEW: แยกยอดตามสิทธิการรักษา — เพราะยอดรวมข้างบนเป็นเพียงตัวเลขที่รอจัดสรรเข้า รพ.สต.
    bodyContents = bodyContents.concat(ptlnBuildRightsBreakdownRows_(data.revenue.byRights));
  }

  return [{
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: PTLN_COLOR_BRAND_, paddingAll: '20px',
      contents: [
        { type: 'text', text: 'PT STATION', color: '#FFFFFFAA', size: 'xs', weight: 'bold' },
        { type: 'text', text: 'สรุปงานประจำสัปดาห์', color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'sm' }
      ]
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: bodyContents }
  }];
}

// ════════════════════════════════════════════════════════════
// Flex Message — การ์ดสรุปรายเดือน
// ════════════════════════════════════════════════════════════
function ptlnBuildMonthlyBubbles_(data) {
  var pct = function (v, t) { return t ? Math.min(100, Math.round(v / t * 100)) : 0; };

  var bodyContents = [
    { type: 'text', text: '🗓️ สรุปงานประจำเดือน', weight: 'bold', size: 'md', color: '#111111', wrap: true },
    { type: 'text', text: data.monthLabel, size: 'sm', color: PTLN_COLOR_TEXT_SOFT_, margin: 'xs' },
    {
      type: 'box', layout: 'horizontal', margin: 'lg', spacing: 'sm',
      contents: [
        ptlnStatBox_('รวมทั้งหมด', data.totalCount, PTLN_COLOR_BRAND_),
        ptlnStatBox_('OPD', data.opdCount, PTLN_COLOR_OPD_),
        ptlnStatBox_('เยี่ยมบ้าน', data.homeCount, PTLN_COLOR_HOME_)
      ]
    },
    { type: 'separator', margin: 'lg' },
    { type: 'text', text: 'เทียบเป้าหมายรายเดือน', size: 'xs', weight: 'bold', color: '#111111', margin: 'lg' },
    { type: 'text', text: 'ผู้ป่วยรวม: ' + data.totalCount + ' / ' + data.targetPatients + ' ราย (' + pct(data.totalCount, data.targetPatients) + '%)', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'sm', wrap: true },
    { type: 'text', text: 'OPD: ' + data.opdCount + ' / ' + data.targetOPD + ' ราย (' + pct(data.opdCount, data.targetOPD) + '%)', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'xs', wrap: true },
    { type: 'text', text: 'เยี่ยมบ้าน: ' + data.homeCount + ' / ' + data.targetHome + ' ราย (' + pct(data.homeCount, data.targetHome) + '%)', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'xs', wrap: true },
    { type: 'text', text: 'ผู้ป่วยไม่ซ้ำ (unique HN): ' + data.patientCount + ' ราย • วันทำการ: ' + data.workingDays + ' วัน', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'md', wrap: true }
  ];

  if (data.revenue) {
    bodyContents.push({ type: 'separator', margin: 'lg' });
    bodyContents.push({ type: 'text', text: '💰 รายได้รวมทั้งเดือน', size: 'xs', weight: 'bold', color: '#111111', margin: 'lg' });
    bodyContents.push({ type: 'text', text: 'รับจริง: ' + Math.round(data.revenue.realizedRevenue || 0).toLocaleString('th-TH') + ' บาท', size: 'sm', weight: 'bold', color: PTLN_COLOR_BRAND_, margin: 'sm' });
    bodyContents.push({ type: 'text', text: 'รอเบิก/เฉลี่ยรายหัว: ' + Math.round(data.revenue.pendingRevenue || 0).toLocaleString('th-TH') + ' บาท', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'xs' });
    // ✅ NEW: แยกยอดตามสิทธิการรักษา — เพราะยอดรวมข้างบนเป็นเพียงตัวเลขที่รอจัดสรรเข้า รพ.สต.
    bodyContents = bodyContents.concat(ptlnBuildRightsBreakdownRows_(data.revenue.byRights));
  }

  return [{
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: PTLN_COLOR_BRAND_, paddingAll: '20px',
      contents: [
        { type: 'text', text: 'PT STATION', color: '#FFFFFFAA', size: 'xs', weight: 'bold' },
        { type: 'text', text: 'สรุปงานประจำเดือน', color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'sm' }
      ]
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: bodyContents }
  }];
}

// ════════════════════════════════════════════════════════════
// ฟังก์ชันทดสอบ — รันจาก Apps Script Editor ก่อน go-live
// ════════════════════════════════════════════════════════════
function ptlnTestSendWeeklyToUser(userId) {
  if (!userId) { Logger.log('ใส่ userId ด้วย เช่น ptlnTestSendWeeklyToUser("Uxxxxxxxx")'); return; }
  var today = new Date();
  var dow = today.getDay();
  var monday = new Date(today); monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  var data = ptlnBuildWeeklyData_(dateToStr(monday));
  var bubbles = ptlnBuildWeeklyBubbles_(data);
  var messages = ptlnPackBubblesToMessages_(bubbles, '📊 (ทดสอบ) สรุปงานประจำสัปดาห์ ' + data.weekLabel);
  messages.forEach(function (m) { ptlnPush_(userId, [m]); });
  Logger.log('ส่งสรุปรายสัปดาห์ทดสอบไปที่ ' + userId + ' แล้ว');
}

function ptlnTestSendMonthlyToUser(userId, yearMonth) {
  if (!userId) { Logger.log('ใส่ userId ด้วย เช่น ptlnTestSendMonthlyToUser("Uxxxxxxxx")'); return; }
  if (!yearMonth) {
    var prevMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    yearMonth = Utilities.formatDate(prevMonth, TIMEZONE, 'yyyy-MM');
  }
  var data = ptlnBuildMonthlyData_(yearMonth);
  var bubbles = ptlnBuildMonthlyBubbles_(data);
  var messages = ptlnPackBubblesToMessages_(bubbles, '🗓️ (ทดสอบ) สรุปงานประจำเดือน ' + data.monthLabel);
  messages.forEach(function (m) { ptlnPush_(userId, [m]); });
  Logger.log('ส่งสรุปรายเดือนทดสอบไปที่ ' + userId + ' แล้ว (เดือน ' + yearMonth + ')');
}


// ════════════════════════════════════════════════════════════════════════
// ═══  LINE NOTIFY V2 (เพิ่มต่อท้ายโมดูล LineDailyNotify เดิม)  ═══
// ────────────────────────────────────────────────────────────────────────
//  1) สรุปเช้า 07:00 ส่งเฉพาะ จันทร์–ศุกร์ (ข้ามเสาร์–อาทิตย์อัตโนมัติ)
//  2) ตารางนัด "พรุ่งนี้" ส่งเวลา 20:00 น. (ส่งเมื่อพรุ่งนี้เป็นวันทำการเท่านั้น
//     = ส่งคืนวันอาทิตย์–พฤหัสบดี / ข้ามคืนวันศุกร์–เสาร์ และข้ามถ้าพรุ่งนี้เป็นวันหยุดนักขัตฤกษ์)
//  3) รายงานตรวจสอบการลงข้อมูล 15:30 น. — ใครยังไม่บันทึกผล / ยังไม่ระบุ ICD-10
//  4) ตัวตั้งเวลาแบบ "ticker" ทุก 5 นาที (ptlnTick) เพื่อให้ตรงเวลา 15:30 / 20:00 จริง
//     เพราะ atHour().nearMinute() ของ Apps Script คลาดเคลื่อนได้ ±15 นาที
//  5) กันส่งซ้ำ (once-guard) + แจ้งอีเมลถ้าส่ง LINE ไม่สำเร็จจริง ๆ
//  6) ptlnSelfTest() — ชุดทดสอบอัตโนมัติรันได้จาก Apps Script Editor
//
//  วิธีเปิดใช้: รัน ptlnSetupExtraTriggers() ครั้งเดียวจาก Apps Script Editor
//  (trigger เช้าเดิมไม่ต้องตั้งใหม่ — โค้ดข้ามเสาร์–อาทิตย์ให้เอง)
// ════════════════════════════════════════════════════════════════════════

// ── helper วันที่: คำนวณจากตัวเลข y-m-d ล้วน ๆ ด้วย UTC → ไม่ขึ้นกับ timezone ของโปรเจกต์/เครื่อง ──
function ptlnYmdToUtc_(dateStr) {
  var p = String(dateStr).split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}
function ptlnIsWeekendStr_(dateStr) {
  var dow = ptlnYmdToUtc_(dateStr).getUTCDay();
  return dow === 0 || dow === 6;
}
function ptlnAddDays_(dateStr, n) {
  var p = String(dateStr).split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
  var mm = d.getUTCMonth() + 1, dd = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
}
function ptlnThaiDateLabel_(dateStr) {
  var d = ptlnYmdToUtc_(dateStr);
  return 'วัน' + PTLN_TH_DAYS_[d.getUTCDay()] + 'ที่ ' + d.getUTCDate() + ' ' +
    PTLN_TH_MONTHS_[d.getUTCMonth() + 1] + ' ' + (d.getUTCFullYear() + 543);
}
function ptlnInWindow_(nowMinutes, sched) {
  var start = sched.hour * 60 + sched.minute;
  return nowMinutes >= start && nowMinutes <= start + sched.windowMin;
}
function ptlnGetAppUrl_() {
  try { var u = ScriptApp.getService().getUrl() || ''; return /^https:\/\//.test(u) ? u : ''; }
  catch (e) { return ''; }
}

// ── toggle เปิด/ปิด (ค่าเริ่มต้น = เปิด) ──
function ptlnSetEveningEnabled(on) {
  PropertiesService.getScriptProperties().setProperty(PTLN_PROP_EVENING_ENABLED_, on ? 'true' : 'false');
  return (on ? '✅ เปิด' : '⏸️ ปิด') + 'การส่งตารางนัดพรุ่งนี้ 20:00 แล้ว';
}
function ptlnIsEveningEnabled_() {
  var v = PropertiesService.getScriptProperties().getProperty(PTLN_PROP_EVENING_ENABLED_);
  return v === null ? true : v === 'true';
}
function ptlnSetAuditEnabled(on) {
  PropertiesService.getScriptProperties().setProperty(PTLN_PROP_AUDIT_ENABLED_, on ? 'true' : 'false');
  return (on ? '✅ เปิด' : '⏸️ ปิด') + 'รายงานตรวจสอบการลงข้อมูล 15:30 แล้ว';
}
function ptlnIsAuditEnabled_() {
  var v = PropertiesService.getScriptProperties().getProperty(PTLN_PROP_AUDIT_ENABLED_);
  return v === null ? true : v === 'true';
}

// ── กันส่งซ้ำ: 1 งาน/1 วันที่-เป้าหมาย ส่งได้ครั้งเดียว (ใช้เฉพาะตอน trigger/ticker เรียก) ──
function ptlnClaimRun_(job, key) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return false; }
  try {
    var props = PropertiesService.getScriptProperties();
    var pk = 'LN_LASTRUN_' + job;
    if (props.getProperty(pk) === key) return false;
    props.setProperty(pk, key);
    return true;
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* ไม่ร้ายแรง */ }
  }
}
function ptlnReleaseRun_(job, key) {
  var props = PropertiesService.getScriptProperties();
  var pk = 'LN_LASTRUN_' + job;
  if (props.getProperty(pk) === key) props.deleteProperty(pk);
}

// ── ตรวจสิทธิ์ผู้ใช้ LINE: ต้องเป็นสถานะ active ในชีต LineStaff เท่านั้น ──
function ptlnIsActiveStaff_(userId) {
  if (!userId) return false;
  var ids = ptlnGetActiveStaffIds_();
  return ids.indexOf(String(userId).trim()) !== -1;
}

// ════════════════════════════════════════════════════════════
//  Trigger: ticker ทุก 5 นาที (เบามาก — นอกช่วงเวลาจะ return ทันทีโดยไม่แตะชีต)
// ════════════════════════════════════════════════════════════
function ptlnSetupExtraTriggers() {
  ptlnRemoveExtraTriggers();
  ScriptApp.newTrigger(PTLN_TRIGGER_TICK_FN_).timeBased().everyMinutes(5).create();
  return '✅ ตั้ง ticker ทุก 5 นาทีแล้ว (ptlnTick): ตรวจสอบการลงข้อมูล 15:30 น. และส่งตารางนัดพรุ่งนี้ 20:00 น.';
}
function ptlnRemoveExtraTriggers() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === PTLN_TRIGGER_TICK_FN_) { ScriptApp.deleteTrigger(t); removed++; }
  });
  return removed ? ('ลบ ticker เดิม ' + removed + ' รายการ') : 'ไม่มี ticker เดิม';
}
function ptlnTick() {
  var now  = new Date();
  var mins = Number(Utilities.formatDate(now, TIMEZONE, 'H')) * 60 + Number(Utilities.formatDate(now, TIMEZONE, 'm'));
  PTLN_SCHEDULE_.forEach(function (s) {
    if (!ptlnInWindow_(mins, s)) return;
    try {
      var tickToday = dateToStr(now);
      if (s.onlyWhen && !s.onlyWhen(tickToday)) return;
      if (s.skipWhen && s.skipWhen(tickToday)) { Logger.log('[ptlnTick] ' + s.job + ' ข้าม (ถูกแทนด้วยสรุปสัปดาห์)'); return; }
      s.run({ auto: true });
    }
    catch (err) { Logger.log('[ptlnTick] ' + s.job + ' ERROR: ' + err.message); }
  });
}

// ════════════════════════════════════════════════════════════
//  A) ตารางนัดพรุ่งนี้ (20:00)
// ════════════════════════════════════════════════════════════
function ptlnRunEveningPreview(opts) {
  var auto = !!(opts && typeof opts === 'object');
  if (auto && !ptlnIsEveningEnabled_()) { Logger.log('[Evening] ปิดใช้งานอยู่ — ข้าม'); return; }

  var todayStr    = dateToStr(new Date());
  var tomorrowStr = ptlnAddDays_(todayStr, 1);

  if (auto) {
    if (ptlnIsWeekendStr_(tomorrowStr)) { Logger.log('[Evening] พรุ่งนี้เป็นเสาร์/อาทิตย์ — ข้าม'); return; }
    var hol = getHoliday(tomorrowStr);
    if (hol) { Logger.log('[Evening] พรุ่งนี้เป็นวันหยุด (' + hol + ') — ข้าม'); return; }
    if (!ptlnClaimRun_('evening', tomorrowStr)) { Logger.log('[Evening] ส่งของ ' + tomorrowStr + ' ไปแล้ว — ข้าม'); return; }
  }

  try {
    var userIds = ptlnGetActiveStaffIds_();
    if (!userIds.length) {
      Logger.log('[Evening] ยังไม่มีผู้รับสถานะ active');
      if (auto) ptlnReleaseRun_('evening', tomorrowStr);
      return;
    }
    var data     = ptlnBuildDailyData_(tomorrowStr, 'tomorrow');
    var bubbles  = ptlnBuildDailyBubbles_(data);
    var messages = ptlnPackBubblesToMessages_(bubbles, '🌙 ตารางนัดพรุ่งนี้ ' + data.thaiDateLabel);
    ptlnSendMessagesToMany_(userIds, messages);
    Logger.log('[Evening] ส่งสำเร็จถึง ' + userIds.length + ' คน สำหรับ ' + tomorrowStr + ' (' + data.totalCount + ' ราย)');
  } catch (err) {
    if (auto && !(err && err.sentAny)) ptlnReleaseRun_('evening', tomorrowStr);
    Logger.log('[Evening] ERROR: ' + err.message);
    try {
      GmailApp.sendEmail(NOTIFY_EMAIL, '⚠️ [PT Station] ส่งตารางนัดพรุ่งนี้ผ่าน LINE ไม่สำเร็จ',
        'เกิดข้อผิดพลาดตอนส่งตารางนัดของ ' + tomorrowStr + ':\n\n' + err.message +
        '\n\nระบบจะลองใหม่อัตโนมัติภายในช่วง 15 นาทีแรกหลัง 20:00 น.\nตรวจสอบ Apps Script Editor > Executions');
    } catch (mailErr) { /* เงียบไว้ */ }
  }
}

// ════════════════════════════════════════════════════════════
//  B) รายงานตรวจสอบการลงข้อมูล (15:30)
//     "ลงข้อมูลแล้ว" = มีแถวในชีต Outcomes ของ bookingId นั้น (บันทึกผล VAS/Barthel)
//                      และมี ICD-10 หลัก (Bookings คอลัมน์ 14)
//     นัดที่เวลาเริ่ม >= cutoff = "ยังไม่ถึงเวลา" ไม่นับว่าตกหล่น
// ════════════════════════════════════════════════════════════
function ptlnBuildAuditData_(dateStr, cutoffHHmm) {
  var holiday  = getHoliday(dateStr);
  var isClosed = !!holiday || ptlnIsWeekendStr_(dateStr);
  var out = {
    dateStr: dateStr, thaiDateLabel: ptlnThaiDateLabel_(dateStr), isClosed: isClosed,
    holidayReason: holiday || (ptlnIsWeekendStr_(dateStr) ? 'วันหยุดสุดสัปดาห์' : ''),
    cutoff: cutoffHHmm, complete: 0, missing: [], noDiag: [], upcoming: [], totalDue: 0
  };
  if (isClosed) return out;

  var tMap = buildTherapistMap();

  var outcomeSet = {};
  var os = OUTCOMES_SHEET();
  if (os && os.getLastRow() >= 2) {
    os.getRange(2, 2, os.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var id = (r[0] === null || r[0] === undefined) ? '' : String(r[0]).trim();
      if (id) outcomeSet[id] = true;
    });
  }

  var rows = BOOKINGS_SHEET().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var r  = rows[i];
    var bd = parseFlexDate(r[2]);
    if (!bd || dateToStr(bd) !== dateStr) continue;
    var hn = normalizeHN(r[6]);
    if (hn === 'BLOCK') continue;
    var bookingId = (r[1] === null || r[1] === undefined) ? '' : String(r[1]).trim();
    if (!bookingId) continue;

    var apType = r[12] || 'OPD';
    var item = {
      bookingId: bookingId, time: normalizeTime(r[3]), name: r[7] || '', hn: hn,
      therapistName: tMap[r[4]] || 'ไม่ระบุ',
      kind: (apType === 'Home' || apType === 'เยี่ยมบ้าน') ? 'home' : 'opd',
      arrived: String(r[11] || '') === 'Arrived',
      hasOutcome: !!outcomeSet[bookingId],
      hasDiag: !!(r[13] && String(r[13]).trim())
    };

    if (cutoffHHmm && item.time && item.time >= cutoffHHmm) out.upcoming.push(item);
    else if (!item.hasOutcome) out.missing.push(item);
    else if (!item.hasDiag)    out.noDiag.push(item);
    else out.complete++;
  }
  var byTime = function (a, b) { return (a.time || '').localeCompare(b.time || ''); };
  out.missing.sort(byTime); out.noDiag.sort(byTime); out.upcoming.sort(byTime);
  out.totalDue = out.complete + out.missing.length + out.noDiag.length;
  return out;
}

function ptlnBuildAuditBubbles_(data) {
  var bubbles = [ptlnBuildAuditSummaryBubble_(data)];
  if (data.isClosed) return bubbles;
  bubbles = bubbles.concat(ptlnBuildAuditListBubbles_(data.missing, { icon: '🔴', title: 'ยังไม่บันทึกผล',            color: PTLN_COLOR_WARN_,  dateStr: data.dateStr }));
  bubbles = bubbles.concat(ptlnBuildAuditListBubbles_(data.noDiag,  { icon: '🟠', title: 'บันทึกผลแล้ว ขาด ICD-10',   color: PTLN_COLOR_AUDIT_, dateStr: data.dateStr }));
  return bubbles;
}

function ptlnBuildAuditSummaryBubble_(data) {
  var missingN = data.missing.length, noDiagN = data.noDiag.length;
  var body = [{ type: 'text', text: '📅 ' + data.thaiDateLabel, weight: 'bold', size: 'md', color: '#111111', wrap: true }];

  if (data.isClosed) {
    body.push({ type: 'text', text: 'วันนี้หยุดทำการ ไม่ต้องตรวจสอบ', size: 'sm', color: PTLN_COLOR_TEXT_SOFT_, margin: 'md', wrap: true });
  } else {
    body.push({ type: 'text', text: 'ตรวจสอบนัดที่เริ่มก่อน ' + data.cutoff + ' น.', size: 'xs', color: PTLN_COLOR_TEXT_SOFT_, margin: 'xs' });
    body.push({
      type: 'box', layout: 'horizontal', margin: 'lg', spacing: 'sm',
      contents: [
        ptlnStatBox_('ลงข้อมูลครบ', data.complete, PTLN_COLOR_OPD_),
        ptlnStatBox_('ยังไม่บันทึกผล', missingN, missingN ? PTLN_COLOR_WARN_ : PTLN_COLOR_TEXT_SOFT_),
        ptlnStatBox_('ขาด ICD-10', noDiagN, noDiagN ? PTLN_COLOR_AUDIT_ : PTLN_COLOR_TEXT_SOFT_)
      ]
    });
    body.push({ type: 'separator', margin: 'lg' });
    if (missingN === 0 && noDiagN === 0) {
      body.push({ type: 'text', text: '✅ ลงข้อมูลครบทุกราย ไม่มีรายการตกหล่น', size: 'sm', weight: 'bold', color: PTLN_COLOR_OPD_, wrap: true, margin: 'lg' });
    } else {
      body.push({ type: 'text', text: '⚠️ มีรายการที่ยังลงข้อมูลไม่ครบ กรุณาตรวจสอบและบันทึกก่อนปิดเวร', size: 'sm', weight: 'bold', color: PTLN_COLOR_WARN_, wrap: true, margin: 'lg' });
      body.push({ type: 'text', text: 'แตะรายชื่อในการ์ดถัดไปเพื่อดูรายละเอียดเคส', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, wrap: true, margin: 'sm' });
    }
    if (data.upcoming.length) {
      body.push({ type: 'text', text: 'ℹ️ นัดหลัง ' + data.cutoff + ' น. อีก ' + data.upcoming.length + ' ราย (ยังไม่ถึงเวลา — ไม่นับในรายงานนี้)', size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, wrap: true, margin: 'md' });
    }
  }

  var bubble = {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: PTLN_COLOR_AUDIT_, paddingAll: '20px',
      contents: [
        { type: 'text', text: 'PT STATION • AUDIT', color: '#FFFFFFAA', size: 'xs', weight: 'bold' },
        { type: 'text', text: 'ตรวจสอบการลงข้อมูล', color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'sm' }
      ]
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: body }
  };
  var url = ptlnGetAppUrl_();
  if (url && !data.isClosed && (missingN || noDiagN)) {
    bubble.footer = {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: [{ type: 'button', style: 'primary', color: PTLN_COLOR_BRAND_, height: 'sm',
        action: { type: 'uri', label: 'เปิดระบบลงข้อมูล', uri: url } }]
    };
  }
  return bubble;
}

function ptlnBuildAuditListBubbles_(list, opt) {
  if (!list.length) return [];
  var chunks = [];
  for (var i = 0; i < list.length; i += PTLN_ROWS_PER_BUBBLE_) chunks.push(list.slice(i, i + PTLN_ROWS_PER_BUBBLE_));
  return chunks.map(function (chunk, idx) {
    var pageLabel = chunks.length > 1 ? ' (' + (idx + 1) + '/' + chunks.length + ')' : '';
    var rows = [];
    chunk.forEach(function (item, k) {
      if (k > 0) rows.push({ type: 'separator', margin: 'md' });
      rows.push(ptlnBuildAuditRow_(item, opt));
    });
    return {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'horizontal', backgroundColor: opt.color, paddingAll: '16px', alignItems: 'center',
        contents: [
          { type: 'text', text: opt.icon + ' ' + opt.title + pageLabel, color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true, flex: 1 },
          { type: 'text', text: String(list.length) + ' ราย', color: '#FFFFFFCC', size: 'xs', align: 'end' }
        ]
      },
      body: { type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'md', contents: rows }
    };
  });
}

function ptlnBuildAuditRow_(item, opt) {
  var displayName = ptlnIsMaskNamesOn_() ? ptlnMaskThaiName_(item.name) : item.name;
  var kindIcon    = item.kind === 'home' ? '🏠' : '🏥';
  var status;
  if (!item.hasOutcome) status = item.arrived ? '✅ เช็คอินแล้ว • ❌ ยังไม่บันทึกผล' : '⏳ ยังไม่เช็คอิน • ❌ ยังไม่บันทึกผล';
  else                  status = '✅ บันทึกผลแล้ว • ⚠️ ยังไม่ระบุ ICD-10';
  return {
    type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center',
    action: { type: 'postback', data: 'act=case&kind=' + item.kind + '&b=' + encodeURIComponent(item.bookingId) + '&d=' + opt.dateStr, displayText: '📋 ' + displayName },
    contents: [
      { type: 'box', layout: 'vertical', flex: 0, width: '54px', alignItems: 'center', justifyContent: 'center', backgroundColor: PTLN_COLOR_BRAND_SOFT_, cornerRadius: '8px', paddingAll: '6px',
        contents: [{ type: 'text', text: item.time || '-', size: 'xs', weight: 'bold', color: opt.color, align: 'center' }] },
      { type: 'box', layout: 'vertical', flex: 1,
        contents: [
          { type: 'text', text: displayName || 'ไม่ระบุชื่อ', weight: 'bold', size: 'sm', wrap: true, color: '#111111' },
          { type: 'text', text: kindIcon + ' HN ' + item.hn + ' • ' + (item.therapistName || ''), size: 'xxs', color: PTLN_COLOR_TEXT_SOFT_, wrap: true, margin: 'xs' },
          { type: 'text', text: status, size: 'xxs', color: opt.color, wrap: true, margin: 'xs' }
        ] },
      { type: 'text', text: '›', size: 'lg', color: PTLN_COLOR_TEXT_SOFT_, flex: 0, gravity: 'center' }
    ]
  };
}

function ptlnRunAuditReport(opts) {
  var auto = !!(opts && typeof opts === 'object');
  if (auto && !ptlnIsAuditEnabled_()) { Logger.log('[Audit] ปิดใช้งานอยู่ — ข้าม'); return; }

  var todayStr = dateToStr(new Date());
  if (auto) {
    if (ptlnIsWeekendStr_(todayStr)) { Logger.log('[Audit] วันนี้เสาร์/อาทิตย์ — ข้าม'); return; }
    var hol = getHoliday(todayStr);
    if (hol) { Logger.log('[Audit] วันนี้เป็นวันหยุด (' + hol + ') — ข้าม'); return; }
    if (!ptlnClaimRun_('audit', todayStr)) { Logger.log('[Audit] ตรวจของ ' + todayStr + ' ไปแล้ว — ข้าม'); return; }
  }

  try {
    var userIds = ptlnGetActiveStaffIds_();
    if (!userIds.length) {
      Logger.log('[Audit] ยังไม่มีผู้รับสถานะ active');
      if (auto) ptlnReleaseRun_('audit', todayStr);
      return;
    }
    // อัตโนมัติ: ตัดที่ 15:30 ตายตัว / สั่งเอง: ตัดที่ "เวลาตอนนี้"
    var cutoff = auto ? PTLN_AUDIT_CUTOFF_HHMM_ : Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm');
    var data   = ptlnBuildAuditData_(todayStr, cutoff);

    if (auto && data.totalDue === 0 && data.upcoming.length === 0) { Logger.log('[Audit] วันนี้ไม่มีนัด — ข้าม'); return; }
    var clean = !data.missing.length && !data.noDiag.length;
    if (auto && clean && !PTLN_AUDIT_SEND_WHEN_CLEAN_) { Logger.log('[Audit] ครบทุกราย (ตั้งค่าไม่ส่งเมื่อครบ) — ข้าม'); return; }

    var bubbles  = ptlnBuildAuditBubbles_(data);
    var messages = ptlnPackBubblesToMessages_(bubbles, '🔎 ตรวจสอบการลงข้อมูล ' + data.thaiDateLabel + ' — ตกหล่น ' + (data.missing.length + data.noDiag.length) + ' ราย');
    ptlnSendMessagesToMany_(userIds, messages);
    Logger.log('[Audit] ส่งสำเร็จ: ครบ ' + data.complete + ' / ยังไม่บันทึกผล ' + data.missing.length + ' / ขาด ICD-10 ' + data.noDiag.length);
  } catch (err) {
    if (auto && !(err && err.sentAny)) ptlnReleaseRun_('audit', todayStr);
    Logger.log('[Audit] ERROR: ' + err.message);
    try {
      GmailApp.sendEmail(NOTIFY_EMAIL, '⚠️ [PT Station] ส่งรายงานตรวจสอบการลงข้อมูลผ่าน LINE ไม่สำเร็จ',
        'เกิดข้อผิดพลาด:\n\n' + err.message + '\n\nตรวจสอบ Apps Script Editor > Executions');
    } catch (mailErr) { /* เงียบไว้ */ }
  }
}

// ════════════════════════════════════════════════════════════
//  C) ฟังก์ชันทดสอบ (ส่งหาคนเดียว ไม่กระทบคนอื่น) — รันจาก Apps Script Editor
// ════════════════════════════════════════════════════════════
function ptlnTestEveningToUser(userId) {
  var tomorrowStr = ptlnAddDays_(dateToStr(new Date()), 1);
  var data     = ptlnBuildDailyData_(tomorrowStr, 'tomorrow');
  var messages = ptlnPackBubblesToMessages_(ptlnBuildDailyBubbles_(data), '🌙 (ทดสอบ) ตารางนัดพรุ่งนี้ ' + data.thaiDateLabel);
  ptlnSendMessagesToMany_([userId], messages);
  return 'ส่งตัวอย่างตารางนัดพรุ่งนี้ (' + tomorrowStr + ') ให้ ' + userId + ' แล้ว';
}
function ptlnTestAuditToUser(userId) {
  var todayStr = dateToStr(new Date());
  var data     = ptlnBuildAuditData_(todayStr, Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm'));
  var messages = ptlnPackBubblesToMessages_(ptlnBuildAuditBubbles_(data), '🔎 (ทดสอบ) ตรวจสอบการลงข้อมูล ' + data.thaiDateLabel);
  ptlnSendMessagesToMany_([userId], messages);
  return 'ส่งตัวอย่างรายงานตรวจสอบ (' + todayStr + ') ให้ ' + userId + ' แล้ว';
}

// ════════════════════════════════════════════════════════════
//  D) SELF-TEST อัตโนมัติ — รันจาก Editor: ptlnSelfTest() แล้วดู Logger
//     ไม่ส่งข้อความ LINE จริง ไม่แก้ข้อมูลใด ๆ (อ่านอย่างเดียว)
// ════════════════════════════════════════════════════════════
function ptlnSelfTest() {
  var results = [];
  function check(name, cond, extra) { results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + (extra || ''))); }

  // 1) ตรรกะวันที่ (2026-10-17 = เสาร์, 2026-10-18 = อาทิตย์, 2026-10-19 = จันทร์)
  check('weekend: เสาร์',  ptlnIsWeekendStr_('2026-10-17') === true);
  check('weekend: อาทิตย์', ptlnIsWeekendStr_('2026-10-18') === true);
  check('weekend: จันทร์', ptlnIsWeekendStr_('2026-10-19') === false);
  check('addDays: ข้ามเดือน/ปี', ptlnAddDays_('2026-12-31', 1) === '2027-01-01' && ptlnAddDays_('2026-02-28', 1) === '2026-03-01');
  // เย็นวันอาทิตย์ → พรุ่งนี้จันทร์ = ส่ง / เย็นศุกร์,เสาร์ → ไม่ส่ง
  var sendTable = { '2026-10-18': true, '2026-10-19': true, '2026-10-20': true, '2026-10-21': true, '2026-10-22': true, '2026-10-23': false, '2026-10-17': false };
  Object.keys(sendTable).forEach(function (today) {
    var wouldSend = !ptlnIsWeekendStr_(ptlnAddDays_(today, 1));
    check('evening ส่งคืน ' + today, wouldSend === sendTable[today], 'ได้ ' + wouldSend);
  });

  // 2) หน้าต่างเวลา ticker
  var audit = PTLN_SCHEDULE_[0], eve = PTLN_SCHEDULE_[1];
  check('window: 15:29 ยังไม่ถึง', !ptlnInWindow_(15 * 60 + 29, audit));
  check('window: 15:30 เริ่ม',     ptlnInWindow_(15 * 60 + 30, audit));
  check('window: 15:44 ยังทัน',    ptlnInWindow_(15 * 60 + 44, audit));
  check('window: 15:45 เลยแล้ว',   !ptlnInWindow_(15 * 60 + 45, audit));
  check('window: 20:00 เริ่ม',     ptlnInWindow_(20 * 60, eve));

  // 3) สร้างข้อมูลจริงแบบอ่านอย่างเดียว + ตรวจขนาด/รูปแบบ Flex
  try {
    var today = dateToStr(new Date());
    var ad = ptlnBuildAuditData_(today, '23:59');
    var ab = ptlnBuildAuditBubbles_(ad);
    var tm = ptlnBuildDailyData_(ptlnAddDays_(today, 1), 'tomorrow');
    var tb = ptlnBuildDailyBubbles_(tm);
    [['audit', ab], ['tomorrow', tb]].forEach(function (p) {
      var maxBytes = 0;
      p[1].forEach(function (b) { maxBytes = Math.max(maxBytes, JSON.stringify(b).length); });
      check(p[0] + ': ทุกการ์ด < 50KB', maxBytes < 50000, 'max=' + maxBytes);
      var msgs = ptlnPackBubblesToMessages_(p[1], 'x');
      check(p[0] + ': carousel ≤ 12 การ์ด/ข้อความ', msgs.every(function (m) { return m.contents.type !== 'carousel' || m.contents.contents.length <= PTLN_BUBBLES_PER_MSG_; }));
    });
    check('audit: จำนวนรวมสอดคล้อง', ad.isClosed || (ad.complete + ad.missing.length + ad.noDiag.length === ad.totalDue));
    Logger.log('ตัวอย่างวันนี้: ครบ ' + ad.complete + ' / ยังไม่บันทึกผล ' + ad.missing.length + ' / ขาด ICD-10 ' + ad.noDiag.length + ' / ยังไม่ถึงเวลา ' + ad.upcoming.length);
  } catch (e) { check('build ข้อมูลจริงได้โดยไม่ error', false, e.message); }

  // 4) ความปลอดภัย: userId มั่ว ๆ ต้องไม่ผ่านด่านสิทธิ์
  check('security: userId ว่าง/มั่ว ไม่ผ่าน', !ptlnIsActiveStaff_('') && !ptlnIsActiveStaff_('U_not_registered_xxxxxxxxxxxxxxxxxxxx'));

  var failed = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  var report = '════ ptlnSelfTest ════\n' + results.join('\n') + '\n──────────────\nผล: ' + (results.length - failed) + '/' + results.length + ' ผ่าน' + (failed ? ' ❌ มี ' + failed + ' รายการไม่ผ่าน' : ' ✅');
  Logger.log(report);
  return report;
}

// ═══════════════════════════════════════════════════════════════════
// ✅ V17 PERFORMANCE — มุมมองรายเดือน / ปฏิทิน
// ───────────────────────────────────────────────────────────────────
// ปัญหาเดิม
//  1) ตารางรายเดือนเรียกเซิร์ฟเวอร์ 2 ครั้งต่อกัน (getAllMasseusesWithSlots → getBookingsRange)
//     แต่ละครั้งต้องอ่านชีตใหม่ทั้งหมด และไม่มีแคชฝั่งเซิร์ฟเวอร์เลย
//  2) getCalendarEvents อ่านชีต Slots/ExtraSlots/Bookings ซ้ำ "ทุกวัน × ทุกนักกายภาพ"
//     (ราว 22 วัน × 3 คน × 2 ชีต ≈ 130+ ครั้งต่อการโหลดเดือนเดียว)
// แนวทางใหม่
//  - อ่านแต่ละชีต "ครั้งเดียว" แล้วคำนวณในหน่วยความจำ
//  - ตอบกลับเป็น bundle เดียว + แคชแบบบีบอัด (gzip) ผูกกับ dataVersion
//    ทุกครั้งที่ incrementVersion() (จอง/ยกเลิก/ย้าย/เปิด-ปิดคิว) แคชเดิมจะถูกข้ามทันที
//  - ลูกข่ายส่ง etag มาถามก่อน ถ้าไม่เปลี่ยนจะได้คำตอบเล็กๆ กลับไป (ไม่ส่งข้อมูลซ้ำ)
// ═══════════════════════════════════════════════════════════════════
const MB_CACHE_TTL_SEC = 3600; // 1 ชม. (ข้อมูลเปลี่ยนผ่านระบบ = ล้างด้วย version อยู่แล้ว)

function bigCachePut_(key, obj, ttl) {
  try {
    const cache = CacheService.getScriptCache();
    const raw   = Utilities.newBlob(JSON.stringify(obj), 'application/json', 'x.json');
    const gz    = Utilities.base64Encode(Utilities.gzip(raw).getBytes());
    const SIZE  = 90000;                       // base64 = ASCII → 1 ตัวอักษร = 1 ไบต์ (เพดาน 100KB/คีย์)
    const n     = Math.max(1, Math.ceil(gz.length / SIZE));
    const batch = {};
    for (let i = 0; i < n; i++) batch[key + '#' + i] = gz.substr(i * SIZE, SIZE);
    batch[key + '#n'] = String(n);
    cache.putAll(batch, ttl || MB_CACHE_TTL_SEC);
  } catch (e) { Logger.log('bigCachePut_ ' + e.message); }
}

function bigCacheGet_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const n = parseInt(cache.get(key + '#n') || '0', 10);
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '#' + i);
    const got = cache.getAll(keys);
    let gz = '';
    for (let i = 0; i < n; i++) {
      const part = got[key + '#' + i];
      if (part === undefined || part === null) return null;   // ชิ้นใดชิ้นหนึ่งหมดอายุ = ถือว่าพลาด
      gz += part;
    }
    const blob = Utilities.newBlob(Utilities.base64Decode(gz), 'application/x-gzip', 'x.gz');
    return JSON.parse(Utilities.ungzip(blob).getDataAsString());
  } catch (e) { Logger.log('bigCacheGet_ ' + e.message); return null; }
}

function pad2_(n) { return String(n).padStart(2, '0'); }
function addDaysStr_(ds, n) {
  const p = ds.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}
function dowOfStr_(ds) {
  const p = ds.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
}
// จัดเวลาให้เทียบกันได้ (ตรงกับฟังก์ชัน n() ฝั่งหน้าเว็บ)
function mbSortKey_(s) {
  let r = (s || '').toString().trim().replace(/[^0-9:]/g, '');
  if (r.indexOf(':') !== -1 && r.split(':')[0].length === 1) r = '0' + r;
  return r;
}

// ───────────────────────────────────────────────────────────────────
// getMonthlyBundle(year, month, knownEtag, force)
//   year = ค.ศ., month = 1–12
//   คืนข้อมูลที่ตารางรายเดือนต้องใช้ "ครบในการเรียกครั้งเดียว"
//   ถ้า knownEtag ตรงกับที่แคชไว้ → { unchanged:true } (ไม่ส่งข้อมูลซ้ำ)
// ───────────────────────────────────────────────────────────────────
function getMonthlyBundle(year, month, knownEtag, force) {
  try {
    year = Number(year); month = Number(month);
    if (year > 2400) year -= 543;
    if (!year || month < 1 || month > 12) return { success: false, message: 'เดือนไม่ถูกต้อง' };
    const ym  = year + '-' + pad2_(month);
    const ver = getSystemVersion();
    const key = 'mb3_v' + ver + '_' + ym;

    if (!force) {
      const hit = bigCacheGet_(key);
      if (hit) {
        if (knownEtag && String(knownEtag) === String(hit.etag)) {
          return { success: true, unchanged: true, version: ver, etag: hit.etag, builtAt: hit.builtAt };
        }
        return hit;
      }
    }
    const built = buildMonthlyBundle_(year, month, ver);
    bigCachePut_(key, built, MB_CACHE_TTL_SEC);
    return built;
  } catch (e) {
    Logger.log('getMonthlyBundle: ' + e.message);
    return { success: false, message: e.message };
  }
}

function buildMonthlyBundle_(year, month, ver) {
  const ym      = year + '-' + pad2_(month);
  const start   = ym + '-01';
  const end     = ym + '-' + pad2_(new Date(year, month, 0).getDate());
  const builtAt = Date.now();

  // ── อ่านทุกชีต "ครั้งเดียว" ──
  const therapists = getAllMasseusesConfig();
  const slotsData  = SLOTS_SHEET().getDataRange().getValues();
  const hData      = HOLIDAYS_SHEET().getDataRange().getValues();
  const bSheet     = BOOKINGS_SHEET();
  const bLast      = bSheet.getLastRow();
  // ตารางรายเดือนใช้แค่คอลัมน์ A–M (ไม่อ่านคอลัมน์ diagnosis JSON) → อ่านน้อยลง/ไม่ต้อง parse
  const bData      = bLast >= 2 ? bSheet.getRange(2, 1, bLast - 1, 13).getValues() : [];

  const tMap = {};
  therapists.forEach(t => { tMap[t.id] = t.name; });

  // ── นักกายภาพ + ช่องเวลา (เหมือน getAllMasseusesWithSlots เดิม) ──
  const docMap = {}, docSlotsMap = {}, allSlots = {};
  therapists.forEach(t => {
    docMap[t.name] = t.id;
    const times = [];
    for (let i = 1; i < slotsData.length; i++) {
      const row = slotsData[i];
      if (row[2] !== t.id || !row[1]) continue;
      const time = timeValueToStr(row[1]);
      const norm = normalizeTime(time);
      if (norm === '12:00' || norm === '00:00') continue;
      times.push(time);
      allSlots[time] = true;
    }
    times.sort((a, b) => normalizeTime(a).localeCompare(normalizeTime(b)));
    docSlotsMap[t.name] = times;
  });
  const sortedSlots = Object.keys(allSlots).sort((a, b) => mbSortKey_(a).localeCompare(mbSortKey_(b)));

  // ── ค่าเริ่มต้น "เปิดทำการ" ตามวัน/นักกายภาพ ──
  const defaults = {};
  for (let i = 1; i < slotsData.length; i++) {
    const dow = slotsData[i][0], tid = slotsData[i][2], tv = slotsData[i][1];
    if (dow !== '' && tid && tv) defaults[tid + '_' + dow] = 'Open';
  }

  // ── วันหยุด (เฉพาะเดือนนี้) ──
  const holidays = {};
  for (let i = 1; i < hData.length; i++) {
    const hd = parseFlexDate(hData[i][0]);
    if (!hd) continue;
    const ds = dateToStr(hd);
    if (ds < start || ds > end || holidays[ds]) continue;
    holidays[ds] = hData[i][1] || 'หยุด';
  }

  // ── การจอง (เฉพาะเดือนนี้ / ไม่ส่งเบอร์โทรไปหน้าตาราง) ──
  const bookings = [];
  for (let i = 0; i < bData.length; i++) {
    const r  = bData[i];
    const bd = parseFlexDate(r[2]);
    if (!bd) continue;
    const ds = dateToStr(bd);
    if (ds < start || ds > end) continue;
    bookings.push({
      date: ds,
      masseuse: tMap[r[4]] || 'นักกายภาพบำบัด',
      time: normalizeTime(r[3]),
      hn: normalizeHN(r[6]),
      name: r[7],
      rights: r[9],
      treatmentType: r[10],
      appointmentType: r[12] || 'OPD'
    });
  }

  return {
    success: true, yearMonth: ym, version: ver, builtAt: builtAt,
    etag: ver + ':' + builtAt,
    bookings: bookings, holidays: holidays, defaults: defaults,
    sortedSlots: sortedSlots, docMap: docMap, docSlotsMap: docSlotsMap
  };
}

// ───────────────────────────────────────────────────────────────────
// getCalendarEvents (เขียนใหม่) — อ่านแต่ละชีตครั้งเดียว + แคชตาม version
//  • ปรับ start/end ให้เป็น yyyy-MM-dd ก่อนเทียบ (FullCalendar ส่งมาเป็น ISO
//    "2026-10-25T00:00:00+07:00" → เดิมทำให้การจองของ "วันแรกที่เห็นในปฏิทิน" ถูกข้าม)
//  • ExtraSlots ที่ Sheets แปลงคอลัมน์วันที่เป็น Date อัตโนมัติ ก็นับให้ถูกต้อง
// ───────────────────────────────────────────────────────────────────
function getCalendarEvents(start, end) {
  const s = String(start || '').substring(0, 10);
  const e = String(end   || '').substring(0, 10);
  if (!s || !e) return [];
  const key = 'ce3_v' + getSystemVersion() + '_' + s + '_' + e;
  const hit = bigCacheGet_(key);
  if (hit) return hit;
  const events = buildCalendarEvents_(s, e);
  bigCachePut_(key, events, 900);
  return events;
}

function buildCalendarEvents_(start, end) {
  const therapists = getAllMasseusesConfig();
  const hData      = HOLIDAYS_SHEET().getDataRange().getValues();
  const slotsData  = SLOTS_SHEET().getDataRange().getValues();
  const exSheet    = EXTRA_SLOTS_SHEET();
  const exData     = exSheet ? exSheet.getDataRange().getValues() : [];
  const bSheet     = BOOKINGS_SHEET();
  const bLast      = bSheet.getLastRow();
  const bData      = bLast >= 2 ? bSheet.getRange(2, 1, bLast - 1, 5).getValues() : []; // A–E พอ

  // วันหยุดที่ตั้งเอง/ราชการ (ตัดซ้ำ)
  const holidaySet = {};
  for (let i = 1; i < hData.length; i++) {
    const hd = parseFlexDate(hData[i][0]);
    if (!hd) continue;
    const ds = dateToStr(hd);
    if (!holidaySet[ds]) {
      holidaySet[ds] = { reason: hData[i][1] || 'ปิดทำการ', source: (hData[i][2] || '').toString().toLowerCase() };
    }
  }

  // ช่องเวลามาตรฐานต่อ (วัน-ของ-สัปดาห์ × นักกายภาพ)
  const baseSlots = {};
  for (let i = 1; i < slotsData.length; i++) {
    const row = slotsData[i];
    if (row[0] === '' || row[0] === null || !row[2] || !row[1]) continue;
    const k = String(row[0]) + '_' + String(row[2]).trim();
    (baseSlots[k] = baseSlots[k] || []).push({ time: normalizeTime(row[1]), type: row[3] || 'normal' });
  }
  // ช่องเวลาพิเศษรายวัน
  const extraSlots = {};
  for (let i = 1; i < exData.length; i++) {
    const r = exData[i];
    if (!r[0] || !r[2] || !r[1] || r[1].toString() === 'undefined') continue;
    const t = normalizeTime(r[1]);
    if (!t || t === '00:00') continue;
    const dsx = (r[0] instanceof Date) ? dateToStr(r[0]) : r[0].toString().trim();
    const k = dsx + '_' + String(r[2]).trim();
    (extraSlots[k] = extraSlots[k] || []).push({ time: t, type: 'extra' });
  }
  // เวลาที่ถูกจองแล้ว ต่อวัน/นักกายภาพ (เฉพาะช่วงที่ขอ)
  const booked = {};
  for (let i = 0; i < bData.length; i++) {
    const bd = parseFlexDate(bData[i][2]);
    if (!bd) continue;
    const ds = dateToStr(bd);
    if (ds < start || ds >= end) continue;
    const t = timeValueToStr(bData[i][3]);
    if (!t) continue;
    const k = ds + '|' + bData[i][4];
    (booked[k] = booked[k] || {})[t] = true;
  }

  const events = [];
  for (let ds = start; ds < end; ds = addDaysStr_(ds, 1)) {
    const dow = dowOfStr_(ds);
    const hol = holidaySet[ds];
    if (hol) {
      events.push({ title: 'หยุด: ' + hol.reason, start: ds, allDay: true, isHoliday: true,
                    holidaySource: hol.source === 'national' ? 'national' : 'manual' });
      continue;
    }
    if (dow === 0 || dow === 6) {
      events.push({ title: 'หยุดสัปดาห์', start: ds, allDay: true, isHoliday: true, holidaySource: 'weekend' });
      continue;
    }
    therapists.forEach(t => {
      const slots = (baseSlots[dow + '_' + t.id] || []).concat(extraSlots[ds + '_' + t.id] || []);
      if (!slots.length) return;
      const bookedSet = booked[ds + '|' + t.id] || {};
      let total = 0, used = 0;
      slots.forEach(sl => {
        if (sl.type === 'lunch') return;
        total++;
        if (bookedSet[sl.time]) used++;
      });
      events.push({
        title: t.name, start: ds, isHoliday: false,
        isHome: t.name.toUpperCase().indexOf('HOME') !== -1,
        doctorName: t.name, rem: Math.max(0, total - used), totalSlots: total
      });
    });
  }
  return events;
}

// อุ่นแคชเดือนนี้/เดือนหน้า (เรียกจาก syncMainViews ทุก 30 นาที) — ผู้ใช้คนแรกของวันจะไม่ต้องรอ
function warmMonthlyBundles_() {
  const now = new Date();
  for (let i = 0; i <= 1; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    getMonthlyBundle(d.getFullYear(), d.getMonth() + 1, '', false);
  }
}

// ใช้เมื่อแก้ชีต Slots / Config / Holidays "ด้วยมือ" แล้วอยากให้ทุกหน้าเห็นทันที
// (รันจาก Apps Script Editor ได้เลย) — แค่เพิ่ม version ทำให้แคชเดิมถูกข้ามทั้งหมด
function refreshAllCaches() {
  incrementVersion();
  clearKPICache();
  clearPublicAvailabilityCache();
  return 'ล้างแคชทั้งหมดแล้ว — dataVersion = ' + getSystemVersion();
}

// ═══════════════════════════════════════════════════════════════════
// ✅ V18 — บันทึกหลายตำแหน่งต่อนัด (รักษา 2 ข้าง) + Discharge
// ───────────────────────────────────────────────────────────────────
//  โครงข้อมูล
//   • OutcomeSites (ชีตใหม่ สร้างอัตโนมัติ) : 1 แถว = 1 ตำแหน่งที่รักษาใน 1 นัด
//       บริเวณ + ข้าง + ICD-10 + ชนิด (ปวด/ชา) + VAS ก่อน-หลัง + measures(JSON สำหรับ ROM ฯลฯ ในอนาคต)
//   • Outcomes (เดิม) ยังเป็นสรุป 1 แถวต่อนัด → KPI/Export เดิมใช้ได้ต่อ
//       VAS หลัก = ตำแหน่งที่ปวดมากสุดก่อนรักษา, VAS รอง = ตำแหน่งถัดไป (ตามที่ frontend ส่งมา)
//   • Episodes (เดิม) เพิ่มคอลัมน์ I–L : ผู้ปิดเคส / สรุปผล(JSON) / โปรแกรมที่บ้าน / เกณฑ์กลับมาพบ
//       เปิดเคสให้อัตโนมัติเมื่อบันทึกผลครั้งแรก และนับจำนวนครั้งจาก Outcomes จริง (ไม่เก็บเป็นตัวเลขที่เพี้ยนได้)
//  ความเข้ากันได้ย้อนหลัง
//   • นัดเก่าที่ไม่มีแถวใน OutcomeSites → แปลงจาก Outcomes + Bookings ตอนอ่าน (ไม่ต้องย้ายข้อมูล)
//   • backfillOutcomeSites(true) = ทดลองดูก่อน, backfillOutcomeSites(false) = เขียนจริง (รันครั้งเดียวได้)
// ═══════════════════════════════════════════════════════════════════
const SITE_HEADERS = ['siteId','bookingId','hn','episodeId','date','therapistId','seq','region','side','icd10','dxLabel','dxJson','vasType','vasBefore','vasAfter','measures','createdAt'];
const SITE_REGIONS = { shoulder:'ไหล่', neck:'คอ', upper_back:'หลังส่วนบน', lower_back:'หลังส่วนล่าง', hip:'สะโพก', knee:'เข่า',
                       ankle_foot:'ข้อเท้า/เท้า', elbow:'ข้อศอก', wrist_hand:'ข้อมือ/มือ', head_jaw:'ศีรษะ/ขากรรไกร', other:'อื่นๆ' };
const SITE_SIDE_LABELS = { L:'ซ้าย', R:'ขวา', B:'สองข้าง', '':'' };
const EP_STATUS_LABELS = { active:'กำลังรักษา', completed:'บรรลุเป้าหมาย', referred:'ส่งต่อ', patient_stop:'ขอหยุดเอง', dropout:'ขาดนัด/หยุดกลางคัน', other:'อื่นๆ' };
const EP_CLOSE_STATUSES = ['completed','referred','patient_stop','dropout','other'];
const MAX_SITES_PER_VISIT = 4;

function ensureSheetWithHeaders_(name, headers) {
  let sh = getSheet(name);
  if (!sh) {
    sh = getSpreadsheet().insertSheet(name);
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());   // V29 final: ชีตใหม่มีแค่ 26 คอลัมน์ แต่ AssetRegister มี 39
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    try { sh.setFrozenRows(1); } catch (e) {}
  }
  return sh;
}
function OUTCOME_SITES_SHEET() { return ensureSheetWithHeaders_('OutcomeSites', SITE_HEADERS); }

// เพิ่มหัวคอลัมน์ I–L ให้ Episodes (ครั้งเดียว ไม่แตะข้อมูลเดิม)
function ensureEpisodeColumns_() {
  const sh = EPISODES_SHEET();
  if (!sh) return null;
  const want = ['dischargedBy','summaryJson','homeProgram','followUp','followPlan'];
  if (sh.getMaxColumns() < 8 + want.length) sh.insertColumnsAfter(sh.getMaxColumns(), 8 + want.length - sh.getMaxColumns());
  const cur = sh.getRange(1, 9, 1, want.length).getValues()[0];
  if (cur.some((v, i) => !v)) {
    const out = want.map((h, i) => cur[i] || h);
    sh.getRange(1, 9, 1, want.length).setValues([out]);
  }
  return sh;
}

function clampVas_(v) {
  const n = numOrBlank_(v);
  if (n === '') return '';
  return Math.max(0, Math.min(10, n));
}
function normSide_(s) {
  s = String(s || '').trim().toUpperCase();
  if (s === 'L' || s === 'LEFT'  || s === 'ซ้าย') return 'L';
  if (s === 'R' || s === 'RIGHT' || s === 'ขวา')  return 'R';
  if (s === 'B' || s === 'BOTH'  || s === 'สองข้าง') return 'B';
  return '';
}

// ตรวจ/จัดรูปแบบรายการตำแหน่งที่รับมาจากหน้าเว็บ
function normalizeSites_(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach(function (s) {
    if (!s || out.length >= MAX_SITES_PER_VISIT) return;
    const dx = (s.diagnosis && typeof s.diagnosis === 'object') ? s.diagnosis : null;
    const region = SITE_REGIONS[s.region] ? s.region : (s.region ? 'other' : '');
    const vb = clampVas_(s.vasBefore), va = clampVas_(s.vasAfter);
    if (!region && !dx && vb === '' && va === '') return;       // แถวว่าง
    out.push({
      seq: out.length + 1, region: region, side: normSide_(s.side),
      icd10: dx ? (dx.icd10 || '') : '', dxLabel: dx ? (dx.label || '') : '', diagnosis: dx,
      vasType: s.vasType === 'numbness' ? 'numbness' : 'pain', vasBefore: vb, vasAfter: va,
      measures: (s.measures && typeof s.measures === 'object') ? s.measures : {}
    });
  });
  return out;
}

// HOME / บันทึกแบบเดิม (ไม่มี sites) → สร้างรายการตำแหน่งจากฟิลด์เดิม
function sitesFromLegacyInput_(d) {
  const arr = [];
  const vb1 = d.vas1_before !== undefined ? d.vas1_before : d.vas_before;
  const va1 = d.vas1_after  !== undefined ? d.vas1_after  : d.vas_after;
  const t1  = d.vas1_type || d.vas_type;
  if (d.diagnosis || (clampVas_(vb1) !== '')) {
    arr.push({ region: d.diagnosis && d.diagnosis.region, side: d.diagnosis && d.diagnosis.side, diagnosis: d.diagnosis,
               vasType: t1, vasBefore: vb1, vasAfter: va1 });
  }
  if (d.diagnosis2 || (clampVas_(d.vas2_before) !== '')) {
    arr.push({ region: d.diagnosis2 && d.diagnosis2.region, side: d.diagnosis2 && d.diagnosis2.side, diagnosis: d.diagnosis2,
               vasType: d.vas2_type, vasBefore: d.vas2_before, vasAfter: d.vas2_after });
  }
  return normalizeSites_(arr);
}

function siteRowToObj_(r) {
  let dx = null;
  if (r[11]) { try { dx = JSON.parse(r[11]); } catch (e) {} }
  if (!dx && r[9]) dx = { icd10: r[9], label: r[10] || '' };
  let ms = {};
  if (r[15]) { try { ms = JSON.parse(r[15]); } catch (e) {} }
  const dt = r[4] instanceof Date ? dateToStr(r[4]) : String(r[4] || '');
  return {
    siteId: r[0], bookingId: String(r[1] || ''), hn: normalizeHN(r[2]), episodeId: r[3] || '', date: dt, therapistId: r[5] || '',
    seq: Number(r[6]) || 1, region: r[7] || '', regionLabel: SITE_REGIONS[r[7]] || '', side: r[8] || '', sideLabel: SITE_SIDE_LABELS[r[8] || ''] || '',
    icd10: r[9] || '', dxLabel: r[10] || '', diagnosis: dx, vasType: r[12] || 'pain',
    vasBefore: r[13] === undefined ? '' : r[13], vasAfter: r[14] === undefined ? '' : r[14], measures: ms
  };
}

// อ่านทุกแถวใน OutcomeSites ครั้งเดียว → กลุ่มตาม bookingId
function readAllSites_() {
  const sh = getSheet('OutcomeSites');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, SITE_HEADERS.length).getValues()
           .filter(r => r[0]).map(siteRowToObj_);
}

// ───────────────────────────────────────────────────────────────────
// บันทึกตำแหน่งของนัดหนึ่ง (แทนที่ของเดิมของ booking นั้นทั้งหมด)
// ───────────────────────────────────────────────────────────────────
function saveSitesForBooking_(d, episodeId, sites) {
  const sh = OUTCOME_SITES_SHEET();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const bid = String(d.bookingId).trim();
    const last = sh.getLastRow();
    if (last >= 2) {
      const ids = sh.getRange(2, 2, last - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0] || '').trim() === bid) sh.deleteRow(i + 2);
      }
    }
    if (!sites.length) return 0;
    const bd = parseFlexDate(d.date) || new Date();
    const dstr = dateToStr(bd);
    const tid = d.therapistId || lookupBookingTherapistId_(bid) || '';
    const now = new Date();
    const hn = normalizeHN(d.hn);
    const rows = sites.map(function (s, i) {
      return [Utilities.getUuid(), bid, hn, episodeId || '', dstr, tid, i + 1, s.region, s.side, s.icd10, s.dxLabel,
              s.diagnosis ? JSON.stringify(s.diagnosis) : '', s.vasType, s.vasBefore, s.vasAfter,
              (s.measures && Object.keys(s.measures).length) ? JSON.stringify(s.measures) : '', now];
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, SITE_HEADERS.length).setValues(rows);
    return rows.length;
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

// ───────────────────────────────────────────────────────────────────
// Episode อัตโนมัติ
// ───────────────────────────────────────────────────────────────────
function findEpisodeRows_(hn) {
  const sh = ensureEpisodeColumns_();
  if (!sh || sh.getLastRow() < 2) return { sh: sh, list: [] };
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
  const list = [];
  data.forEach(function (r, i) {
    if (!r[0] || normalizeHN(r[1]) !== hn) return;
    list.push({ row: i + 2, v: r });
  });
  return { sh: sh, list: list };
}

function ensureActiveEpisode_(hn, d, sites) {
  // ✅ V23: ผู้ป่วยที่ D/C แล้วกลับมา / เคส active ที่ขาดนาน → ตัดสินตามที่เจ้าหน้าที่เลือก (มาเรื่องเดิม/เรื่องใหม่)
  //        เฉพาะ client ใหม่ที่ส่ง returnCheck มา — client เก่าใช้ logic เดิมด้านล่างเหมือนเดิมทุกประการ
  if (d && d.returnCheck) {
    const rr = rtn_resolveForSave_(hn, d, sites);
    if (rr) return rr;
  }
  const found = findEpisodeRows_(hn);
  const act = found.list.filter(e => e.v[6] === 'active')[0];
  if (act) return { episodeId: act.v[0], existing: true };
  const first = sites[0] || {};
  const dx = Object.assign({}, first.diagnosis || {});
  if (first.region) dx.region = first.region;
  if (first.side) dx.side = first.side;
  const r = getOrCreateEpisode(hn, dx, parseFlexDate(d.date) || new Date());
  return { episodeId: r.episodeId, existing: !!r.existing };
}

// นับจำนวนครั้งจริงจาก Outcomes (นัดที่มีบันทึกผล ภายในช่วงเวลาของเคส)
function countEpisodeVisits_(hn, startStr, endStr) {
  const sh = OUTCOMES_SHEET();
  if (!sh || sh.getLastRow() < 2) return 0;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  const seen = {};
  rows.forEach(function (r) {
    if (normalizeHN(r[2]) !== hn || !r[1]) return;
    const dt = r[3] instanceof Date ? dateToStr(r[3]) : String(r[3] || '').substring(0, 10);
    if (startStr && dt < startStr) return;
    if (endStr && dt > endStr) return;
    seen[String(r[1]).trim()] = true;
  });
  return Object.keys(seen).length;
}
function recountEpisodeVisits_(hn, episodeId) {
  const found = findEpisodeRows_(hn);
  const ep = found.list.filter(e => e.v[0] === episodeId)[0];
  if (!ep) return 0;
  const startStr = ep.v[2] instanceof Date ? dateToStr(ep.v[2]) : '';
  const endStr   = ep.v[3] instanceof Date ? dateToStr(ep.v[3]) : '';
  const n = countEpisodeVisits_(hn, startStr, endStr);
  found.sh.getRange(ep.row, 6).setValue(n);
  return n;
}

// ───────────────────────────────────────────────────────────────────
// ครอบ saveOutcome / saveOutcome_dual เดิม — ของเดิมทำงานเหมือนเดิมทุกอย่าง แล้วต่อด้วย V18
// ถ้าส่วน V18 ผิดพลาด การบันทึกเดิมยัง "สำเร็จ" (คืน v18.error เพื่อแจ้งเตือน ไม่ทำให้ข้อมูลหาย)
// ───────────────────────────────────────────────────────────────────
function afterOutcomeSaved_(d) {
  const hn = normalizeHN(d.hn);
  let sites = normalizeSites_(d.sites);
  if (!sites.length) sites = sitesFromLegacyInput_(d);
  const ep = ensureActiveEpisode_(hn, d, sites);
  saveSitesForBooking_(d, ep.episodeId, sites);
  const visits = recountEpisodeVisits_(hn, ep.episodeId);
  const out = { episodeId: ep.episodeId, newEpisode: !ep.existing, returnType: ep.returnType || '', sites: sites.length, visits: visits, hint: getDischargeHint(hn) };
  if (d.bodyChart && typeof d.bodyChart === 'object') {          // ✅ V19: null/ไม่ส่ง = ไม่เปลี่ยนแผนภาพ
    try { out.bodyChart = saveBodyChartForBooking_(d, ep.episodeId); }
    catch (e) { Logger.log('V19 bodyChart: ' + e.message); out.bodyChartError = e.message; }
  }
  return out;
}
function saveOutcome_dual(d) {
  const pre = rtn_precheck_(d); if (pre) return pre;          // ✅ V23: ต้องเลือก เรื่องเดิม/เรื่องใหม่ ก่อน (ยังไม่บันทึกอะไร)
  const res = saveOutcome_dualCore_(d);
  if (!res || !res.success) return res;
  try { res.v18 = afterOutcomeSaved_(d); } catch (e) { Logger.log('V18 saveOutcome_dual: ' + e.message); res.v18 = { error: e.message }; }
  return res;
}
function saveOutcome(d) {
  const pre = rtn_precheck_(d); if (pre) return pre;          // ✅ V23
  const res = saveOutcomeCore_(d);
  if (!res || !res.success) return res;
  try { res.v18 = afterOutcomeSaved_(d); } catch (e) { Logger.log('V18 saveOutcome: ' + e.message); res.v18 = { error: e.message }; }
  return res;
}

// ───────────────────────────────────────────────────────────────────
// อ่านตำแหน่ง
// ───────────────────────────────────────────────────────────────────
function sitesFromOutcomeObj_(o) {
  const arr = [];
  const dx1 = o.diagnosis || null, dx2 = o.diagnosis2 || null;
  const has = v => v !== '' && v !== undefined && v !== null;
  if (has(o.vas_before) || dx1) {
    arr.push({ seq: 1, region: (dx1 && dx1.region) || '', side: (dx1 && dx1.side) || '', icd10: dx1 ? dx1.icd10 || '' : '', dxLabel: dx1 ? dx1.label || '' : '',
               diagnosis: dx1, vasType: o.vas1_type || o.vas_type || 'pain', vasBefore: has(o.vas_before) ? o.vas_before : '', vasAfter: has(o.vas_after) ? o.vas_after : '', legacy: true });
  }
  if (has(o.vas2_before) || dx2) {
    arr.push({ seq: 2, region: (dx2 && dx2.region) || '', side: (dx2 && dx2.side) || '', icd10: dx2 ? dx2.icd10 || '' : '', dxLabel: dx2 ? dx2.label || '' : '',
               diagnosis: dx2, vasType: o.vas2_type || 'pain', vasBefore: has(o.vas2_before) ? o.vas2_before : '', vasAfter: has(o.vas2_after) ? o.vas2_after : '', legacy: true });
  }
  arr.forEach(s => { s.regionLabel = SITE_REGIONS[s.region] || ''; s.sideLabel = SITE_SIDE_LABELS[s.side] || ''; });
  return arr;
}
function getSitesForBooking(bookingId) {
  const bid = String(bookingId || '').trim();
  const rows = readAllSites_().filter(s => s.bookingId === bid).sort((a, b) => a.seq - b.seq);
  if (rows.length) return rows;
  const o = getOutcomeByBookingCore_(bid);
  return o ? sitesFromOutcomeObj_(o) : [];
}
function getOutcomeByBooking(bookingId) {
  const o = getOutcomeByBookingCore_(bookingId);
  if (!o) return o;
  try {
    const bid = String(bookingId || '').trim();
    const rows = readAllSites_().filter(s => s.bookingId === bid).sort((a, b) => a.seq - b.seq);
    o.sites = rows.length ? rows : sitesFromOutcomeObj_(o);
  } catch (e) { o.sites = []; }
  try {
    const bc = getBodyChart(bookingId);
    o.bodyChart = bc ? bc.chart : null;
    o.hasBodyChart = !!(bc && bcHasContent_(bc.chart));
  } catch (e) { o.bodyChart = null; o.hasBodyChart = false; }
  return o;
}

// ตำแหน่งของนัดล่าสุดของ HN (ใช้ "เติมจากครั้งก่อน") — before ใหม่ = after ครั้งก่อน
function getPrefillSites(hn) {
  hn = normalizeHN(hn);
  const all = readAllSites_().filter(s => s.hn === hn);
  let src = [], date = '';
  if (all.length) {
    const lastDate = all.map(s => s.date).sort().pop();
    const lastBids = {};
    all.filter(s => s.date === lastDate).forEach(s => { lastBids[s.bookingId] = true; });
    const bid = Object.keys(lastBids).pop();
    src = all.filter(s => s.bookingId === bid).sort((a, b) => a.seq - b.seq);
    date = lastDate;
  } else {
    const sh = OUTCOMES_SHEET();
    if (sh && sh.getLastRow() >= 2) {
      const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().filter(r => normalizeHN(r[2]) === hn && r[1]);
      if (rows.length) {
        rows.sort((a, b) => String(b[3] instanceof Date ? b[3].getTime() : b[3]).localeCompare(String(a[3] instanceof Date ? a[3].getTime() : a[3])));
        const o = getOutcomeByBookingCore_(rows[0][1]);
        if (o) { src = sitesFromOutcomeObj_(o); date = o.date || ''; }
      }
    }
  }
  return { date: date, sites: src.map(s => ({ region: s.region, side: s.side, diagnosis: s.diagnosis, vasType: s.vasType,
                                              prevAfter: s.vasAfter, regionLabel: s.regionLabel, sideLabel: s.sideLabel, icd10: s.icd10 })) };
}

// ───────────────────────────────────────────────────────────────────
// Discharge
// ───────────────────────────────────────────────────────────────────
function pickEpisodeForSummary_(hn, preferActive) {
  const found = findEpisodeRows_(hn);
  if (!found.list.length) return null;
  const act = found.list.filter(e => e.v[6] === 'active')[0];
  if (act) return act;
  if (preferActive) return null;
  return found.list.sort((a, b) => String(b.v[2]).localeCompare(String(a.v[2])))[0];
}


// อ่าน Bookings ครั้งเดียว → แผนที่ bookingId → { a: ICD หลัก, b: ICD รอง }
function buildDxMap_() {
  const bsh = BOOKINGS_SHEET();
  const map = {};
  if (!bsh || bsh.getLastRow() < 2) return map;
  bsh.getRange(2, 1, bsh.getLastRow() - 1, 15).getValues().forEach(function (r) {
    const bid = String(r[1] || '').trim(); if (!bid) return;
    let a = null, c = null;
    if (r[13]) { try { a = JSON.parse(r[13]); } catch (e) {} }
    if (r[14]) { try { c = JSON.parse(r[14]); } catch (e) {} }
    map[bid] = { a: a, b: c };
  });
  return map;
}

function getDischargeSummary(hn, endOverride) {
  try {
    hn = normalizeHN(hn);
    const ep = pickEpisodeForSummary_(hn, false);
    if (!ep) return { success: false, message: 'ยังไม่มี Episode ของผู้ป่วยรายนี้ (จะเปิดอัตโนมัติเมื่อบันทึกผลครั้งแรก)' };
    const startStr = ep.v[2] instanceof Date ? dateToStr(ep.v[2]) : '';
    // ✅ V21: endOverride = วันที่ Discharge ที่ผู้ใช้เลือก (รองรับ Discharge ย้อนหลัง) → สรุปผลนับเฉพาะนัดถึงวันนั้น
    const endStr   = (endOverride && /^\d{4}-\d{2}-\d{2}$/.test(String(endOverride))) ? String(endOverride) : (ep.v[3] instanceof Date ? dateToStr(ep.v[3]) : '');
    const inRange = dt => (!startStr || dt >= startStr) && (!endStr || dt <= endStr);

    // ตำแหน่ง: จัดกลุ่มตาม (บริเวณ+ข้าง) เรียงตามวันที่
    const sites = readAllSites_().filter(s => s.hn === hn && inRange(s.date));
    const coveredBookings = {};
    sites.forEach(s => { coveredBookings[s.bookingId] = true; });

    // Outcomes ในช่วงเคส (สำหรับ Barthel / เป้าหมาย / นัดเก่าที่ยังไม่มีแถวตำแหน่ง)
    const osh = OUTCOMES_SHEET();
    const oRows = (osh && osh.getLastRow() >= 2) ? osh.getRange(2, 1, osh.getLastRow() - 1, 15).getValues() : [];
    const outs = [];
    oRows.forEach(function (r) {
      if (normalizeHN(r[2]) !== hn || !r[1]) return;
      const dt = r[3] instanceof Date ? dateToStr(r[3]) : String(r[3] || '').substring(0, 10);
      if (!inRange(dt)) return;
      outs.push({ bookingId: String(r[1]).trim(), date: dt, vb: r[5], va: r[6], barthel: r[7], goal: r[8] === 'yes' || outcomeGoalMetFromPtd_(parsePtData_(r[9] || '')),
                  vb2: r[12], va2: r[13], t1: (parsePtData_(r[9] || '').vas1_type || 'pain'), t2: (parsePtData_(r[9] || '').vas2_type || 'pain') });
    });
    outs.sort((a, b) => a.date.localeCompare(b.date));
    // นัดเก่า: ไม่มีใน OutcomeSites → ใช้ VAS หลัก/รองจาก Outcomes + ICD จาก Bookings (อ่าน Bookings ครั้งเดียว)
    const legacySites = [];
    const needLegacy = outs.filter(o => !coveredBookings[o.bookingId]);
    if (needLegacy.length) {
      const dxMap = buildDxMap_();
      needLegacy.forEach(function (o) {
        const dx = dxMap[o.bookingId] || {};
        const obj = { vas_before: o.vb, vas_after: o.va, vas2_before: o.vb2, vas2_after: o.va2, diagnosis: dx.a || null, diagnosis2: dx.b || null,
                      vas1_type: o.t1, vas2_type: o.t2 };
        sitesFromOutcomeObj_(obj).forEach(s => legacySites.push(Object.assign({ date: o.date, bookingId: o.bookingId }, s)));
      });
    }

    const groups = {};
    sites.concat(legacySites).sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.seq - b.seq)).forEach(function (s) {
      if (s.vasBefore === '' || s.vasAfter === '') return;
      const key = (s.region || '-') + '|' + (s.side || '-') + (s.region ? '' : '|' + (s.icd10 || ''));
      const g = groups[key] || (groups[key] = { region: s.region, regionLabel: s.regionLabel || SITE_REGIONS[s.region] || '', side: s.side, sideLabel: s.sideLabel || SITE_SIDE_LABELS[s.side] || '',
                                                icd10: s.icd10, dxLabel: s.dxLabel, vasType: s.vasType, first: null, last: null, n: 0 });
      const pt = { date: s.date, before: Number(s.vasBefore), after: Number(s.vasAfter) };
      if (!g.first) g.first = pt;
      g.last = pt; g.n++;
      if (!g.icd10 && s.icd10) { g.icd10 = s.icd10; g.dxLabel = s.dxLabel; }
    });
    const siteList = Object.keys(groups).map(function (k) {
      const g = groups[k];
      g.reduction = g.first.before - g.last.after;
      return g;
    });

    const bt = outs.filter(o => o.barthel !== '' && o.barthel !== undefined && o.barthel !== null);
    const hasEnd = !endOverride && !!endStr;
    return {
      success: true,
      episode: { episodeId: ep.v[0], status: ep.v[6] || 'active', statusLabel: EP_STATUS_LABELS[ep.v[6]] || ep.v[6], startDate: startStr, endDate: endStr },
      visits: countEpisodeVisits_(hn, startStr, endStr),
      firstVisit: outs.length ? outs[0].date : '', lastVisit: outs.length ? outs[outs.length - 1].date : '',
      sites: siteList,
      barthel: bt.length ? { first: Number(bt[0].barthel), last: Number(bt[bt.length - 1].barthel) } : null,
      goalsMet: outs.filter(o => o.goal).length, lastGoalMet: outs.length ? !!outs[outs.length - 1].goal : false,
      closed: hasEnd
    };
  } catch (e) { Logger.log('getDischargeSummary: ' + e.message); return { success: false, message: e.message }; }
}

// เข้าเกณฑ์ Discharge? → แจ้งเตือนเบาๆ (ไม่ปิดเคสเอง)
function getDischargeHint(hn) {
  try {
    hn = normalizeHN(hn);
    const ep = pickEpisodeForSummary_(hn, true);
    if (!ep) return { suggest: false };
    const sum = getDischargeSummary(hn);
    if (!sum.success || !sum.sites.length) return { suggest: false };
    const allLow = sum.sites.every(s => s.last.after <= 2);
    const suggest = !!(sum.lastGoalMet && allLow && sum.visits >= 2);
    return { suggest: suggest, visits: sum.visits, reason: suggest ? 'บรรลุเป้าหมายครั้งล่าสุด และ VAS หลังรักษาทุกตำแหน่ง ≤ 2' : '' };
  } catch (e) { return { suggest: false }; }
}

// ปิดเคสแบบ Discharge (แทนปุ่มเดิม) — เก็บสรุปผลอัตโนมัติ + โปรแกรมที่บ้าน + เกณฑ์กลับมาพบ
function dischargeEpisode(d) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองใหม่' }; }
  try {
    if (!d || !d.hn) return { success: false, message: 'ไม่พบ HN' };
    const status = String(d.status || '').trim();
    if (EP_CLOSE_STATUSES.indexOf(status) < 0) return { success: false, message: 'เหตุผลการ Discharge ไม่ถูกต้อง' };
    const hn = normalizeHN(d.hn);
    const ep = pickEpisodeForSummary_(hn, true);
    if (!ep) return { success: false, message: 'ไม่พบ Episode ที่กำลังรักษา (อาจถูกปิดไปแล้ว)' };
    if (status === 'other' && !String(d.note || '').trim()) return { success: false, message: 'กรุณาระบุรายละเอียดเมื่อเลือก "อื่นๆ"' };
    // ✅ V21: วันที่ Discharge (ย้อนหลังได้) — ห้ามเกินวันนี้ และห้ามก่อนวันเริ่มเคส
    const todayStr = dateToStr(new Date());
    const endStr = String(d.date || '').trim() || todayStr;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endStr)) return { success: false, message: 'รูปแบบวันที่ Discharge ไม่ถูกต้อง' };
    if (endStr > todayStr) return { success: false, message: 'วันที่ Discharge ต้องไม่เกินวันนี้' };
    const epStartStr = ep.v[2] instanceof Date ? dateToStr(ep.v[2]) : '';
    if (epStartStr && endStr < epStartStr) return { success: false, message: 'วันที่ Discharge (' + endStr + ') ต้องไม่ก่อนวันเริ่มเคส (' + epStartStr + ')' };
    const summary = getDischargeSummary(hn, endStr);
    // ✅ V20: ผลลัพธ์/ปลายทางหลัง Discharge เก็บใน summaryJson (ไม่ต้องเพิ่มคอลัมน์)
    if (summary && summary.success) {
      const rOk = ['full','partial','none'], dOk = ['home','hep','followup','refer'];
      summary.discharge = { result: rOk.indexOf(d.result) >= 0 ? d.result : '', destination: dOk.indexOf(d.destination) >= 0 ? d.destination : '' };
    }
    const ep4 = endStr.split('-');
    const now = new Date(+ep4[0], +ep4[1] - 1, +ep4[2]);
    const sh = findEpisodeRows_(hn).sh;
    sh.getRange(ep.row, 4).setValue(now);
    sh.getRange(ep.row, 6).setValue(summary.success ? summary.visits : (ep.v[5] || 0));
    sh.getRange(ep.row, 7).setValue(status);
    sh.getRange(ep.row, 8).setValue(String(d.note || ''));
    sh.getRange(ep.row, 9, 1, 4).setValues([[ String(d.by || 'กภ.พลอยไพลิน ประทีปพงศ์'), summary.success ? JSON.stringify(summary) : '', String(d.homeProgram || ''), String(d.followUp || '') ]]);
    try { CacheService.getScriptCache().remove('kpi_trend_12m_v3'); } catch (e2) {}
    return { success: true, summary: summary, statusLabel: EP_STATUS_LABELS[status] };
  } catch (e) { Logger.log('dischargeEpisode: ' + e.message); return { success: false, message: e.message }; }
  finally { try { lock.releaseLock(); } catch (e3) {} }
}

// ✅ V21 — เปิดเคสอีกครั้ง / เลิกทำ Discharge: กลับเป็น active และล้างสรุปการ Discharge
function reopenEpisode(episodeId) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองใหม่' }; }
  try {
    const id = String(episodeId || '').trim();
    if (!id) return { success: false, message: 'ไม่พบรหัส Episode' };
    const sh = ensureEpisodeColumns_();
    if (!sh || sh.getLastRow() < 2) return { success: false, message: 'ไม่พบ Sheet Episodes' };
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
    let row = 0, hn = '';
    for (let i = 0; i < data.length; i++) { if (String(data[i][0]) === id) { row = i + 2; hn = normalizeHN(data[i][1]); if (data[i][6] === 'active') return { success: false, message: 'เคสนี้กำลังรักษาอยู่แล้ว' }; break; } }
    if (!row) return { success: false, message: 'ไม่พบ Episode' };
    const other = data.some(function (r) { return String(r[0]) !== id && normalizeHN(r[1]) === hn && r[6] === 'active'; });
    if (other) return { success: false, message: 'ผู้ป่วยรายนี้มีเคสที่กำลังรักษาอยู่แล้ว จึงเปิดเคสเก่าซ้ำไม่ได้' };
    sh.getRange(row, 4).setValue('');
    sh.getRange(row, 7).setValue('active');
    sh.getRange(row, 8).setValue('');
    sh.getRange(row, 9, 1, 4).setValues([['', '', '', '']]);
    try { CacheService.getScriptCache().remove('kpi_trend_12m_v3'); } catch (e2) {}
    return { success: true };
  } catch (e) { Logger.log('reopenEpisode: ' + e.message); return { success: false, message: e.message }; }
  finally { try { lock.releaseLock(); } catch (e3) {} }
}

// ✅ V21 — สร้าง Episode ย้อนหลังให้ผู้ป่วยเก่า (ที่มีประวัติใน Outcomes แต่ไม่มีแถวใน Episodes)
//   รันจากตัวแก้ไข Apps Script:  backfillEpisodesDryRun() = ดูรายงานก่อน (ไม่เขียน) → backfillEpisodesWrite() = เขียนจริง
//   กติกา: ต่อ HN เรียงนัดตามวัน แยกเป็นรอบการรักษาเมื่อห่างกัน > 90 วัน
//     • รอบล่าสุด → active (ถ้าชนกับ Episode ที่มีอยู่และห่างไม่เกิน 90 วัน จะขยายวันเริ่มของ Episode นั้นย้อนไปแทน)
//     • รอบก่อนหน้า (ห่างเกิน 90 วันแล้ว) → ปิดเป็น "อื่นๆ" วันที่ปิด = วันที่มาครั้งสุดท้าย พร้อมหมายเหตุ "สร้างย้อนหลังอัตโนมัติ"
//   ไม่แตะนัด/ผลการรักษาใดๆ และรันซ้ำได้ปลอดภัย (นัดที่อยู่ในช่วงของ Episode เดิมจะไม่ถูกนับซ้ำ)
function backfillEpisodesDryRun() { const r = backfillEpisodes(true, 0);  Logger.log(JSON.stringify(r, null, 1)); return r; }
function backfillEpisodesWrite()  { const r = backfillEpisodes(false, 0); Logger.log(JSON.stringify(r, null, 1)); return r; }
//   ตัวเลือก: ปิดเคสที่ไม่มาพบเกิน 90 วันเป็น "ขาดนัด/หยุดกลางคัน" ให้เลย (ไม่ต้องกดทีละราย) — ดูรายงานก่อนด้วย ...DryRun แล้วค่อยเขียนจริง
function backfillEpisodesCloseOldDryRun() { const r = backfillEpisodes(true, 90);  Logger.log(JSON.stringify(r, null, 1)); return r; }
function backfillEpisodesCloseOldWrite()  { const r = backfillEpisodes(false, 90); Logger.log(JSON.stringify(r, null, 1)); return r; }

function backfillEpisodes(dryRun, autoCloseDays) {
  const GAP = 90;
  autoCloseDays = Number(autoCloseDays) || 0;
  const todayNum = Math.round(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) / 86400000);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองใหม่' }; }
  try {
    const esh = ensureEpisodeColumns_();
    const osh = OUTCOMES_SHEET();
    if (!esh || !osh || osh.getLastRow() < 2) return { success: false, message: 'ไม่พบชีต Episodes/Outcomes' };
    const dayNum = function (s) { const p = String(s).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); };
    const toDate = function (s) { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
    const toStr = function (v) { return v instanceof Date ? dateToStr(v) : String(v || '').substring(0, 10); };

    // นัดที่บันทึกผลแล้ว ต่อ HN (นับเป็นครั้งตาม bookingId ไม่ซ้ำ)
    const byHn = {};
    osh.getRange(2, 1, osh.getLastRow() - 1, 4).getValues().forEach(function (r) {
      const hn = normalizeHN(r[2]), bid = String(r[1] || '').trim(), dt = toStr(r[3]);
      if (!hn || hn === 'BLOCK' || !bid || !/^\d{4}-\d{2}-\d{2}$/.test(dt)) return;
      const m = byHn[hn] || (byHn[hn] = {}); if (!m[bid] || dt < m[bid].date) m[bid] = { bid: bid, date: dt };
    });
    // Episode ที่มีอยู่แล้ว
    const eps = {};
    const epRows = esh.getLastRow() >= 2 ? esh.getRange(2, 1, esh.getLastRow() - 1, 12).getValues() : [];
    epRows.forEach(function (r, i) {
      if (!r[0]) return; const hn = normalizeHN(r[1]);
      (eps[hn] = eps[hn] || []).push({ row: i + 2, start: toStr(r[2]), end: toStr(r[3]), status: r[6] || 'active' });
    });

    const dxMap = buildDxMap_();
    const newRows = [], extend = [], rep = { hnTotal: 0, hnTouched: 0, created: 0, createdActive: 0, createdClosed: 0, extended: 0, visitsCovered: 0, sample: [] };
    Object.keys(byHn).forEach(function (hn) {
      rep.hnTotal++;
      const have = eps[hn] || [];
      const list = Object.keys(byHn[hn]).map(function (k) { return byHn[hn][k]; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
      // เฉพาะนัดที่ยังไม่อยู่ในช่วงของ Episode เดิม
      const free = list.filter(function (o) { return !have.some(function (e) { return (!e.start || o.date >= e.start) && (!e.end || o.date <= e.end); }); });
      if (!free.length) return;
      // แยกรอบตามช่วงห่าง
      const courses = []; let cur = null;
      free.forEach(function (o) {
        if (cur && dayNum(o.date) - dayNum(cur.last) <= GAP) { cur.visits.push(o); cur.last = o.date; }
        else { cur = { first: o.date, last: o.date, visits: [o] }; courses.push(cur); }
      });
      const activeEp = have.filter(function (e) { return e.status === 'active'; })[0] || null;
      let touched = false;
      courses.forEach(function (c, idx) {
        const isLatestFree = idx === courses.length - 1;
        // รอบที่ต่อเนื่องกับ Episode active เดิม → ขยายวันเริ่มย้อนหลัง
        if (activeEp && c.last < activeEp.start && dayNum(activeEp.start) - dayNum(c.last) <= GAP && isLatestFree) {
          extend.push({ row: activeEp.row, start: c.first }); rep.extended++; rep.visitsCovered += c.visits.length; touched = true;
          rep.sample.length < 12 && rep.sample.push(hn + ': ขยายเริ่มเป็น ' + c.first + ' (+' + c.visits.length + ' ครั้ง)'); return;
        }
        const latestOverall = isLatestFree && !activeEp && !have.some(function (e) { return e.start > c.last; });
        const dx = (dxMap[c.visits[0].bid] || {}).a || {};
        const stale = latestOverall && autoCloseDays > 0 && (todayNum - dayNum(c.last)) > autoCloseDays;
        const keepActive = latestOverall && !stale;
        const status = keepActive ? 'active' : (stale ? 'dropout' : 'other');
        const note = keepActive ? '' : (stale ? 'สร้างย้อนหลังอัตโนมัติ (ไม่มาพบเกิน ' + autoCloseDays + ' วัน)' : 'สร้างย้อนหลังอัตโนมัติ (รอบการรักษาที่ห่างจากครั้งถัดไป > ' + GAP + ' วัน)');
        newRows.push([Utilities.getUuid(), hn, toDate(c.first), keepActive ? '' : toDate(c.last), JSON.stringify(dx), c.visits.length, status, note,
                      keepActive ? '' : 'ระบบ (backfill)', '', '', '']);
        rep.created++; keepActive ? rep.createdActive++ : rep.createdClosed++; rep.visitsCovered += c.visits.length; touched = true;
        rep.sample.length < 12 && rep.sample.push(hn + ': ' + (keepActive ? 'เปิดเคส active' : 'ปิดเคสเก่า') + ' ' + c.first + ' → ' + c.last + ' (' + c.visits.length + ' ครั้ง)');
      });
      if (touched) rep.hnTouched++;
    });

    rep.success = true; rep.dryRun = !!dryRun;
    if (dryRun) { rep.message = 'ทดลองเท่านั้น ยังไม่ได้เขียนข้อมูล — ถ้าตัวเลขโอเคให้รัน backfillEpisodesWrite()'; return rep; }
    if (newRows.length) esh.getRange(esh.getLastRow() + 1, 1, newRows.length, 12).setValues(newRows);
    extend.forEach(function (x) { esh.getRange(x.row, 3).setValue(toDate(x.start)); });
    try { CacheService.getScriptCache().remove('kpi_trend_12m_v3'); } catch (e2) {}
    rep.message = 'เขียนแล้ว: เพิ่ม ' + newRows.length + ' เคส, ขยายวันเริ่ม ' + extend.length + ' เคส';
    return rep;
  } catch (e) { Logger.log('backfillEpisodes: ' + e.message); return { success: false, message: e.message }; }
  finally { try { lock.releaseLock(); } catch (e3) {} }
}

// ================================================================
// ✅ V22 — แนวโน้มรายบุคคล: รายการเคส (กำลังรักษา) ที่แนวโน้มดีขึ้น + แผนติดตามที่นักกายภาพเลือก
//   ดีขึ้นชัดเจน (strong): VAS ล่าสุด ≤ 2 หรือลดลง ≥ 50% (อย่างน้อย 2 แต้ม)
//   ดีขึ้น (improving):   VAS ลดลง ≥ 2 แต้ม หรือ ≥ 30% หรือ Barthel เพิ่ม ≥ 5   (ต้องมีบันทึกผล ≥ 2 ครั้ง)
//   แผนติดตามเก็บเป็น JSON ที่ Episodes คอลัมน์ 13 (followPlan) พร้อมประวัติการเปลี่ยนแผนย้อนหลัง
// ================================================================
const FOLLOW_PLANS_ = ['continue', 'taper', 'hep', 'recheck'];
const FOLLOW_FREQS_ = ['', 'weekly1', 'biweekly', 'monthly'];

function getImprovingCases() {
  try {
    const board = getDischargeBoard();
    if (!board || !board.success) return board || { success: false, message: 'โหลดข้อมูลไม่สำเร็จ' };
    const esh = ensureEpisodeColumns_();
    const num = function (v) { return (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v); };

    const plans = {};
    if (esh && esh.getLastRow() >= 2) esh.getRange(2, 1, esh.getLastRow() - 1, 13).getValues().forEach(function (r) {
      if (r[0] && r[12]) { try { plans[String(r[0])] = JSON.parse(r[12]); } catch (e) {} }
    });

    const byHn = {};
    const osh = OUTCOMES_SHEET();
    if (osh && osh.getLastRow() >= 2) osh.getRange(2, 1, osh.getLastRow() - 1, 15).getValues().forEach(function (r) {
      const hn = normalizeHN(r[2]); if (!hn || !r[1]) return;
      const dt = r[3] instanceof Date ? dateToStr(r[3]) : String(r[3] || '').substring(0, 10);
      (byHn[hn] = byHn[hn] || {})[String(r[1]).trim()] = { date: dt, vb: num(r[5]), va: num(r[6]), barthel: num(r[7]),
        goal: r[8] === 'yes' || outcomeGoalMetFromPtd_(parsePtData_(r[9] || '')) };
    });

    const today = board.today || dateToStr(new Date());
    const items = [];
    board.active.forEach(function (it) {
      const all = byHn[it.hn] ? Object.keys(byHn[it.hn]).map(function (k) { return byHn[it.hn][k]; }) : [];
      const series = all.filter(function (o) { return !it.startDate || o.date >= it.startDate; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
      if (series.length < 2) return;
      const first = series[0], last = series[series.length - 1], prev = series[series.length - 2];
      const vasFirst = first.vb, vasLast = last.va;
      const drop = (vasFirst !== null && vasLast !== null) ? vasFirst - vasLast : 0;
      const pct = (vasFirst !== null && vasFirst > 0) ? drop / vasFirst : 0;
      const bt = series.filter(function (o) { return o.barthel !== null; });
      const bGain = bt.length >= 2 ? bt[bt.length - 1].barthel - bt[0].barthel : 0;
      let level = '';
      if ((vasLast !== null && vasLast <= 2 && drop >= 1) || (pct >= 0.5 && drop >= 2)) level = 'strong';
      else if (drop >= 2 || (pct >= 0.3 && drop >= 1) || bGain >= 5) level = 'improving';
      if (!level) return;
      items.push({
        episodeId: it.episodeId, hn: it.hn, name: it.name, diagnosis: it.diagnosis, startDate: it.startDate,
        visits: series.length, lastVisit: it.lastVisit, daysSince: it.daysSince, readiness: it.readiness, goalLast: it.goalLast,
        vasFirst: vasFirst, vasLast: vasLast, drop: drop, pct: Math.round(pct * 100),
        barthelFirst: bt.length ? bt[0].barthel : null, barthelLast: bt.length ? bt[bt.length - 1].barthel : null, bGain: bGain,
        goalsMet: series.filter(function (o) { return o.goal; }).length,
        recentUp: prev.va !== null && last.va !== null && last.va > prev.va,
        level: level, plan: plans[it.episodeId] || null,
        series: series.slice(-12).map(function (o) { return { date: o.date, vb: o.vb, va: o.va, barthel: o.barthel, goal: !!o.goal }; })
      });
    });
    const due = function (x) { return !!(x.plan && x.plan.nextDate && x.plan.nextDate <= today); };
    items.sort(function (a, b) {
      return (due(b) - due(a)) || ((a.level === 'strong' ? 0 : 1) - (b.level === 'strong' ? 0 : 1)) || String(b.lastVisit).localeCompare(String(a.lastVisit));
    });
    return {
      success: true, today: today, items: items,
      stats: { active: board.active.length, improving: items.length,
               strong: items.filter(function (x) { return x.level === 'strong'; }).length,
               due: items.filter(due).length,
               noPlan: items.filter(function (x) { return !x.plan; }).length }
    };
  } catch (e) { Logger.log('getImprovingCases: ' + e.message); return { success: false, message: e.message }; }
}

// บันทึกแผนติดตามของเคสที่กำลังรักษา (เก็บแผนล่าสุด + ประวัติ 10 ครั้งล่าสุด)
function saveFollowPlan(d) {
  d = d || {};
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองใหม่' }; }
  try {
    const id = String(d.episodeId || '').trim();
    const plan = String(d.plan || '').trim();
    const freq = String(d.freq || '').trim();
    const nextDate = String(d.nextDate || '').trim();
    if (!id) return { success: false, message: 'ไม่พบรหัส Episode' };
    if (FOLLOW_PLANS_.indexOf(plan) < 0) return { success: false, message: 'กรุณาเลือกแผนติดตาม' };
    if (FOLLOW_FREQS_.indexOf(freq) < 0) return { success: false, message: 'ความถี่นัดไม่ถูกต้อง' };
    if (nextDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return { success: false, message: 'รูปแบบวันที่ไม่ถูกต้อง' };
    if (plan === 'recheck' && !nextDate) return { success: false, message: 'กรุณาระบุวันที่นัดประเมินซ้ำ' };
    if (nextDate && nextDate < dateToStr(new Date())) return { success: false, message: 'วันที่ทบทวนต้องไม่ย้อนหลัง' };
    const sh = ensureEpisodeColumns_();
    if (!sh || sh.getLastRow() < 2) return { success: false, message: 'ไม่พบ Sheet Episodes' };
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 13).getValues();
    let row = 0, cur = null;
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) !== id) continue;
      if ((data[i][6] || 'active') !== 'active') return { success: false, message: 'เคสนี้ปิดแล้ว ไม่สามารถกำหนดแผนติดตามได้' };
      row = i + 2; try { cur = data[i][12] ? JSON.parse(data[i][12]) : null; } catch (e1) { cur = null; }
      break;
    }
    if (!row) return { success: false, message: 'ไม่พบ Episode' };
    const history = (cur && cur.history ? cur.history : []).slice(-9);
    if (cur && cur.plan) history.push({ plan: cur.plan, freq: cur.freq || '', nextDate: cur.nextDate || '', by: cur.by || '', at: cur.at || '' });
    const obj = {
      plan: plan, freq: freq, nextDate: nextDate, note: String(d.note || '').trim().substring(0, 500),
      by: String(d.by || 'กภ.พลอยไพลิน ประทีปพงศ์'), at: Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm"), history: history
    };
    sh.getRange(row, 13).setValue(JSON.stringify(obj));
    return { success: true, plan: obj };
  } catch (e) { Logger.log('saveFollowPlan: ' + e.message); return { success: false, message: e.message }; }
  finally { try { lock.releaseLock(); } catch (e2) {} }
}

// แจ้งเตือนหลังจองนัด: ผู้ป่วยรายนี้ Discharge แล้วหรือไม่ (เคสใหม่จะเปิดอัตโนมัติเมื่อบันทึกผลครั้งแรก)
function getEpisodeNoticeForHN(hn) {
  try {
    hn = normalizeHN(hn);
    const found = findEpisodeRows_(hn);
    if (!found.list.length) return { hasActive: false, lastDischarged: null };
    if (found.list.some(e => e.v[6] === 'active')) return { hasActive: true, lastDischarged: null };
    const last = found.list.filter(e => e.v[3] instanceof Date).sort((a, b) => b.v[3] - a.v[3])[0];
    return { hasActive: false, lastDischarged: last ? { endDate: dateToStr(last.v[3]), status: last.v[6], statusLabel: EP_STATUS_LABELS[last.v[6]] || last.v[6] } : null };
  } catch (e) { return { hasActive: false, lastDischarged: null }; }
}

// ฟิลด์เพิ่มของ Episode สำหรับ getEpisodesForHN / getRecentEpisodes
function epExtra_(row) {
  let summary = null;
  if (row[9]) { try { summary = JSON.parse(row[9]); } catch (e) {} }
  const et = String(row[13] || '').trim();
  return { statusLabel: EP_STATUS_LABELS[row[6]] || row[6] || '', dischargedBy: row[8] || '', summary: summary, homeProgram: row[10] || '', followUp: row[11] || '',
           episodeType: et, episodeTypeLabel: (et && RTN.TYPE_LABELS[et]) || '', parentEpisodeId: String(row[14] || ''), returnReason: row[15] || '', reopenCount: (function () { try { const h = JSON.parse(row[17] || '[]'); return Array.isArray(h) ? h.length : 0; } catch (e) { return 0; } })() };
}

// ───────────────────────────────────────────────────────────────────
// รายงาน: ผลรายตำแหน่ง/ข้าง ของเดือน (ต่อยอดเป็น KPI ได้)
// ───────────────────────────────────────────────────────────────────
function getSiteKPI(yearMonth) {
  const p = String(yearMonth || '').split('-').map(Number);
  const start = p[0] + '-' + pad2_(p[1]) + '-01', end = p[0] + '-' + pad2_(p[1]) + '-' + pad2_(new Date(p[0], p[1], 0).getDate());
  const g = {};
  readAllSites_().forEach(function (s) {
    if (s.date < start || s.date > end || s.vasBefore === '' || s.vasAfter === '') return;
    const key = (s.region || '-') + '|' + (s.side || '-');
    const o = g[key] || (g[key] = { region: s.region, regionLabel: s.regionLabel || 'ไม่ระบุบริเวณ', side: s.side, sideLabel: s.sideLabel, n: 0, sb: 0, sa: 0, improved: 0 });
    o.n++; o.sb += Number(s.vasBefore); o.sa += Number(s.vasAfter);
    if (Number(s.vasBefore) - Number(s.vasAfter) >= 2) o.improved++;
  });
  return Object.keys(g).map(function (k) {
    const o = g[k];
    return { region: o.region, regionLabel: o.regionLabel, side: o.side, sideLabel: o.sideLabel, n: o.n,
             avgBefore: +(o.sb / o.n).toFixed(1), avgAfter: +(o.sa / o.n).toFixed(1), avgReduction: +((o.sb - o.sa) / o.n).toFixed(1),
             improvedPct: +(o.improved / o.n * 100).toFixed(0) };
  }).sort((a, b) => b.n - a.n);
}

// ───────────────────────────────────────────────────────────────────
// backfill ข้อมูลเก่า (ไม่บังคับ): สร้างแถว OutcomeSites จาก Outcomes + Bookings
//   backfillOutcomeSites(true)  → แค่รายงานว่าจะเพิ่มกี่แถว (ปลอดภัย)
//   backfillOutcomeSites(false) → เขียนจริง
// ───────────────────────────────────────────────────────────────────
function backfillOutcomeSites(dryRun) {
  dryRun = (dryRun !== false);
  const osh = OUTCOMES_SHEET();
  if (!osh || osh.getLastRow() < 2) return { dryRun: dryRun, bookings: 0, rows: 0 };
  const have = {};
  readAllSites_().forEach(s => { have[s.bookingId] = true; });
  const oRows = osh.getRange(2, 1, osh.getLastRow() - 1, 4).getValues();
  const bsh = BOOKINGS_SHEET();
  const bData = bsh.getLastRow() >= 2 ? bsh.getRange(2, 1, bsh.getLastRow() - 1, 15).getValues() : [];
  const dxMap = {};
  bData.forEach(function (r) {
    const bid = String(r[1] || '').trim(); if (!bid) return;
    let a = null, b = null;
    if (r[13]) { try { a = JSON.parse(r[13]); } catch (e) {} }
    if (r[14]) { try { b = JSON.parse(r[14]); } catch (e) {} }
    dxMap[bid] = { a: a, b: b };
  });
  const out = [];
  const all = osh.getRange(2, 1, osh.getLastRow() - 1, 15).getValues();
  all.forEach(function (r) {
    const bid = String(r[1] || '').trim();
    if (!bid || have[bid]) return;
    const ptd = parsePtData_(r[9] || '');
    const dx = dxMap[bid] || {};
    const o = { vas_before: r[5], vas_after: r[6], vas2_before: r[12], vas2_after: r[13], diagnosis: dx.a, diagnosis2: dx.b,
                vas1_type: ptd.vas1_type || ptd.vas_type || 'pain', vas2_type: ptd.vas2_type || 'pain' };
    const dt = r[3] instanceof Date ? dateToStr(r[3]) : String(r[3] || '').substring(0, 10);
    sitesFromOutcomeObj_(o).forEach(function (s, i) {
      out.push([Utilities.getUuid(), bid, normalizeHN(r[2]), '', dt, r[4] || '', i + 1, s.region, s.side, s.icd10, s.dxLabel,
                s.diagnosis ? JSON.stringify(s.diagnosis) : '', s.vasType, s.vasBefore, s.vasAfter, '', new Date()]);
    });
  });
  if (!dryRun && out.length) {
    const sh = OUTCOME_SITES_SHEET();
    sh.getRange(sh.getLastRow() + 1, 1, out.length, SITE_HEADERS.length).setValues(out);
  }
  return { dryRun: dryRun, rows: out.length, bookings: new Set(out.map(r => r[1])).size };
}

// สร้างชีต/คอลัมน์ที่ V18 ต้องใช้ (รันครั้งเดียวจาก Editor ได้ — ถ้าไม่รัน ระบบจะสร้างให้เองตอนใช้งานครั้งแรก)
function setupV18() {
  OUTCOME_SITES_SHEET();
  BODY_CHARTS_SHEET();
  ensureEpisodeColumns_();
  return 'พร้อมใช้งาน: OutcomeSites + BodyCharts + Episodes (คอลัมน์ I–L)';
}

// ═══════════════════════════════════════════════════════════════════
// ✅ V19 — แผนภาพร่างกาย (วาดบริเวณที่มีปัญหา) ผูกกับบันทึกผลแต่ละนัด
// ───────────────────────────────────────────────────────────────────
//  • ชีตใหม่ BodyCharts (สร้างอัตโนมัติ) : 1 แถว = 1 แผนภาพต่อ 1 นัด
//  • เก็บเป็นเวกเตอร์ JSON {v:1, strokes:[{k:'pen'|'dot', t:'pain'|'numb'|'swell'|'other', w, p:[[x,y],...]}]}
//    พิกัด 0–1000 (ไม่ผูกกับขนาดหน้าจอ) → ขนาดเล็ก (โดยทั่วไป 1–6 KB) ขยาย/ย่อ/พิมพ์ได้คมทุกขนาด
//  • บันทึกไปพร้อมกับ saveOutcome / saveOutcome_dual (ส่ง d.bodyChart มา) — ถ้าไม่ส่ง = ไม่เปลี่ยนแปลง
//  • ถ้าบันทึกแผนภาพพลาด การบันทึกผลหลักยังสำเร็จ (คืน v18.bodyChartError)
// ═══════════════════════════════════════════════════════════════════
const BODYCHART_HEADERS = ['chartId','bookingId','hn','episodeId','date','json','note','createdAt','updatedAt'];
const BC_TYPES = ['pain','numb','paralysis','absent','swell','other'];   // ✅ V25: +paralysis (อัมพาต/ใช้งานไม่ได้) +absent (ไม่มีอวัยวะส่วนนั้น)
const BC_REGION_RE = /^[RL]_(arm|forearm|hand|thigh|shank|foot)$/;      // ✅ V25: ระบายทั้งส่วน (ใช้ร่วมกันทั้งด้านหน้า/หลัง)
function bcHasContent_(chart) { return !!(chart && ((chart.strokes && chart.strokes.length) || (chart.regions && chart.regions.length))); }
const BC_MAX_STROKES = 300, BC_MAX_POINTS = 800, BC_MAX_JSON = 45000;   // เซลล์ Sheets จุได้ 50,000 ตัวอักษร

function BODY_CHARTS_SHEET() { return ensureSheetWithHeaders_('BodyCharts', BODYCHART_HEADERS); }

// ตรวจและทำความสะอาดข้อมูลจากหน้าเว็บ (ไม่เชื่อข้อมูลฝั่งผู้ใช้)
function sanitizeBodyChart_(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.strokes)) return { strokes: [], note: '' };
  const clamp = v => Math.max(0, Math.min(1000, Math.round(Number(v) * 10) / 10));
  const strokes = [];
  raw.strokes.slice(0, BC_MAX_STROKES).forEach(function (s) {
    if (!s || !Array.isArray(s.p) || !s.p.length) return;
    const k = s.k === 'dot' ? 'dot' : 'pen';
    const t = BC_TYPES.indexOf(s.t) >= 0 ? s.t : 'other';
    const w = Math.max(1, Math.min(12, Math.round(Number(s.w) || 3)));
    const pts = [];
    s.p.slice(0, k === 'dot' ? 1 : BC_MAX_POINTS).forEach(function (pt) {
      if (!Array.isArray(pt)) return;
      const x = Number(pt[0]), y = Number(pt[1]);
      if (isNaN(x) || isNaN(y)) return;
      pts.push([clamp(x), clamp(y)]);
    });
    if (pts.length) strokes.push({ k: k, t: t, w: w, p: pts });
  });
  // ✅ V25: regions = ส่วนของแขน/ขาที่ระบายทั้งส่วน [{r:'R_forearm', t:'paralysis'|'absent'|...}] (1 ส่วนมีได้ 1 ชนิด)
  const seen = {}, regions = [];
  (Array.isArray(raw.regions) ? raw.regions : []).slice(0, 24).forEach(function (g) {
    if (!g || !BC_REGION_RE.test(String(g.r)) || BC_TYPES.indexOf(g.t) < 0 || seen[g.r]) return;
    seen[g.r] = 1; regions.push({ r: String(g.r), t: g.t });
  });
  return { strokes: strokes, regions: regions, note: String(raw.note || '').substring(0, 300) };
}

function readBodyChartRow_(r) {
  let chart = { strokes: [] };
  try { chart = JSON.parse(r[5] || '{}'); } catch (e) {}
  if (!chart || !Array.isArray(chart.strokes)) chart = { strokes: [] };
  if (!Array.isArray(chart.regions)) chart.regions = [];
  chart.v = 1; chart.note = chart.note || r[6] || '';
  return { chartId: r[0], bookingId: String(r[1] || ''), hn: normalizeHN(r[2]), episodeId: r[3] || '',
           date: r[4] instanceof Date ? dateToStr(r[4]) : String(r[4] || ''), chart: chart };
}
function readAllBodyCharts_() {
  const sh = getSheet('BodyCharts');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, BODYCHART_HEADERS.length).getValues().filter(r => r[0]).map(readBodyChartRow_);
}

// บันทึก/แทนที่/ลบ แผนภาพของนัด (เรียกจาก afterOutcomeSaved_)
function saveBodyChartForBooking_(d, episodeId) {
  const clean = sanitizeBodyChart_(d.bodyChart);
  const bid = String(d.bookingId).trim();
  const empty = !clean.strokes.length && !clean.regions.length && !clean.note;
  const json = JSON.stringify({ v: 1, strokes: clean.strokes, regions: clean.regions, note: clean.note });
  if (json.length > BC_MAX_JSON) throw new Error('แผนภาพมีรายละเอียดมากเกินไป กรุณาลดจำนวนเส้นหรือลบบางส่วน');
  const sh = BODY_CHARTS_SHEET();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const last = sh.getLastRow();
    let row = 0;
    if (last >= 2) {
      const ids = sh.getRange(2, 2, last - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) if (String(ids[i][0] || '').trim() === bid) { row = i + 2; break; }
    }
    if (empty) { if (row) sh.deleteRow(row); return 'deleted'; }
    const now = new Date();
    const dstr = dateToStr(parseFlexDate(d.date) || now);
    if (row) {
      sh.getRange(row, 3, 1, 7).setValues([[ normalizeHN(d.hn), episodeId || '', dstr, json, clean.note, sh.getRange(row, 8, 1, 1).getValues()[0][0] || now, now ]]);
      return 'updated';
    }
    sh.getRange(last + 1, 1, 1, BODYCHART_HEADERS.length).setValues([[ Utilities.getUuid(), bid, normalizeHN(d.hn), episodeId || '', dstr, json, clean.note, now, now ]]);
    return 'created';
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

function getBodyChart(bookingId) {
  const bid = String(bookingId || '').trim();
  const hit = readAllBodyCharts_().filter(c => c.bookingId === bid)[0];
  return hit || null;
}
// แผนภาพล่าสุดของ HN (ไม่รวมนัดที่กำลังแก้) — ใช้ "แสดงครั้งก่อน" / "ใช้เป็นจุดตั้งต้น"
function getPreviousBodyChart(hn, excludeBookingId) {
  hn = normalizeHN(hn);
  const ex = String(excludeBookingId || '').trim();
  const list = readAllBodyCharts_().filter(c => c.hn === hn && c.bookingId !== ex && bcHasContent_(c.chart))
                                   .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return list[0] || null;
}
function getBodyChartsByHN(hn, limit) {
  hn = normalizeHN(hn);
  return readAllBodyCharts_().filter(c => c.hn === hn).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit || 12);
}

// หน้ารายวันโหลดผลหลายนัดในครั้งเดียว → แนบรายการตำแหน่ง (sites) และตัวบอกว่ามีแผนภาพ
function getBatchOutcomes(bookingIds) {
  const res = getBatchOutcomesCore_(bookingIds);
  try {
    const grouped = {};
    readAllSites_().forEach(function (s) { if (res[s.bookingId]) (grouped[s.bookingId] = grouped[s.bookingId] || []).push(s); });
    Object.keys(grouped).forEach(function (b) { res[b].sites = grouped[b].sort((x, y) => x.seq - y.seq); });
    readAllBodyCharts_().forEach(function (ch) { if (res[ch.bookingId] && bcHasContent_(ch.chart)) res[ch.bookingId].hasBodyChart = true; });
  } catch (e) { Logger.log('getBatchOutcomes V19: ' + e.message); }
  return res;
}


// ═══════════════════════════════════════════════════════════════════
// ✅ V20 — Discharge Board (แท็บ Discharge): อ่านชีตครั้งเดียว ประเมินความพร้อมรายเคส
// ═══════════════════════════════════════════════════════════════════
function getDischargeBoard() {
  try {
    const esh = ensureEpisodeColumns_();
    const empty = { success: true, active: [], closed: [], stats: { active: 0, ready: 0, stale: 0, closedMonth: 0 } };
    if (!esh || esh.getLastRow() < 2) return empty;
    const eps = esh.getRange(2, 1, esh.getLastRow() - 1, 12).getValues();

    const names = {};
    const psh = PATIENTS_SHEET();
    if (psh && psh.getLastRow() >= 2) psh.getRange(2, 1, psh.getLastRow() - 1, 3).getValues().forEach(function (r) { if (r[1]) names[normalizeHN(r[1])] = String(r[2] || '').trim(); });
    const bsh = BOOKINGS_SHEET();
    if (bsh && bsh.getLastRow() >= 2) bsh.getRange(2, 7, bsh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      const hn = normalizeHN(r[0]); if (hn && hn !== 'BLOCK' && !names[hn] && r[1]) names[hn] = String(r[1]).trim();
    });

    const num = function (v) { return (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v); };
    const byHn = {};
    const osh = OUTCOMES_SHEET();
    if (osh && osh.getLastRow() >= 2) osh.getRange(2, 1, osh.getLastRow() - 1, 15).getValues().forEach(function (r) {
      const hn = normalizeHN(r[2]); if (!hn || !r[1]) return;
      const dt = r[3] instanceof Date ? dateToStr(r[3]) : String(r[3] || '').substring(0, 10);
      (byHn[hn] = byHn[hn] || []).push({ bid: String(r[1]).trim(), date: dt, vb: num(r[5]), va: num(r[6]), va2: num(r[13]), barthel: num(r[7]),
        goal: r[8] === 'yes' || outcomeGoalMetFromPtd_(parsePtData_(r[9] || '')) });
    });

    const today = dateToStr(new Date());
    const ym = today.substring(0, 7);
    const dayDiff = function (a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); };
    const active = [], closed = [];

    eps.forEach(function (r) {
      if (!r[0]) return;
      const hn = normalizeHN(r[1]);
      const startStr = r[2] instanceof Date ? dateToStr(r[2]) : '';
      const endStr = r[3] instanceof Date ? dateToStr(r[3]) : '';
      const status = r[6] || 'active';
      const list = (byHn[hn] || []).filter(function (o) { return (!startStr || o.date >= startStr) && (!endStr || o.date <= endStr); })
                                   .sort(function (a, b) { return a.date.localeCompare(b.date); });
      const seen = {}; list.forEach(function (o) { seen[o.bid] = true; });
      const visits = Object.keys(seen).length;
      const last = list.length ? list[list.length - 1] : null;
      const first = list.length ? list[0] : null;
      const lastVisit = last ? last.date : '';
      const daysSince = dayDiff(lastVisit || startStr || today, today);
      let dx = {}; try { dx = JSON.parse(r[4] || '{}'); } catch (e) {}
      const bt = list.filter(function (o) { return o.barthel !== null; });
      const item = Object.assign({
        episodeId: String(r[0]), hn: hn, name: names[hn] || hn || 'ไม่ระบุ', status: status, startDate: startStr, endDate: endStr,
        visits: visits, lastVisit: lastVisit, daysSince: daysSince, diagnosis: dx,
        vasFirst: first ? first.vb : null, vasLast: last ? last.va : null,
        barthelFirst: bt.length ? bt[0].barthel : null, barthelLast: bt.length ? bt[bt.length - 1].barthel : null,
        goalLast: last ? !!last.goal : false
      }, epExtra_(r));

      if (status === 'active') {
        const low = item.vasLast !== null && item.vasLast <= 2 && (!last || last.va2 === null || last.va2 <= 2);
        const reasons = [];
        let level = 'ongoing';
        if (item.goalLast && low && visits >= 2) { level = 'ready'; reasons.push('บรรลุเป้าหมายครั้งล่าสุด', 'VAS หลังรักษา ≤ 2'); }
        else if (daysSince >= 30 && visits > 0) { level = 'stale'; reasons.push('ไม่มารับบริการเกิน 30 วัน'); }
        else if (daysSince >= 30) { level = 'stale'; reasons.push('เปิดเคสแล้วไม่มีบันทึกผลเกิน 30 วัน'); }
        item.readiness = { level: level, reasons: reasons };
        active.push(item);
      } else {
        closed.push(item);
      }
    });

    const rank = { ready: 0, stale: 1, ongoing: 2 };
    active.sort(function (a, b) { return (rank[a.readiness.level] - rank[b.readiness.level]) || String(b.lastVisit).localeCompare(String(a.lastVisit)); });
    closed.sort(function (a, b) { return String(b.endDate).localeCompare(String(a.endDate)); });
    return {
      success: true, active: active, closed: closed.slice(0, 300), today: today,
      stats: {
        active: active.length,
        ready: active.filter(function (a) { return a.readiness.level === 'ready'; }).length,
        stale: active.filter(function (a) { return a.readiness.level === 'stale'; }).length,
        closedMonth: closed.filter(function (c) { return String(c.endDate).substring(0, 7) === ym; }).length
      }
    };
  } catch (e) { Logger.log('getDischargeBoard: ' + e.message); return { success: false, message: e.message }; }
}

// ============================================================
// ✅ V23 — ศูนย์จัดการระบบ (Admin Console): ภาพรวมหลายวัน, ปิด/เปิดหลายวัน,
//    จัดการคิวหลายวันพร้อมกัน, ตารางประจำสัปดาห์, รายการนัดแบบช่วงวัน
// ============================================================
const ADM_MAX_DAYS_ = 70;
const ADM_MAX_ROWS_ = 2000;

function admOk_(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function admAdd_(s, n) {
  const p = s.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10);
}
function admDow_(s) {
  const p = s.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
}
function admDay_(v) {
  if (v instanceof Date) return dateToStr(v);
  const d = parseFlexDate(v);
  return d ? dateToStr(d) : '';
}
function admRange_(start, end) {
  if (!admOk_(start) || !admOk_(end) || end < start) return null;
  const out = [];
  for (let d = start; d <= end && out.length <= ADM_MAX_DAYS_; d = admAdd_(d, 1)) out.push(d);
  return out.length > ADM_MAX_DAYS_ ? null : out;
}
function admDates_(d) {
  if (d && d.dates && d.dates.length) {
    const seen = {}, out = [];
    d.dates.forEach(x => { if (admOk_(x) && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out.length <= ADM_MAX_DAYS_ ? out.sort() : null;
  }
  return d ? admRange_(d.start, d.end) : null;
}
function admTimeKey_(v) { const t = normalizeTime(v instanceof Date ? v : (v || '').toString()); return /^\d{2}:\d{2}$/.test(t) ? t : ''; }
function admLocked_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองอีกครั้ง' }; }
  try { return fn(); }
  catch (e) { Logger.log('adm error: ' + e.message); return { success: false, message: 'เกิดข้อผิดพลาด: ' + e.message }; }
  finally { lock.releaseLock(); }
}
function admTouch_() { incrementVersion(); clearKPICache(); clearPublicAvailabilityCache(); }

// โหลดทั้งช่วงวันในครั้งเดียว (ใช้ทั้งปฏิทินภาพรวมและตารางสัปดาห์)
function getAdminRange(start, end) {
  try {
    const days = admRange_(start, end);
    if (!days) return { success: false, message: 'ช่วงวันที่ไม่ถูกต้อง (เลือกได้ไม่เกิน ' + ADM_MAX_DAYS_ + ' วัน)' };
    const ths = getAllMasseusesConfig();
    const set = {}; days.forEach(x => { set[x] = 1; });

    const tpl = {};                                   // tid_dow -> [{t,type}]
    SLOTS_SHEET().getDataRange().getValues().slice(1).forEach(r => {
      if (r[0] === '' || !r[2] || !r[1]) return;
      const t = admTimeKey_(r[1]);
      if (!t || t === '12:00' || t === '00:00') return;
      if ((r[4] || 'Open') === 'Closed') return;
      const k = r[2] + '_' + r[0];
      (tpl[k] = tpl[k] || []).push({ t: t, type: r[3] || 'normal' });
    });

    const ext = {};                                   // date_tid -> [t]
    const exSheet = EXTRA_SLOTS_SHEET();
    if (exSheet) exSheet.getDataRange().getValues().slice(1).forEach(r => {
      if (!r[0] || !r[2] || !r[1]) return;
      const ds = admDay_(r[0]); if (!set[ds]) return;
      const t = admTimeKey_(r[1]); if (!t || t === '12:00' || t === '00:00') return;
      (ext[ds + '_' + r[2]] = ext[ds + '_' + r[2]] || []).push(t);
    });

    const bk = {};                                    // date_tid -> {time: booking}
    BOOKINGS_SHEET().getDataRange().getValues().slice(1).forEach(r => {
      const ds = admDay_(r[2]); if (!set[ds]) return;
      const t = admTimeKey_(r[3]); if (!t) return;
      const hn = normalizeHN(r[6]);
      const k = ds + '_' + r[4];
      (bk[k] = bk[k] || {})[t] = {
        id: r[1], hn: hn, n: hn === 'BLOCK' ? '' : (r[7] || ''), blk: hn === 'BLOCK',
        a: r[12] || 'OPD', st: r[11] || ''
      };
    });

    const hol = {};
    HOLIDAYS_SHEET().getDataRange().getValues().slice(1).forEach(r => {
      const ds = admDay_(r[0]); if (set[ds] && !hol[ds]) hol[ds] = (r[1] || 'วันหยุด').toString();
    });

    const stats = { booked: 0, free: 0, blocked: 0, closedDays: 0 };
    const outDays = days.map(ds => {
      const dow = admDow_(ds), weekend = dow === 0 || dow === 6, holiday = hol[ds] || '';
      const day = { date: ds, dow: dow, weekend: weekend, holiday: holiday, th: [] };
      if (holiday) stats.closedDays++;
      ths.forEach(t => {
        const slots = [], seen = {};
        if (!weekend) {
          (tpl[t.id + '_' + dow] || []).forEach(s => { if (!seen[s.t]) { seen[s.t] = 1; slots.push({ t: s.t, x: 0 }); } });
          (ext[ds + '_' + t.id] || []).forEach(x => { if (!seen[x]) { seen[x] = 1; slots.push({ t: x, x: 1 }); } });
        }
        const bm = bk[ds + '_' + t.id] || {};
        Object.keys(bm).forEach(x => { if (!seen[x]) { seen[x] = 1; slots.push({ t: x, x: 0, orph: 1 }); } });
        slots.sort((a, b) => a.t.localeCompare(b.t));
        slots.forEach(s => {
          const b = bm[s.t];
          if (b) {
            if (b.blk) { s.s = 'x'; s.id = b.id; if (!holiday) stats.blocked++; }
            else { s.s = 'b'; s.id = b.id; s.n = b.n; s.h = b.hn; s.a = b.a; s.st = b.st; stats.booked++; }
          } else { s.s = 'o'; if (!holiday && !weekend) stats.free++; }
        });
        day.th.push({ id: t.id, slots: slots });
      });
      return day;
    });
    return { success: true, today: dateToStr(new Date()), start: start, end: end, therapists: ths, days: outDays, stats: stats };
  } catch (e) {
    Logger.log('getAdminRange ERROR: ' + e.message);
    return { success: false, message: 'โหลดข้อมูลไม่สำเร็จ: ' + e.message };
  }
}

// ปิด/เปิดวันทำการหลายวัน  d = {start,end | dates[], closed, reason, skipWeekends}
function adminSetClosed(d) {
  return admLocked_(function () {
    const days = admDates_(d);
    if (!days || !days.length) return { success: false, message: 'ช่วงวันที่ไม่ถูกต้อง' };
    const sheet = HOLIDAYS_SHEET();
    const data = sheet.getDataRange().getValues();
    const have = {};
    for (let i = 1; i < data.length; i++) { const ds = admDay_(data[i][0]); if (ds) have[ds] = (have[ds] || []).concat(i + 1); }
    let changed = 0, skipped = 0;
    if (d.closed) {
      const reason = (d.reason || '').toString().trim();
      if (!reason) return { success: false, message: 'กรุณาระบุสาเหตุที่ปิด' };
      const rows = [];
      days.forEach(ds => {
        const dow = admDow_(ds);
        if ((d.skipWeekends !== false) && (dow === 0 || dow === 6)) { skipped++; return; }
        if (have[ds]) { skipped++; return; }
        rows.push([new Date(ds), reason.substring(0, 120)]);
      });
      if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
      changed = rows.length;
    } else {
      const del = [];
      days.forEach(ds => { if (have[ds]) del.push.apply(del, have[ds]); });
      del.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
      changed = del.length;
    }
    // นัดหมายจริงที่ยังค้างอยู่ในวันที่ปิด (ไม่ลบให้อัตโนมัติ เพื่อให้เจ้าหน้าที่เลื่อนนัดเอง)
    let affected = 0;
    if (d.closed) {
      const set = {}; days.forEach(x => { set[x] = 1; });
      BOOKINGS_SHEET().getDataRange().getValues().slice(1).forEach(r => {
        const ds = admDay_(r[2]);
        if (set[ds] && normalizeHN(r[6]) !== 'BLOCK' && admDow_(ds) !== 0 && admDow_(ds) !== 6) affected++;
      });
    }
    if (changed) admTouch_();
    return { success: true, changed: changed, skipped: skipped, affected: affected };
  });
}

// จัดการคิวหลายวัน  d = {dates[]|start,end, tids[], times[], action: block|unblock|addExtra|removeExtra}
function adminBulkSlots(d) {
  return admLocked_(function () {
    const days = admDates_(d);
    if (!days || !days.length) return { success: false, message: 'ช่วงวันที่ไม่ถูกต้อง' };
    const act = d.action;
    if (['block', 'unblock', 'addExtra', 'removeExtra'].indexOf(act) < 0) return { success: false, message: 'คำสั่งไม่ถูกต้อง' };
    const allT = getAllMasseusesConfig().map(t => t.id);
    const tids = (d.tids && d.tids.length ? d.tids : allT).filter(t => allT.indexOf(t) >= 0);
    if (!tids.length) return { success: false, message: 'ไม่พบนักกายภาพบำบัดที่เลือก' };
    const times = (d.times || []).map(admTimeKey_).filter(Boolean);
    if ((act === 'addExtra') && !times.length) return { success: false, message: 'กรุณาระบุเวลาของคิวเสริม' };

    const rng = getAdminRange(days[0], days[days.length - 1]);
    if (!rng.success) return rng;
    const want = {}; days.forEach(x => { want[x] = 1; });
    let n = 0, skipped = 0;

    if (act === 'block' || act === 'addExtra') {
      const rows = [], exRows = [];
      rng.days.forEach(day => {
        if (!want[day.date] || day.weekend || day.holiday) { if (want[day.date]) skipped++; return; }
        day.th.forEach(th => {
          if (tids.indexOf(th.id) < 0) return;
          if (act === 'block') {
            th.slots.forEach(s => {
              if (s.s !== 'o') return;
              if (times.length && times.indexOf(s.t) < 0) return;
              rows.push([new Date(), Utilities.getUuid(), new Date(day.date), "'" + s.t, th.id, '', 'BLOCK', 'BLOCKED', '', '', '', '', '', '', '']);
            });
          } else {
            times.forEach(t => {
              if (th.slots.some(s => s.t === t)) { skipped++; return; }
              exRows.push([day.date, "'" + t, th.id]);
            });
          }
        });
      });
      if (rows.length + exRows.length > ADM_MAX_ROWS_) return { success: false, message: 'รายการมากเกินไป กรุณาแบ่งทำทีละช่วง' };
      if (rows.length) BOOKINGS_SHEET().getRange(BOOKINGS_SHEET().getLastRow() + 1, 1, rows.length, 15).setValues(rows);
      if (exRows.length) { const ex = EXTRA_SLOTS_SHEET(); ex.getRange(ex.getLastRow() + 1, 1, exRows.length, 3).setValues(exRows); }
      n = rows.length + exRows.length;
    } else if (act === 'unblock') {
      const sh = BOOKINGS_SHEET(), data = sh.getDataRange().getValues(), del = [];
      for (let i = 1; i < data.length; i++) {
        if (normalizeHN(data[i][6]) !== 'BLOCK') continue;
        const ds = admDay_(data[i][2]); if (!want[ds]) continue;
        if (tids.indexOf(data[i][4]) < 0) continue;
        if (times.length && times.indexOf(admTimeKey_(data[i][3])) < 0) continue;
        del.push(i + 1);
      }
      del.sort((a, b) => b - a).forEach(r => sh.deleteRow(r)); n = del.length;
    } else {
      const sh = EXTRA_SLOTS_SHEET(); if (!sh) return { success: true, changed: 0, skipped: 0 };
      const data = sh.getDataRange().getValues(), del = [];
      for (let i = 1; i < data.length; i++) {
        const ds = admDay_(data[i][0]); if (!want[ds]) continue;
        if (tids.indexOf(data[i][2]) < 0) continue;
        if (times.length && times.indexOf(admTimeKey_(data[i][1])) < 0) continue;
        del.push(i + 1);
      }
      del.sort((a, b) => b - a).forEach(r => sh.deleteRow(r)); n = del.length;
    }
    if (n) admTouch_();
    return { success: true, changed: n, skipped: skipped };
  });
}

// รายการนัดหมายแบบช่วงวัน (ไม่รวมคิวที่ปิด)
function adminListBookings(start, end) {
  try {
    const days = admRange_(start, end);
    if (!days) return { success: false, message: 'ช่วงวันที่ไม่ถูกต้อง (เลือกได้ไม่เกิน ' + ADM_MAX_DAYS_ + ' วัน)' };
    const set = {}; days.forEach(x => { set[x] = 1; });
    const tMap = buildTherapistMap(), items = [], hol = {};
    HOLIDAYS_SHEET().getDataRange().getValues().slice(1).forEach(r => { const h = admDay_(r[0]); if (set[h] && !hol[h]) hol[h] = (r[1] || 'วันหยุด').toString(); });
    BOOKINGS_SHEET().getDataRange().getValues().slice(1).forEach(r => {
      const ds = admDay_(r[2]); if (!set[ds]) return;
      const hn = normalizeHN(r[6]); if (hn === 'BLOCK') return;
      items.push({ id: r[1], date: ds, time: admTimeKey_(r[3]), tid: r[4], therapist: tMap[r[4]] || '', hn: hn,
        name: (r[7] || '').toString(), phone: (r[8] || '').toString().replace(/^'/, ''), rights: r[9] || '',
        treat: r[10] || '', st: r[11] || '', appt: r[12] || 'OPD', closed: hol[ds] || '' });
    });
    items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return { success: true, today: dateToStr(new Date()), items: items };
  } catch (e) { return { success: false, message: 'โหลดไม่สำเร็จ: ' + e.message }; }
}

// ตารางเวลาประจำสัปดาห์ (แม่แบบ)
function getWeeklyTemplate() {
  try {
    const ths = getAllMasseusesConfig(), tpl = {};
    ths.forEach(t => { tpl[t.id] = { 1: [], 2: [], 3: [], 4: [], 5: [] }; });
    SLOTS_SHEET().getDataRange().getValues().slice(1).forEach(r => {
      if (r[0] === '' || !r[2] || !r[1] || !tpl[r[2]] || !tpl[r[2]][r[0]]) return;
      const t = admTimeKey_(r[1]);
      if (!t || t === '12:00' || t === '00:00' || (r[4] || 'Open') === 'Closed') return;
      if (tpl[r[2]][r[0]].indexOf(t) < 0) tpl[r[2]][r[0]].push(t);
    });
    Object.keys(tpl).forEach(k => Object.keys(tpl[k]).forEach(dw => tpl[k][dw].sort()));
    return { success: true, therapists: ths, template: tpl };
  } catch (e) { return { success: false, message: 'โหลดไม่สำเร็จ: ' + e.message }; }
}

// d = {tid, days: {1:[times],2:[...],...}}  — แทนที่เฉพาะวันที่ส่งมา
function saveWeeklyTemplate(d) {
  return admLocked_(function () {
    const tid = d && d.tid;
    if (!tid || getAllMasseusesConfig().map(t => t.id).indexOf(tid) < 0) return { success: false, message: 'ไม่พบนักกายภาพบำบัด' };
    const dd = d.days || {}, keys = Object.keys(dd).map(Number).filter(x => x >= 1 && x <= 5);
    if (!keys.length) return { success: false, message: 'ไม่มีข้อมูลที่จะบันทึก' };
    for (let i = 0; i < keys.length; i++) {
      const arr = dd[keys[i]];
      if (!Array.isArray(arr) || arr.length > 40) return { success: false, message: 'ข้อมูลเวลาไม่ถูกต้อง' };
      for (let j = 0; j < arr.length; j++) if (!/^\d{2}:\d{2}$/.test(arr[j]) || arr[j] === '12:00') return { success: false, message: 'เวลา "' + arr[j] + '" ไม่ถูกต้อง' };
    }
    const sh = SLOTS_SHEET(), data = sh.getDataRange().getValues();
    const oldType = {}, oldSet = {}, del = [];
    const typeCount = {};
    for (let i = 1; i < data.length; i++) {
      if (data[i][2] !== tid) continue;
      const t = admTimeKey_(data[i][1]);
      if (data[i][3]) typeCount[data[i][3]] = (typeCount[data[i][3]] || 0) + 1;
      if (keys.indexOf(Number(data[i][0])) < 0 || t === '12:00' || t === '00:00') continue;
      oldType[data[i][0] + '_' + t] = data[i][3] || 'normal';
      (oldSet[data[i][0]] = oldSet[data[i][0]] || {})[t] = 1;
      del.push(i + 1);
    }
    let defType = 'normal', best = 0;
    Object.keys(typeCount).forEach(k => { if (typeCount[k] > best) { best = typeCount[k]; defType = k; } });

    const added = [], removed = [];
    const rows = [];
    keys.forEach(dw => {
      const nw = {}; dd[dw].forEach(t => { nw[t] = 1; });
      Object.keys(nw).sort().forEach(t => {
        rows.push([dw, "'" + t, tid, oldType[dw + '_' + t] || defType, 'Open']);
        if (!(oldSet[dw] && oldSet[dw][t])) added.push(dw + ' ' + t);
      });
      Object.keys(oldSet[dw] || {}).forEach(t => { if (!nw[t]) removed.push({ dow: dw, t: t }); });
    });

    // นัดหมายล่วงหน้าที่อยู่บนเวลาที่ถูกเอาออก (ไม่ลบ แต่แจ้งเตือน)
    let orphaned = 0;
    if (removed.length) {
      const today = dateToStr(new Date());
      BOOKINGS_SHEET().getDataRange().getValues().slice(1).forEach(r => {
        if (r[4] !== tid || normalizeHN(r[6]) === 'BLOCK') return;
        const ds = admDay_(r[2]); if (!ds || ds < today) return;
        const dw = admDow_(ds), t = admTimeKey_(r[3]);
        if (removed.some(x => x.dow === dw && x.t === t)) orphaned++;
      });
    }
    del.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
    admTouch_();
    return { success: true, added: added.length, removed: removed.length, orphaned: orphaned };
  });
}

// รายการวันปิดทำการ (รวมวันติดกันที่เหตุผลเดียวกันเป็นช่วงเดียว)
function adminListHolidays() {
  try {
    const today = dateToStr(new Date()), from = admAdd_(today, -14);
    const rows = [];
    HOLIDAYS_SHEET().getDataRange().getValues().slice(1).forEach(r => {
      const ds = admDay_(r[0]); if (ds && ds >= from) rows.push({ d: ds, r: (r[1] || 'วันหยุด').toString() });
    });
    rows.sort((a, b) => a.d.localeCompare(b.d));
    const items = [];
    rows.forEach(x => {
      const last = items[items.length - 1];
      if (last && last.reason === x.r && last.end !== x.d) {
        // ติดกันถ้าวันถัดไปที่เป็นวันทำการคือ x.d (ข้ามเสาร์-อาทิตย์ได้)
        let n = admAdd_(last.end, 1);
        while (admDow_(n) === 0 || admDow_(n) === 6) n = admAdd_(n, 1);
        if (n === x.d) { last.end = x.d; last.days++; return; }
      }
      if (last && last.end === x.d) return;
      items.push({ start: x.d, end: x.d, days: 1, reason: x.r });
    });
    return { success: true, today: today, items: items };
  } catch (e) { return { success: false, message: 'โหลดไม่สำเร็จ: ' + e.message }; }
}

// ═══════════════════════════════════════════════════════════════════
// ✅ V23 — ผู้ป่วยที่ D/C แล้วกลับมารักษา: "มาเรื่องเดิม" vs "มาเรื่องใหม่"
// ───────────────────────────────────────────────────────────────────
// เดิม: ผู้ป่วยที่ D/C แล้วกลับมา ระบบเปิด Episode ใหม่ให้เงียบๆ ทุกครั้ง (ไม่แยกเรื่องเดิม/เรื่องใหม่)
// ใหม่: ตอนบันทึกผลครั้งแรกหลังกลับมา ระบบเทียบการวินิจฉัย/บริเวณ/ข้าง กับเคสเดิม แล้ว "แนะนำ" ให้เจ้าหน้าที่ตัดสิน 1 คลิก
//   reopen      ปัญหาเดิม D/C ไม่เกิน 30 วัน → เปิดเคสเดิมต่อ (เก็บสรุป D/C เดิมไว้ใน reopenHistoryJson)
//   recurrence  ปัญหาเดิมกลับมาเป็นซ้ำ        → เปิดเคสใหม่ + parentEpisodeId ชี้เคสเดิม
//   new_problem ปัญหาใหม่                      → เปิดเคสใหม่ แยกผลลัพธ์ออกจากเคสเดิม
//   continue    เคส active ที่ขาดไปเกิน 90 วัน แต่ยังเป็นเรื่องเดิม (ต้องใส่เหตุผล)
//   เคส active ที่ขาดเกิน 90 วันแล้วเลือก recurrence/new_problem → ระบบปิดเคสเก่าเป็น "ขาดนัด/หยุดกลางคัน" ให้
// กติกาที่คงไว้: 1 HN มี Episode active ได้ 1 เคส · ไม่ลบ/ไม่ทับประวัติเดิม
// ความปลอดภัย: เซิร์ฟเวอร์คำนวณสถานะซ้ำทุกครั้ง ปฏิเสธตัวเลือกที่ไม่อยู่ในรายการที่อนุญาต · client เก่า (ไม่ส่ง returnCheck) ทำงานแบบเดิม
// ติดตั้ง: รัน setupV23() ครั้งเดียว (เพิ่มคอลัมน์ N–R ใน Episodes) → rtnSelfTest() → closeStaleEpisodesDryRun() → closeStaleEpisodesWrite()
// ═══════════════════════════════════════════════════════════════════
const RTN = {
  REOPEN_SUGGEST_DAYS: 14,
  REOPEN_MAX_DAYS: 30,
  RECUR_GAP_DAYS: 90,
  STALE_ACTIVE_DAYS: 90,
  MAX_REASON: 300,
  COLS: ['episodeType', 'parentEpisodeId', 'returnReason', 'openedBy', 'reopenHistoryJson'],   // Episodes คอลัมน์ 14–18
  DX_CLUSTERS: [['I63', 'I61', 'I64', 'I69', 'G81']],
  DEFAULT_BY: 'กภ.พลอยไพลิน ประทีปพงศ์',
  TYPE_LABELS: { initial: 'เคสแรก', reopen: 'ต่อเคสเดิม', recurrence: 'เป็นซ้ำ', new_problem: 'ปัญหาใหม่', continue: 'ต่อเนื่อง', legacy: 'ข้อมูลย้อนหลัง' }
};

/* ───────── PURE LOGIC (ไม่แตะชีต — ทดสอบได้) ───────── */
function rtn_str_(v) { return String(v == null ? '' : v).trim(); }
function rtn_parse_(s) { try { return typeof s === 'string' ? (s ? JSON.parse(s) : {}) : (s || {}); } catch (e) { return {}; } }
function rtn_ymd_(v) {
  if (!v) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd');
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  let y = Number(m[1]); if (y > 2400) y -= 543;
  if (y < 1990 || y > 2200) return '';
  return y + '-' + m[2] + '-' + m[3];
}
function rtn_days_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function rtn_code_(icd) { return rtn_str_(icd).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function rtn_family_(icd) {
  const f = rtn_code_(icd).slice(0, 3);
  for (let i = 0; i < RTN.DX_CLUSTERS.length; i++) if (RTN.DX_CLUSTERS[i].indexOf(f) >= 0) return RTN.DX_CLUSTERS[i][0];
  return f;
}
function rtn_sidesOverlap_(a, b) { return !a || !b || a === 'B' || b === 'B' || a === b; }

/** เทียบ 2 การวินิจฉัย → 'same' | 'maybe' | 'different'   (dx = {icd10, region, side, group})
 *  ข้อมูลไม่พอเทียบ → 'maybe' เสมอ ไม่ฟันธงว่า "คนละปัญหา" */
function rtn_compareDx_(a, b) {
  a = a || {}; b = b || {};
  const ca = rtn_code_(a.icd10), cb = rtn_code_(b.icd10);
  const ra = rtn_str_(a.region).toLowerCase(), rb = rtn_str_(b.region).toLowerCase();
  if (ca && cb) {
    const n = Math.min(ca.length, cb.length, 5);
    if (n >= 4 && ca.slice(0, n) === cb.slice(0, n)) return 'same';
    const fa = rtn_family_(ca), fb = rtn_family_(cb);
    if (fa === fb && RTN.DX_CLUSTERS.some(function (c) { return c[0] === fa; })) return 'same';
  }
  if (ra && rb && ra === rb && rtn_sidesOverlap_(rtn_str_(a.side), rtn_str_(b.side))) return 'same';
  if (ca && cb) return (rtn_family_(ca) === rtn_family_(cb) || (a.group && a.group === b.group)) ? 'maybe' : 'different';
  if (ra && rb) return 'different';
  if (a.group && b.group) return a.group === b.group ? 'maybe' : 'different';
  return 'maybe';
}
function rtn_relDxs_(epDxs, newDxs) {
  const A = (epDxs && epDxs.length) ? epDxs : [{}], B = (newDxs && newDxs.length) ? newDxs : [{}];
  let best = 'different';
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    const r = rtn_compareDx_(A[i], B[j]);
    if (r === 'same') return 'same';
    if (r === 'maybe') best = 'maybe';
  }
  return best;
}
function rtn_hasDx_(dxs) { return (dxs || []).some(function (x) { return x && (rtn_code_(x.icd10) || rtn_str_(x.region) || rtn_str_(x.group)); }); }
function rtn_dxLabel_(dx) {
  dx = dx || {};
  const reg = rtn_str_(dx.region), side = SITE_SIDE_LABELS[rtn_str_(dx.side)] || '';
  const place = reg ? ((SITE_REGIONS[reg] || reg) + (side ? ' (' + side + ')' : '')) : '';
  const lab = rtn_str_(dx.label);
  const head = lab ? ((rtn_str_(dx.icd10) ? rtn_str_(dx.icd10) + ' ' : '') + lab) : '';
  return (head && place ? head + ' · ' + place : head) || place || rtn_str_(dx.icd10) || 'ไม่ระบุการวินิจฉัย';
}
/** หาเคสที่ "ปัญหาเดียวกันมากที่สุด" ใน pool → { e, rel } | null  (same ชนะ maybe; เสมอกัน → เคสที่ใหม่กว่า) */
function rtn_bestParent_(pool, newDxs) {
  let best = null;
  pool.slice().sort(function (a, b) { return (b.end || b.start) < (a.end || a.start) ? -1 : 1; }).forEach(function (e) {
    const r = rtn_relDxs_(e.dxs, newDxs);
    if (r === 'different') return;
    if (!best || (r === 'same' && best.rel !== 'same')) best = { e: e, rel: r };
  });
  return best;
}
function rtn_brief_(e) {
  const sm = rtn_parse_(e.summaryJson), dc = sm.discharge || {};
  return { episodeId: e.episodeId, status: e.status, statusLabel: EP_STATUS_LABELS[e.status] || e.status, start: e.start, end: e.end, lastVisit: e.lastVisit || '',
           dxLabel: rtn_dxLabel_((e.dxs && e.dxs[0]) || e.dx), visits: Number(e.totalVisits) || 0, result: dc.result || '', destination: dc.destination || '', type: e.episodeType || '' };
}

/**
 * ตัดสินสถานะผู้ป่วย ณ วันที่มารับบริการ
 * state: new_patient | covered | active | active_stale | discharged       needsDecision = (active_stale | discharged)
 *   covered = วันที่อยู่ในช่วงของเคสที่ปิดแล้ว (แก้ผลนัดเก่า / บันทึกในวัน D/C) → ผูกกับเคสนั้น ไม่ถาม ไม่เปิดเคสใหม่
 */
function rtn_context_(eps, date, newDxs) {
  const hasDx = rtn_hasDx_(newDxs);
  const closed = eps.filter(function (e) { return EP_CLOSE_STATUSES.indexOf(e.status) >= 0; });
  const active = eps.filter(function (e) { return e.status === 'active'; }).sort(function (a, b) { return b.start < a.start ? -1 : 1; });
  const history = eps.slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; }).map(rtn_brief_);
  const out = function (o) { o.history = history; o.needsDecision = (o.state === 'active_stale' || o.state === 'discharged'); return o; };

  if (!eps.length) return out({ state: 'new_patient', suggestion: 'initial', options: ['initial'] });

  const activeStarted = active.filter(function (e) { return e.start <= date; });
  if (!activeStarted.length) {
    const cov = closed.filter(function (e) { return e.start <= date && (!e.end || e.end >= date); })
                      .sort(function (a, b) { return b.start < a.start ? -1 : 1; })[0];
    if (cov) return out({ state: 'covered', suggestion: 'covered', options: [], targetEpisodeId: cov.episodeId });
  }

  if (active.length) {
    const since = function (e) { return rtn_days_(e.lastVisit || e.start, date); };
    const fresh = active.filter(function (e) { return since(e) <= RTN.STALE_ACTIVE_DAYS; });
    if (fresh.length) return out({ state: 'active', suggestion: 'continue', options: ['continue'], targetEpisodeId: fresh[0].episodeId });
    let rel = 'maybe', parent = active[0];
    if (hasDx) {
      const b = rtn_bestParent_(active, newDxs);
      if (b) { rel = b.rel; parent = b.e; } else { rel = 'different'; parent = null; }
    }
    return out({ state: 'active_stale', suggestion: rel === 'different' ? 'new_problem' : 'recurrence', confidence: rel === 'maybe' ? 'low' : 'high', relation: rel,
                 daysSinceLastVisit: since(active[0]), staleEpisode: rtn_brief_(active[0]), targetEpisodeId: active[0].episodeId,
                 parentEpisodeId: parent ? parent.episodeId : '', staleEpisodeIds: active.map(function (e) { return e.episodeId; }),
                 options: rel === 'different' ? ['new_problem', 'continue'] : ['recurrence', 'continue', 'new_problem'] });
  }

  // ไม่มี Episode active → ผู้ป่วยเคย D/C แล้วกลับมา
  const lastClosed = closed.slice().sort(function (a, b) { return (b.end || b.start) < (a.end || a.start) ? -1 : 1; })[0];
  if (!lastClosed) return out({ state: 'new_patient', suggestion: 'initial', options: ['initial'] });
  const days = rtn_days_(lastClosed.end || lastClosed.start, date);
  let parent = null, rel = 'different';
  if (hasDx) { const b = rtn_bestParent_(closed, newDxs); if (b) { rel = b.rel; parent = b.e; } }
  else { rel = 'maybe'; parent = lastClosed; }
  const parentDays = parent ? rtn_days_(parent.end || parent.start, date) : days;
  let suggestion, confidence;
  if (rel === 'same') { suggestion = parentDays <= RTN.REOPEN_SUGGEST_DAYS ? 'reopen' : 'recurrence'; confidence = 'high'; }
  else if (rel === 'maybe') { suggestion = parentDays <= RTN.RECUR_GAP_DAYS ? 'recurrence' : 'new_problem'; confidence = 'low'; }
  else { suggestion = 'new_problem'; confidence = 'high'; }
  const options = [];
  if (parent && parentDays <= RTN.REOPEN_MAX_DAYS && rel !== 'different') options.push('reopen');
  options.push('recurrence', 'new_problem');
  return out({ state: 'discharged', suggestion: suggestion, confidence: confidence, relation: rel, daysSinceDischarge: days,
               lastEpisode: rtn_brief_(lastClosed), parentEpisodeId: parent ? parent.episodeId : '', options: options });
}

/** ตรวจ decision ที่ client ส่งมาเทียบกับ context ที่เซิร์ฟเวอร์คำนวณ → ข้อความ error หรือ '' ถ้าใช้ได้ */
function rtn_validate_(ctx, dec) {
  dec = dec || {};
  const decision = rtn_str_(dec.decision), reason = rtn_str_(dec.reason);
  if (!decision) return 'ผู้ป่วยรายนี้กลับมาหลัง D/C หรือขาดการรักษานาน กรุณาเลือกว่าเป็นเรื่องเดิมหรือเรื่องใหม่';
  if (ctx.options.indexOf(decision) < 0) return 'ตัวเลือก "' + decision + '" ใช้ไม่ได้กับผู้ป่วยรายนี้ในขณะนี้ — กรุณาตรวจสถานะเคสใหม่อีกครั้ง';
  if (decision === 'reopen' && !reason) return 'กรุณาระบุเหตุผลที่ต่อเคสเดิม';
  if (ctx.state === 'active_stale' && decision === 'continue' && !reason) return 'เคสนี้ไม่มารับบริการมา ' + ctx.daysSinceLastVisit + ' วัน กรุณาระบุเหตุผลที่ต่อเคสเดิม';
  return '';
}

/* ───────── SHEET HELPERS ───────── */
function rtn_ensureCols_() {
  const sh = ensureEpisodeColumns_();
  if (!sh) return null;
  const need = 13 + RTN.COLS.length;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  const cur = sh.getRange(1, 14, 1, RTN.COLS.length).getValues()[0];
  if (cur.some(function (v) { return !v; })) sh.getRange(1, 14, 1, RTN.COLS.length).setValues([RTN.COLS.map(function (h, i) { return cur[i] || h; })]);
  return sh;
}
function rtn_readEpisodes_(hn) {
  const sh = rtn_ensureCols_();
  if (!sh || sh.getLastRow() < 2) return { sh: sh, eps: [] };
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 13 + RTN.COLS.length).getValues();
  const eps = [];
  vals.forEach(function (r, i) {
    if (!r[0]) return;
    const h = normalizeHN(r[1]);
    if (hn && h !== hn) return;
    eps.push({ row: i + 2, episodeId: String(r[0]), hn: h, start: rtn_ymd_(r[2]), end: rtn_ymd_(r[3]), dx: rtn_parse_(r[4]), totalVisits: Number(r[5]) || 0,
               status: rtn_str_(r[6]) || 'active', note: r[7] || '', dischargedBy: r[8] || '', summaryJson: r[9] || '', homeProgram: r[10] || '', followUp: r[11] || '', followPlan: r[12] || '',
               episodeType: rtn_str_(r[13]), parentEpisodeId: rtn_str_(r[14]), returnReason: r[15] || '', openedBy: r[16] || '', reopenHistoryJson: r[17] || '' });
  });
  return { sh: sh, eps: eps };
}
function rtn_visitDates_(hnSet, exceptBid, untilDate) {
  const bsh = BOOKINGS_SHEET();
  const by = {};
  if (!bsh || bsh.getLastRow() < 2) return by;
  const exc = rtn_str_(exceptBid);
  bsh.getRange(2, 1, bsh.getLastRow() - 1, 12).getValues().forEach(function (r) {
    if (rtn_str_(r[11]) !== 'Arrived') return;
    const h = normalizeHN(r[6]); if (!h || (hnSet && !hnSet[h])) return;
    if (exc && rtn_str_(r[1]) === exc) return;
    const d = rtn_ymd_(parseFlexDate(r[2])); if (!d || (untilDate && d > untilDate)) return;
    (by[h] = by[h] || []).push(d);
  });
  return by;
}
function rtn_attachLastVisit_(eps, exceptBid, untilDate) {
  const need = {}; eps.forEach(function (e) { if (e.status === 'active') need[e.hn] = true; });
  if (!Object.keys(need).length) return;
  const by = rtn_visitDates_(need, exceptBid, untilDate);
  eps.forEach(function (e) {
    if (e.status !== 'active') return;
    let last = '';
    (by[e.hn] || []).forEach(function (d) { if (d >= e.start && d > last) last = d; });
    e.lastVisit = last || e.start;
  });
}
function rtn_dxFromSite_(s) {
  const dx = s.diagnosis || {};
  return { icd10: s.icd10 || dx.icd10 || '', region: s.region === 'other' ? '' : (s.region || ''), side: s.side || '', group: dx.group || '', label: s.dxLabel || dx.label || '' };
}
function rtn_attachDxs_(eps, hn) {
  const sites = readAllSites_().filter(function (s) { return s.hn === hn; });
  eps.forEach(function (e) {
    const seen = {}, list = [];
    const add = function (x) { const k = [rtn_code_(x.icd10), x.region, x.side].join('|'); if (k === '||' || seen[k] || list.length >= 8) return; seen[k] = 1; list.push(x); };
    add({ icd10: e.dx.icd10 || '', region: e.dx.region || '', side: e.dx.side || '', group: e.dx.group || '', label: e.dx.label || '' });
    sites.forEach(function (s) { if ((!e.start || s.date >= e.start) && (!e.end || s.date <= e.end)) add(rtn_dxFromSite_(s)); });
    e.dxs = list;
  });
}
function rtn_sitesOf_(d) {
  let sites = normalizeSites_(d.sites);
  if (!sites.length) sites = sitesFromLegacyInput_(d);
  return sites;
}
function rtn_newDxs_(sites) { return sites.map(rtn_dxFromSite_); }
function rtn_dateOf_(d) { return rtn_ymd_(parseFlexDate(d.date) || new Date()); }
function rtn_ctxForSave_(hn, d, sites) {
  const date = rtn_dateOf_(d);
  const r = rtn_readEpisodes_(hn);
  rtn_attachLastVisit_(r.eps, d.bookingId, date);
  const newDxs = rtn_newDxs_(sites || rtn_sitesOf_(d));
  r.eps.forEach(function (e) { e.dxs = [e.dx]; });
  if (r.eps.length && !(r.eps.some(function (e) { return e.status === 'active'; }) && !rtn_hasDx_(newDxs))) rtn_attachDxs_(r.eps, hn);
  const ctx = rtn_context_(r.eps, date, newDxs);
  ctx.date = date; ctx.hn = hn; ctx.newDxLabel = newDxs.length ? rtn_dxLabel_(newDxs[0]) : '';
  // ✅ V24: ถ้าตอนนัดเจ้าหน้าที่เลือกไว้แล้ว → แปลงเป็นคำตัดสินให้เลย (ไม่ต้องถามซ้ำตอนบันทึกผล)
  if (ctx.needsDecision && d && d.bookingId) {
    try {
      const it = rtn_bookingIntent_(d.bookingId);
      if (it) { ctx.bookingIntent = it.choice; ctx.preDecision = rtn_decisionFromIntent_(ctx, it); }
    } catch (eP) { Logger.log('preDecision: ' + eP.message); }
  }
  return { ctx: ctx, eps: r.eps, sh: r.sh, date: date, newDxs: newDxs };
}

/* ───────── PUBLIC API ───────── */
function setupV23() {
  rtn_ensureCols_();
  rtn_ensureBookingIntentCol_();
  return 'พร้อมใช้งาน: Episodes คอลัมน์ N–R (episodeType, parentEpisodeId, returnReason, openedBy, reopenHistoryJson) + Bookings คอลัมน์ P (returnIntent)';
}

/** หน้าเว็บเรียก "ก่อนบันทึกผล" ด้วยข้อมูลชุดเดียวกับที่จะบันทึก → บอกว่าต้องถามหรือไม่ (อ่านอย่างเดียว) */
function getReturnContextForSave(d) {
  try {
    d = d || {};
    const hn = normalizeHN(d.hn);
    if (!hn || hn === 'BLOCK') return { success: true, needsDecision: false, state: 'none' };
    const c = rtn_ctxForSave_(hn, d).ctx;
    c.success = true;
    return c;
  } catch (e) { Logger.log('getReturnContextForSave: ' + e.message); return { success: false, message: e.message }; }
}

/** ใช้ก่อน saveOutcome / saveOutcome_dual: ถ้าต้องเลือกแต่ยังไม่เลือก/เลือกไม่ถูก → ไม่บันทึกอะไรเลย
 *  client เก่า (ไม่ส่ง returnCheck) และกรณีโมดูลนี้ผิดพลาด → คืน null = บันทึกแบบเดิมต่อไป */
function rtn_precheck_(d) {
  try {
    if (!d || !d.returnCheck) return null;
    const hn = normalizeHN(d.hn);
    if (!hn || hn === 'BLOCK') return null;
    const ctx = rtn_ctxForSave_(hn, d).ctx;
    if (!ctx.needsDecision) return null;
    const err = rtn_validate_(ctx, d.returnDecision || ctx.preDecision);
    if (!err) return null;
    ctx.success = false; ctx.needReturnDecision = true; ctx.message = err;
    return ctx;
  } catch (e) { Logger.log('rtn_precheck_: ' + e.message); return null; }
}

function rtn_closeAsDropout_(sh, e, today, why) {
  const end = e.lastVisit || e.start;
  const p = end.split('-');
  sh.getRange(e.row, 4).setValue(new Date(+p[0], +p[1] - 1, +p[2]));
  sh.getRange(e.row, 7).setValue('dropout');
  sh.getRange(e.row, 8).setValue((rtn_str_(e.note) ? rtn_str_(e.note) + ' | ' : '') + 'ปิดอัตโนมัติเมื่อ ' + today + (why ? ' — ' + why : ''));
  sh.getRange(e.row, 9).setValue('ระบบ (ไม่มารับบริการเกิน ' + RTN.STALE_ACTIVE_DAYS + ' วัน)');
  e.status = 'dropout'; e.end = end;
}

/** เรียกจาก ensureActiveEpisode_ ตอนบันทึกผล: คืน {episodeId, existing, returnType} หรือ null = ให้ใช้ logic เดิม */
function rtn_resolveForSave_(hn, d, sites) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { throw new Error('ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองใหม่'); }
  try {
    const cx = rtn_ctxForSave_(hn, d, sites), ctx = cx.ctx;
    if (ctx.state === 'covered') return { episodeId: ctx.targetEpisodeId, existing: true, returnType: 'covered' };
    if (!ctx.needsDecision) return null;
    const dec = d.returnDecision || ctx.preDecision || {};
    const err = rtn_validate_(ctx, dec);
    if (err) throw new Error(err);
    const decision = rtn_str_(dec.decision), reason = rtn_str_(dec.reason).slice(0, RTN.MAX_REASON);
    const by = rtn_str_(dec.by || d.by).slice(0, 80) || RTN.DEFAULT_BY, sh = cx.sh, date = cx.date;
    const byId = function (id) { return cx.eps.filter(function (e) { return e.episodeId === id; })[0]; };
    const dropCache = function () { try { CacheService.getScriptCache().remove('kpi_trend_12m_v3'); } catch (e2) {} };

    if (decision === 'continue') {
      const ep = byId(ctx.targetEpisodeId);
      if (!ep || ep.status !== 'active') throw new Error('ไม่พบเคสที่กำลังรักษาอยู่ของผู้ป่วยรายนี้');
      sh.getRange(ep.row, 16).setValue((rtn_str_(ep.returnReason) ? rtn_str_(ep.returnReason) + ' | ' : '') + date + ' ต่อเคสเดิมหลังขาด ' + ctx.daysSinceLastVisit + ' วัน — ' + reason);
      return { episodeId: ep.episodeId, existing: true, returnType: 'continue' };
    }

    if (decision === 'reopen') {
      const ep = byId(ctx.parentEpisodeId);
      if (!ep || EP_CLOSE_STATUSES.indexOf(ep.status) < 0) throw new Error('ไม่พบเคสที่จำหน่ายแล้วสำหรับเปิดซ้ำ');
      const gap = rtn_days_(ep.end || ep.start, date);
      if (gap > RTN.REOPEN_MAX_DAYS) throw new Error('จำหน่ายมาแล้ว ' + gap + ' วัน (เกิน ' + RTN.REOPEN_MAX_DAYS + ' วัน) ต้องเปิดเคสใหม่');
      const hist = rtn_parse_(ep.reopenHistoryJson); const arr = Array.isArray(hist) ? hist : (hist.items || []);
      arr.push({ reopenedAt: date, by: by, reason: reason, prevStatus: ep.status, prevEndDate: ep.end, prevDischargedBy: ep.dischargedBy || '', prevNote: ep.note || '',
                 prevSummaryJson: ep.summaryJson || '', prevHomeProgram: ep.homeProgram || '', prevFollowUp: ep.followUp || '' });
      sh.getRange(ep.row, 4).setValue('');
      sh.getRange(ep.row, 7).setValue('active');
      sh.getRange(ep.row, 8).setValue('');
      sh.getRange(ep.row, 9, 1, 4).setValues([['', '', '', '']]);
      sh.getRange(ep.row, 18).setValue(JSON.stringify(arr));
      dropCache();
      return { episodeId: ep.episodeId, existing: true, returnType: 'reopen' };
    }

    // recurrence | new_problem → เปิด Episode ใหม่ (ถ้ามีเคส active ที่ค้างอยู่ ปิดเป็น dropout ก่อน เพื่อให้มี active เคสเดียว)
    if (ctx.state === 'active_stale') {
      (ctx.staleEpisodeIds || []).forEach(function (id) {
        const old = byId(id); if (!old) return;
        rtn_closeAsDropout_(sh, old, date, reason);
        try { recountEpisodeVisits_(hn, old.episodeId); } catch (e3) {}
      });
    }
    let parentId = '';
    if (decision === 'recurrence') parentId = ctx.parentEpisodeId || (ctx.lastEpisode && ctx.lastEpisode.episodeId) || ctx.targetEpisodeId || '';
    const first = (sites && sites[0]) || {};
    const dx = Object.assign({}, first.diagnosis || {});
    if (first.region) dx.region = first.region;
    if (first.side) dx.side = first.side;
    const p = date.split('-'), eid = Utilities.getUuid();
    sh.appendRow([eid, hn, new Date(+p[0], +p[1] - 1, +p[2]), '', JSON.stringify(dx), 0, 'active', '', '', '', '', '', '', decision, parentId, reason, by, '']);
    dropCache();
    return { episodeId: eid, existing: false, returnType: decision };
  } finally { try { lock.releaseLock(); } catch (e9) {} }
}

/** ปิดเคส active ที่ไม่มารับบริการเกิน N วันเป็น dropout (endDate = วันที่มาครั้งสุดท้าย) — รันจาก Editor เท่านั้น ดูผลด้วย ...DryRun ก่อน */
function closeStaleEpisodesDryRun() { const r = closeStaleEpisodes_(true, 0);  Logger.log(JSON.stringify(r, null, 1)); return r; }
function closeStaleEpisodesWrite()  { const r = closeStaleEpisodes_(false, 0); Logger.log(JSON.stringify(r, null, 1)); return r; }
function closeStaleEpisodes_(dryRun, days) {
  days = Number(days) || RTN.STALE_ACTIVE_DAYS;
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองใหม่' }; }
  try {
    const today = dateToStr(new Date()), r = rtn_readEpisodes_('');
    rtn_attachLastVisit_(r.eps, '', today);
    const act = r.eps.filter(function (e) { return e.status === 'active'; });
    const stale = act.filter(function (e) { return rtn_days_(e.lastVisit || e.start, today) > days; });
    if (!dryRun) {
      stale.forEach(function (e) { rtn_closeAsDropout_(r.sh, e, today, ''); try { recountEpisodeVisits_(e.hn, e.episodeId); } catch (e2) {} });
      try { CacheService.getScriptCache().remove('kpi_trend_12m_v3'); } catch (e3) {}
    }
    return { success: true, dryRun: !!dryRun, thresholdDays: days, activeTotal: act.length, toClose: stale.length,
             message: dryRun ? 'ทดลองเท่านั้น ยังไม่ได้เขียนข้อมูล — ถ้าตัวเลขโอเคให้รัน closeStaleEpisodesWrite()' : 'ปิดแล้ว ' + stale.length + ' เคส',
             sample: stale.slice(0, 15).map(function (e) { return { hn: e.hn, start: e.start, lastVisit: e.lastVisit, dx: rtn_dxLabel_(e.dx) }; }) };
  } catch (e) { Logger.log('closeStaleEpisodes_: ' + e.message); return { success: false, message: e.message }; }
  finally { try { lock.releaseLock(); } catch (e4) {} }
}

/** ทดสอบตรรกะ (ไม่แตะชีต) — รันจาก Editor ต้องขึ้น PASS ทุกข้อ */
function rtnSelfTest() {
  const ep = function (id, st, a, b, dx, last) { return { episodeId: id, status: st, start: a, end: b, dx: dx, dxs: [dx], lastVisit: last || '', totalVisits: 5 }; };
  const knee = { icd10: 'M170', region: 'knee', side: 'R' }, ankle = { icd10: 'S934', region: 'ankle_foot', side: 'R' }, shR = { region: 'shoulder', side: 'R' }, shL = { region: 'shoulder', side: 'L' };
  const C = rtn_context_;
  const cases = [
    ['ผู้ป่วยใหม่ → initial',                         C([], '2026-11-10', [knee]).suggestion, 'initial'],
    ['D/C 8 วัน เรื่องเดิม → แนะนำ reopen',           C([ep('a', 'completed', '2026-09-01', '2026-11-02', knee)], '2026-11-10', [knee]).suggestion, 'reopen'],
    ['D/C 70 วัน เรื่องเดิม → recurrence',            C([ep('a', 'completed', '2026-06-01', '2026-09-01', knee)], '2026-11-10', [knee]).suggestion, 'recurrence'],
    ['D/C 70 วัน → ไม่มีตัวเลือก reopen',             C([ep('a', 'completed', '2026-06-01', '2026-09-01', knee)], '2026-11-10', [knee]).options.indexOf('reopen'), -1],
    ['D/C แล้วมาเรื่องใหม่ → new_problem',            C([ep('a', 'completed', '2026-09-01', '2026-11-02', knee)], '2026-11-10', [ankle]).suggestion, 'new_problem'],
    ['D/C ไหล่ขวา มาไหล่ซ้าย → new_problem',          C([ep('a', 'completed', '2026-09-01', '2026-11-02', shR)], '2026-11-10', [shL]).suggestion, 'new_problem'],
    ['เคสมี 2 ตำแหน่ง มาเรื่องเดิมตำแหน่งที่ 2 → reopen', C([{ episodeId: 'a', status: 'completed', start: '2026-09-01', end: '2026-11-02', dx: knee, dxs: [shR, knee], totalVisits: 5 }], '2026-11-10', [knee]).suggestion, 'reopen'],
    ['แก้ผลนัดเก่าในช่วงเคสที่ D/C แล้ว → covered',     C([ep('a', 'completed', '2026-09-01', '2026-11-02', knee)], '2026-10-01', [knee]).state, 'covered'],
    ['บันทึกในวัน D/C → covered',                     C([ep('a', 'completed', '2026-09-01', '2026-11-02', knee)], '2026-11-02', [knee]).state, 'covered'],
    ['active ใหม่ → ต่อเคสเดิมเงียบๆ (ไม่ถาม)',       C([ep('a', 'active', '2026-10-01', '', knee, '2026-11-05')], '2026-11-10', [ankle]).needsDecision, false],
    ['active ค้าง 98 วัน → active_stale (ต้องถาม)',   C([ep('a', 'active', '2026-05-01', '', knee, '2026-08-04')], '2026-11-10', [knee]).state, 'active_stale'],
    ['active ค้าง + ปัญหาใหม่ → new_problem',         C([ep('a', 'active', '2026-05-01', '', knee, '2026-08-04')], '2026-11-10', [ankle]).suggestion, 'new_problem'],
    ['ไม่ระบุ dx หลัง D/C → ไม่ฟันธง (confidence ต่ำ)', C([ep('a', 'completed', '2026-09-01', '2026-11-02', knee)], '2026-11-10', []).confidence, 'low'],
    ['ปี พ.ศ. 2569-11-10 → 2026-11-10',               rtn_ymd_('2569-11-10'), '2026-11-10'],
    ['validate: reopen ไม่มีเหตุผล → ไม่ผ่าน',        !!rtn_validate_(C([ep('a', 'completed', '2026-09-01', '2026-11-02', knee)], '2026-11-10', [knee]), { decision: 'reopen' }), true],
    ['validate: reopen เกิน 30 วัน → ไม่ผ่าน',        !!rtn_validate_(C([ep('a', 'completed', '2026-06-01', '2026-09-01', knee)], '2026-11-10', [knee]), { decision: 'reopen', reason: 'x' }), true],
    ['validate: new_problem ไม่ต้องมีเหตุผล → ผ่าน',  rtn_validate_(C([ep('a', 'completed', '2026-09-01', '2026-11-02', knee)], '2026-11-10', [ankle]), { decision: 'new_problem' }), '']
  ];
  let fail = 0;
  cases.forEach(function (c) { const ok = c[1] === c[2]; if (!ok) fail++; Logger.log((ok ? 'PASS ' : 'FAIL ') + c[0] + (ok ? '' : '  (ได้ ' + c[1] + ' ต้องเป็น ' + c[2] + ')')); });
  Logger.log(fail ? ('ไม่ผ่าน ' + fail + ' ข้อ') : 'ผ่านครบทุกข้อ (' + cases.length + ')');
  if (fail) throw new Error('rtnSelfTest ไม่ผ่าน ' + fail + ' ข้อ');
  return 'ผ่านครบทุกข้อ (' + cases.length + ')';
}


// ═══════════════════════════════════════════════════════════════════
// ✅ V24 — เลือก "ต่อจากเดิม" / "มาเรื่องใหม่" ตั้งแต่ตอนนัดผู้ป่วย
// ───────────────────────────────────────────────────────────────────
// ตอนจองคิว ถ้า HN นี้เคย D/C แล้ว (หรือมีเคส active ที่ขาดนานเกิน 90 วัน) หน้าเว็บจะให้เลือก 1 ใน 2:
//   continue = ต่อจากเดิม   → D/C ≤ 30 วัน: เปิดเคสเดิมต่อ (reopen) · เกิน 30 วัน: เปิดรอบใหม่เชื่อมเคสเดิม (recurrence)
//                             เคส active ที่ขาดนาน: รักษาต่อในเคสเดิม (continue)
//   new      = มาเรื่องใหม่ → เปิดเคสใหม่แยกจากเคสเดิม (new_problem)
// เก็บที่ชีต Bookings คอลัมน์ 16 (P) = JSON {choice, reason, at}
// ตอนบันทึกผลครั้งแรก ระบบแปลงเป็น returnDecision ให้เอง (ctx.preDecision) แล้วผ่าน rtn_validate_ เดิม — ไม่ถามซ้ำ
// ไม่มีตัวเลือกตอนนัด (นัดเก่า/client เก่า) → ถามตอนบันทึกผลเหมือน V23 ทุกประการ
// ติดตั้ง: รัน setupV23() อีกครั้ง (เพิ่มหัวคอลัมน์ P ในชีต Bookings) — ไม่รันก็ได้ ระบบเพิ่มให้อัตโนมัติเมื่อมีการเลือกครั้งแรก
// ═══════════════════════════════════════════════════════════════════
const RTN_INTENT_COL = 16;

function rtn_intentChoice_(raw) {
  const o = rtn_normIntent_(raw);
  return o ? o.choice : '';
}
/** รับ string JSON หรือ object → {choice:'continue'|'new', reason, at} | null */
function rtn_normIntent_(raw) {
  if (!raw) return null;
  const o = rtn_parse_(raw);
  const choice = rtn_str_(o && o.choice);
  if (choice !== 'continue' && choice !== 'new') return null;
  return { choice: choice, reason: rtn_str_(o.reason).slice(0, RTN.MAX_REASON), at: rtn_str_(o.at) || Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm') };
}
function rtn_ensureBookingIntentCol_() {
  const sh = BOOKINGS_SHEET();
  if (!sh) return null;
  if (sh.getMaxColumns() < RTN_INTENT_COL) sh.insertColumnsAfter(sh.getMaxColumns(), RTN_INTENT_COL - sh.getMaxColumns());
  const c = sh.getRange(1, RTN_INTENT_COL);
  if (!rtn_str_(c.getValue())) c.setValue('returnIntent');
  return sh;
}
/** อ่านตัวเลือกที่เลือกไว้ตอนนัดของ booking นี้ → {choice, reason, at} | null */
function rtn_bookingIntent_(bid) {
  bid = rtn_str_(bid);
  if (!bid) return null;
  const sh = BOOKINGS_SHEET();
  if (!sh || sh.getLastRow() < 2 || sh.getMaxColumns() < RTN_INTENT_COL) return null;
  const n = sh.getLastRow() - 1;
  const ids = sh.getRange(2, 2, n, 1).getValues();
  for (let i = 0; i < n; i++) {
    if (rtn_str_(ids[i][0]) === bid) return rtn_normIntent_(sh.getRange(i + 2, RTN_INTENT_COL).getValue());
  }
  return null;
}
/** แปลงตัวเลือกตอนนัด → decision ของ V23 (ต้องอยู่ใน ctx.options ที่เซิร์ฟเวอร์คำนวณ ไม่งั้นคืน null = ถามตามปกติ) */
function rtn_decisionFromIntent_(ctx, it) {
  if (!it || !ctx || !ctx.options) return null;
  let k = '';
  if (it.choice === 'new') k = 'new_problem';
  else if (it.choice === 'continue') {
    if (ctx.state === 'active_stale') k = 'continue';
    else if (ctx.state === 'discharged') k = ctx.options.indexOf('reopen') >= 0 ? 'reopen' : 'recurrence';
  }
  if (!k || ctx.options.indexOf(k) < 0) return null;
  const reason = it.reason || (it.choice === 'continue' ? 'เจ้าหน้าที่เลือก "ต่อจากเดิม" ตั้งแต่ตอนนัดหมาย' : 'เจ้าหน้าที่เลือก "มาเรื่องใหม่" ตั้งแต่ตอนนัดหมาย');
  return { decision: k, reason: reason.slice(0, RTN.MAX_REASON), by: '', fromBooking: true };
}

/** ฟอร์มจองเรียก (อ่านอย่างเดียว) หลังเลือก/พิมพ์ HN → บอกว่าต้องให้เลือก ต่อจากเดิม/เรื่องใหม่ หรือไม่ */
function getBookingReturnContext(d) {
  try {
    d = d || {};
    const hn = normalizeHN(d.hn);
    if (!hn || hn === 'BLOCK') return { success: true, needsDecision: false, state: 'none' };
    const c = rtn_ctxForSave_(hn, { date: d.date }).ctx;
    return {
      success: true, hn: hn, state: c.state, needsDecision: !!c.needsDecision,
      daysSinceDischarge: c.daysSinceDischarge || 0, daysSinceLastVisit: c.daysSinceLastVisit || 0,
      lastEpisode: c.lastEpisode || null, staleEpisode: c.staleEpisode || null,
      canReopen: (c.options || []).indexOf('reopen') >= 0
    };
  } catch (e) { Logger.log('getBookingReturnContext: ' + e.message); return { success: false, message: e.message }; }
}

// ================================================================
//  V28 : ศูนย์ควบคุมอุปกรณ์ — ทะเบียนครุภัณฑ์ทางการแพทย์ + เตรียมศูนย์ยืม
//    AssetRegister (1 แถว/ครุภัณฑ์) · AssetLog (ประวัติ+timestamp ทุกการเปลี่ยนแปลง) · AssetLoans (เตรียมไว้)
//    รูปเก็บใน Google Drive (ไม่เปิดสาธารณะ) อ้างด้วย fileId — ดึงผ่าน assetGetPhoto()
// ================================================================
const ASSET_GAS_READONLY = true;     // V30: ฝั่ง Apps Script ดูอย่างเดียว — เพิ่ม/แก้/ยืม/คืน/ตรวจสภาพ ทำที่เว็บศูนย์ยืม-คืนบน GitHub (ต้องใช้ PIN)
function assetWriteGuard_() { if (ASSET_GAS_READONLY) throw new Error('หน้านี้เปิดดูอย่างเดียว — กรุณาทำรายการที่ศูนย์ยืม-คืนอุปกรณ์บนเว็บ (เมนู "เปิดศูนย์ยืม-คืน")'); }
const ASSET_LOAN_ENABLED = false;   // เปลี่ยนเป็น true เมื่อพร้อมเปิดศูนย์ยืม (ต้องมีหน้าจอยืม-คืนรองรับด้วย)
const ASSET_FOLDER_NAME = 'PT Station - Equipment Photos';
const ASSET_HEADERS = ['assetId','assetNo','name','category','brand','model','serialNo','spec','acquireMethod','fundSource','unitPrice','acquireDate','docRef','vendor','warrantyEnd','lifeYears','location','custodian','status','loanable','calibDue','remark','photoIds','thumb','voided','createdAt','createdBy','updatedAt','updatedBy','checkIntervalDays','qrKey','qrText','qrFileId','qrImg','qrAt','lastCheckAt','lastCheckBy','lastCheckResult','nextCheckDue'];
const ASSET_FIELDS = ['assetNo','name','category','brand','model','serialNo','spec','acquireMethod','fundSource','unitPrice','acquireDate','docRef','vendor','warrantyEnd','lifeYears','location','custodian','status','loanable','calibDue','remark','checkIntervalDays'];
const ASSET_DATE_FIELDS = ['acquireDate','warrantyEnd','calibDue','nextCheckDue'];
const ASSET_LOG_HEADERS = ['ts','assetId','assetNo','action','by','detail'];
const ASSET_LOAN_HEADERS = ['loanId','assetId','assetNo','assetName','borrowerName','borrowerHN','phone','loanDate','dueDate','returnDate','status','conditionOut','conditionIn','note','createdAt','createdBy','updatedAt'];
const ASSET_STATUSES = ['ใช้งานได้','ชำรุด / รอซ่อม','ส่งซ่อม','รอจำหน่าย','จำหน่ายแล้ว'];

function assetSheets_() {
  const reg = ensureSheetWithHeaders_('AssetRegister', ASSET_HEADERS);
  assetEnsureColumns_(reg);   // V29: เติมคอลัมน์ใหม่ให้ชีตเดิม (ครั้งเดียว)
  return { reg: reg, log: ensureSheetWithHeaders_('AssetLog', ASSET_LOG_HEADERS), loan: ensureSheetWithHeaders_('AssetLoans', ASSET_LOAN_HEADERS), chk: ensureSheetWithHeaders_('AssetChecks', ASSET_CHECK_HEADERS) };
}
function assetNow_() { return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); }
function assetS_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().substring(0, max || 200); }
function assetD_(v) { v = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; }
function assetV_(v, key) {
  if (v instanceof Date) return Utilities.formatDate(v, TIMEZONE, ASSET_DATE_FIELDS.indexOf(key) >= 0 ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  return v == null ? '' : v;
}
function assetRowToObj_(row) {
  const o = {};
  ASSET_HEADERS.forEach(function (h, i) { o[h] = assetV_(row[i], h); });
  o.unitPrice = o.unitPrice === '' ? '' : Number(o.unitPrice) || 0;
  o.lifeYears = o.lifeYears === '' ? '' : Number(o.lifeYears) || 0;
  o.voided = String(o.voided) === 'Y';
  let ids = []; try { ids = JSON.parse(o.photoIds || '[]'); } catch (e) {}
  o.photoIds = Array.isArray(ids) ? ids : [];
  o.checkIntervalDays = o.checkIntervalDays === '' ? '' : Number(o.checkIntervalDays) || 0;
  delete o.qrImg;   // V29: เซลล์รูป QR ไม่ส่งไปหน้าเว็บ (ใช้ qrText วาด QR เอง)
  return o;
}
function assetClean_(d) {
  const price = Number(d.unitPrice);
  const life = Number(d.lifeYears);
  const st = ASSET_STATUSES.indexOf(d.status) >= 0 ? d.status : ASSET_STATUSES[0];
  return {
    assetNo: assetS_(d.assetNo, 60), name: assetS_(d.name, 160), category: assetS_(d.category, 60),
    brand: assetS_(d.brand, 80), model: assetS_(d.model, 80), serialNo: assetS_(d.serialNo, 80), spec: assetS_(d.spec, 500),
    acquireMethod: assetS_(d.acquireMethod, 40), fundSource: assetS_(d.fundSource, 60),
    unitPrice: (d.unitPrice === '' || d.unitPrice == null || !isFinite(price) || price < 0) ? '' : Math.round(price * 100) / 100,
    acquireDate: assetD_(d.acquireDate), docRef: assetS_(d.docRef, 100), vendor: assetS_(d.vendor, 120), warrantyEnd: assetD_(d.warrantyEnd),
    lifeYears: (d.lifeYears === '' || d.lifeYears == null || !isFinite(life) || life < 0) ? '' : Math.round(life),
    location: assetS_(d.location, 100), custodian: assetS_(d.custodian, 100), status: st,
    loanable: d.loanable === 'Y' ? 'Y' : 'N', calibDue: assetD_(d.calibDue), remark: assetS_(d.remark, 500),
    checkIntervalDays: (d.checkIntervalDays === '' || d.checkIntervalDays == null || !isFinite(Number(d.checkIntervalDays)) || Number(d.checkIntervalDays) <= 0) ? '' : Math.round(Number(d.checkIntervalDays))
  };
}
function assetWriteRow_(sh, rowNo, arr) {
  const fm = ASSET_HEADERS.map(function (h) { return h === 'unitPrice' ? '#,##0.00' : ((h === 'lifeYears' || h === 'checkIntervalDays') ? '0' : '@'); });
  const qi = ASSET_HEADERS.indexOf('qrImg');   // V29: เซลล์รูป QR — ห้ามเขียนทับ (อ่านค่ากลับมาไม่ได้)
  [[0, qi], [qi + 1, ASSET_HEADERS.length]].forEach(function (s) {
    if (s[1] <= s[0]) return;
    const rg = sh.getRange(rowNo, s[0] + 1, 1, s[1] - s[0]);
    rg.setNumberFormats([fm.slice(s[0], s[1])]); rg.setValues([arr.slice(s[0], s[1])]);
  });
}
function assetLog_(sh, assetId, assetNo, action, by, detail) {
  const txt = typeof detail === 'string' ? detail : JSON.stringify(detail || {});
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, ASSET_LOG_HEADERS.length).setNumberFormats([['@','@','@','@','@','@']]).setValues([[assetNow_(), assetId, assetNo, action, by, txt.substring(0, 1500)]]);
}
function assetFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ASSET_PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* fall through */ } }
  const it = DriveApp.getFoldersByName(ASSET_FOLDER_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(ASSET_FOLDER_NAME);
  props.setProperty('ASSET_PHOTO_FOLDER_ID', f.getId());
  return f;
}
function assetReadAll_(sh) {
  const last = sh.getLastRow();
  return last >= 2 ? sh.getRange(2, 1, last - 1, ASSET_HEADERS.length).getValues() : [];
}

function assetGetConfig() { assetSheets_(); return { loanEnabled: ASSET_LOAN_ENABLED, statuses: ASSET_STATUSES }; }

function assetList() {
  const S = assetSheets_();
  return assetReadAll_(S.reg).map(assetRowToObj_).filter(function (o) { return !o.voided; });
}

function assetGet(assetId) {
  const S = assetSheets_();
  const o = assetReadAll_(S.reg).map(assetRowToObj_).filter(function (x) { return x.assetId === String(assetId); })[0];
  if (!o) throw new Error('ไม่พบรายการ');
  const last = S.log.getLastRow(), logs = [];
  if (last >= 2) {
    const rows = S.log.getRange(2, 1, last - 1, ASSET_LOG_HEADERS.length).getValues();
    for (let i = rows.length - 1; i >= 0 && logs.length < 40; i--) {
      if (String(rows[i][1]) === o.assetId) logs.push({ ts: assetV_(rows[i][0], 'ts'), action: rows[i][3], by: rows[i][4], detail: rows[i][5] });
    }
  }
  o.log = logs;
  return o;
}

function assetSave(d) {
  assetWriteGuard_();
  d = d || {};
  const by = assetS_(d.by, 60) || 'ไม่ระบุ';
  const c = assetClean_(d);
  if (!c.name) throw new Error('กรุณากรอกชื่อรายการ');
  const S = assetSheets_(), sh = S.reg;
  const idx = {}; ASSET_HEADERS.forEach(function (h, i) { idx[h] = i; });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = assetReadAll_(sh);
    const editId = assetS_(d.assetId, 20);
    let rowIdx = -1, maxN = 0;
    rows.forEach(function (r, i) {
      const id = String(r[idx.assetId]), m = /^A(\d+)$/.exec(id);
      if (m) maxN = Math.max(maxN, Number(m[1]));
      if (editId && id === editId) rowIdx = i;
    });
    if (c.assetNo) {
      const key = c.assetNo.toLowerCase();
      rows.forEach(function (r) {
        if (String(r[idx.voided]) !== 'Y' && String(r[idx.assetNo]).trim().toLowerCase() === key && String(r[idx.assetId]) !== editId)
          throw new Error('เลขครุภัณฑ์ซ้ำกับรายการ: ' + r[idx.name]);
      });
    }
    const now = assetNow_();
    if (editId) {
      if (rowIdx < 0) throw new Error('ไม่พบรายการ');
      const old = rows[rowIdx];
      if (String(old[idx.voided]) === 'Y') throw new Error('รายการนี้ถูกยกเลิกแล้ว');
      const oldNo = String(old[idx.assetNo] || '').trim();
      if (oldNo && oldNo !== c.assetNo) throw new Error('เลขครุภัณฑ์แก้ไขไม่ได้ เพื่อให้ตรวจสอบย้อนหลังได้');
      const nu = old.slice(), diff = {};
      ASSET_FIELDS.forEach(function (k) {
        const ov = assetV_(old[idx[k]], k);
        if (String(ov) !== String(c[k])) diff[k] = [ov, c[k]];
        nu[idx[k]] = c[k];
      });
      if (!Object.keys(diff).length) return { ok: true, assetId: editId, changed: false };
      nu[idx.updatedAt] = now; nu[idx.updatedBy] = by;
      assetWriteRow_(sh, rowIdx + 2, nu);
      assetLog_(S.log, editId, c.assetNo || oldNo, 'update', by, diff);
      return { ok: true, assetId: editId, changed: true };
    }
    const id = 'A' + ('00000' + (maxN + 1)).slice(-5);
    const row = ASSET_HEADERS.map(function (h) { return ''; });
    ASSET_FIELDS.forEach(function (k) { row[idx[k]] = c[k]; });
    row[idx.assetId] = id; row[idx.photoIds] = '[]'; row[idx.voided] = '';
    row[idx.createdAt] = now; row[idx.createdBy] = by; row[idx.updatedAt] = now; row[idx.updatedBy] = by;
    const newRowNo = sh.getLastRow() + 1;
    assetWriteRow_(sh, newRowNo, row);
    assetLog_(S.log, id, c.assetNo, 'create', by, { name: c.name, status: c.status });
    let qrError = '';
    try { assetQrApply_(S, newRowNo, row, by, false); } catch (qe) { qrError = qe.message; Logger.log('auto QR ' + id + ': ' + qe.message); }   // V29
    return { ok: true, assetId: id, created: true, qrError: qrError };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

function assetAddPhoto(assetId, full, thumb, by) {
  assetWriteGuard_();
  by = assetS_(by, 60) || 'ไม่ระบุ';
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(full || ''));
  if (!m) throw new Error('ไฟล์รูปไม่ถูกต้อง');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 3000000) throw new Error('รูปใหญ่เกิน 3 MB');
  const S = assetSheets_(), sh = S.reg;
  const idx = {}; ASSET_HEADERS.forEach(function (h, i) { idx[h] = i; });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = assetReadAll_(sh);
    let r = -1;
    rows.forEach(function (x, i) { if (String(x[idx.assetId]) === String(assetId)) r = i; });
    if (r < 0) throw new Error('ไม่พบรายการ');
    const o = assetRowToObj_(rows[r]);
    if (o.voided) throw new Error('รายการนี้ถูกยกเลิกแล้ว');
    if (o.photoIds.length >= 12) throw new Error('แนบรูปได้สูงสุด 12 รูปต่อรายการ');
    const ext = m[1] === 'image/png' ? 'png' : (m[1] === 'image/webp' ? 'webp' : 'jpg');
    const name = String(o.assetNo || o.assetId).replace(/[^A-Za-z0-9ก-๙_.-]/g, '_') + '_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmmss') + '_' + (o.photoIds.length + 1) + '.' + ext;
    const file = assetFolder_().createFile(Utilities.newBlob(bytes, m[1], name));
    o.photoIds.push(file.getId());
    const rowNo = r + 2;
    sh.getRange(rowNo, idx.photoIds + 1).setNumberFormat('@').setValue(JSON.stringify(o.photoIds));
    const tm = /^data:image\/(?:jpeg|png|webp);base64,/.test(String(thumb || '')) && String(thumb).length <= 45000;
    if (tm && !o.thumb) sh.getRange(rowNo, idx.thumb + 1).setNumberFormat('@').setValue(String(thumb));
    sh.getRange(rowNo, idx.updatedAt + 1, 1, 1).setNumberFormat('@').setValue(assetNow_());
    sh.getRange(rowNo, idx.updatedBy + 1, 1, 1).setNumberFormat('@').setValue(by);
    assetLog_(S.log, o.assetId, o.assetNo, 'photo_add', by, { fileId: file.getId() });
    return { ok: true, fileId: file.getId(), count: o.photoIds.length };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

function assetGetPhoto(fileId) {
  fileId = assetS_(fileId, 80);
  if (!/^[\w-]{10,}$/.test(fileId)) throw new Error('รหัสรูปไม่ถูกต้อง');
  const folderId = assetFolder_().getId(), f = DriveApp.getFileById(fileId);
  let ok = false; const ps = f.getParents();
  while (ps.hasNext()) { if (ps.next().getId() === folderId) ok = true; }
  if (!ok) throw new Error('ไม่อนุญาต');
  const b = f.getBlob();
  return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
}

// ถอดรูปออกจากรายการ — ไฟล์ยังอยู่ใน Drive เพื่อเป็นหลักฐาน (ไม่ลบทิ้ง) และบันทึกลง AssetLog
function assetRemovePhoto(assetId, fileId, by) {
  assetWriteGuard_();
  by = assetS_(by, 60) || 'ไม่ระบุ';
  const S = assetSheets_(), sh = S.reg;
  const idx = {}; ASSET_HEADERS.forEach(function (h, i) { idx[h] = i; });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = assetReadAll_(sh);
    let r = -1;
    rows.forEach(function (x, i) { if (String(x[idx.assetId]) === String(assetId)) r = i; });
    if (r < 0) throw new Error('ไม่พบรายการ');
    const o = assetRowToObj_(rows[r]);
    const left = o.photoIds.filter(function (id) { return id !== fileId; });
    if (left.length === o.photoIds.length) throw new Error('ไม่พบรูปนี้ในรายการ');
    const rowNo = r + 2;
    sh.getRange(rowNo, idx.photoIds + 1).setNumberFormat('@').setValue(JSON.stringify(left));
    if (!left.length) sh.getRange(rowNo, idx.thumb + 1).setNumberFormat('@').setValue('');
    sh.getRange(rowNo, idx.updatedAt + 1).setNumberFormat('@').setValue(assetNow_());
    sh.getRange(rowNo, idx.updatedBy + 1).setNumberFormat('@').setValue(by);
    assetLog_(S.log, o.assetId, o.assetNo, 'photo_del', by, { fileId: fileId });
    return { ok: true, count: left.length };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

// ยกเลิกรายการที่บันทึกผิด (soft delete — ข้อมูลยังอยู่ในชีตและมี log)
function assetVoid(assetId, reason, by) {
  assetWriteGuard_();
  by = assetS_(by, 60) || 'ไม่ระบุ'; reason = assetS_(reason, 300);
  if (!reason) throw new Error('กรุณาระบุเหตุผลที่ยกเลิก');
  const S = assetSheets_(), sh = S.reg;
  const idx = {}; ASSET_HEADERS.forEach(function (h, i) { idx[h] = i; });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = assetReadAll_(sh);
    let r = -1;
    rows.forEach(function (x, i) { if (String(x[idx.assetId]) === String(assetId)) r = i; });
    if (r < 0) throw new Error('ไม่พบรายการ');
    const rowNo = r + 2;
    sh.getRange(rowNo, idx.voided + 1).setNumberFormat('@').setValue('Y');
    sh.getRange(rowNo, idx.updatedAt + 1).setNumberFormat('@').setValue(assetNow_());
    sh.getRange(rowNo, idx.updatedBy + 1).setNumberFormat('@').setValue(by);
    assetLog_(S.log, String(assetId), String(rows[r][idx.assetNo] || ''), 'void', by, { reason: reason });
    return { ok: true };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

function assetLogList(limit) {
  const S = assetSheets_(), n = Math.max(1, Math.min(300, Number(limit) || 120));
  const last = S.log.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - n + 1);
  return S.log.getRange(start, 1, last - start + 1, ASSET_LOG_HEADERS.length).getValues().reverse().map(function (r) {
    return { ts: assetV_(r[0], 'ts'), assetId: r[1], assetNo: r[2], action: r[3], by: r[4], detail: r[5] };
  });
}

// ---------- เตรียมศูนย์ยืม (ยังไม่ผูกกับหน้าจอ; เปิดใช้ด้วย ASSET_LOAN_ENABLED) ----------
function assetLoanGuard_() { if (!ASSET_LOAN_ENABLED) throw new Error('ศูนย์ยืมยังไม่เปิดใช้งาน'); }
function assetLoanList() {
  const S = assetSheets_(), last = S.loan.getLastRow();
  if (last < 2) return [];
  return S.loan.getRange(2, 1, last - 1, ASSET_LOAN_HEADERS.length).getValues().map(function (r) {
    const o = {}; ASSET_LOAN_HEADERS.forEach(function (h, i) { o[h] = assetV_(r[i], h.indexOf('Date') > 0 ? 'loanDate' : h); }); return o;
  });
}
function assetLoanCheckout(d) {
  assetLoanGuard_(); d = d || {};
  const by = assetS_(d.by, 60) || 'ไม่ระบุ', S = assetSheets_();
  const a = assetReadAll_(S.reg).map(assetRowToObj_).filter(function (x) { return x.assetId === String(d.assetId); })[0];
  if (!a || a.voided) throw new Error('ไม่พบรายการ');
  if (a.loanable !== 'Y' || a.status !== ASSET_STATUSES[0]) throw new Error('รายการนี้ยังไม่พร้อมให้ยืม');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const loans = assetLoanList();
    if (loans.some(function (l) { return l.assetId === a.assetId && l.status === 'ยืมอยู่'; })) throw new Error('รายการนี้ถูกยืมอยู่');
    const id = 'L' + ('00000' + (loans.length + 1)).slice(-5), now = assetNow_();
    const row = [id, a.assetId, a.assetNo, a.name, assetS_(d.borrowerName, 100), assetS_(d.borrowerHN, 30), assetS_(d.phone, 30), assetD_(d.loanDate), assetD_(d.dueDate), '', 'ยืมอยู่', assetS_(d.conditionOut, 200), '', assetS_(d.note, 300), now, by, now];
    const r = S.loan.getLastRow() + 1;
    S.loan.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    assetLog_(S.log, a.assetId, a.assetNo, 'loan_out', by, { loanId: id, borrower: row[4] });
    return { ok: true, loanId: id };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}
function assetLoanReturn(d) {
  assetLoanGuard_(); d = d || {};
  const by = assetS_(d.by, 60) || 'ไม่ระบุ', S = assetSheets_(), last = S.loan.getLastRow();
  if (last < 2) throw new Error('ไม่พบรายการยืม');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = S.loan.getRange(2, 1, last - 1, ASSET_LOAN_HEADERS.length).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) !== String(d.loanId)) continue;
      if (String(rows[i][10]) !== 'ยืมอยู่') throw new Error('รายการนี้คืนแล้ว');
      const r = i + 2, today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
      S.loan.getRange(r, 10).setNumberFormat('@').setValue(assetD_(d.returnDate) || today);
      S.loan.getRange(r, 11).setNumberFormat('@').setValue('คืนแล้ว');
      S.loan.getRange(r, 13).setNumberFormat('@').setValue(assetS_(d.conditionIn, 200));
      S.loan.getRange(r, 17).setNumberFormat('@').setValue(assetNow_());
      assetLog_(S.log, String(rows[i][1]), String(rows[i][2]), 'loan_in', by, { loanId: d.loanId });
      return { ok: true };
    }
    throw new Error('ไม่พบรายการยืม');
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

// ================================================================
//  V29 : QR Code ประจำครุภัณฑ์ + บันทึก QR ลงชีต + ตรวจสภาพ (ต่อยอดจาก V28)
//    - สร้าง QR อัตโนมัติเมื่อเพิ่มครุภัณฑ์ใหม่ / สร้างย้อนหลังด้วยปุ่มในหน้าจอ หรือรัน setupV29() ครั้งเดียว
//    - QR เก็บเป็นลิงก์ <WebApp>?view=asset&id=A00001&k=<คีย์สุ่ม> สแกนด้วยกล้องมือถือได้เลย
//    - บันทึกลง AssetRegister: qrKey · qrText · qrFileId (ไฟล์ PNG ใน Drive) · qrImg (รูปในเซลล์) · qrAt
//    - สร้างรูป QR ด้วยโค้ดในไฟล์นี้เอง (ไม่พึ่งบริการภายนอก) — ใช้ไลบรารี qrcode-generator (MIT)
//    - ตรวจสภาพ: ชีต AssetChecks + คอลัมน์ lastCheck*/nextCheckDue ใน AssetRegister · รอบตรวจกำหนดที่ checkIntervalDays
//    - หน้าสาธารณะเมื่อสแกน (view=asset) แสดงเฉพาะข้อมูลพื้นฐาน ไม่แสดงราคา/ผู้ขาย/Serial/ชื่อผู้ยืม
// ================================================================
const ASSET_QR_FOLDER_NAME = 'PT Station - Equipment QR';
const ASSET_CHECK_HEADERS = ['checkId', 'ts', 'assetId', 'assetNo', 'assetName', 'result', 'note', 'by', 'nextDue'];
const ASSET_CHECK_RESULTS = ['ปกติ', 'ต้องปรับปรุง / ซ่อมเล็กน้อย', 'ชำรุด ใช้งานไม่ได้'];

// --- qrcode-generator 1.4.4 (Kazuhiko Arase, MIT License) ---
const PT_QRCODE_ = (function () { var qrcode=function(){var t=function(t,r){var e=t,n=g[r],o=null,i=0,a=null,u=[],f={},c=function(t,r){o=function(t){for(var r=new Array(t),e=0;e<t;e+=1){r[e]=new Array(t);for(var n=0;n<t;n+=1)r[e][n]=null}return r}(i=4*e+17),l(0,0),l(i-7,0),l(0,i-7),s(),h(),d(t,r),e>=7&&v(t),null==a&&(a=p(e,n,u)),w(a,r)},l=function(t,r){for(var e=-1;e<=7;e+=1)if(!(t+e<=-1||i<=t+e))for(var n=-1;n<=7;n+=1)r+n<=-1||i<=r+n||(o[t+e][r+n]=0<=e&&e<=6&&(0==n||6==n)||0<=n&&n<=6&&(0==e||6==e)||2<=e&&e<=4&&2<=n&&n<=4)},h=function(){for(var t=8;t<i-8;t+=1)null==o[t][6]&&(o[t][6]=t%2==0);for(var r=8;r<i-8;r+=1)null==o[6][r]&&(o[6][r]=r%2==0)},s=function(){for(var t=B.getPatternPosition(e),r=0;r<t.length;r+=1)for(var n=0;n<t.length;n+=1){var i=t[r],a=t[n];if(null==o[i][a])for(var u=-2;u<=2;u+=1)for(var f=-2;f<=2;f+=1)o[i+u][a+f]=-2==u||2==u||-2==f||2==f||0==u&&0==f}},v=function(t){for(var r=B.getBCHTypeNumber(e),n=0;n<18;n+=1){var a=!t&&1==(r>>n&1);o[Math.floor(n/3)][n%3+i-8-3]=a}for(n=0;n<18;n+=1){a=!t&&1==(r>>n&1);o[n%3+i-8-3][Math.floor(n/3)]=a}},d=function(t,r){for(var e=n<<3|r,a=B.getBCHTypeInfo(e),u=0;u<15;u+=1){var f=!t&&1==(a>>u&1);u<6?o[u][8]=f:u<8?o[u+1][8]=f:o[i-15+u][8]=f}for(u=0;u<15;u+=1){f=!t&&1==(a>>u&1);u<8?o[8][i-u-1]=f:u<9?o[8][15-u-1+1]=f:o[8][15-u-1]=f}o[i-8][8]=!t},w=function(t,r){for(var e=-1,n=i-1,a=7,u=0,f=B.getMaskFunction(r),c=i-1;c>0;c-=2)for(6==c&&(c-=1);;){for(var g=0;g<2;g+=1)if(null==o[n][c-g]){var l=!1;u<t.length&&(l=1==(t[u]>>>a&1)),f(n,c-g)&&(l=!l),o[n][c-g]=l,-1==(a-=1)&&(u+=1,a=7)}if((n+=e)<0||i<=n){n-=e,e=-e;break}}},p=function(t,r,e){for(var n=A.getRSBlocks(t,r),o=b(),i=0;i<e.length;i+=1){var a=e[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var u=0;for(i=0;i<n.length;i+=1)u+=n[i].dataCount;if(o.getLengthInBits()>8*u)throw"code length overflow. ("+o.getLengthInBits()+">"+8*u+")";for(o.getLengthInBits()+4<=8*u&&o.put(0,4);o.getLengthInBits()%8!=0;)o.putBit(!1);for(;!(o.getLengthInBits()>=8*u||(o.put(236,8),o.getLengthInBits()>=8*u));)o.put(17,8);return function(t,r){for(var e=0,n=0,o=0,i=new Array(r.length),a=new Array(r.length),u=0;u<r.length;u+=1){var f=r[u].dataCount,c=r[u].totalCount-f;n=Math.max(n,f),o=Math.max(o,c),i[u]=new Array(f);for(var g=0;g<i[u].length;g+=1)i[u][g]=255&t.getBuffer()[g+e];e+=f;var l=B.getErrorCorrectPolynomial(c),h=k(i[u],l.getLength()-1).mod(l);for(a[u]=new Array(l.getLength()-1),g=0;g<a[u].length;g+=1){var s=g+h.getLength()-a[u].length;a[u][g]=s>=0?h.getAt(s):0}}var v=0;for(g=0;g<r.length;g+=1)v+=r[g].totalCount;var d=new Array(v),w=0;for(g=0;g<n;g+=1)for(u=0;u<r.length;u+=1)g<i[u].length&&(d[w]=i[u][g],w+=1);for(g=0;g<o;g+=1)for(u=0;u<r.length;u+=1)g<a[u].length&&(d[w]=a[u][g],w+=1);return d}(o,n)};f.addData=function(t,r){var e=null;switch(r=r||"Byte"){case"Numeric":e=M(t);break;case"Alphanumeric":e=x(t);break;case"Byte":e=m(t);break;case"Kanji":e=L(t);break;default:throw"mode:"+r}u.push(e),a=null},f.isDark=function(t,r){if(t<0||i<=t||r<0||i<=r)throw t+","+r;return o[t][r]},f.getModuleCount=function(){return i},f.make=function(){if(e<1){for(var t=1;t<40;t++){for(var r=A.getRSBlocks(t,n),o=b(),i=0;i<u.length;i++){var a=u[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var g=0;for(i=0;i<r.length;i++)g+=r[i].dataCount;if(o.getLengthInBits()<=8*g)break}e=t}c(!1,function(){for(var t=0,r=0,e=0;e<8;e+=1){c(!0,e);var n=B.getLostPoint(f);(0==e||t>n)&&(t=n,r=e)}return r}())},f.createTableTag=function(t,r){t=t||2;var e="";e+='<table style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: "+(r=void 0===r?4*t:r)+"px;",e+='">',e+="<tbody>";for(var n=0;n<f.getModuleCount();n+=1){e+="<tr>";for(var o=0;o<f.getModuleCount();o+=1)e+='<td style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: 0px;",e+=" width: "+t+"px;",e+=" height: "+t+"px;",e+=" background-color: ",e+=f.isDark(n,o)?"#000000":"#ffffff",e+=";",e+='"/>';e+="</tr>"}return e+="</tbody>",e+="</table>"},f.createSvgTag=function(t,r,e,n){var o={};"object"==typeof arguments[0]&&(t=(o=arguments[0]).cellSize,r=o.margin,e=o.alt,n=o.title),t=t||2,r=void 0===r?4*t:r,(e="string"==typeof e?{text:e}:e||{}).text=e.text||null,e.id=e.text?e.id||"qrcode-description":null,(n="string"==typeof n?{text:n}:n||{}).text=n.text||null,n.id=n.text?n.id||"qrcode-title":null;var i,a,u,c,g=f.getModuleCount()*t+2*r,l="";for(c="l"+t+",0 0,"+t+" -"+t+",0 0,-"+t+"z ",l+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',l+=o.scalable?"":' width="'+g+'px" height="'+g+'px"',l+=' viewBox="0 0 '+g+" "+g+'" ',l+=' preserveAspectRatio="xMinYMin meet"',l+=n.text||e.text?' role="img" aria-labelledby="'+y([n.id,e.id].join(" ").trim())+'"':"",l+=">",l+=n.text?'<title id="'+y(n.id)+'">'+y(n.text)+"</title>":"",l+=e.text?'<description id="'+y(e.id)+'">'+y(e.text)+"</description>":"",l+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',l+='<path d="',a=0;a<f.getModuleCount();a+=1)for(u=a*t+r,i=0;i<f.getModuleCount();i+=1)f.isDark(a,i)&&(l+="M"+(i*t+r)+","+u+c);return l+='" stroke="transparent" fill="black"/>',l+="</svg>"},f.createDataURL=function(t,r){t=t||2,r=void 0===r?4*t:r;var e=f.getModuleCount()*t+2*r,n=r,o=e-r;return I(e,e,function(r,e){if(n<=r&&r<o&&n<=e&&e<o){var i=Math.floor((r-n)/t),a=Math.floor((e-n)/t);return f.isDark(a,i)?0:1}return 1})},f.createImgTag=function(t,r,e){t=t||2,r=void 0===r?4*t:r;var n=f.getModuleCount()*t+2*r,o="";return o+="<img",o+=' src="',o+=f.createDataURL(t,r),o+='"',o+=' width="',o+=n,o+='"',o+=' height="',o+=n,o+='"',e&&(o+=' alt="',o+=y(e),o+='"'),o+="/>"};var y=function(t){for(var r="",e=0;e<t.length;e+=1){var n=t.charAt(e);switch(n){case"<":r+="&lt;";break;case">":r+="&gt;";break;case"&":r+="&amp;";break;case'"':r+="&quot;";break;default:r+=n}}return r};return f.createASCII=function(t,r){if((t=t||1)<2)return function(t){t=void 0===t?2:t;var r,e,n,o,i,a=1*f.getModuleCount()+2*t,u=t,c=a-t,g={"██":"█","█ ":"▀"," █":"▄","  ":" "},l={"██":"▀","█ ":"▀"," █":" ","  ":" "},h="";for(r=0;r<a;r+=2){for(n=Math.floor((r-u)/1),o=Math.floor((r+1-u)/1),e=0;e<a;e+=1)i="█",u<=e&&e<c&&u<=r&&r<c&&f.isDark(n,Math.floor((e-u)/1))&&(i=" "),u<=e&&e<c&&u<=r+1&&r+1<c&&f.isDark(o,Math.floor((e-u)/1))?i+=" ":i+="█",h+=t<1&&r+1>=c?l[i]:g[i];h+="\n"}return a%2&&t>0?h.substring(0,h.length-a-1)+Array(a+1).join("▀"):h.substring(0,h.length-1)}(r);t-=1,r=void 0===r?2*t:r;var e,n,o,i,a=f.getModuleCount()*t+2*r,u=r,c=a-r,g=Array(t+1).join("██"),l=Array(t+1).join("  "),h="",s="";for(e=0;e<a;e+=1){for(o=Math.floor((e-u)/t),s="",n=0;n<a;n+=1)i=1,u<=n&&n<c&&u<=e&&e<c&&f.isDark(o,Math.floor((n-u)/t))&&(i=0),s+=i?g:l;for(o=0;o<t;o+=1)h+=s+"\n"}return h.substring(0,h.length-1)},f.renderTo2dContext=function(t,r){r=r||2;for(var e=f.getModuleCount(),n=0;n<e;n++)for(var o=0;o<e;o++)t.fillStyle=f.isDark(n,o)?"black":"white",t.fillRect(n*r,o*r,r,r)},f};t.stringToBytes=(t.stringToBytesFuncs={default:function(t){for(var r=[],e=0;e<t.length;e+=1){var n=t.charCodeAt(e);r.push(255&n)}return r}}).default,t.createStringToBytes=function(t,r){var e=function(){for(var e=S(t),n=function(){var t=e.read();if(-1==t)throw"eof";return t},o=0,i={};;){var a=e.read();if(-1==a)break;var u=n(),f=n()<<8|n();i[String.fromCharCode(a<<8|u)]=f,o+=1}if(o!=r)throw o+" != "+r;return i}(),n="?".charCodeAt(0);return function(t){for(var r=[],o=0;o<t.length;o+=1){var i=t.charCodeAt(o);if(i<128)r.push(i);else{var a=e[t.charAt(o)];"number"==typeof a?(255&a)==a?r.push(a):(r.push(a>>>8),r.push(255&a)):r.push(n)}}return r}};var r,e,n,o,i,a=1,u=2,f=4,c=8,g={L:1,M:0,Q:3,H:2},l=0,h=1,s=2,v=3,d=4,w=5,p=6,y=7,B=(r=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],e=1335,n=7973,i=function(t){for(var r=0;0!=t;)r+=1,t>>>=1;return r},(o={}).getBCHTypeInfo=function(t){for(var r=t<<10;i(r)-i(e)>=0;)r^=e<<i(r)-i(e);return 21522^(t<<10|r)},o.getBCHTypeNumber=function(t){for(var r=t<<12;i(r)-i(n)>=0;)r^=n<<i(r)-i(n);return t<<12|r},o.getPatternPosition=function(t){return r[t-1]},o.getMaskFunction=function(t){switch(t){case l:return function(t,r){return(t+r)%2==0};case h:return function(t,r){return t%2==0};case s:return function(t,r){return r%3==0};case v:return function(t,r){return(t+r)%3==0};case d:return function(t,r){return(Math.floor(t/2)+Math.floor(r/3))%2==0};case w:return function(t,r){return t*r%2+t*r%3==0};case p:return function(t,r){return(t*r%2+t*r%3)%2==0};case y:return function(t,r){return(t*r%3+(t+r)%2)%2==0};default:throw"bad maskPattern:"+t}},o.getErrorCorrectPolynomial=function(t){for(var r=k([1],0),e=0;e<t;e+=1)r=r.multiply(k([1,C.gexp(e)],0));return r},o.getLengthInBits=function(t,r){if(1<=r&&r<10)switch(t){case a:return 10;case u:return 9;case f:case c:return 8;default:throw"mode:"+t}else if(r<27)switch(t){case a:return 12;case u:return 11;case f:return 16;case c:return 10;default:throw"mode:"+t}else{if(!(r<41))throw"type:"+r;switch(t){case a:return 14;case u:return 13;case f:return 16;case c:return 12;default:throw"mode:"+t}}},o.getLostPoint=function(t){for(var r=t.getModuleCount(),e=0,n=0;n<r;n+=1)for(var o=0;o<r;o+=1){for(var i=0,a=t.isDark(n,o),u=-1;u<=1;u+=1)if(!(n+u<0||r<=n+u))for(var f=-1;f<=1;f+=1)o+f<0||r<=o+f||0==u&&0==f||a==t.isDark(n+u,o+f)&&(i+=1);i>5&&(e+=3+i-5)}for(n=0;n<r-1;n+=1)for(o=0;o<r-1;o+=1){var c=0;t.isDark(n,o)&&(c+=1),t.isDark(n+1,o)&&(c+=1),t.isDark(n,o+1)&&(c+=1),t.isDark(n+1,o+1)&&(c+=1),0!=c&&4!=c||(e+=3)}for(n=0;n<r;n+=1)for(o=0;o<r-6;o+=1)t.isDark(n,o)&&!t.isDark(n,o+1)&&t.isDark(n,o+2)&&t.isDark(n,o+3)&&t.isDark(n,o+4)&&!t.isDark(n,o+5)&&t.isDark(n,o+6)&&(e+=40);for(o=0;o<r;o+=1)for(n=0;n<r-6;n+=1)t.isDark(n,o)&&!t.isDark(n+1,o)&&t.isDark(n+2,o)&&t.isDark(n+3,o)&&t.isDark(n+4,o)&&!t.isDark(n+5,o)&&t.isDark(n+6,o)&&(e+=40);var g=0;for(o=0;o<r;o+=1)for(n=0;n<r;n+=1)t.isDark(n,o)&&(g+=1);return e+=Math.abs(100*g/r/r-50)/5*10},o),C=function(){for(var t=new Array(256),r=new Array(256),e=0;e<8;e+=1)t[e]=1<<e;for(e=8;e<256;e+=1)t[e]=t[e-4]^t[e-5]^t[e-6]^t[e-8];for(e=0;e<255;e+=1)r[t[e]]=e;var n={glog:function(t){if(t<1)throw"glog("+t+")";return r[t]},gexp:function(r){for(;r<0;)r+=255;for(;r>=256;)r-=255;return t[r]}};return n}();function k(t,r){if(void 0===t.length)throw t.length+"/"+r;var e=function(){for(var e=0;e<t.length&&0==t[e];)e+=1;for(var n=new Array(t.length-e+r),o=0;o<t.length-e;o+=1)n[o]=t[o+e];return n}(),n={getAt:function(t){return e[t]},getLength:function(){return e.length},multiply:function(t){for(var r=new Array(n.getLength()+t.getLength()-1),e=0;e<n.getLength();e+=1)for(var o=0;o<t.getLength();o+=1)r[e+o]^=C.gexp(C.glog(n.getAt(e))+C.glog(t.getAt(o)));return k(r,0)},mod:function(t){if(n.getLength()-t.getLength()<0)return n;for(var r=C.glog(n.getAt(0))-C.glog(t.getAt(0)),e=new Array(n.getLength()),o=0;o<n.getLength();o+=1)e[o]=n.getAt(o);for(o=0;o<t.getLength();o+=1)e[o]^=C.gexp(C.glog(t.getAt(o))+r);return k(e,0).mod(t)}};return n}var A=function(){var t=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],r=function(t,r){var e={};return e.totalCount=t,e.dataCount=r,e},e={};return e.getRSBlocks=function(e,n){var o=function(r,e){switch(e){case g.L:return t[4*(r-1)+0];case g.M:return t[4*(r-1)+1];case g.Q:return t[4*(r-1)+2];case g.H:return t[4*(r-1)+3];default:return}}(e,n);if(void 0===o)throw"bad rs block @ typeNumber:"+e+"/errorCorrectionLevel:"+n;for(var i=o.length/3,a=[],u=0;u<i;u+=1)for(var f=o[3*u+0],c=o[3*u+1],l=o[3*u+2],h=0;h<f;h+=1)a.push(r(c,l));return a},e}(),b=function(){var t=[],r=0,e={getBuffer:function(){return t},getAt:function(r){var e=Math.floor(r/8);return 1==(t[e]>>>7-r%8&1)},put:function(t,r){for(var n=0;n<r;n+=1)e.putBit(1==(t>>>r-n-1&1))},getLengthInBits:function(){return r},putBit:function(e){var n=Math.floor(r/8);t.length<=n&&t.push(0),e&&(t[n]|=128>>>r%8),r+=1}};return e},M=function(t){var r=a,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+2<r.length;)t.put(o(r.substring(n,n+3)),10),n+=3;n<r.length&&(r.length-n==1?t.put(o(r.substring(n,n+1)),4):r.length-n==2&&t.put(o(r.substring(n,n+2)),7))}},o=function(t){for(var r=0,e=0;e<t.length;e+=1)r=10*r+i(t.charAt(e));return r},i=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);throw"illegal char :"+t};return n},x=function(t){var r=u,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+1<r.length;)t.put(45*o(r.charAt(n))+o(r.charAt(n+1)),11),n+=2;n<r.length&&t.put(o(r.charAt(n)),6)}},o=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);if("A"<=t&&t<="Z")return t.charCodeAt(0)-"A".charCodeAt(0)+10;switch(t){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+t}};return n},m=function(r){var e=f,n=t.stringToBytes(r),o={getMode:function(){return e},getLength:function(t){return n.length},write:function(t){for(var r=0;r<n.length;r+=1)t.put(n[r],8)}};return o},L=function(r){var e=c,n=t.stringToBytesFuncs.SJIS;if(!n)throw"sjis not supported.";!function(){var t=n("友");if(2!=t.length||38726!=(t[0]<<8|t[1]))throw"sjis not supported."}();var o=n(r),i={getMode:function(){return e},getLength:function(t){return~~(o.length/2)},write:function(t){for(var r=o,e=0;e+1<r.length;){var n=(255&r[e])<<8|255&r[e+1];if(33088<=n&&n<=40956)n-=33088;else{if(!(57408<=n&&n<=60351))throw"illegal char at "+(e+1)+"/"+n;n-=49472}n=192*(n>>>8&255)+(255&n),t.put(n,13),e+=2}if(e<r.length)throw"illegal char at "+(e+1)}};return i},D=function(){var t=[],r={writeByte:function(r){t.push(255&r)},writeShort:function(t){r.writeByte(t),r.writeByte(t>>>8)},writeBytes:function(t,e,n){e=e||0,n=n||t.length;for(var o=0;o<n;o+=1)r.writeByte(t[o+e])},writeString:function(t){for(var e=0;e<t.length;e+=1)r.writeByte(t.charCodeAt(e))},toByteArray:function(){return t},toString:function(){var r="";r+="[";for(var e=0;e<t.length;e+=1)e>0&&(r+=","),r+=t[e];return r+="]"}};return r},S=function(t){var r=t,e=0,n=0,o=0,i={read:function(){for(;o<8;){if(e>=r.length){if(0==o)return-1;throw"unexpected end of file./"+o}var t=r.charAt(e);if(e+=1,"="==t)return o=0,-1;t.match(/^\s$/)||(n=n<<6|a(t.charCodeAt(0)),o+=6)}var i=n>>>o-8&255;return o-=8,i}},a=function(t){if(65<=t&&t<=90)return t-65;if(97<=t&&t<=122)return t-97+26;if(48<=t&&t<=57)return t-48+52;if(43==t)return 62;if(47==t)return 63;throw"c:"+t};return i},I=function(t,r,e){for(var n=function(t,r){var e=t,n=r,o=new Array(t*r),i={setPixel:function(t,r,n){o[r*e+t]=n},write:function(t){t.writeString("GIF87a"),t.writeShort(e),t.writeShort(n),t.writeByte(128),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(255),t.writeByte(255),t.writeByte(255),t.writeString(","),t.writeShort(0),t.writeShort(0),t.writeShort(e),t.writeShort(n),t.writeByte(0);var r=a(2);t.writeByte(2);for(var o=0;r.length-o>255;)t.writeByte(255),t.writeBytes(r,o,255),o+=255;t.writeByte(r.length-o),t.writeBytes(r,o,r.length-o),t.writeByte(0),t.writeString(";")}},a=function(t){for(var r=1<<t,e=1+(1<<t),n=t+1,i=u(),a=0;a<r;a+=1)i.add(String.fromCharCode(a));i.add(String.fromCharCode(r)),i.add(String.fromCharCode(e));var f,c,g,l=D(),h=(f=l,c=0,g=0,{write:function(t,r){if(t>>>r!=0)throw"length over";for(;c+r>=8;)f.writeByte(255&(t<<c|g)),r-=8-c,t>>>=8-c,g=0,c=0;g|=t<<c,c+=r},flush:function(){c>0&&f.writeByte(g)}});h.write(r,n);var s=0,v=String.fromCharCode(o[s]);for(s+=1;s<o.length;){var d=String.fromCharCode(o[s]);s+=1,i.contains(v+d)?v+=d:(h.write(i.indexOf(v),n),i.size()<4095&&(i.size()==1<<n&&(n+=1),i.add(v+d)),v=d)}return h.write(i.indexOf(v),n),h.write(e,n),h.flush(),l.toByteArray()},u=function(){var t={},r=0,e={add:function(n){if(e.contains(n))throw"dup key:"+n;t[n]=r,r+=1},size:function(){return r},indexOf:function(r){return t[r]},contains:function(r){return void 0!==t[r]}};return e};return i}(t,r),o=0;o<r;o+=1)for(var i=0;i<t;i+=1)n.setPixel(i,o,e(i,o));var a=D();n.write(a);for(var u=function(){var t=0,r=0,e=0,n="",o={},i=function(t){n+=String.fromCharCode(a(63&t))},a=function(t){if(t<0);else{if(t<26)return 65+t;if(t<52)return t-26+97;if(t<62)return t-52+48;if(62==t)return 43;if(63==t)return 47}throw"n:"+t};return o.writeByte=function(n){for(t=t<<8|255&n,r+=8,e+=1;r>=6;)i(t>>>r-6),r-=6},o.flush=function(){if(r>0&&(i(t<<6-r),t=0,r=0),e%3!=0)for(var o=3-e%3,a=0;a<o;a+=1)n+="="},o.toString=function(){return n},o}(),f=a.toByteArray(),c=0;c<f.length;c+=1)u.writeByte(f[c]);return u.flush(),"data:image/gif;base64,"+u};return t}();qrcode.stringToBytesFuncs["UTF-8"]=function(t){return function(t){for(var r=[],e=0;e<t.length;e++){var n=t.charCodeAt(e);n<128?r.push(n):n<2048?r.push(192|n>>6,128|63&n):n<55296||n>=57344?r.push(224|n>>12,128|n>>6&63,128|63&n):(e++,n=65536+((1023&n)<<10|1023&t.charCodeAt(e)),r.push(240|n>>18,128|n>>12&63,128|n>>6&63,128|63&n))}return r}(t)}; return qrcode; })();

function assetIdx_() { const o = {}; ASSET_HEADERS.forEach(function (h, i) { o[h] = i; }); return o; }

// เพิ่มหัวคอลัมน์ใหม่ต่อท้าย AssetRegister เดิม (ไม่แตะข้อมูลเดิม) — ทำครั้งเดียวแล้วจำไว้ใน Script Properties
function assetEnsureColumns_(sh) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ASSET_COLS_V29') === '1') return;
  const need = ASSET_HEADERS.length;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  const cur = sh.getRange(1, 1, 1, need).getValues()[0];
  const out = ASSET_HEADERS.map(function (h, i) { return cur[i] || h; });
  if (out.some(function (v, i) { return v !== cur[i]; })) {
    sh.getRange(1, 1, 1, need).setValues([out]);
    sh.getRange(1, 1, 1, need).setFontWeight('bold');
  }
  props.setProperty('ASSET_COLS_V29', '1');
}

// ---------- ลิงก์เว็บแอป (ฐานของ QR) ----------
function assetQrBase_() {
  let base = PropertiesService.getScriptProperties().getProperty('webAppUrl') || '';
  if (!base) {
    try { const u = ScriptApp.getService().getUrl(); if (u && u.indexOf('/exec') !== -1) base = u.split('?')[0]; } catch (e) {}
  }
  if (!base) throw new Error('ยังไม่พบลิงก์เว็บแอป — ให้เปิดระบบผ่านลิงก์ที่ลงท้ายด้วย /exec อย่างน้อย 1 ครั้ง แล้วสร้าง QR ใหม่');
  return base;
}
function assetQrInfo() {
  let base = '', ok = true;
  try { base = assetQrBase_(); } catch (e) { ok = false; }
  return { ok: ok, base: base };
}
function assetQrNewKey_() { return Utilities.getUuid().replace(/-/g, '').substring(0, 8); }
function assetQrFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ASSET_QR_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* สร้างใหม่ */ } }
  const it = DriveApp.getFoldersByName(ASSET_QR_FOLDER_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(ASSET_QR_FOLDER_NAME);
  props.setProperty('ASSET_QR_FOLDER_ID', f.getId());
  return f;
}

// ---------- สร้างรูป QR เป็น PNG (1 บิต) ด้วยตัวเอง ไม่ต้องเรียกบริการภายนอก ----------
function assetQrMatrix_(text) {
  const qr = PT_QRCODE_(0, 'M'); qr.addData(String(text), 'Byte'); qr.make();
  const n = qr.getModuleCount(), m = [];
  for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(!!qr.isDark(r, c)); m.push(row); }
  return m;
}
let _assetCrcT = null;
function assetCrc32_(u8) {
  if (!_assetCrcT) {
    _assetCrcT = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); _assetCrcT[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < u8.length; i++) c = _assetCrcT[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function assetConcat_(parts) {
  let len = 0; parts.forEach(function (p) { len += p.length; });
  const out = new Uint8Array(len); let o = 0;
  parts.forEach(function (p) { out.set(p, o); o += p.length; });
  return out;
}
function assetU32_(v) { return Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
function assetPngChunk_(type, data) {
  const t = Uint8Array.of(type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3));
  const td = assetConcat_([t, data]);
  return assetConcat_([assetU32_(data.length), td, assetU32_(assetCrc32_(td))]);
}
function assetQrPngBytes_(text) {
  const m = assetQrMatrix_(text), n = m.length, S = 8, Q = 4, W = (n + 2 * Q) * S, H = W, rb = Math.ceil(W / 8);
  const raw = new Uint8Array((rb + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    const r = Math.floor(y / S) - Q;
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      const c = Math.floor(x / S) - Q;
      const dark = r >= 0 && r < n && c >= 0 && c < n && m[r][c];
      if (!dark) raw[p + (x >> 3)] |= (0x80 >> (x & 7));   // 1 = ขาว
    }
    p += rb;
  }
  const z = [Uint8Array.of(0x78, 0x01)];
  for (let off = 0; off < raw.length;) {
    const sz = Math.min(65535, raw.length - off), fin = (off + sz >= raw.length) ? 1 : 0;
    z.push(Uint8Array.of(fin, sz & 255, (sz >> 8) & 255, (~sz) & 255, ((~sz) >> 8) & 255), raw.subarray(off, off + sz));
    off += sz;
  }
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  z.push(assetU32_(((b << 16) | a) >>> 0));
  const ihdr = assetConcat_([assetU32_(W), assetU32_(H), Uint8Array.of(1, 0, 0, 0, 0)]);
  return assetConcat_([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    assetPngChunk_('IHDR', ihdr), assetPngChunk_('IDAT', assetConcat_(z)), assetPngChunk_('IEND', new Uint8Array(0))
  ]);
}
function assetQrBlob_(text, name) {
  const u8 = assetQrPngBytes_(text);
  return Utilities.newBlob(Array.from(u8, function (b) { return b > 127 ? b - 256 : b; }), 'image/png', name);
}

// ใส่รูป QR ลงในเซลล์ของชีต — ลองตามลำดับ: data URI → ลิงก์ Drive → ลิงก์ข้อความ (คืนค่าวิธีที่สำเร็จ)
function assetQrCellImage_(sh, row, col, blob, file, label, text) {
  try { sh.setRowHeight(row, 84); } catch (e) {}
  try {
    const im = SpreadsheetApp.newCellImage().setSourceUrl('data:image/png;base64,' + Utilities.base64Encode(blob.getBytes()))
      .setAltTextTitle('QR ' + label).setAltTextDescription(text).build();
    sh.getRange(row, col).setNumberFormat('General').setValue(im); return 'data';
  } catch (e1) { /* ลองวิธีถัดไป */ }
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const im2 = SpreadsheetApp.newCellImage().setSourceUrl('https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400')
      .setAltTextTitle('QR ' + label).build();
    sh.getRange(row, col).setNumberFormat('General').setValue(im2); return 'drive';
  } catch (e2) { /* ลองวิธีถัดไป */ }
  try {
    sh.getRange(row, col).setNumberFormat('General').setFormula('=HYPERLINK("https://drive.google.com/file/d/' + file.getId() + '/view","เปิดรูป QR")'); return 'link';
  } catch (e3) { return ''; }
}

// สร้าง/สร้างซ้ำ QR ของแถวเดียว (ผู้เรียกต้องถือ lock เอง)
function assetQrApply_(S, rowNo, rowArr, by, force) {
  const ix = assetIdx_(), sh = S.reg;
  const id = String(rowArr[ix.assetId] || '');
  if (!force && rowArr[ix.qrText] && rowArr[ix.qrFileId]) return { assetId: id, ok: true, skipped: true };
  const base = assetQrBase_();
  const key = String(rowArr[ix.qrKey] || '') || assetQrNewKey_();
  const text = base + '?view=asset&id=' + encodeURIComponent(id) + '&k=' + key;
  const no = String(rowArr[ix.assetNo] || '').trim();
  const blob = assetQrBlob_(text, 'QR_' + (no || id).replace(/[^A-Za-z0-9ก-๙_.-]/g, '_') + '_' + id + '.png');
  const file = assetQrFolder_().createFile(blob);
  const oldFile = String(rowArr[ix.qrFileId] || '');
  if (oldFile) { try { DriveApp.getFileById(oldFile).setTrashed(true); } catch (e) {} }
  sh.getRange(rowNo, ix.qrKey + 1, 1, 3).setNumberFormat('@').setValues([[key, text, file.getId()]]);
  sh.getRange(rowNo, ix.qrAt + 1).setNumberFormat('@').setValue(assetNow_());
  const how = assetQrCellImage_(sh, rowNo, ix.qrImg + 1, blob, file, no || id, text);
  assetLog_(S.log, id, no, 'qr_gen', by, { fileId: file.getId(), sheetImage: how || 'none' });
  return { assetId: id, ok: true, fileId: file.getId(), sheetImage: how };
}

// สร้าง QR เป็นชุด (หน้าจอเรียกทีละไม่เกิน 10 รายการ) — force = สร้างใหม่ทับของเดิม (คีย์เดิมคงอยู่)
function assetQrBatch(ids, force, by) {
  assetWriteGuard_();
  by = assetS_(by, 60) || 'ไม่ระบุ';
  ids = (Array.isArray(ids) ? ids : []).map(String).slice(0, 10);
  if (!ids.length) return { results: [] };
  assetQrBase_();
  const S = assetSheets_(), ix = assetIdx_(), lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rows = assetReadAll_(S.reg), pos = {};
    rows.forEach(function (r, i) { pos[String(r[ix.assetId])] = i; });
    try { S.reg.setColumnWidth(ix.qrImg + 1, 96); } catch (e) {}
    const results = ids.map(function (id) {
      try {
        const i = pos[id];
        if (i == null) throw new Error('ไม่พบรายการ');
        if (String(rows[i][ix.voided]) === 'Y') throw new Error('รายการนี้ถูกยกเลิกแล้ว');
        return assetQrApply_(S, i + 2, rows[i], by, !!force);
      } catch (e) { return { assetId: id, ok: false, error: e.message }; }
    });
    return { results: results };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

// บันทึกประวัติว่าพิมพ์ป้าย QR ของรายการไหนบ้าง (เขียนทีเดียว)
function assetQrPrintLog(ids, size, by) {
  assetWriteGuard_();
  by = assetS_(by, 60) || 'ไม่ระบุ'; size = assetS_(size, 10);
  ids = (Array.isArray(ids) ? ids : []).map(String).slice(0, 300);
  if (!ids.length) return { ok: true };
  const S = assetSheets_(), ix = assetIdx_(), no = {};
  assetReadAll_(S.reg).forEach(function (r) { no[String(r[ix.assetId])] = String(r[ix.assetNo] || ''); });
  const now = assetNow_();
  const out = ids.filter(function (id) { return no[id] != null; }).map(function (id) { return [now, id, no[id], 'qr_print', by, JSON.stringify({ size: size })]; });
  if (out.length) S.log.getRange(S.log.getLastRow() + 1, 1, out.length, ASSET_LOG_HEADERS.length).setNumberFormat('@').setValues(out);
  return { ok: true, count: out.length };
}

// ---------- ตรวจสภาพ ----------
function assetCheckSave(d) {
  assetWriteGuard_();
  d = d || {};
  const by = assetS_(d.by, 60);
  if (!by) throw new Error('กรุณากรอกชื่อผู้ตรวจ');
  const result = String(d.result || '');
  if (ASSET_CHECK_RESULTS.indexOf(result) < 0) throw new Error('กรุณาเลือกผลการตรวจ');
  const note = assetS_(d.note, 500);
  if (result !== ASSET_CHECK_RESULTS[0] && !note) throw new Error('กรุณาระบุรายละเอียดที่พบ');
  const S = assetSheets_(), ix = assetIdx_(), sh = S.reg;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = assetReadAll_(sh);
    let r = -1;
    rows.forEach(function (x, i) { if (String(x[ix.assetId]) === String(d.assetId)) r = i; });
    if (r < 0) throw new Error('ไม่พบรายการ');
    const o = assetRowToObj_(rows[r]);
    if (o.voided) throw new Error('รายการนี้ถูกยกเลิกแล้ว');
    const rowNo = r + 2, now = assetNow_();
    const days = Number(o.checkIntervalDays) || 0;
    const nextDue = days > 0 ? Utilities.formatDate(new Date(Date.now() + days * 86400000), TIMEZONE, 'yyyy-MM-dd') : '';
    sh.getRange(rowNo, ix.lastCheckAt + 1, 1, 4).setNumberFormat('@').setValues([[now, by, result, nextDue]]);
    let statusChanged = false;
    if (result === ASSET_CHECK_RESULTS[2] && o.status === ASSET_STATUSES[0]) {
      sh.getRange(rowNo, ix.status + 1).setNumberFormat('@').setValue(ASSET_STATUSES[1]);
      statusChanged = true;
    }
    sh.getRange(rowNo, ix.updatedAt + 1, 1, 2).setNumberFormat('@').setValues([[now, by]]);
    const cid = 'C' + ('00000' + Math.max(1, S.chk.getLastRow())).slice(-5);
    S.chk.getRange(S.chk.getLastRow() + 1, 1, 1, ASSET_CHECK_HEADERS.length).setNumberFormat('@')
      .setValues([[cid, now, o.assetId, o.assetNo, o.name, result, note, by, nextDue]]);
    assetLog_(S.log, o.assetId, o.assetNo, 'check', by, { result: result, note: note, statusChanged: statusChanged });
    return { ok: true, nextDue: nextDue, statusChanged: statusChanged };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

function assetCheckList(assetId, limit) {
  const S = assetSheets_(), n = Math.max(1, Math.min(60, Number(limit) || 12)), last = S.chk.getLastRow();
  if (last < 2) return [];
  const rows = S.chk.getRange(2, 1, last - 1, ASSET_CHECK_HEADERS.length).getValues(), out = [];
  for (let i = rows.length - 1; i >= 0 && out.length < n; i--) {
    if (String(rows[i][2]) === String(assetId)) out.push({ ts: assetV_(rows[i][1], 'ts'), result: rows[i][5], note: rows[i][6], by: rows[i][7], nextDue: assetV_(rows[i][8], 'nextCheckDue') });
  }
  return out;
}

// ---------- ตั้งค่าครั้งเดียว: ย้ายคอลัมน์ + สร้าง QR ให้ครุภัณฑ์ที่ยังไม่มี (รันจากตัวแก้ไข Apps Script) ----------
function assetQrRun_(force, who) {
  const S = assetSheets_(), ix = assetIdx_();
  assetQrBase_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let ok = 0, fail = 0;
  try {
    try { S.reg.setColumnWidth(ix.qrImg + 1, 96); } catch (e) {}
    assetReadAll_(S.reg).forEach(function (r, i) {
      if (String(r[ix.voided]) === 'Y' || !r[ix.assetId]) return;
      if (!force && r[ix.qrText] && r[ix.qrFileId]) return;
      try { assetQrApply_(S, i + 2, r, who, !!force); ok++; } catch (e) { fail++; Logger.log('QR ' + r[ix.assetId] + ': ' + e.message); }
    });
  } finally { try { lock.releaseLock(); } catch (e) {} }
  Logger.log(who + ' เสร็จ — สร้าง QR ' + ok + ' รายการ, ไม่สำเร็จ ' + fail);
  return { ok: ok, fail: fail };
}
function setupV29() { return assetQrRun_(false, 'setupV29'); }
// ใช้เมื่อลิงก์เว็บแอปเปลี่ยน (เช่น สร้าง Deployment ใหม่): สร้างรูป QR ของทุกรายการใหม่ด้วยลิงก์ปัจจุบัน แล้วต้องพิมพ์ป้ายใหม่ไปติด
function assetQrRegenerateAll() { return assetQrRun_(true, 'assetQrRegenerateAll'); }

// ---------- หน้าที่เปิดเมื่อสแกน QR (สาธารณะ — แสดงเฉพาะข้อมูลพื้นฐาน) ----------
function assetEsc_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function assetThDate_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return '-';
  const mo = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return (+m[3]) + ' ' + mo[+m[2] - 1] + ' ' + (+m[1] + 543);
}
function assetScanPage_(p, appUrl) {
  const id = String(p.id || ''), k = String(p.k || '');
  let o = null;
  try {
    const S = assetSheets_();
    o = assetReadAll_(S.reg).map(assetRowToObj_).filter(function (x) { return x.assetId === id && !x.voided; })[0] || null;
  } catch (e) { Logger.log('assetScanPage_: ' + e.message); }
  const valid = !!(o && o.qrKey && o.qrKey === k);
  let body;
  if (!valid) {
    body = '<h1>ไม่พบข้อมูลครุภัณฑ์</h1><p class="m">ป้าย QR นี้อาจถูกยกเลิกหรือถูกแทนที่ด้วยป้ายใหม่ กรุณาติดต่อเจ้าหน้าที่</p>';
  } else {
    const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    const lcFront = PropertiesService.getScriptProperties().getProperty('LC_FRONTEND_URL') || '';
    const cls = o.status === ASSET_STATUSES[0] ? 'ok' : (o.status === ASSET_STATUSES[4] ? 'off' : 'bad');
    let loanLine = '';
    if (o.loanable === 'Y') {
      let out = null;
      try { if (typeof lc_sheets_ === 'function') out = lc_openLoanMap_(lc_readLoans_(lc_sheets_().loan), today)[o.assetId] || null; } catch (e) {}
      loanLine = out ? 'ถูกยืมอยู่' + (out.dueDate ? ' · กำหนดคืน ' + assetThDate_(out.dueDate) : '')
        : (o.status === ASSET_STATUSES[0] ? 'พร้อมให้ยืม' : 'ยังให้ยืมไม่ได้ในขณะนี้');
    }
    const late = o.nextCheckDue && o.nextCheckDue <= today;
    const rowsHtml = [
      ['หมวด', o.category], ['สถานที่ตั้ง', o.location], ['ผู้รับผิดชอบ', o.custodian],
      ['ตรวจสภาพล่าสุด', o.lastCheckAt ? assetThDate_(o.lastCheckAt) + (o.lastCheckResult ? ' · ' + o.lastCheckResult : '') : 'ยังไม่เคยบันทึก'],
      ['ตรวจครั้งถัดไป', o.nextCheckDue ? assetThDate_(o.nextCheckDue) + (late ? ' (ถึงกำหนดแล้ว)' : '') : '-'],
      ['การยืม-คืน', loanLine]
    ].filter(function (r) { return r[1]; }).map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + assetEsc_(r[1]) + '</dd></div>'; }).join('');
    body = '<p class="no">' + (o.assetNo ? 'เลขครุภัณฑ์ ' + assetEsc_(o.assetNo) : 'ยังไม่มีเลขครุภัณฑ์') + '</p><h1>' + assetEsc_(o.name) + '</h1>' +
      '<p><span class="b ' + cls + '">' + assetEsc_(o.status) + '</span></p><dl>' + rowsHtml + '</dl>' +
      (lcFront ? '<a class="btn" target="_top" href="' + assetEsc_(lcFront + 'scan.html?id=' + encodeURIComponent(o.assetId) + '&k=' + encodeURIComponent(k)) + '">เปิดหน้าครุภัณฑ์ในศูนย์ยืม-คืน (ยืม / คืน / ตรวจสภาพ)</a>'
        : (appUrl ? '<a class="btn" href="' + assetEsc_(appUrl + '?asset=' + encodeURIComponent(o.assetId)) + '">เจ้าหน้าที่: เปิดดูในระบบ</a>' : ''));
  }
  const html = '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ข้อมูลครุภัณฑ์ — PT Station</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap" rel="stylesheet"><style>' +
    ':root{--bg:#f0f4f8;--card:#fff;--tx:#111827;--tx2:#4b5563;--bd:#e5e7eb;--pr:#1a56db;--ok:#047857;--bad:#b91c1c;--off:#6b7280;color-scheme:light dark}' +
    '@media(prefers-color-scheme:dark){:root{--bg:#0f172a;--card:#1e293b;--tx:#f1f5f9;--tx2:#cbd5e1;--bd:#334155;--pr:#93c5fd;--ok:#6ee7b7;--bad:#fca5a5;--off:#94a3b8}}' +
    '*{box-sizing:border-box}body{margin:0;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));background:var(--bg);color:var(--tx);font-family:"Sarabun","Noto Sans Thai",system-ui,sans-serif;line-height:1.55}' +
    'main{max-width:520px;margin:0 auto;background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:20px}' +
    '.no{margin:0 0 4px;font-size:.875rem;color:var(--pr);font-variant-numeric:tabular-nums}h1{margin:0 0 10px;font-size:1.375rem;line-height:1.35;overflow-wrap:anywhere}' +
    '.b{display:inline-block;padding:3px 12px;border-radius:99px;border:1px solid currentColor;font-size:.875rem;font-weight:600}.b.ok{color:var(--ok)}.b.bad{color:var(--bad)}.b.off{color:var(--off)}' +
    'dl{margin:16px 0 0}dl div{padding:8px 0;border-bottom:1px dashed var(--bd)}dt{font-size:.75rem;color:var(--tx2)}dd{margin:0;overflow-wrap:anywhere}' +
    '.m{color:var(--tx2)}.btn{display:flex;align-items:center;justify-content:center;min-height:48px;margin-top:20px;padding:10px 16px;border-radius:12px;background:var(--pr);color:#fff;text-decoration:none;font-weight:600;text-align:center}' +
    '@media(prefers-color-scheme:dark){.btn{color:#0f172a}}.btn:focus-visible{outline:3px solid var(--tx);outline-offset:2px}' +
    '.f{max-width:520px;margin:12px auto 0;text-align:center;font-size:.75rem;color:var(--tx2)}</style></head><body><main>' + body +
    '</main><p class="f">PT Station · ทะเบียนครุภัณฑ์ รพ.สต.บางขะแยง</p></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('ข้อมูลครุภัณฑ์ — PT Station').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
