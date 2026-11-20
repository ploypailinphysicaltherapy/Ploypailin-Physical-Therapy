/**
 * LoanCenter.gs — ศูนย์ยืม-คืนอุปกรณ์ / ทะเบียนครุภัณฑ์ + QR (Backend API)  v1.1.0
 * ไฟล์นี้เป็นไฟล์ที่ 2 ในโปรเจกต์ Apps Script เดียวกับ Code.gs (PT Station) — ใช้ Web App /exec ลิงก์เดียวกัน
 *
 * ภาพรวม
 *   · ฝั่งเจ้าหน้าที่ใช้งานจริงอยู่บน GitHub (โฟลเดอร์ /loan) เรียกมาที่นี่แบบ
 *       POST <WebApp>/exec   body = JSON (text/plain)   {"action":"...","token":"...","args":{...}}
 *       GET  <WebApp>/exec?action=ping | ?action=scan&id=A00001&k=xxxxxxxx
 *     Code.gs (doPost/doGet) ส่งต่อคำขอพวกนี้มาที่ lcDoPost_ / lcDoGet_ ในไฟล์นี้
 *   · ฝั่ง Apps Script (index.html เมนู "ศูนย์ควบคุมอุปกรณ์") เป็นระบบแอดมินไว้ "ดู" อย่างเดียว
 *     เรียก lcAdminOverview() ผ่าน google.script.run
 *   · ชื่อฟังก์ชัน/ค่าคงที่ทั้งหมดขึ้นต้น lc / LC_ เพื่อไม่ชนกับ Code.gs
 *
 * ความปลอดภัย: ตรวจสิทธิ์ที่เซิร์ฟเวอร์ทุกครั้ง (PIN → token อายุ 6 ชม. เก็บใน CacheService)
 *   ชื่อผู้ทำรายการในประวัติมาจาก session ไม่เชื่อค่าที่ client ส่งมา
 *   action สาธารณะมีแค่ ping / login / scan (scan ต้องมีคีย์สุ่มของป้าย QR และไม่เปิดเผยราคา/Serial/ชื่อผู้ยืม)
 *
 * ตั้งค่าครั้งแรก: แก้ lcSetConfig() แล้ว Run → Run lcSetupLoanCenter() → Deploy เวอร์ชันใหม่ของ Web App
 */


const LC_APP_VERSION = '1.2.0';
const LC_SCHEMA_VER = '1';
const LC_SESSION_TTL = 21600;          // วินาที (สูงสุดของ CacheService = 6 ชม.)
const LC_LOGIN_MAX_FAIL = 5;           // ใส่ PIN ผิดครบนี้ → ล็อกการเข้าสู่ระบบชั่วคราว
const LC_LOGIN_LOCK_SEC = 600;
const LC_MAX_BODY = 6000000;           // ตัวอักษร (รูปแนบ ≤ 3 MB เป็น base64)
const LC_DEFAULT_LOAN_DAYS = 7;
const LC_MAX_LOAN_DAYS = 90;
const LC_THUMB_MAX = 20000;            // ตัวอักษรของรูปย่อ (data URI) ที่เก็บในชีต


const LC_DATE_KEYS = ['acquireDate','warrantyEnd','calibDue','nextCheckDue','loanDate','dueDate','returnDate'];
const LC_LOG_HEADERS = ['ts','assetId','assetNo','action','by','detail'];
const LC_LOAN_HEADERS = ['loanId','assetId','assetNo','assetName','borrowerName','borrowerHN','phone','loanDate','dueDate','returnDate','status','conditionOut','conditionIn','note','createdAt','createdBy','updatedAt','borrowerType','returnedBy'];
const LC_CHECK_HEADERS = ['checkId','ts','assetId','assetNo','assetName','result','note','by','nextDue'];

const LC_STATUSES = ['ใช้งานได้','ชำรุด / รอซ่อม','ส่งซ่อม','รอจำหน่าย','จำหน่ายแล้ว'];
const LC_CHECK_RESULTS = ['ปกติ','ต้องปรับปรุง / ซ่อมเล็กน้อย','ชำรุด ใช้งานไม่ได้'];
const LC_BORROWER_TYPES = ['บุคลากร','ผู้ป่วย / ญาติ','อสม. / ชุมชน','หน่วยงานอื่น'];
const LC_ACQUIRE_METHODS = ['ซื้อ','บริจาค','โอน / รับโอน','ยืมใช้','อื่นๆ'];
const LC_LOAN_OPEN = 'ยืมอยู่';
const LC_LOAN_DONE = 'คืนแล้ว';

// ================================================================
//  ข้อผิดพลาด / ยูทิลิตี
// ================================================================
class LcApiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
function lc_bad_(msg) { return new LcApiError('BAD_REQUEST', msg); }

function lc_prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function lc_txt_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().substring(0, max || 200); }
function lc_nowStr_() { return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); }
function lc_today_() { return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'); }
function lc_isoOk_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
function lc_date_(v) { v = String(v || '').trim(); return lc_isoOk_(v) ? v : ''; }
function lc_addDays_(iso, n) { const m = iso.split('-'); return new Date(Date.UTC(+m[0], +m[1] - 1, +m[2] + n)).toISOString().slice(0, 10); }
function lc_daysBetween_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function lc_val_(v, key) {
  if (v instanceof Date) return Utilities.formatDate(v, TIMEZONE, LC_DATE_KEYS.indexOf(key) >= 0 ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  return v == null ? '' : v;
}
function lc_withLock_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { throw new LcApiError('BUSY', 'ระบบกำลังบันทึกข้อมูลของผู้ใช้อื่นอยู่ กรุณาลองใหม่อีกครั้ง'); }
  try { return fn(); } finally { try { lock.releaseLock(); } catch (e) {} }
}

// ================================================================
//  ชีต
// ================================================================
function lc_ss_() { return getSpreadsheet(); }
function lc_ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  const cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  const out = headers.map(function (h, i) { return cur[i] || h; });
  if (out.some(function (v, i) { return v !== cur[i]; })) sh.getRange(1, 1, 1, headers.length).setValues([out]).setFontWeight('bold');
  try { sh.setFrozenRows(1); } catch (e) {}
  return sh;
}
function lc_sheets_() {
  const ss = lc_ss_(), p = PropertiesService.getScriptProperties();
  const names = ['AssetRegister', 'AssetLog', 'AssetLoans', 'AssetChecks'];
  let ok = p.getProperty('LC_SCHEMA_VER') === LC_SCHEMA_VER;
  names.forEach(function (n) { if (!ss.getSheetByName(n)) ok = false; });
  if (!ok) {
    lc_ensureSheet_(ss, 'AssetRegister', ASSET_HEADERS); lc_ensureSheet_(ss, 'AssetLog', LC_LOG_HEADERS);
    lc_ensureSheet_(ss, 'AssetLoans', LC_LOAN_HEADERS); lc_ensureSheet_(ss, 'AssetChecks', LC_CHECK_HEADERS);
    p.setProperty('LC_SCHEMA_VER', LC_SCHEMA_VER);
  }
  return { reg: ss.getSheetByName('AssetRegister'), log: ss.getSheetByName('AssetLog'), loan: ss.getSheetByName('AssetLoans'), chk: ss.getSheetByName('AssetChecks') };
}
function lc_ix_() { const o = {}; ASSET_HEADERS.forEach(function (h, i) { o[h] = i; }); return o; }

function lc_readAssets_(sh) { const last = sh.getLastRow(); return last >= 2 ? sh.getRange(2, 1, last - 1, ASSET_HEADERS.length).getValues() : []; }
function lc_rowToAsset_(row) {
  const o = {};
  ASSET_HEADERS.forEach(function (h, i) { o[h] = lc_val_(row[i], h); });
  o.unitPrice = o.unitPrice === '' ? '' : Number(o.unitPrice) || 0;
  o.lifeYears = o.lifeYears === '' ? '' : Number(o.lifeYears) || 0;
  o.checkIntervalDays = o.checkIntervalDays === '' ? '' : Number(o.checkIntervalDays) || 0;
  o.voided = String(o.voided) === 'Y';
  let ids = []; try { ids = JSON.parse(o.photoIds || '[]'); } catch (e) {}
  o.photoIds = Array.isArray(ids) ? ids : [];
  delete o.qrImg; delete o.qrFileId;
  return o;
}
function lc_writeAssetRow_(sh, rowNo, arr) {
  const fm = ASSET_HEADERS.map(function (h) { return h === 'unitPrice' ? '#,##0.00' : ((h === 'lifeYears' || h === 'checkIntervalDays') ? '0' : '@'); });
  const qi = ASSET_HEADERS.indexOf('qrImg');   // เซลล์รูป QR — ห้ามเขียนทับ
  [[0, qi], [qi + 1, ASSET_HEADERS.length]].forEach(function (s) {
    if (s[1] <= s[0]) return;
    const rg = sh.getRange(rowNo, s[0] + 1, 1, s[1] - s[0]);
    rg.setNumberFormats([fm.slice(s[0], s[1])]); rg.setValues([arr.slice(s[0], s[1])]);
  });
}
function lc_findRow_(rows, id) {
  const k = lc_ix_().assetId;
  for (let i = 0; i < rows.length; i++) if (String(rows[i][k]) === String(id)) return i;
  return -1;
}
function lc_log_(sh, assetId, assetNo, action, by, detail) {
  const t = typeof detail === 'string' ? detail : JSON.stringify(detail || {});
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, LC_LOG_HEADERS.length).setNumberFormats([['@','@','@','@','@','@']]).setValues([[lc_nowStr_(), assetId, assetNo, action, by, t.substring(0, 1500)]]);
}
function lc_driveFolder_(propKey, name) {
  const p = PropertiesService.getScriptProperties(), id = p.getProperty(propKey);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* สร้างใหม่ */ } }
  const it = DriveApp.getFoldersByName(name);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  p.setProperty(propKey, f.getId());
  return f;
}

