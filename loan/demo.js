/* โหมดตัวอย่าง (Demo) — ดูหน้าจอผู้ยืม/เจ้าหน้าที่ด้วยข้อมูลจำลอง โดยไม่แตะระบบจริง
 *
 * วิธีทำงาน: ดาวน์โหลดไฟล์ gas/LoanCenter.gs ตัวจริง (ไฟล์เดียวกับที่ deploy บน Apps Script) มารันในเบราว์เซอร์
 * ร่วมกับ "ชีตจำลอง" ที่เก็บใน sessionStorage ของแท็บนี้ — กติกา/การตรวจข้อมูล/ข้อความผิดพลาดจึงเหมือนของจริงทุกอย่าง
 * ข้อมูลตัวอย่างสร้างจาก lcDemoSeed() ตัวเดียวกับที่ปุ่ม "สร้างข้อมูลตัวอย่าง" ในหน้าแอดมินใช้
 *
 * เปิด:  เพิ่ม ?demo=1 ท้าย URL   ปิด: ?demo=0 (หรือปุ่ม "ออกจากโหมดตัวอย่าง" บนแถบด้านบน)
 * รหัสผู้ดูแลในโหมดตัวอย่าง: 123456 (ไม่ใช่รหัสจริง)
 */
(function () {
  var AK = 'elc.demo', DK = 'elc.demo.db', PIN = '123456';
  var C = window.ELC_CONFIG || {};
  function ss() { try { return window.sessionStorage; } catch (e) { return null; } }

  // ----- เปิด/ปิดจาก URL -----
  (function () {
    try {
      var u = new URL(location.href), v = u.searchParams.get('demo'), s = ss();
      if (v === null || !s) return;
      if (v === '1' || v === 'true') s.setItem(AK, '1'); else { s.removeItem(AK); s.removeItem(DK); s.removeItem('elc.demo.session'); }
      u.searchParams.delete('demo');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) {}
  })();
  function active() { var s = ss(); return !!(s && s.getItem(AK) === '1'); }

  // ----- SHA-256 แบบ synchronous (Apps Script computeDigest เป็น sync; WebCrypto เป็น async) -----
  var K = [], H0 = [];
  (function () {
    var n = 2, i, p = [];
    while (p.length < 64) { for (i = 2; i * i <= n; i++) if (n % i === 0) break; if (i * i > n) p.push(n); n++; }
    function fr(x) { return Math.floor((x - Math.floor(x)) * 4294967296) >>> 0; }
    p.forEach(function (q, k) { K[k] = fr(Math.cbrt(q)); if (k < 8) H0[k] = fr(Math.sqrt(q)); });
  })();
  function sha256(bytes) {
    var l = bytes.length, nl = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nl), i, j, h = H0.slice(), w = new Array(64);
    m.set(bytes); m[l] = 0x80;
    var bits = l * 8; for (i = 0; i < 8; i++) m[nl - 1 - i] = i < 4 ? (bits >>> (8 * i)) & 255 : 0;
    function R(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var o = 0; o < nl; o += 64) {
      for (i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (i = 16; i < 64; i++) { var s0 = R(w[i - 15], 7) ^ R(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = R(w[i - 2], 17) ^ R(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var t1 = (hh + (R(e, 6) ^ R(e, 11) ^ R(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((R(a, 2) ^ R(a, 13) ^ R(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var out = []; for (j = 0; j < 8; j++) for (i = 3; i >= 0; i--) { var v = (h[j] >>> (8 * i)) & 255; out.push(v > 127 ? v - 256 : v); }
    return out;
  }
  function utf8(s) { return new TextEncoder().encode(String(s)); }

  // ----- ชีตจำลอง (เก็บใน sessionStorage) -----
  var db = null, engine = null, files = {}, booting = null;
  function save() { var s = ss(); if (!s || !db) return; try { s.setItem(DK, JSON.stringify(db)); } catch (e) { /* เต็ม: ข้ามการบันทึก (ยังใช้ในหน้านี้ได้) */ } }
  function emptyDb() { return { sheets: {}, props: {}, cache: {}, seeded: false }; }
  function mkSheet(name) {
    var st = db.sheets[name] || (db.sheets[name] = { data: [], maxC: 26 });
    var sh = {
      getName: function () { return name; },
      getLastRow: function () { for (var i = st.data.length - 1; i >= 0; i--) { var r = st.data[i]; if (r && r.some(function (v) { return v !== '' && v != null; })) return i + 1; } return 0; },
      getMaxColumns: function () { return st.maxC; },
      insertColumnsAfter: function (a, n) { st.maxC += n; },
      deleteRows: function (a, n) { st.data.splice(a - 1, n); },
      setFrozenRows: function () {}, setRowHeight: function () {}, setColumnWidth: function () {},
      getRange: function (r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        var rg = {
          getValues: function () { var o = []; for (var i = 0; i < nr; i++) { var row = [], src = st.data[r - 1 + i] || []; for (var j = 0; j < nc; j++) { var v = src[c - 1 + j]; row.push(v == null ? '' : v); } o.push(row); } return o; },
          getDisplayValues: function () { return rg.getValues().map(function (x) { return x.map(String); }); },
          setValues: function (v) { for (var i = 0; i < nr; i++) { st.data[r - 1 + i] = st.data[r - 1 + i] || []; for (var j = 0; j < nc; j++) st.data[r - 1 + i][c - 1 + j] = v[i][j]; } return rg; },
          setValue: function (v) { st.data[r - 1] = st.data[r - 1] || []; st.data[r - 1][c - 1] = (v && v.__img) ? '' : v; return rg; },
          setFormula: function (f) { return rg.setValue(f); },
          setNumberFormat: function () { return rg; }, setNumberFormats: function () { return rg; }, setFontWeight: function () { return rg; }
        };
        return rg;
      }
    };
    return sh;
  }
  var SS = { getName: function () { return 'ชีตตัวอย่าง (จำลอง)'; }, getSheetByName: function (n) { return db.sheets[n] ? mkSheet(n) : null; }, insertSheet: function (n) { return mkSheet(n); } };

  function pad(n) { return ('0' + n).slice(-2); }
  function fmtDate(d, tz, f) {
    var t = new Date(d.getTime() + 7 * 3600000);   // เขตเวลา Asia/Bangkok = UTC+7 (ไม่ขึ้นกับเครื่องผู้ใช้)
    var m = { yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()), HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()) };
    return f.replace(/yyyy|MM|dd|HH|mm|ss/g, function (k) { return m[k]; });
  }
  function bytesOf(a) { return a instanceof Uint8Array ? a : Uint8Array.from(a, function (x) { return x & 255; }); }
  function uuid() { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); var h = '0123456789abcdef', s = ''; for (var i = 0; i < 36; i++) s += (i === 8 || i === 13 || i === 18 || i === 23) ? '-' : h[Math.floor(Math.random() * 16)]; return s; }
  function mkFile(blob) {
    var id = 'DEMOFILE' + uuid().replace(/-/g, '').slice(0, 12); files[id] = blob;
    return { getId: function () { return id; }, setSharing: function () {}, getBlob: function () { return files[id]; }, setTrashed: function () { delete files[id]; }, getParents: function () { var u = false; return { hasNext: function () { return !u; }, next: function () { u = true; return folder; } }; } };
  }
  var folder = { getId: function () { return 'DEMOFOLDER'; }, createFile: mkFile };
  var cacheApi = {
    get: function (k) { var e = db.cache[k]; if (!e) return null; if (e.x && e.x < Date.now()) { delete db.cache[k]; return null; } return e.v; },
    put: function (k, v, sec) { db.cache[k] = { v: String(v), x: sec ? Date.now() + sec * 1000 : 0 }; },
    remove: function (k) { delete db.cache[k]; }
  };
  var sandbox = {
    SpreadsheetApp: { newCellImage: function () { var o = { __img: 1 }, b = { setSourceUrl: function (u) { o.url = u; return b; }, setAltTextTitle: function () { return b; }, setAltTextDescription: function () { return b; }, build: function () { return o; } }; return b; } },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return db.props[k] == null ? null : db.props[k]; }, setProperty: function (k, v) { db.props[k] = String(v); }, deleteProperty: function (k) { delete db.props[k]; } }; } },
    CacheService: { getScriptCache: function () { return cacheApi; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (t) { return { t: t, setMimeType: function () { return this; } }; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    Logger: { log: function () {} },
    Utilities: {
      formatDate: fmtDate, getUuid: uuid,
      base64Encode: function (b) { var u = typeof b === 'string' ? utf8(b) : bytesOf(b), s = '', i; for (i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); },
      base64Decode: function (s) { var r = atob(String(s)), o = new Array(r.length); for (var i = 0; i < r.length; i++) { var v = r.charCodeAt(i); o[i] = v > 127 ? v - 256 : v; } return o; },
      newBlob: function (bytes, type, name) { return { getBytes: function () { return bytes; }, getContentType: function () { return type; }, getName: function () { return name; } }; },
      DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
      computeDigest: function (alg, v) { return sha256(typeof v === 'string' ? utf8(v) : bytesOf(v)); }
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 },
      getFoldersByName: function () { return { hasNext: function () { return false; } }; },
      createFolder: function () { return folder; }, getFolderById: function () { return folder; },
      getFileById: function (id) { if (!files[id]) throw new Error('ไม่พบไฟล์ (โหมดตัวอย่างเก็บรูปไว้ชั่วคราวในหน้านี้เท่านั้น)'); return mkFile(files[id]); }
    }
  };

  // ----- โหลด LoanCenter.gs ตัวจริงมารัน -----
  function srcUrl() { return C.DEMO_SRC || new URL('../gas/LoanCenter.gs', location.href).href; }
  var LAT = 420;   // หน่วงเวลาเล็กน้อยให้ใกล้ของจริง (เห็นสถานะกำลังโหลด) — ปรับได้ด้วย ELC_DEMO.latency
  var api = { latency: LAT };
  function boot() {
    if (engine) return Promise.resolve(engine);
    if (booting) return booting;
    var s = ss(), raw = s && s.getItem(DK);
    try { db = raw ? JSON.parse(raw) : emptyDb(); } catch (e) { db = emptyDb(); }
    booting = fetch(srcUrl(), { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(function (src) {
      var ASSET_HEADERS = ['assetId', 'assetNo', 'name', 'category', 'brand', 'model', 'serialNo', 'spec', 'acquireMethod', 'fundSource', 'unitPrice', 'acquireDate', 'docRef', 'vendor', 'warrantyEnd', 'lifeYears', 'location', 'custodian', 'status', 'loanable', 'calibDue', 'remark', 'photoIds', 'thumb', 'voided', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'checkIntervalDays', 'qrKey', 'qrText', 'qrFileId', 'qrImg', 'qrAt', 'lastCheckAt', 'lastCheckBy', 'lastCheckResult', 'nextCheckDue'];
      var ASSET_FIELDS = ['assetNo', 'name', 'category', 'brand', 'model', 'serialNo', 'spec', 'acquireMethod', 'fundSource', 'unitPrice', 'acquireDate', 'docRef', 'vendor', 'warrantyEnd', 'lifeYears', 'location', 'custodian', 'status', 'loanable', 'calibDue', 'remark', 'checkIntervalDays'];
      var names = ['SpreadsheetApp', 'PropertiesService', 'CacheService', 'ContentService', 'LockService', 'Logger', 'Utilities', 'DriveApp', 'TIMEZONE', 'ASSET_HEADERS', 'ASSET_FIELDS', 'ASSET_FOLDER_NAME', 'ASSET_QR_FOLDER_NAME', 'getSpreadsheet', 'PT_QRCODE_'];
      var vals = [sandbox.SpreadsheetApp, sandbox.PropertiesService, sandbox.CacheService, sandbox.ContentService, sandbox.LockService, sandbox.Logger, sandbox.Utilities, sandbox.DriveApp,
        'Asia/Bangkok', ASSET_HEADERS, ASSET_FIELDS, 'PT Station - Equipment Photos', 'PT Station - Equipment QR', function () { return SS; },
        function (t, e) { if (!window.PT_QR) throw new Error('ไม่มีตัวสร้าง QR'); return window.PT_QR(t, e); }];
      var fn = new Function(names.join(','), src + '\n;return { handle: lc_handle_, errOut: lc_errOut_, hashPin: lc_hashPin_, seed: lcDemoSeed, clear: lcDemoClear, status: lcDemoStatus, sheets: lc_sheets_ };');
      engine = fn.apply(null, vals);
      engine.sheets();                                    // สร้างหัวตารางทุกชีต
      db.props.LC_FRONTEND_URL = new URL('./', location.href).href;
      if (!db.props.LC_PIN_SALT) { db.props.LC_PIN_SALT = 'demo-' + uuid().slice(0, 8); db.props.LC_ADMIN_PIN_HASH = engine.hashPin(PIN, db.props.LC_PIN_SALT); }
      if (!db.seeded) { engine.seed('ข้อมูลตัวอย่าง'); db.seeded = true; }
      save();
      return engine;
    }).catch(function (e) {
      booting = null; engine = null;
      var er = new Error('เปิดโหมดตัวอย่างไม่สำเร็จ (' + (e && e.message || e) + ') — ตรวจสอบว่าเปิดผ่าน GitHub Pages และมีไฟล์ gas/LoanCenter.gs');
      er.code = 'DEMO'; throw er;
    });
    return booting;
  }

  function raw(action, token, args) {
    return boot().then(function () {
      var out;
      try {
        if (action === 'assetQrBatch' && !window.PT_QR) {
          out = { ok: true, data: { results: (args && args.ids || []).map(function (id) { return { assetId: id, ok: true, sheetImage: 'none' }; }) } };
        } else out = { ok: true, data: engine.handle({ action: action, token: token, args: args }) };
      } catch (err) { out = engine.errOut(err); }
      save();
      return JSON.parse(JSON.stringify(out));
    }).then(function (j) { return new Promise(function (res) { setTimeout(function () { res(j); }, api.latency * (0.6 + Math.random() * 0.8)); }); });
  }

  api.active = active;
  api.pin = PIN;
  api.raw = raw;
  api.boot = boot;
  api.hint = { reqId: 'DEMOR001', phone: '0812345001' };
  api.reset = function () { var s = ss(); if (s) { s.removeItem(DK); s.removeItem('elc.demo.session'); } engine = null; booting = null; db = null; files = {}; };
  api.exit = function () {
    var s = ss(); if (s) { s.removeItem(AK); s.removeItem(DK); s.removeItem('elc.demo.session'); }
    location.reload();
  };
  window.ELC_DEMO = api;
})();
