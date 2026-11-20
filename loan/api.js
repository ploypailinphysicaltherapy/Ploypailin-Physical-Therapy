// ตัวเรียก backend (Google Apps Script) — ใช้ร่วมกันทั้งหน้าเจ้าหน้าที่ หน้าขอยืม และหน้าสแกน
// · โหมดตัวอย่าง (?demo=1): ส่งคำขอไปที่ ELC_DEMO (รัน LoanCenter.gs ในเบราว์เซอร์) แทนการเรียกเซิร์ฟเวอร์จริง
// · แจ้งสถานะ "กำลังติดต่อเซิร์ฟเวอร์" ผ่านอีเวนต์ elc:net {pending} ให้แถบโหลดด้านบน (ux.js) แสดงผล
(function () {
  var C = window.ELC_CONFIG || {}, D = window.ELC_DEMO, demo = !!(D && D.active());
  var KEY = demo ? 'elc.demo.session' : 'elc.session';
  var pending = 0;
  function load() { try { var s = JSON.parse((demo ? sessionStorage : localStorage).getItem(KEY) || 'null'); if (s && s.token && s.exp > Date.now()) return s; } catch (e) {} return null; }
  function save(s) { try { (demo ? sessionStorage : localStorage).setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function clear() { try { (demo ? sessionStorage : localStorage).removeItem(KEY); } catch (e) {} }
  function ApiErr(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function net(d) { pending = Math.max(0, pending + d); try { window.dispatchEvent(new CustomEvent('elc:net', { detail: { pending: pending } })); } catch (e) {} }
  function unwrap(j) {
    if (!j || j.ok !== true) {
      var code = j && j.code || 'INTERNAL';
      if (code === 'AUTH_REQUIRED') { clear(); window.dispatchEvent(new Event('elc:auth')); }
      throw ApiErr(code, j && j.error || 'เกิดข้อผิดพลาด');
    }
    return j.data;
  }
  function call(action, args, opts) {
    opts = opts || {};
    var s = load();
    if (demo) {
      net(1);
      return D.raw(action, s ? s.token : '', args || {}).then(unwrap).then(function (d) { net(-1); return d; }, function (e) { net(-1); throw e; });
    }
    if (!C.API_URL || /PASTE_DEPLOYMENT_ID_HERE/.test(C.API_URL)) return Promise.reject(ApiErr('CONFIG', 'ยังไม่ได้ตั้งค่า API_URL ในไฟล์ config.js'));
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, opts.timeout || 60000);
    net(1);
    // ส่งเป็น text/plain เพื่อเลี่ยง CORS preflight (Apps Script ไม่รองรับ OPTIONS)
    return fetch(C.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, token: s ? s.token : '', args: args || {} }), redirect: 'follow', signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw ApiErr('NETWORK', 'เชื่อมต่อระบบไม่สำเร็จ (' + r.status + ')'); return r.json(); })
      .then(unwrap)
      .catch(function (e) {
        if (e && e.code) throw e;
        if (e && e.name === 'AbortError') throw ApiErr('TIMEOUT', 'ระบบตอบสนองช้า กรุณาลองใหม่อีกครั้ง');
        throw ApiErr('NETWORK', 'เชื่อมต่อระบบไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
      })
      .then(function (d) { clearTimeout(t); net(-1); return d; }, function (e) { clearTimeout(t); net(-1); throw e; });
  }
  function login(name, pin) {
    return call('login', { name: name, pin: pin }).then(function (d) {
      save({ token: d.token, name: d.name, role: d.role, exp: Date.now() + (d.expiresIn - 120) * 1000 });
      return d;
    });
  }
  function logout() { var p = load() ? call('logout').catch(function () {}) : Promise.resolve(); return p.then(clear); }
  window.ELC_API = { call: call, login: login, logout: logout, session: load, clear: clear, demo: demo };
})();