// ================================================================
//  ตั้งค่า (รันจากตัวแก้ไข Apps Script)
// ================================================================
function lc_hashPin_(pin, salt) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return d.map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}
function lc_safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * ✏️ ตั้งค่าครั้งแรก — แก้ค่าด้านล่าง แล้วกด Run lcSetConfig ครั้งเดียว (เสร็จแล้วลบ PIN ออกจากโค้ดทันที)
 *   FRONTEND_URL : ลิงก์หน้าเว็บศูนย์ยืม-คืนบน GitHub Pages (ลงท้ายด้วย /) — ใช้เป็นปลายทางของ QR
 *   ADMIN_PIN    : รหัสผู้ดูแล (อย่างน้อย 6 ตัว) — มีสิทธิ์เดียว ทำได้ทุกอย่าง: ยืม/คืน ตรวจสภาพ เพิ่ม/แก้ครุภัณฑ์ พิมพ์ QR ยกเลิกรายการ
 * ชีตที่ใช้คือ SPREADSHEET_ID เดียวกับ Code.gs (PT Station) — ไม่ต้องตั้งซ้ำ
 */
function lcSetConfig() {
  const CFG = {
    FRONTEND_URL: 'https://ploypailinphysicaltherapy.github.io/Ploypailin-Physical-Therapy/loan/',
    ADMIN_PIN: ''
  };
  const p = PropertiesService.getScriptProperties();
  if (CFG.FRONTEND_URL) {
    let u = CFG.FRONTEND_URL.trim();
    if (!/^https:\/\//.test(u)) throw new Error('FRONTEND_URL ต้องขึ้นต้นด้วย https://');
    if (u.slice(-1) !== '/') u += '/';
    p.setProperty('LC_FRONTEND_URL', u);
  }
  if (CFG.ADMIN_PIN) {
    if (String(CFG.ADMIN_PIN).length < 6) throw new Error('PIN ต้องมีอย่างน้อย 6 ตัวอักษร');
    const salt = Utilities.getUuid();
    p.setProperty('LC_PIN_SALT', salt);
    p.setProperty('LC_ADMIN_PIN_HASH', lc_hashPin_(String(CFG.ADMIN_PIN), salt));
    p.deleteProperty('LC_STAFF_PIN_HASH');   // เลิกใช้รหัสเจ้าหน้าที่ (ถ้าเคยตั้งไว้)
  }
  Logger.log('บันทึกการตั้งค่าแล้ว — ลบ ADMIN_PIN ออกจากโค้ดได้เลย แล้วรัน lcSetupLoanCenter()');
}

function lcSetupLoanCenter() {
  const S = lc_sheets_();
  const rep = {
    spreadsheet: lc_ss_().getName(),
    sheets: ['AssetRegister', 'AssetLog', 'AssetLoans', 'AssetChecks'],
    frontendUrl: lc_prop_('LC_FRONTEND_URL') || '(ยังไม่ตั้ง — รัน lcSetConfig)',
    pinsSet: !!lc_prop_('LC_ADMIN_PIN_HASH'),
    assets: Math.max(0, S.reg.getLastRow() - 1)
  };
  if (rep.frontendUrl.charAt(0) === '(') Logger.log('⚠ ยังไม่ได้ตั้ง FRONTEND_URL');
  if (!rep.pinsSet) Logger.log('⚠ ยังไม่ได้ตั้ง PIN');
  Logger.log(JSON.stringify(rep));
  return rep;
}
/** สร้าง QR ให้ครุภัณฑ์ทุกรายการที่ยังไม่มี (รันจากตัวแก้ไข ใช้ตอนนำเข้าข้อมูลเก่า) */
function lcBackfillQr() { return lc_qrRun_(false, 'backfillQr'); }
/** ใช้เมื่อ FRONTEND_URL เปลี่ยน: สร้างรูป QR ของทุกรายการใหม่ แล้วต้องพิมพ์ป้ายใหม่ไปติด */
function lcRegenerateAllQr() { return lc_qrRun_(true, 'regenerateAllQr'); }

// ================================================================
//  ระบบสิทธิ์ (PIN → token)
// ================================================================
function lc_apiLogin_(a) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('LC_LOGIN_FAILS') || 0);
  if (fails >= LC_LOGIN_MAX_FAIL) throw new LcApiError('LOCKED', 'ใส่รหัสผิดหลายครั้ง ระบบล็อกการเข้าสู่ระบบชั่วคราว 10 นาที');
  const name = lc_txt_(a.name, 60), pin = String(a.pin == null ? '' : a.pin);
  if (name.length < 2) throw lc_bad_('กรุณากรอกชื่อผู้ใช้งาน (อย่างน้อย 2 ตัวอักษร)');
  const salt = lc_prop_('LC_PIN_SALT'), ah = lc_prop_('LC_ADMIN_PIN_HASH');
  if (!salt || !ah) throw new LcApiError('CONFIG', 'ระบบยังไม่ได้ตั้งรหัสผ่าน — ผู้ดูแลต้องรัน lcSetConfig() ใน Apps Script');
  const h = lc_hashPin_(pin, salt);
  let role = '';
  if (ah && lc_safeEq_(h, ah)) role = 'admin';
  if (!role) { cache.put('LC_LOGIN_FAILS', String(fails + 1), LC_LOGIN_LOCK_SEC); throw new LcApiError('AUTH', 'รหัสผ่านไม่ถูกต้อง'); }
  cache.remove('LC_LOGIN_FAILS');
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('LC_S_' + token, JSON.stringify({ name: name, role: role, at: Date.now() }), LC_SESSION_TTL);
  return { token: token, name: name, role: role, expiresIn: LC_SESSION_TTL };
}
function lc_session_(token, need) {
  token = String(token || '');
  if (!/^[0-9a-f]{64}$/.test(token)) throw new LcApiError('AUTH_REQUIRED', 'กรุณาเข้าสู่ระบบ');
  const raw = CacheService.getScriptCache().get('LC_S_' + token);
  if (!raw) throw new LcApiError('AUTH_REQUIRED', 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
  const s = JSON.parse(raw);
  if (need === 'admin' && s.role !== 'admin') throw new LcApiError('FORBIDDEN', 'ต้องใช้สิทธิ์ผู้ดูแลระบบ');
  s.token = token;
  return s;
}
function lc_apiLogout_(a, s) { CacheService.getScriptCache().remove('LC_S_' + s.token); return { ok: true }; }

// ================================================================
//  ตัวรับคำขอ
// ================================================================
const LC_ROUTES = {
  ping:        { role: '',      fn: function () { return { name: 'Equipment Loan Center', version: LC_APP_VERSION, time: lc_nowStr_(), configured: { frontend: !!lc_prop_('LC_FRONTEND_URL'), pins: !!lc_prop_('LC_ADMIN_PIN_HASH') } }; } },
  login:       { role: '',      fn: lc_apiLogin_ },
  scan:        { role: '',      fn: lc_apiScan_ },
  requestCatalog: { role: '',   fn: lc_apiReqCatalog_ },
  requestCreate:  { role: '',   fn: lc_apiReqCreate_ },
  requestStatus:  { role: '',   fn: lc_apiReqStatus_ },
  logout:      { role: 'admin', fn: lc_apiLogout_ },
  me:          { role: 'admin', fn: function (a, s) { return { name: s.name, role: s.role }; } },
  config:      { role: 'admin', fn: lc_apiConfig_ },
  dashboard:   { role: 'admin', fn: lc_apiDashboard_ },
  assetList:   { role: 'admin', fn: lc_apiAssetList_ },
  assetGet:    { role: 'admin', fn: lc_apiAssetGet_ },
  assetSave:   { role: 'admin', fn: lc_apiAssetSave_ },
  assetAddPhoto:    { role: 'admin', fn: lc_apiAddPhoto_ },
  assetGetPhoto:    { role: 'admin', fn: lc_apiGetPhoto_ },
  assetRemovePhoto: { role: 'admin', fn: lc_apiRemovePhoto_ },
  assetQrBatch:     { role: 'admin', fn: lc_apiQrBatch_ },
  assetQrPrintLog:  { role: 'admin', fn: lc_apiQrPrintLog_ },
  assetCheckSave:   { role: 'admin', fn: lc_apiCheckSave_ },
  assetCheckList:   { role: 'admin', fn: lc_apiCheckList_ },
  assetLogList:     { role: 'admin', fn: lc_apiLogList_ },
  loanList:      { role: 'admin', fn: lc_apiLoanList_ },
  loanCheckout:  { role: 'admin', fn: lc_apiLoanCheckout_ },
  loanReturn:    { role: 'admin', fn: lc_apiLoanReturn_ },
  loanExtend:    { role: 'admin', fn: lc_apiLoanExtend_ },
  assetVoid:     { role: 'admin', fn: lc_apiAssetVoid_ }
};
function lc_handle_(req) {
  if (!req || typeof req !== 'object') throw lc_bad_('คำขอไม่ถูกต้อง');
  const def = Object.prototype.hasOwnProperty.call(LC_ROUTES, req.action) ? LC_ROUTES[req.action] : null;
  if (!def) throw lc_bad_('ไม่รู้จักคำสั่งนี้');
  const s = def.role ? lc_session_(req.token, def.role) : null;
  const args = (req.args && typeof req.args === 'object') ? req.args : {};
  return def.fn(args, s);
}
function lc_out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function lc_errOut_(err) {
  if (err instanceof LcApiError) return { ok: false, code: err.code, error: err.message };
  Logger.log('INTERNAL: ' + (err && err.stack || err));
  return { ok: false, code: 'INTERNAL', error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ หากยังเป็นอีกให้แจ้งผู้ดูแล' };
}

// ================================================================
//  Config / Dashboard / รายการ
// ================================================================
function lc_apiConfig_() {
  return {
    statuses: LC_STATUSES, checkResults: LC_CHECK_RESULTS, borrowerTypes: LC_BORROWER_TYPES, acquireMethods: LC_ACQUIRE_METHODS,
    defaultLoanDays: LC_DEFAULT_LOAN_DAYS, maxLoanDays: LC_MAX_LOAN_DAYS, frontendUrl: lc_prop_('LC_FRONTEND_URL'), today: lc_today_()
  };
}
function lc_loanRowToObj_(r) {
  const o = {}; LC_LOAN_HEADERS.forEach(function (h, i) { o[h] = lc_val_(r[i], h); });
  return o;
}
function lc_readLoans_(sh) {
  const last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, LC_LOAN_HEADERS.length).getValues().map(lc_loanRowToObj_);
}
function lc_decorateLoan_(l, today) {
  const open = l.status === LC_LOAN_OPEN;
  l.overdue = open && !!l.dueDate && l.dueDate < today;
  l.daysLate = l.overdue ? lc_daysBetween_(l.dueDate, today) : 0;
  l.daysLeft = open && l.dueDate ? lc_daysBetween_(today, l.dueDate) : null;
  return l;
}
function lc_openLoanMap_(loans, today) {
  const m = {};
  loans.forEach(function (l) { if (l.status === LC_LOAN_OPEN) m[l.assetId] = lc_decorateLoan_(l, today); });
  return m;
}
function lc_checkInfo_(o, today) {
  if (o.status === LC_STATUSES[4]) return false;
  if (!o.checkIntervalDays && !o.nextCheckDue) return false;
  if (!o.lastCheckAt) return !!o.checkIntervalDays;
  return !!o.nextCheckDue && o.nextCheckDue <= today;
}
function lc_liveAssets_(S) { return lc_readAssets_(S.reg).map(lc_rowToAsset_).filter(function (o) { return !o.voided; }); }

function lc_apiAssetList_() {
  const S = lc_sheets_(), today = lc_today_(), open = lc_openLoanMap_(lc_readLoans_(S.loan), today);
  return lc_liveAssets_(S).map(function (o) {
    o.loan = open[o.assetId] ? lc_publicLoan_(open[o.assetId]) : null;
    o.checkDue = lc_checkInfo_(o, today);
    return o;
  });
}
function lc_publicLoan_(l) {
  return { loanId: l.loanId, borrowerName: l.borrowerName, borrowerType: l.borrowerType, phone: l.phone, loanDate: l.loanDate, dueDate: l.dueDate, overdue: l.overdue, daysLate: l.daysLate, daysLeft: l.daysLeft };
}
function lc_apiAssetGet_(a) {
  const S = lc_sheets_(), today = lc_today_();
  const rows = lc_readAssets_(S.reg), i = lc_findRow_(rows, a.id);
  if (i < 0) throw lc_bad_('ไม่พบรายการ');
  const o = lc_rowToAsset_(rows[i]);
  const loans = lc_readLoans_(S.loan).filter(function (l) { return l.assetId === o.assetId; }).map(function (l) { return lc_decorateLoan_(l, today); }).reverse();
  const cur = loans.filter(function (l) { return l.status === LC_LOAN_OPEN; })[0] || null;
  o.loan = cur ? lc_publicLoan_(cur) : null;
  o.checkDue = lc_checkInfo_(o, today);
  o.loans = loans.slice(0, 15);
  const lg = [], last = S.log.getLastRow();
  if (last >= 2) {
    const lr = S.log.getRange(2, 1, last - 1, LC_LOG_HEADERS.length).getValues();
    for (let k = lr.length - 1; k >= 0 && lg.length < 40; k--) {
      if (String(lr[k][1]) === o.assetId) lg.push({ ts: lc_val_(lr[k][0], 'ts'), action: lr[k][3], by: lr[k][4], detail: lr[k][5] });
    }
  }
  o.log = lg;
  return o;
}
function lc_apiDashboard_() {
  const S = lc_sheets_(), today = lc_today_();
  const loans = lc_readLoans_(S.loan), open = lc_openLoanMap_(loans, today), assets = lc_liveAssets_(S);
  const d = { today: today, total: 0, available: 0, onLoan: 0, overdue: 0, broken: 0, checkDue: 0, noQr: 0, overdueLoans: [], dueSoon: [], checkList: [], noQrList: [] };
  assets.forEach(function (o) {
    if (o.status === LC_STATUSES[4]) return;
    d.total++;
    const l = open[o.assetId];
    if (l) { d.onLoan++; } else if (o.status === LC_STATUSES[0] && o.loanable === 'Y') d.available++;
    if (o.status !== LC_STATUSES[0]) d.broken++;
    if (!o.qrText) { d.noQr++; if (d.noQrList.length < 12) d.noQrList.push({ assetId: o.assetId, assetNo: o.assetNo, name: o.name }); }
    if (lc_checkInfo_(o, today)) { d.checkDue++; if (d.checkList.length < 12) d.checkList.push({ assetId: o.assetId, assetNo: o.assetNo, name: o.name, nextCheckDue: o.nextCheckDue, never: !o.lastCheckAt }); }
  });
  Object.keys(open).forEach(function (id) {
    const l = open[id], row = { loanId: l.loanId, assetId: l.assetId, assetNo: l.assetNo, assetName: l.assetName, borrowerName: l.borrowerName, phone: l.phone, dueDate: l.dueDate, daysLate: l.daysLate, daysLeft: l.daysLeft };
    if (l.overdue) { d.overdue++; d.overdueLoans.push(row); } else if (l.daysLeft !== null && l.daysLeft <= 2) d.dueSoon.push(row);
  });
  d.overdueLoans.sort(function (x, y) { return y.daysLate - x.daysLate; });
  d.dueSoon.sort(function (x, y) { return x.daysLeft - y.daysLeft; });
  return d;
}

// ================================================================
//  เพิ่ม / แก้ครุภัณฑ์
// ================================================================
function lc_cleanAsset_(d) {
  const price = Number(d.unitPrice), life = Number(d.lifeYears), iv = Number(d.checkIntervalDays);
  return {
    assetNo: lc_txt_(d.assetNo, 60), name: lc_txt_(d.name, 160), category: lc_txt_(d.category, 60),
    brand: lc_txt_(d.brand, 80), model: lc_txt_(d.model, 80), serialNo: lc_txt_(d.serialNo, 80), spec: lc_txt_(d.spec, 500),
    acquireMethod: lc_txt_(d.acquireMethod, 40), fundSource: lc_txt_(d.fundSource, 60),
    unitPrice: (d.unitPrice === '' || d.unitPrice == null || !isFinite(price) || price < 0) ? '' : Math.round(price * 100) / 100,
    acquireDate: lc_date_(d.acquireDate), docRef: lc_txt_(d.docRef, 100), vendor: lc_txt_(d.vendor, 120), warrantyEnd: lc_date_(d.warrantyEnd),
    lifeYears: (d.lifeYears === '' || d.lifeYears == null || !isFinite(life) || life < 0) ? '' : Math.round(life),
    location: lc_txt_(d.location, 100), custodian: lc_txt_(d.custodian, 100),
    status: LC_STATUSES.indexOf(d.status) >= 0 ? d.status : LC_STATUSES[0],
    loanable: d.loanable === 'Y' ? 'Y' : 'N', calibDue: lc_date_(d.calibDue), remark: lc_txt_(d.remark, 500),
    checkIntervalDays: (d.checkIntervalDays === '' || d.checkIntervalDays == null || !isFinite(iv) || iv <= 0) ? '' : Math.min(3650, Math.round(iv))
  };
}
function lc_apiAssetSave_(d, s) {
  const c = lc_cleanAsset_(d), by = s.name;
  if (!c.name) throw lc_bad_('กรุณากรอกชื่อรายการ');
  const S = lc_sheets_(), sh = S.reg, ix = lc_ix_();
  return lc_withLock_(function () {
    const rows = lc_readAssets_(sh), editId = lc_txt_(d.assetId, 20);
    let rowIdx = -1, maxN = 0;
    rows.forEach(function (r, i) {
      const id = String(r[ix.assetId]), m = /^A(\d+)$/.exec(id);
      if (m) maxN = Math.max(maxN, Number(m[1]));
      if (editId && id === editId) rowIdx = i;
    });
    if (c.assetNo) {
      const key = c.assetNo.toLowerCase();
      rows.forEach(function (r) {
        if (String(r[ix.voided]) !== 'Y' && String(r[ix.assetNo]).trim().toLowerCase() === key && String(r[ix.assetId]) !== editId)
          throw lc_bad_('เลขครุภัณฑ์ซ้ำกับรายการ: ' + r[ix.name]);
      });
    }
    const now = lc_nowStr_();
    if (editId) {
      if (rowIdx < 0) throw lc_bad_('ไม่พบรายการ');
      const old = rows[rowIdx];
      if (String(old[ix.voided]) === 'Y') throw lc_bad_('รายการนี้ถูกยกเลิกแล้ว');
      const oldNo = String(old[ix.assetNo] || '').trim();
      if (oldNo && oldNo !== c.assetNo) throw lc_bad_('เลขครุภัณฑ์แก้ไขไม่ได้ เพื่อให้ตรวจสอบย้อนหลังได้');
      const nu = old.slice(), diff = {};
      ASSET_FIELDS.forEach(function (k) {
        const ov = lc_val_(old[ix[k]], k);
        if (String(ov) !== String(c[k])) diff[k] = [ov, c[k]];
        nu[ix[k]] = c[k];
      });
      if (!Object.keys(diff).length) return { assetId: editId, changed: false };
      nu[ix.updatedAt] = now; nu[ix.updatedBy] = by;
      lc_writeAssetRow_(sh, rowIdx + 2, nu);
      lc_log_(S.log, editId, c.assetNo || oldNo, 'update', by, diff);
      return { assetId: editId, changed: true };
    }
    const id = 'A' + ('00000' + (maxN + 1)).slice(-5);
    const row = ASSET_HEADERS.map(function () { return ''; });
    ASSET_FIELDS.forEach(function (k) { row[ix[k]] = c[k]; });
    row[ix.assetId] = id; row[ix.photoIds] = '[]';
    row[ix.createdAt] = now; row[ix.createdBy] = by; row[ix.updatedAt] = now; row[ix.updatedBy] = by;
    const newRowNo = sh.getLastRow() + 1;
    lc_writeAssetRow_(sh, newRowNo, row);
    lc_log_(S.log, id, c.assetNo, 'create', by, { name: c.name, status: c.status });
    let qrError = '';
    try { lc_qrApply_(S, newRowNo, row, by, false); } catch (qe) { qrError = qe.message; Logger.log('auto QR ' + id + ': ' + qe.message); }
    return { assetId: id, created: true, qrError: qrError };
  });
}
function lc_apiAssetVoid_(a, s) {
  const reason = lc_txt_(a.reason, 300);
  if (!reason) throw lc_bad_('กรุณาระบุเหตุผลที่ยกเลิก');
  const S = lc_sheets_(), ix = lc_ix_();
  return lc_withLock_(function () {
    const rows = lc_readAssets_(S.reg), i = lc_findRow_(rows, a.id);
    if (i < 0) throw lc_bad_('ไม่พบรายการ');
    if (lc_readLoans_(S.loan).some(function (l) { return l.assetId === String(a.id) && l.status === LC_LOAN_OPEN; })) throw lc_bad_('รายการนี้ยังถูกยืมอยู่ ต้องรับคืนก่อนจึงจะยกเลิกได้');
    const r = i + 2;
    S.reg.getRange(r, ix.voided + 1).setNumberFormat('@').setValue('Y');
    S.reg.getRange(r, ix.updatedAt + 1, 1, 2).setNumberFormat('@').setValues([[lc_nowStr_(), s.name]]);
    lc_log_(S.log, String(a.id), String(rows[i][ix.assetNo] || ''), 'void', s.name, { reason: reason });
    return { ok: true };
  });
}

// ================================================================
//  รูปภาพ
// ================================================================
function lc_apiAddPhoto_(a, s) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(a.full || ''));
  if (!m) throw lc_bad_('ไฟล์รูปไม่ถูกต้อง');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 3000000) throw lc_bad_('รูปใหญ่เกิน 3 MB');
  const S = lc_sheets_(), ix = lc_ix_();
  return lc_withLock_(function () {
    const rows = lc_readAssets_(S.reg), i = lc_findRow_(rows, a.id);
    if (i < 0) throw lc_bad_('ไม่พบรายการ');
    const o = lc_rowToAsset_(rows[i]);
    if (o.voided) throw lc_bad_('รายการนี้ถูกยกเลิกแล้ว');
    if (o.photoIds.length >= 12) throw lc_bad_('แนบรูปได้สูงสุด 12 รูปต่อรายการ');
    const ext = m[1] === 'image/png' ? 'png' : (m[1] === 'image/webp' ? 'webp' : 'jpg');
    const name = String(o.assetNo || o.assetId).replace(/[^A-Za-z0-9ก-๙_.-]/g, '_') + '_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmmss') + '_' + (o.photoIds.length + 1) + '.' + ext;
    const file = lc_driveFolder_('ASSET_PHOTO_FOLDER_ID', ASSET_FOLDER_NAME).createFile(Utilities.newBlob(bytes, m[1], name));
    o.photoIds.push(file.getId());
    const r = i + 2;
    S.reg.getRange(r, ix.photoIds + 1).setNumberFormat('@').setValue(JSON.stringify(o.photoIds));
    const th = String(a.thumb || '');
    if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(th) && th.length <= LC_THUMB_MAX && !o.thumb) S.reg.getRange(r, ix.thumb + 1).setNumberFormat('@').setValue(th);
    S.reg.getRange(r, ix.updatedAt + 1, 1, 2).setNumberFormat('@').setValues([[lc_nowStr_(), s.name]]);
    lc_log_(S.log, o.assetId, o.assetNo, 'photo_add', s.name, { fileId: file.getId() });
    return { fileId: file.getId(), count: o.photoIds.length };
  });
}
function lc_apiGetPhoto_(a) {
  const fileId = lc_txt_(a.fileId, 80);
  if (!/^[\w-]{10,}$/.test(fileId)) throw lc_bad_('รหัสรูปไม่ถูกต้อง');
  const folderId = lc_driveFolder_('ASSET_PHOTO_FOLDER_ID', ASSET_FOLDER_NAME).getId(), f = DriveApp.getFileById(fileId);
  let ok = false; const ps = f.getParents();
  while (ps.hasNext()) { if (ps.next().getId() === folderId) ok = true; }
  if (!ok) throw new LcApiError('FORBIDDEN', 'ไม่อนุญาต');
  const b = f.getBlob();
  return { dataUri: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
}
function lc_apiRemovePhoto_(a, s) {
  const S = lc_sheets_(), ix = lc_ix_();
  return lc_withLock_(function () {
    const rows = lc_readAssets_(S.reg), i = lc_findRow_(rows, a.id);
    if (i < 0) throw lc_bad_('ไม่พบรายการ');
    const o = lc_rowToAsset_(rows[i]);
    const left = o.photoIds.filter(function (x) { return x !== a.fileId; });
    if (left.length === o.photoIds.length) throw lc_bad_('ไม่พบรูปนี้ในรายการ');
    const r = i + 2;
    S.reg.getRange(r, ix.photoIds + 1).setNumberFormat('@').setValue(JSON.stringify(left));
    if (!left.length) S.reg.getRange(r, ix.thumb + 1).setNumberFormat('@').setValue('');
    S.reg.getRange(r, ix.updatedAt + 1, 1, 2).setNumberFormat('@').setValues([[lc_nowStr_(), s.name]]);
    lc_log_(S.log, o.assetId, o.assetNo, 'photo_del', s.name, { fileId: a.fileId });   // ไฟล์ยังอยู่ใน Drive เป็นหลักฐาน
    return { count: left.length };
  });
}
function lc_apiLogList_(a) {
  const S = lc_sheets_(), n = Math.max(1, Math.min(300, Number(a.limit) || 120)), last = S.log.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - n + 1);
  return S.log.getRange(start, 1, last - start + 1, LC_LOG_HEADERS.length).getValues().reverse().map(function (r) {
    return { ts: lc_val_(r[0], 'ts'), assetId: r[1], assetNo: r[2], action: r[3], by: r[4], detail: r[5] };
  });
}

