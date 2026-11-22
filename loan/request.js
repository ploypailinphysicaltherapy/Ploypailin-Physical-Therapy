/* หน้าขอยืมอุปกรณ์ (สาธารณะ) — ไม่ต้องล็อกอิน ส่งคำขอเข้า "ศูนย์ควบคุมอุปกรณ์ → คำขอยืม" ของระบบแอดมิน
   ทางเข้าหลักของศูนย์ยืม-คืนคือส่วนผู้ยืม (หน้านี้) · ทางเข้าผู้ดูแลถูกซ่อนไว้ในท้ายหน้า (เจ้าหน้าที่) */
(function () {
  // ลิงก์เก่า (QR รุ่นก่อน / ลิงก์จากระบบแอดมิน) ที่ชี้เข้าหน้าผู้ดูแล → ส่งต่อไป staff.html
  if (/^#\/(asset|assets|loans|scan|print|log)/.test(location.hash)) { location.replace('staff.html' + location.hash); return; }
  var API = window.ELC_API, C = window.ELC_CONFIG || {}, $ = function (s) { return document.querySelector(s); };
  var S = { items: [], cfg: {}, q: '', cat: '', loaded: false }, MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fd(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + (+m[1] + 543) : '-'; }
  function addDays(iso, n) { var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10); }
  function ic(n, c) { return '<svg class="ico' + (c ? ' ' + c : '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
  function toast(msg, bad) { var t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; $('#toasts').appendChild(t); setTimeout(function () { t.remove(); }, bad ? 5000 : 2800); }
  var STATE = { available: ['ok', 'พร้อมให้ยืม'], onLoan: ['acc', 'ถูกยืมอยู่ · จองคิวได้'], overdue: ['warn', 'ยังไม่ได้รับคืน'], unavailable: ['', 'ยังไม่พร้อมให้ยืม'] };

  // ---------- แท็บ: ขอยืม / ติดตามคำขอ ----------
  function tab(name, push) {
    name = name === 'status' ? 'status' : 'list';
    ['list', 'status'].forEach(function (k) {
      $('#p-' + k).hidden = k !== name;
      $('#t-' + k).setAttribute('aria-selected', String(k === name)); $('#t-' + k).tabIndex = k === name ? 0 : -1;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tb-nav a'), function (a) { if (a.dataset.tab === name) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    if (push && location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }
  function tabFromHash() { tab(location.hash === '#status' ? 'status' : 'list'); }
  window.addEventListener('hashchange', tabFromHash);
  document.querySelector('.seg').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var to = e.target.dataset.tab === 'list' ? 'status' : 'list'; tab(to, true); $('#t-' + to).focus();
  });

  // ---------- รายการอุปกรณ์ ----------
  function cats() { var o = {}; S.items.forEach(function (a) { if (a.category) o[a.category] = 1; }); return Object.keys(o).sort(); }
  function paintCats() {
    var c = cats(); $('#cats').hidden = c.length < 2;
    $('#cats').innerHTML = ['<button type="button" class="chip" data-cat="" aria-pressed="' + (!S.cat) + '">ทั้งหมด</button>'].concat(c.map(function (x) { return '<button type="button" class="chip" data-cat="' + esc(x) + '" aria-pressed="' + (S.cat === x) + '">' + esc(x) + '</button>'; })).join('');
  }
  function card(a) {
    var st = STATE[a.state] || STATE.unavailable, can = a.state === 'available' || a.state === 'onLoan';
    var sub = [a.category, a.location].filter(Boolean).join(' · ') + (a.state === 'onLoan' && a.dueDate ? ' · คาดว่าคืน ' + fd(a.dueDate) : '');
    return '<button type="button" class="eq" data-id="' + esc(a.assetId) + '"' + (can ? '' : ' disabled') + '><span class="eq-img">' + (a.thumb ? '<img alt="" loading="lazy" src="' + esc(a.thumb) + '">' : ic('box')) +
      '<span class="badge ' + st[0] + '">' + st[1] + '</span></span>' +
      '<span class="eq-b"><span class="badge m-badge ' + st[0] + '">' + st[1] + '</span><span class="no">' + esc(a.assetNo || a.assetId) + '</span><span class="t">' + esc(a.name) + '</span><span class="s">' + esc(sub || '-') + '</span>' +
      '<span class="go"><span>' + (a.pending ? 'มีผู้ขอแล้ว ' + a.pending + ' คำขอ' : can ? 'ขอยืมอุปกรณ์นี้' : 'ยังไม่เปิดให้ยืม') + '</span>' + (can ? '<span class="arr">' + ic('arrow', 'sm') + '</span>' : '') + '</span></span></button>';
  }
  function paint() {
    var q = S.q.toLowerCase(), rows = S.items.filter(function (a) { return (!S.cat || a.category === S.cat) && (!q || [a.assetNo, a.name, a.category, a.location].join(' ').toLowerCase().indexOf(q) >= 0); });
    var ready = S.items.filter(function (a) { return a.state === 'available'; }).length;
    $('#count').textContent = S.items.length ? 'พร้อมให้ยืม ' + ready + ' จาก ' + S.items.length + ' รายการ' + (rows.length !== S.items.length ? ' · แสดง ' + rows.length + ' รายการ' : '') : '';
    $('#list').innerHTML = rows.length ? '<div class="catalog">' + rows.map(card).join('') + '</div>' : '<div class="empty-st" style="margin-top:16px">' + ic('search') + '<b>' + (S.items.length ? 'ไม่พบอุปกรณ์ที่ตรงกับคำค้น' : 'ยังไม่มีอุปกรณ์ที่เปิดให้ยืม') + '</b><span>' + (S.items.length ? 'ลองค้นด้วยคำอื่น หรือเลือกหมวด "ทั้งหมด"' : 'โปรดกลับมาดูใหม่ หรือโทรสอบถามเจ้าหน้าที่') + '</span></div>';
  }
  function find(id) { return S.items.filter(function (a) { return a.assetId === id; })[0]; }
  function load() {
    API.call('requestCatalog').then(function (d) { S.items = d.items; S.cfg = d; S.loaded = true; paintCats(); paint(); var p = new URLSearchParams(location.search).get('asset'); if (p) { history.replaceState(null, '', location.pathname + location.hash); var a = find(p); if (a && (a.state === 'available' || a.state === 'onLoan')) openForm(a.assetId); } })
      .catch(function (e) { $('#list').innerHTML = '<div class="empty-st" style="margin-top:16px">' + ic('x') + '<b>' + esc(e.message) + '</b><button class="btn sm" id="retry" type="button" style="margin-top:8px">ลองใหม่</button></div>'; });
  }

  // ---------- ฟอร์มขอยืม ----------
  var dlg = $('#dlg'), lastFocus = null;
  function closeDlg() { if (dlg.open) dlg.close(); if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} } }
  function openForm(id) {
    var a = find(id); if (!a) return; var today = S.cfg.today, min = a.state === 'onLoan' && a.dueDate ? addDays(a.dueDate, 1) : today, to = addDays(min, S.cfg.defaultLoanDays || 7);
    lastFocus = document.activeElement;
    dlg.innerHTML = '<form id="rqForm" class="rq" novalidate><h2>ขอยืมอุปกรณ์</h2>' +
      '<div class="who2"><span class="th">' + (a.thumb ? '<img alt="" src="' + esc(a.thumb) + '">' : ic('box')) + '</span><span><b>' + esc(a.name) + '</b><span>' + esc([a.assetNo, a.location].filter(Boolean).join(' · ')) + (a.state === 'onLoan' && a.dueDate ? ' · ถูกยืมอยู่ถึง ' + fd(a.dueDate) : '') + '</span></span></div>' +
      '<div class="fg"><div><label for="fn">ชื่อ <em>*</em></label><input id="fn" name="firstName" type="text" autocomplete="given-name" maxlength="60" required></div>' +
      '<div><label for="ln">นามสกุล <em>*</em></label><input id="ln" name="lastName" type="text" autocomplete="family-name" maxlength="60" required></div>' +
      '<div class="full"><label for="ph">เบอร์โทรศัพท์ <em>*</em></label><input id="ph" name="phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="12" placeholder="0812345678" required><p class="hint">เจ้าหน้าที่ใช้โทรกลับเมื่ออนุมัติ</p></div>' +
      '<div><label for="df">วันที่ต้องการใช้ <em>*</em></label><input id="df" name="from" type="date" min="' + min + '" value="' + min + '" required></div>' +
      '<div><label for="dt">วันที่จะคืน <em>*</em></label><input id="dt" name="to" type="date" min="' + min + '" value="' + to + '" required></div>' +
      '<div class="full"><label for="pp">วัตถุประสงค์ (ถ้ามี)</label><textarea id="pp" name="purpose" maxlength="300" placeholder="เช่น ใช้ดูแลผู้ป่วยติดเตียงที่บ้าน"></textarea></div>' +
      '<div class="hp" aria-hidden="true"><label>เว็บไซต์<input name="website" tabindex="-1" autocomplete="off"></label></div></div>' +
      '<p class="err" role="alert" id="rqErr" hidden></p><div class="foot"><button class="btn pri" type="submit">' + ic('send', 'sm') + 'ส่งคำขอ</button><button class="btn" type="button" data-close>ยกเลิก</button></div>' +
      '<p class="hint" style="margin-top:12px">ยืมได้ครั้งละไม่เกิน ' + (S.cfg.maxLoanDays || 90) + ' วัน · คำขอจะถูกพิจารณาโดยเจ้าหน้าที่</p></form>';
    dlg.showModal(); $('#fn').focus();
    $('#rqForm').addEventListener('submit', function (e) {
      e.preventDefault(); var f = e.target, b = f.querySelector('button[type=submit]'), er = $('#rqErr'); er.hidden = true;
      var d = {}; Array.prototype.forEach.call(f.elements, function (x) { if (x.name) d[x.name] = x.value.trim(); }); d.assetId = a.assetId;
      var bad = !d.firstName ? 'กรุณากรอกชื่อ' : !d.lastName ? 'กรุณากรอกนามสกุล' : !/^0\d{8,9}$/.test(d.phone.replace(/\D/g, '')) ? 'เบอร์โทรไม่ถูกต้อง (เช่น 0812345678)' : !d.from || !d.to ? 'กรุณาเลือกวันที่' : d.to < d.from ? 'วันที่คืนต้องไม่ก่อนวันที่เริ่มใช้' : '';
      if (bad) { er.textContent = bad; er.hidden = false; return; }
      b.disabled = true; b.classList.add('busy');
      API.call('requestCreate', d).then(function (r) { done(r, d); load(); })
        .catch(function (x) { er.textContent = x.message; er.hidden = false; b.disabled = false; b.classList.remove('busy'); });
    });
  }
  function done(r, d) {
    dlg.innerHTML = '<div class="done" aria-live="polite"><div class="okmark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h2>ส่งคำขอเรียบร้อย</h2><p class="hint">กรุณาจดเลขคำขอไว้ ใช้ติดตามสถานะได้ทุกเมื่อ</p><div class="id">' + esc(r.reqId) + '</div>' +
      '<div class="rows"><div><span>อุปกรณ์</span><b>' + esc(r.assetName) + '</b></div><div><span>ผู้ขอ</span><b>' + esc(d.firstName + ' ' + d.lastName) + '</b></div><div><span>ช่วงที่ขอ</span><b>' + fd(d.from) + ' – ' + fd(d.to) + '</b></div><div><span>เจ้าหน้าที่จะโทรกลับ</span><b>' + esc(d.phone) + '</b></div></div>' +
      '<div class="foot"><button class="btn pri" type="button" data-track="' + esc(r.reqId) + '" data-phone="' + esc(d.phone) + '">ติดตามสถานะคำขอ</button><button class="btn" type="button" data-close>เรียบร้อย</button></div></div>';
  }

  // ---------- ติดตามคำขอ (ตัวแสดงขั้นตอน) ----------
  function pipe(r) {
    var ok = r.status === 'อนุมัติแล้ว', no = r.status === 'ปฏิเสธ', pend = !ok && !no;
    var steps = [
      ['done-s', 'check', 'ส่งคำขอแล้ว', 'ได้รับเรื่องแล้ว'],
      [pend ? 'now' : 'done-s', pend ? 'clock' : 'check', 'เจ้าหน้าที่พิจารณา', pend ? 'กำลังรอ' : 'เสร็จสิ้น'],
      [ok ? 'ok-s' : no ? 'no-s' : 'off', ok ? 'check' : no ? 'x' : 'doc', ok ? 'อนุมัติแล้ว' : no ? 'ไม่อนุมัติ' : 'ผลการพิจารณา', ''],
      [ok ? 'now' : 'off', 'phone', 'นัดรับอุปกรณ์', ok ? 'รอเจ้าหน้าที่โทรนัด' : '']
    ];
    return '<ol class="pipe" aria-label="ขั้นตอนของคำขอ">' + steps.map(function (s) { return '<li class="' + s[0] + '"' + (s[0] === 'now' ? ' aria-current="step"' : '') + '><span class="dot">' + ic(s[1]) + '</span><div>' + esc(s[2]) + (s[3] ? '<small>' + esc(s[3]) + '</small>' : '') + '</div></li>'; }).join('') + '</ol>';
  }
  function checkStatus(id, ph) {
    var out = $('#stOut');
    if (!id || !ph) { out.innerHTML = '<p class="err" role="alert">กรุณากรอกเลขคำขอและเบอร์โทร</p>'; return; }
    out.innerHTML = window.ELC_UX ? window.ELC_UX.skel('track') : '<div class="card pad track"><p class="loading">กำลังตรวจสอบ…</p></div>';
    API.call('requestStatus', { reqId: id, phone: ph }).then(function (r) {
      var ok = r.status === 'อนุมัติแล้ว', no = r.status === 'ปฏิเสธ', c = ok ? 'ok' : no ? 'bad' : 'warn';
      out.innerHTML = '<div class="card pad track"><div class="track-h"><div><div class="id">' + esc(r.reqId) + '</div><p>' + esc(r.assetName) + '</p></div><span class="badge ' + c + '">' + esc(r.status) + '</span></div>' + pipe(r) +
        '<dl class="kv"><dt>ช่วงที่ขอ</dt><dd>' + fd(r.from) + ' – ' + fd(r.to) + '</dd></dl>' +
        (r.note ? '<div class="note ' + (no ? 'bad' : '') + '"><b>หมายเหตุจากเจ้าหน้าที่</b>' + esc(r.note) + '</div>' : '') +
        (ok ? '<div class="note ok"><b>เจ้าหน้าที่จะนัดรับอุปกรณ์ทางโทรศัพท์</b>กรุณารับสายเบอร์ 02-598-2723 หรือโทรกลับในเวลาทำการ</div>' : no ? '<div class="note bad"><b>คำขอนี้ไม่ได้รับการอนุมัติ</b>สอบถามเพิ่มเติมได้ที่ 02-598-2723 หรือเลือกอุปกรณ์อื่นแล้วส่งคำขอใหม่</div>' : '<div class="note"><b>กำลังรอเจ้าหน้าที่พิจารณา</b>โดยปกติจะติดต่อกลับในเวลาทำการ (จ–ศ 08:30–16:00 น.)</div>') + '</div>';
    }).catch(function (x) { out.innerHTML = '<p class="err" role="alert">' + esc(x.message) + '</p>'; });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-id],[data-cat],[data-close],[data-track],[data-tab],#retry'); if (!t) { var d = $('#staffD'); if (d && d.open && !d.contains(e.target)) d.open = false; return; }
    if (t.hasAttribute('data-close')) return closeDlg();
    if (t.hasAttribute('data-track')) { var f = $('#stForm'); f.elements.id.value = t.getAttribute('data-track'); f.elements.phone.value = t.getAttribute('data-phone') || ''; closeDlg(); tab('status', true); checkStatus(f.elements.id.value.trim(), f.elements.phone.value.trim()); return; }
    if (t.hasAttribute('data-tab')) { e.preventDefault(); return tab(t.dataset.tab, true); }
    if (t.id === 'retry') { $('#list').innerHTML = window.ELC_UX ? window.ELC_UX.skel('cards') : '<div class="skel"><i></i><i></i><i></i></div>'; return load(); }
    if (t.hasAttribute('data-cat')) { S.cat = t.getAttribute('data-cat'); paintCats(); return paint(); }
    if (t.hasAttribute('data-id') && !t.disabled) openForm(t.getAttribute('data-id'));
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var d = $('#staffD'); if (d && d.open) { d.open = false; d.querySelector('summary').focus(); } } });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDlg(); });
  $('#q').addEventListener('input', function (e) { S.q = e.target.value.trim(); paint(); });
  $('#stForm').addEventListener('submit', function (e) { e.preventDefault(); var f = e.target; checkStatus(f.elements.id.value.trim(), f.elements.phone.value.trim()); });
  // ทางเข้าผู้ดูแล (ซ่อนอยู่ใน "เจ้าหน้าที่" ท้ายหน้า)
  var hm = $('#homeLink'); if (hm && C.HOME_URL) hm.href = C.HOME_URL;
  // โหมดตัวอย่าง: ปุ่มเติมเลขคำขอ/เบอร์ตัวอย่างให้ลองหน้า "ติดตามคำขอ"
  if (window.ELC_DEMO && window.ELC_DEMO.active()) {
    var dl = $('#demoLink'); if (dl) dl.hidden = true;
    var h = window.ELC_DEMO.hint, fb = document.createElement('div'); fb.className = 'demo-fill';
    fb.innerHTML = 'ลองดูตัวอย่าง: <button class="btn sm" type="button" id="demoFill">ใช้เลขคำขอ ' + esc(h.reqId) + '</button>';
    $('#stForm').parentNode.appendChild(fb);
    $('#demoFill').addEventListener('click', function () { var f = $('#stForm'); f.elements.id.value = h.reqId; f.elements.phone.value = h.phone; checkStatus(h.reqId, h.phone); });
  }
  tabFromHash(); load();
})();