// ================================================================
//  ยืม - คืน
// ================================================================
function lc_lix_() { const o = {}; LC_LOAN_HEADERS.forEach(function (h, i) { o[h] = i; }); return o; }
function lc_apiLoanList_(a) {
  const S = lc_sheets_(), today = lc_today_(), scope = a.scope === 'all' ? 'all' : 'open';
  let list = lc_readLoans_(S.loan).map(function (l) { return lc_decorateLoan_(l, today); });
  if (scope === 'open') {
    list = list.filter(function (l) { return l.status === LC_LOAN_OPEN; });
    list.sort(function (x, y) { return (y.daysLate - x.daysLate) || String(x.dueDate).localeCompare(String(y.dueDate)); });
    return list;
  }
  return list.reverse().slice(0, Math.max(1, Math.min(500, Number(a.limit) || 200)));
}
function lc_apiLoanCheckout_(d, s) {
  const name = lc_txt_(d.borrowerName, 100);
  if (name.length < 2) throw lc_bad_('กรุณากรอกชื่อผู้ยืม');
  const type = LC_BORROWER_TYPES.indexOf(d.borrowerType) >= 0 ? d.borrowerType : '';
  if (!type) throw lc_bad_('กรุณาเลือกประเภทผู้ยืม');
  const phone = lc_txt_(d.phone, 20);
  if (phone && !/^[0-9+\-\s()]+$/.test(phone)) throw lc_bad_('เบอร์โทรไม่ถูกต้อง');
  const today = lc_today_(), loanDate = lc_date_(d.loanDate) || today, dueDate = lc_date_(d.dueDate);
  if (loanDate > today) throw lc_bad_('วันที่ยืมต้องไม่เกินวันนี้');
  if (!dueDate) throw lc_bad_('กรุณาระบุวันกำหนดคืน');
  if (dueDate < loanDate) throw lc_bad_('วันกำหนดคืนต้องไม่ก่อนวันที่ยืม');
  if (lc_daysBetween_(loanDate, dueDate) > LC_MAX_LOAN_DAYS) throw lc_bad_('ยืมได้นานสุด ' + LC_MAX_LOAN_DAYS + ' วัน หากต้องการนานกว่านี้ให้ต่อกำหนดคืนภายหลัง');
  const S = lc_sheets_();
  return lc_withLock_(function () {
    const rows = lc_readAssets_(S.reg), i = lc_findRow_(rows, d.assetId);
    if (i < 0) throw lc_bad_('ไม่พบรายการ');
    const a = lc_rowToAsset_(rows[i]);
    if (a.voided) throw lc_bad_('รายการนี้ถูกยกเลิกแล้ว');
    if (a.loanable !== 'Y') throw lc_bad_('รายการนี้ไม่ได้กำหนดให้ยืม (แก้ไขรายการแล้วเปิด "ให้ยืมได้" ก่อน)');
    if (a.status !== LC_STATUSES[0]) throw lc_bad_('รายการนี้ยังไม่พร้อมให้ยืม (สถานะ: ' + a.status + ')');
    const loans = lc_readLoans_(S.loan);
    if (loans.some(function (l) { return l.assetId === a.assetId && l.status === LC_LOAN_OPEN; })) throw lc_bad_('รายการนี้ถูกยืมอยู่แล้ว');
    let maxN = 0; loans.forEach(function (l) { const m = /^L(\d+)$/.exec(String(l.loanId)); if (m) maxN = Math.max(maxN, Number(m[1])); });
    const id = 'L' + ('00000' + (maxN + 1)).slice(-5), now = lc_nowStr_(), L = lc_lix_();
    const row = LC_LOAN_HEADERS.map(function () { return ''; });
    row[L.loanId] = id; row[L.assetId] = a.assetId; row[L.assetNo] = a.assetNo; row[L.assetName] = a.name;
    row[L.borrowerName] = name; row[L.borrowerType] = type; row[L.borrowerHN] = lc_txt_(d.borrowerHN, 30); row[L.phone] = phone;
    row[L.loanDate] = loanDate; row[L.dueDate] = dueDate; row[L.status] = LC_LOAN_OPEN;
    row[L.conditionOut] = lc_txt_(d.conditionOut, 200); row[L.note] = lc_txt_(d.note, 300);
    row[L.createdAt] = now; row[L.createdBy] = s.name; row[L.updatedAt] = now;
    const r = S.loan.getLastRow() + 1;
    S.loan.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    lc_log_(S.log, a.assetId, a.assetNo, 'loan_out', s.name, { loanId: id, borrower: name, due: dueDate });
    return { loanId: id };
  });
}
function lc_findLoan_(S, loanId) {
  const last = S.loan.getLastRow();
  if (last < 2) return null;
  const rows = S.loan.getRange(2, 1, last - 1, LC_LOAN_HEADERS.length).getValues();
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0]) === String(loanId)) return { rowNo: i + 2, obj: lc_loanRowToObj_(rows[i]) };
  return null;
}
function lc_apiLoanReturn_(d, s) {
  const S = lc_sheets_(), L = lc_lix_(), today = lc_today_();
  const cond = lc_txt_(d.conditionIn, 200), damaged = d.damaged === true || d.damaged === 'Y';
  if (damaged && !cond) throw lc_bad_('กรุณาระบุความเสียหายที่พบ');
  return lc_withLock_(function () {
    const f = lc_findLoan_(S, d.loanId);
    if (!f) throw lc_bad_('ไม่พบรายการยืม');
    if (f.obj.status !== LC_LOAN_OPEN) throw lc_bad_('รายการนี้คืนแล้ว');
    const retDate = lc_date_(d.returnDate) || today;
    if (retDate > today) throw lc_bad_('วันที่คืนต้องไม่เกินวันนี้');
    if (retDate < f.obj.loanDate) throw lc_bad_('วันที่คืนต้องไม่ก่อนวันที่ยืม');
    const r = f.rowNo, now = lc_nowStr_();
    const set = function (col, v) { S.loan.getRange(r, L[col] + 1).setNumberFormat('@').setValue(v); };
    set('returnDate', retDate); set('status', LC_LOAN_DONE); set('conditionIn', cond); set('updatedAt', now); set('returnedBy', s.name);
    let statusChanged = false;
    if (damaged) {
      const ix = lc_ix_(), rows = lc_readAssets_(S.reg), i = lc_findRow_(rows, f.obj.assetId);
      if (i >= 0 && String(rows[i][ix.status]) === LC_STATUSES[0]) {
        S.reg.getRange(i + 2, ix.status + 1).setNumberFormat('@').setValue(LC_STATUSES[1]);
        S.reg.getRange(i + 2, ix.updatedAt + 1, 1, 2).setNumberFormat('@').setValues([[now, s.name]]);
        statusChanged = true;
      }
    }
    lc_log_(S.log, f.obj.assetId, f.obj.assetNo, 'loan_in', s.name, { loanId: f.obj.loanId, damaged: damaged, condition: cond, late: retDate > f.obj.dueDate });
    return { statusChanged: statusChanged, late: retDate > f.obj.dueDate };
  });
}
function lc_apiLoanExtend_(d, s) {
  const S = lc_sheets_(), L = lc_lix_(), nd = lc_date_(d.dueDate), reason = lc_txt_(d.reason, 200);
  if (!nd) throw lc_bad_('กรุณาระบุวันกำหนดคืนใหม่');
  return lc_withLock_(function () {
    const f = lc_findLoan_(S, d.loanId);
    if (!f) throw lc_bad_('ไม่พบรายการยืม');
    if (f.obj.status !== LC_LOAN_OPEN) throw lc_bad_('รายการนี้คืนแล้ว');
    if (nd <= f.obj.dueDate) throw lc_bad_('วันกำหนดคืนใหม่ต้องหลังวันกำหนดเดิม');
    if (lc_daysBetween_(f.obj.loanDate, nd) > LC_MAX_LOAN_DAYS * 2) throw lc_bad_('รวมระยะเวลายืมเกินกว่าที่ระบบอนุญาต กรุณาให้ผู้ดูแลพิจารณา');
    S.loan.getRange(f.rowNo, L.dueDate + 1).setNumberFormat('@').setValue(nd);
    S.loan.getRange(f.rowNo, L.updatedAt + 1).setNumberFormat('@').setValue(lc_nowStr_());
    lc_log_(S.log, f.obj.assetId, f.obj.assetNo, 'loan_extend', s.name, { loanId: f.obj.loanId, from: f.obj.dueDate, to: nd, reason: reason });
    return { dueDate: nd };
  });
}

// ================================================================
//  ตรวจสภาพ
// ================================================================
function lc_apiCheckSave_(d, s) {
  const result = String(d.result || '');
  if (LC_CHECK_RESULTS.indexOf(result) < 0) throw lc_bad_('กรุณาเลือกผลการตรวจ');
  const note = lc_txt_(d.note, 500);
  if (result !== LC_CHECK_RESULTS[0] && !note) throw lc_bad_('กรุณาระบุรายละเอียดที่พบ');
  const S = lc_sheets_(), ix = lc_ix_(), sh = S.reg;
  return lc_withLock_(function () {
    const rows = lc_readAssets_(sh), r = lc_findRow_(rows, d.assetId);
    if (r < 0) throw lc_bad_('ไม่พบรายการ');
    const o = lc_rowToAsset_(rows[r]);
    if (o.voided) throw lc_bad_('รายการนี้ถูกยกเลิกแล้ว');
    const rowNo = r + 2, now = lc_nowStr_(), days = Number(o.checkIntervalDays) || 0;
    const nextDue = days > 0 ? lc_addDays_(lc_today_(), days) : '';
    sh.getRange(rowNo, ix.lastCheckAt + 1, 1, 4).setNumberFormat('@').setValues([[now, s.name, result, nextDue]]);
    let statusChanged = false;
    if (result === LC_CHECK_RESULTS[2] && o.status === LC_STATUSES[0]) { sh.getRange(rowNo, ix.status + 1).setNumberFormat('@').setValue(LC_STATUSES[1]); statusChanged = true; }
    sh.getRange(rowNo, ix.updatedAt + 1, 1, 2).setNumberFormat('@').setValues([[now, s.name]]);
    let maxN = 0; const last = S.chk.getLastRow();
    if (last >= 2) S.chk.getRange(2, 1, last - 1, 1).getValues().forEach(function (x) { const m = /^C(\d+)$/.exec(String(x[0])); if (m) maxN = Math.max(maxN, Number(m[1])); });
    const cid = 'C' + ('00000' + (maxN + 1)).slice(-5);
    S.chk.getRange(last + 1, 1, 1, LC_CHECK_HEADERS.length).setNumberFormat('@').setValues([[cid, now, o.assetId, o.assetNo, o.name, result, note, s.name, nextDue]]);
    lc_log_(S.log, o.assetId, o.assetNo, 'check', s.name, { result: result, note: note, statusChanged: statusChanged });
    return { nextDue: nextDue, statusChanged: statusChanged };
  });
}
function lc_apiCheckList_(a) {
  const S = lc_sheets_(), n = Math.max(1, Math.min(60, Number(a.limit) || 12)), last = S.chk.getLastRow();
  if (last < 2) return [];
  const rows = S.chk.getRange(2, 1, last - 1, LC_CHECK_HEADERS.length).getValues(), out = [];
  for (let i = rows.length - 1; i >= 0 && out.length < n; i--) {
    if (String(rows[i][2]) === String(a.id)) out.push({ ts: lc_val_(rows[i][1], 'ts'), result: rows[i][5], note: rows[i][6], by: rows[i][7], nextDue: lc_val_(rows[i][8], 'nextCheckDue') });
  }
  return out;
}

// ================================================================
//  QR Code — สร้างรูปเอง (ไม่พึ่งบริการภายนอก) บันทึกลง Drive + แปะรูปในเซลล์ชีต
//  qrcode-generator 1.4.4 (Kazuhiko Arase, MIT License)
// ================================================================

function lc_qrBase_() {
  const u = lc_prop_('LC_FRONTEND_URL');
  if (!u) throw new LcApiError('CONFIG', 'ยังไม่ได้ตั้งค่า FRONTEND_URL — ผู้ดูแลต้องรัน lcSetConfig()');
  return u;
}
function lc_qrNewKey_() { return Utilities.getUuid().replace(/-/g, '').substring(0, 8); }
function lc_qrMatrix_(text) {
  const qr = PT_QRCODE_(0, 'M'); qr.addData(String(text), 'Byte'); qr.make();
  const n = qr.getModuleCount(), m = [];
  for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(!!qr.isDark(r, c)); m.push(row); }
  return m;
}
let LC__crcT = null;
function lc_crc32_(u8) {
  if (!LC__crcT) {
    LC__crcT = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); LC__crcT[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < u8.length; i++) c = LC__crcT[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function lc_concat_(parts) {
  let len = 0; parts.forEach(function (p) { len += p.length; });
  const out = new Uint8Array(len); let o = 0;
  parts.forEach(function (p) { out.set(p, o); o += p.length; });
  return out;
}
function lc_u32_(v) { return Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
function lc_pngChunk_(type, data) {
  const t = Uint8Array.of(type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3));
  const td = lc_concat_([t, data]);
  return lc_concat_([lc_u32_(data.length), td, lc_u32_(lc_crc32_(td))]);
}
function lc_qrPngBytes_(text) {
  const m = lc_qrMatrix_(text), n = m.length, S = 8, Q = 4, W = (n + 2 * Q) * S, H = W, rb = Math.ceil(W / 8);
  const raw = new Uint8Array((rb + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    const r = Math.floor(y / S) - Q;
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      const c = Math.floor(x / S) - Q;
      const dark = r >= 0 && r < n && c >= 0 && c < n && m[r][c];
      if (!dark) raw[p + (x >> 3)] |= (0x80 >> (x & 7));
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
  z.push(lc_u32_(((b << 16) | a) >>> 0));
  const ihdr = lc_concat_([lc_u32_(W), lc_u32_(H), Uint8Array.of(1, 0, 0, 0, 0)]);
  return lc_concat_([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), lc_pngChunk_('IHDR', ihdr), lc_pngChunk_('IDAT', lc_concat_(z)), lc_pngChunk_('IEND', new Uint8Array(0))]);
}
function lc_qrBlob_(text, name) {
  const u8 = lc_qrPngBytes_(text);
  return Utilities.newBlob(Array.from(u8, function (b) { return b > 127 ? b - 256 : b; }), 'image/png', name);
}
// ใส่รูป QR ลงเซลล์ — ลองตามลำดับ: data URI → ลิงก์ Drive → ลิงก์ข้อความ (คืนวิธีที่สำเร็จ)
function lc_qrCellImage_(sh, row, col, blob, file, label, text) {
  try { sh.setRowHeight(row, 84); } catch (e) {}
  try {
    const im = SpreadsheetApp.newCellImage().setSourceUrl('data:image/png;base64,' + Utilities.base64Encode(blob.getBytes()))
      .setAltTextTitle('QR ' + label).setAltTextDescription(text).build();
    sh.getRange(row, col).setNumberFormat('General').setValue(im); return 'data';
  } catch (e1) { /* ลองวิธีถัดไป */ }
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const im2 = SpreadsheetApp.newCellImage().setSourceUrl('https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400').setAltTextTitle('QR ' + label).build();
    sh.getRange(row, col).setNumberFormat('General').setValue(im2); return 'drive';
  } catch (e2) { /* ลองวิธีถัดไป */ }
  try {
    sh.getRange(row, col).setNumberFormat('General').setFormula('=HYPERLINK("https://drive.google.com/file/d/' + file.getId() + '/view","เปิดรูป QR")'); return 'link';
  } catch (e3) { return ''; }
}
// สร้าง/สร้างซ้ำ QR ของแถวเดียว (ผู้เรียกต้องถือ lock เอง) — คีย์เดิมคงอยู่ ป้ายที่ติดไปแล้วยังสแกนได้ถ้า FRONTEND_URL ไม่เปลี่ยน
function lc_qrApply_(S, rowNo, rowArr, by, force) {
  const ix = lc_ix_(), sh = S.reg, id = String(rowArr[ix.assetId] || '');
  if (!force && rowArr[ix.qrText] && rowArr[ix.qrFileId]) return { assetId: id, ok: true, skipped: true };
  const key = String(rowArr[ix.qrKey] || '') || lc_qrNewKey_();
  const text = lc_qrBase_() + 'scan.html?id=' + encodeURIComponent(id) + '&k=' + key;
  const no = String(rowArr[ix.assetNo] || '').trim();
  const blob = lc_qrBlob_(text, 'QR_' + (no || id).replace(/[^A-Za-z0-9ก-๙_.-]/g, '_') + '_' + id + '.png');
  const file = lc_driveFolder_('ASSET_QR_FOLDER_ID', ASSET_QR_FOLDER_NAME).createFile(blob);
  const oldFile = String(rowArr[ix.qrFileId] || '');
  if (oldFile) { try { DriveApp.getFileById(oldFile).setTrashed(true); } catch (e) {} }
  sh.getRange(rowNo, ix.qrKey + 1, 1, 3).setNumberFormat('@').setValues([[key, text, file.getId()]]);
  sh.getRange(rowNo, ix.qrAt + 1).setNumberFormat('@').setValue(lc_nowStr_());
  const how = lc_qrCellImage_(sh, rowNo, ix.qrImg + 1, blob, file, no || id, text);
  lc_log_(S.log, id, no, 'qr_gen', by, { fileId: file.getId(), sheetImage: how || 'none' });
  return { assetId: id, ok: true, fileId: file.getId(), sheetImage: how };
}
function lc_apiQrBatch_(a, s) {
  const force = a.force === true;
  if (force && s.role !== 'admin') throw new LcApiError('FORBIDDEN', 'การสร้าง QR ซ้ำต้องใช้สิทธิ์ผู้ดูแลระบบ');
  const ids = (Array.isArray(a.ids) ? a.ids : []).map(String).slice(0, 10);
  if (!ids.length) return { results: [] };
  lc_qrBase_();
  const S = lc_sheets_(), ix = lc_ix_();
  return lc_withLock_(function () {
    const rows = lc_readAssets_(S.reg), pos = {};
    rows.forEach(function (r, i) { pos[String(r[ix.assetId])] = i; });
    try { S.reg.setColumnWidth(ix.qrImg + 1, 96); } catch (e) {}
    return { results: ids.map(function (id) {
      try {
        const i = pos[id];
        if (i == null) throw new Error('ไม่พบรายการ');
        if (String(rows[i][ix.voided]) === 'Y') throw new Error('รายการนี้ถูกยกเลิกแล้ว');
        return lc_qrApply_(S, i + 2, rows[i], s.name, force);
      } catch (e) { Logger.log('QR ' + id + ': ' + e.message); return { assetId: id, ok: false, error: 'สร้าง QR ไม่สำเร็จ' }; }
    }) };
  });
}
function lc_apiQrPrintLog_(a, s) {
  const ids = (Array.isArray(a.ids) ? a.ids : []).map(String).slice(0, 300), size = lc_txt_(a.size, 10);
  if (!ids.length) return { count: 0 };
  const S = lc_sheets_(), ix = lc_ix_(), no = {};
  lc_readAssets_(S.reg).forEach(function (r) { no[String(r[ix.assetId])] = String(r[ix.assetNo] || ''); });
  const now = lc_nowStr_();
  const out = ids.filter(function (id) { return no[id] != null; }).map(function (id) { return [now, id, no[id], 'qr_print', s.name, JSON.stringify({ size: size })]; });
  if (out.length) S.log.getRange(S.log.getLastRow() + 1, 1, out.length, LC_LOG_HEADERS.length).setNumberFormat('@').setValues(out);
  return { count: out.length };
}
function lc_qrRun_(force, who) {
  const S = lc_sheets_(), ix = lc_ix_();
  lc_qrBase_();
  let ok = 0, fail = 0;
  lc_withLock_(function () {
    try { S.reg.setColumnWidth(ix.qrImg + 1, 96); } catch (e) {}
    lc_readAssets_(S.reg).forEach(function (r, i) {
      if (String(r[ix.voided]) === 'Y' || !r[ix.assetId]) return;
      if (!force && r[ix.qrText] && r[ix.qrFileId]) return;
      try { lc_qrApply_(S, i + 2, r, who, force); ok++; } catch (e) { fail++; Logger.log('QR ' + r[ix.assetId] + ': ' + e.message); }
    });
  });
  Logger.log(who + ' เสร็จ — สร้าง QR ' + ok + ' รายการ, ไม่สำเร็จ ' + fail);
  return { ok: ok, fail: fail };
}

// ================================================================
//  หน้าสแกน (สาธารณะ) — เปิดเผยเฉพาะข้อมูลพื้นฐาน ไม่มีราคา / Serial / ชื่อผู้ยืม
// ================================================================
function lc_apiScan_(a) {
  const id = String(a.id || ''), k = String(a.k || '');
  if (!/^A\d{3,}$/.test(id) || !/^[0-9a-f]{8}$/.test(k)) return { valid: false };
  const S = lc_sheets_(), today = lc_today_();
  const o = lc_liveAssets_(S).filter(function (x) { return x.assetId === id; })[0];
  if (!o || !o.qrKey || !lc_safeEq_(o.qrKey, k)) return { valid: false };
  let loanState = 'none', due = '';
  if (o.loanable === 'Y') {
    const l = lc_openLoanMap_(lc_readLoans_(S.loan), today)[o.assetId];
    if (l) { loanState = l.overdue ? 'overdue' : 'onLoan'; due = l.dueDate; }
    else loanState = o.status === LC_STATUSES[0] ? 'available' : 'unavailable';
  }
  return {
    valid: true, assetId: o.assetId, assetNo: o.assetNo, name: o.name, category: o.category, location: o.location, custodian: o.custodian,
    status: o.status, loanState: loanState, dueDate: due, lastCheckAt: o.lastCheckAt, lastCheckResult: o.lastCheckResult,
    nextCheckDue: o.nextCheckDue, checkDue: lc_checkInfo_(o, today), thumb: o.thumb || ''
  };
}

// ================================================================
//  ทางเข้า (เรียกจาก doPost / doGet ใน Code.gs)
// ================================================================
function lc_out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/** true ถ้า POST นี้เป็นคำขอของศูนย์ยืม-คืน ({action:'...'}) — ไม่ใช่ webhook ของ LINE ({events:[...]}) */
function lcIsApiRequest_(e) {
  try {
    const raw = e && e.postData && e.postData.contents || '';
    if (!raw || raw.charAt(0) !== '{' || raw.indexOf('"action"') < 0) return false;
    if (raw.length > LC_MAX_BODY) return true;               // ใหญ่เกิน → ให้ lcDoPost_ ตอบ error แทนที่จะส่งให้ LINE
    const j = JSON.parse(raw);
    return !!j && typeof j.action === 'string' && !Array.isArray(j.events);
  } catch (err) { return false; }
}
function lcDoPost_(e) {
  try {
    const raw = e && e.postData && e.postData.contents || '';
    if (!raw || raw.length > LC_MAX_BODY) throw lc_bad_('ข้อมูลที่ส่งมาไม่ถูกต้องหรือมีขนาดใหญ่เกินไป');
    let req; try { req = JSON.parse(raw); } catch (pe) { throw lc_bad_('รูปแบบข้อมูลไม่ถูกต้อง'); }
    return lc_out_({ ok: true, data: lc_handle_(req) });
  } catch (err) { return lc_out_(lc_errOut_(err)); }
}
/** GET สาธารณะของศูนย์ยืม-คืน: ?action=ping หรือ ?action=scan&id=&k= */
function lcDoGet_(p) {
  try {
    p = p || {};
    const act = p.action || 'ping';
    if (act !== 'ping' && act !== 'scan') throw lc_bad_('ไม่รู้จักคำสั่งนี้');
    return lc_out_({ ok: true, data: lc_handle_({ action: act, args: act === 'scan' ? { id: p.id, k: p.k } : {} }) });
  } catch (err) { return lc_out_(lc_errOut_(err)); }
}

// ================================================================
//  ระบบแอดมิน (ดูอย่างเดียว) — ใช้กับ index.html บน Apps Script
//  อ่านชีตเท่านั้น ไม่มีการเขียน/ยืม/คืน — ทำรายการจริงที่หน้าเว็บบน GitHub
// ================================================================
function lcAdminOverview() {
  const S = lc_sheets_(), today = lc_today_();
  const loans = lc_readLoans_(S.loan);
  const open = lc_openLoanMap_(loans, today);
  const assets = lc_liveAssets_(S);
  const d = lc_apiDashboard_();
  const state = {};
  assets.forEach(function (o) {
    const l = open[o.assetId];
    state[o.assetId] = {
      loan: l ? lc_publicLoan_(l) : null,
      checkDue: lc_checkInfo_(o, today),
      lastCheckAt: o.lastCheckAt || '', lastCheckResult: o.lastCheckResult || '', nextCheckDue: o.nextCheckDue || '',
      hasQr: !!o.qrText
    };
  });
  const openList = Object.keys(open).map(function (id) { return open[id]; });
  openList.sort(function (x, y) { return (y.daysLate - x.daysLate) || String(x.dueDate).localeCompare(String(y.dueDate)); });
  const recent = loans.filter(function (l) { return l.status === LC_LOAN_DONE; }).map(function (l) { return lc_decorateLoan_(l, today); }).reverse().slice(0, 60);
  const checks = [], cl = S.chk.getLastRow();
  if (cl >= 2) {
    const start = Math.max(2, cl - 59);
    S.chk.getRange(start, 1, cl - start + 1, LC_CHECK_HEADERS.length).getValues().reverse().forEach(function (r) {
      checks.push({ ts: lc_val_(r[1], 'ts'), assetId: r[2], assetNo: r[3], assetName: r[4], result: r[5], note: r[6], by: r[7] });
    });
  }
  return {
    today: today, dashboard: d, state: state, openLoans: openList, recentLoans: recent, checks: checks,
    logs: lc_apiLogList_({ limit: 80 }),
    frontendUrl: lc_prop_('LC_FRONTEND_URL') || ''
  };
}


// ================================================================
//  คำขอยืม (ผู้ใช้ทั่วไป — ไม่ต้องล็อกอิน)  v1.2
//  · action สาธารณะ: requestCatalog / requestCreate / requestStatus (ไม่เปิดเผยข้อมูลผู้ยืมคนอื่น)
//  · ผู้ดูแลอนุมัติ/ปฏิเสธ/รับคืนที่ระบบแอดมิน (index.html → ศูนย์ควบคุมอุปกรณ์ → แท็บ "คำขอยืม")
//    ผ่าน lcReqList / lcReqDecide / lcAdminReturn — อนุมัติแล้วระบบสร้างรายการยืมจริงลงชีต AssetLoans อัตโนมัติ
// ================================================================
const LC_REQ_HEADERS = ['reqId','assetId','assetNo','assetName','requesterName','phone','neededFrom','neededTo','purpose','status','createdAt','decidedAt','decidedBy','decisionNote','loanId'];
const LC_REQ_PENDING = 'รออนุมัติ';
const LC_REQ_BUSY = 'กำลังดำเนินการ';
const LC_REQ_OK = 'อนุมัติแล้ว';
const LC_REQ_NO = 'ปฏิเสธ';
const LC_REQ_MAX_PENDING_PER_PHONE = 3;
const LC_REQ_MAX_PER_HOUR = 60;

function lc_reqSheet_() { return lc_ensureSheet_(lc_ss_(), 'AssetRequests', LC_REQ_HEADERS); }
function lc_reqIx_() { const o = {}; LC_REQ_HEADERS.forEach(function (h, i) { o[h] = i; }); return o; }
function lc_reqRead_() {
  const sh = lc_reqSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, LC_REQ_HEADERS.length).getDisplayValues().map(function (r, i) {
    const o = { rowNo: i + 2 }; LC_REQ_HEADERS.forEach(function (h, k) { o[h] = String(r[k]); }); return o;
  });
}
function lc_reqSet_(rowNo, patch) {
  const sh = lc_reqSheet_(), X = lc_reqIx_();
  Object.keys(patch).forEach(function (k) { sh.getRange(rowNo, X[k] + 1).setNumberFormat('@').setValue(patch[k]); });
}
function lc_digits_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

/** รายการที่เปิดให้ยืม (ข้อมูลสาธารณะ: ไม่มีราคา/Serial/ชื่อผู้ยืม) */
function lc_apiReqCatalog_() {
  const S = lc_sheets_(), today = lc_today_(), open = lc_openLoanMap_(lc_readLoans_(S.loan), today);
  const pend = {}; lc_reqRead_().forEach(function (r) { if (r.status === LC_REQ_PENDING) pend[r.assetId] = (pend[r.assetId] || 0) + 1; });
  const items = lc_liveAssets_(S).filter(function (o) { return o.loanable === 'Y' && o.status !== LC_STATUSES[4]; }).map(function (o) {
    const l = open[o.assetId];
    return {
      assetId: o.assetId, assetNo: o.assetNo, name: o.name, category: o.category, location: o.location, thumb: o.thumb || '',
      state: l ? (l.overdue ? 'overdue' : 'onLoan') : (o.status === LC_STATUSES[0] ? 'available' : 'unavailable'),
      dueDate: l ? l.dueDate : '', pending: pend[o.assetId] || 0
    };
  });
  return { items: items, today: today, defaultLoanDays: LC_DEFAULT_LOAN_DAYS, maxLoanDays: LC_MAX_LOAN_DAYS };
}

function lc_apiReqCreate_(d) {
  if (d.website) return { reqId: '-', assetName: '' };                     // ช่องล่อบอท
  const first = lc_txt_(d.firstName, 60), last = lc_txt_(d.lastName, 60);
  if (first.length < 2) throw lc_bad_('กรุณากรอกชื่อ');
  if (last.length < 2) throw lc_bad_('กรุณากรอกนามสกุล');
  const phone = lc_digits_(d.phone);
  if (!/^0\d{8,9}$/.test(phone)) throw lc_bad_('เบอร์โทรไม่ถูกต้อง (เช่น 0812345678)');
  const today = lc_today_(), from = lc_date_(d.from) || today, to = lc_date_(d.to);
  if (from < today) throw lc_bad_('วันที่ต้องการใช้ต้องไม่เป็นวันที่ผ่านมาแล้ว');
  if (!to) throw lc_bad_('กรุณาระบุวันที่จะคืน');
  if (to < from) throw lc_bad_('วันที่คืนต้องไม่ก่อนวันที่เริ่มใช้');
  if (lc_daysBetween_(from, to) > LC_MAX_LOAN_DAYS) throw lc_bad_('ขอยืมได้ครั้งละไม่เกิน ' + LC_MAX_LOAN_DAYS + ' วัน');
  const cache = CacheService.getScriptCache(), hk = 'LC_RQ_H_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMddHH');
  const hits = Number(cache.get(hk) || 0);
  if (hits >= LC_REQ_MAX_PER_HOUR) throw new LcApiError('BUSY', 'ระบบรับคำขอจำนวนมากชั่วคราว กรุณาลองใหม่ภายหลัง');
  cache.put(hk, String(hits + 1), 3700);
  const S = lc_sheets_();
  return lc_withLock_(function () {
    const rows = lc_readAssets_(S.reg), i = lc_findRow_(rows, d.assetId);
    if (i < 0) throw lc_bad_('ไม่พบรายการอุปกรณ์');
    const a = lc_rowToAsset_(rows[i]);
    if (a.voided || a.loanable !== 'Y') throw lc_bad_('รายการนี้ไม่เปิดให้ยืม');
    if (a.status !== LC_STATUSES[0]) throw lc_bad_('อุปกรณ์นี้ยังไม่พร้อมให้ยืมในขณะนี้');
    const cur = lc_openLoanMap_(lc_readLoans_(S.loan), today)[a.assetId];
    if (cur && (cur.overdue || from <= cur.dueDate)) throw lc_bad_(cur.overdue ? 'อุปกรณ์นี้ยังไม่ได้รับคืน กรุณาติดต่อเจ้าหน้าที่' : 'อุปกรณ์ถูกยืมอยู่ถึงวันที่ ' + cur.dueDate + ' กรุณาเลือกวันเริ่มใช้หลังจากนั้น');
    const reqs = lc_reqRead_();
    if (reqs.filter(function (r) { return r.status === LC_REQ_PENDING && lc_digits_(r.phone) === phone; }).length >= LC_REQ_MAX_PENDING_PER_PHONE) throw lc_bad_('เบอร์นี้มีคำขอรออนุมัติครบ ' + LC_REQ_MAX_PENDING_PER_PHONE + ' รายการแล้ว กรุณารอเจ้าหน้าที่ติดต่อกลับ');
    if (reqs.some(function (r) { return r.status === LC_REQ_PENDING && r.assetId === a.assetId && lc_digits_(r.phone) === phone; })) throw lc_bad_('คุณส่งคำขอยืมอุปกรณ์นี้ไว้แล้ว กรุณารอเจ้าหน้าที่ติดต่อกลับ');
    let maxN = 0; reqs.forEach(function (r) { const m = /^R(\d+)$/.exec(r.reqId); if (m) maxN = Math.max(maxN, Number(m[1])); });
    const id = 'R' + ('00000' + (maxN + 1)).slice(-5), sh = lc_reqSheet_(), X = lc_reqIx_(), row = LC_REQ_HEADERS.map(function () { return ''; });
    row[X.reqId] = id; row[X.assetId] = a.assetId; row[X.assetNo] = a.assetNo; row[X.assetName] = a.name;
    row[X.requesterName] = first + ' ' + last; row[X.phone] = phone; row[X.neededFrom] = from; row[X.neededTo] = to;
    row[X.purpose] = lc_txt_(d.purpose, 300); row[X.status] = LC_REQ_PENDING; row[X.createdAt] = lc_nowStr_();
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    lc_log_(S.log, a.assetId, a.assetNo, 'request_new', first + ' ' + last, { reqId: id, from: from, to: to });
    return { reqId: id, assetName: a.name, assetNo: a.assetNo, from: from, to: to };
  });
}

function lc_apiReqStatus_(d) {
  const id = String(d.reqId || '').trim().toUpperCase(), phone = lc_digits_(d.phone);
  const r = lc_reqRead_().filter(function (x) { return x.reqId === id && lc_digits_(x.phone) === phone; })[0];
  if (!r) throw lc_bad_('ไม่พบคำขอ ตรวจสอบเลขคำขอและเบอร์โทรอีกครั้ง');
  return { reqId: r.reqId, assetNo: r.assetNo, assetName: r.assetName, status: r.status === LC_REQ_BUSY ? LC_REQ_PENDING : r.status, from: r.neededFrom, to: r.neededTo, decidedAt: r.decidedAt, note: r.decisionNote };
}

// ---------- ฝั่งแอดมิน (เรียกผ่าน google.script.run จากหน้า index.html) ----------
function lcReqList() {
  const S = lc_sheets_(), today = lc_today_(), all = lc_reqRead_();
  const open = lc_readLoans_(S.loan).filter(function (l) { return l.status === LC_LOAN_OPEN; }).map(function (l) { return lc_decorateLoan_(l, today); });
  open.sort(function (x, y) { return (y.daysLate - x.daysLate) || String(x.dueDate).localeCompare(String(y.dueDate)); });
  return {
    today: today, borrowerTypes: LC_BORROWER_TYPES, frontendUrl: lc_prop_('LC_FRONTEND_URL') || '',
    // แนบสถานะอุปกรณ์ให้การ์ดคำขอ: ถ้ายังถูกยืมอยู่ (busyUntil) จะอนุมัติไม่ได้จนกว่าจะรับคืน
    pending: all.filter(function (r) { return r.status === LC_REQ_PENDING; }).map(function (r) {
      const cur = open.filter(function (l) { return l.assetId === r.assetId; })[0];
      r.busyUntil = cur ? String(cur.dueDate || '') : ''; r.busyOverdue = !!(cur && cur.overdue);
      return r;
    }),
    decided: all.filter(function (r) { return r.status !== LC_REQ_PENDING; }).reverse().slice(0, 30),
    openLoans: open
  };
}

/** decision = 'approve' | 'reject' — อนุมัติ = สร้างรายการยืมจริง (วันที่ยืม = วันนี้, กำหนดคืน = วันที่ผู้ขอระบุ) */
function lcReqDecide(reqId, decision, note, by, borrowerType) {
  by = lc_txt_(by, 60); if (by.length < 2) throw lc_bad_('กรุณาระบุชื่อผู้ทำรายการ');
  note = lc_txt_(note, 300);
  const S = lc_sheets_(), today = lc_today_();
  let req = null;
  lc_withLock_(function () {
    req = lc_reqRead_().filter(function (r) { return r.reqId === String(reqId); })[0];
    if (!req) throw lc_bad_('ไม่พบคำขอ');
    if (req.status !== LC_REQ_PENDING) throw lc_bad_('คำขอนี้ถูกดำเนินการแล้ว (' + req.status + ')');
    if (decision === 'reject') {
      lc_reqSet_(req.rowNo, { status: LC_REQ_NO, decidedAt: lc_nowStr_(), decidedBy: by, decisionNote: note });
      lc_log_(S.log, req.assetId, req.assetNo, 'request_reject', by, { reqId: req.reqId, note: note });
    } else lc_reqSet_(req.rowNo, { status: LC_REQ_BUSY });
  });
  if (decision === 'reject') return { status: LC_REQ_NO };
  if (decision !== 'approve') throw lc_bad_('คำสั่งไม่ถูกต้อง');
  try {
    const due = req.neededTo < today ? today : req.neededTo;
    const r = lc_apiLoanCheckout_({
      assetId: req.assetId, borrowerName: req.requesterName, borrowerType: borrowerType || LC_BORROWER_TYPES[1], phone: req.phone,
      loanDate: today, dueDate: due, note: ('คำขอ ' + req.reqId + (req.purpose ? ' · ' + req.purpose : '') + (note ? ' · ' + note : '')).substring(0, 300)
    }, { name: by });
    lc_withLock_(function () { lc_reqSet_(req.rowNo, { status: LC_REQ_OK, decidedAt: lc_nowStr_(), decidedBy: by, decisionNote: note, loanId: r.loanId }); });
    return { status: LC_REQ_OK, loanId: r.loanId };
  } catch (err) {
    lc_withLock_(function () { lc_reqSet_(req.rowNo, { status: LC_REQ_PENDING }); });
    throw err;
  }
}

/** รับคืนจากหน้าแอดมิน */
function lcAdminReturn(loanId, damaged, conditionIn, by) {
  by = lc_txt_(by, 60); if (by.length < 2) throw lc_bad_('กรุณาระบุชื่อผู้ทำรายการ');
  return lc_apiLoanReturn_({ loanId: loanId, damaged: damaged === true, conditionIn: conditionIn }, { name: by });
}
