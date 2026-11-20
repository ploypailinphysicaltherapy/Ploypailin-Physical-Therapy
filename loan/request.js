/* หน้าขอยืมอุปกรณ์ (สาธารณะ) — ไม่ต้องล็อกอิน ส่งคำขอเข้า "ศูนย์ควบคุมอุปกรณ์ → คำขอยืม" ของระบบแอดมิน */
(function () {
  // ลิงก์เก่า (QR รุ่นก่อน / ลิงก์จากระบบแอดมิน) ที่ชี้เข้าหน้าผู้ดูแล → ส่งต่อไป staff.html
  if (/^#\/(asset|assets|loans|scan|print|log)/.test(location.hash)) { location.replace('staff.html' + location.hash); return; }
  var API = window.ELC_API, $ = function (s) { return document.querySelector(s); };
  var S = { items: [], cfg: {}, q: '', cat: '' }, MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fd(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + (+m[1] + 543) : '-'; }
  function addDays(iso, n) { var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10); }
  function toast(msg, bad) { var t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; $('#toasts').appendChild(t); setTimeout(function () { t.remove(); }, bad ? 5000 : 2800); }
  var STATE = { available: ['ok', 'พร้อมให้ยืม'], onLoan: ['acc', 'ถูกยืมอยู่'], overdue: ['warn', 'ยังไม่ได้รับคืน'], unavailable: ['', 'ยังไม่พร้อมให้ยืม'] };

  function cats() { var o = {}; S.items.forEach(function (a) { if (a.category) o[a.category] = 1; }); return Object.keys(o).sort(); }
  function paintCats() {
    var c = cats(); $('#cats').hidden = c.length < 2;
    $('#cats').innerHTML = ['<button type="button" class="chip" data-cat="" aria-pressed="' + (!S.cat) + '">ทั้งหมด</button>'].concat(c.map(function (x) { return '<button type="button" class="chip" data-cat="' + esc(x) + '" aria-pressed="' + (S.cat === x) + '">' + esc(x) + '</button>'; })).join('');
  }
  function row(a) {
    var st = STATE[a.state] || STATE.unavailable, can = a.state === 'available' || a.state === 'onLoan';
    var sub = [a.category, a.location].filter(Boolean).join(' · ') + (a.state === 'onLoan' && a.dueDate ? ' · คาดว่าคืน ' + fd(a.dueDate) : '');
    return '<button type="button" class="li" data-id="' + esc(a.assetId) + '"' + (can ? '' : ' disabled') + '><span class="th">' + (a.thumb ? '<img alt="" src="' + esc(a.thumb) + '">' : '<svg class="ico" aria-hidden="true"><use href="#i-box"/></svg>') + '</span>' +
      '<span class="mn"><span class="no">' + esc(a.assetNo || a.assetId) + '</span><div class="t">' + esc(a.name) + '</div><div class="s">' + esc(sub) + '</div></span>' +
      '<span class="end"><span class="badge ' + st[0] + '">' + st[1] + '</span>' + (a.pending ? '<span class="badge">มีผู้ขอแล้ว ' + a.pending + '</span>' : '') + '</span></button>';
  }
  function paint() {
    var q = S.q.toLowerCase(), rows = S.items.filter(function (a) { return (!S.cat || a.category === S.cat) && (!q || [a.assetNo, a.name, a.category, a.location].join(' ').toLowerCase().indexOf(q) >= 0); });
    $('#list').innerHTML = rows.length ? '<div class="list">' + rows.map(row).join('') + '</div>' : '<div class="list"><div class="empty">' + (S.items.length ? 'ไม่พบอุปกรณ์ที่ตรงกับคำค้น' : 'ยังไม่มีอุปกรณ์ที่เปิดให้ยืม') + '</div></div>';
  }
  function find(id) { return S.items.filter(function (a) { return a.assetId === id; })[0]; }
  function load() {
    API.call('requestCatalog').then(function (d) { S.items = d.items; S.cfg = d; paintCats(); paint(); var p = new URLSearchParams(location.search).get('asset'); if (p) { history.replaceState(null, '', location.pathname); var a = find(p); if (a && (a.state === 'available' || a.state === 'onLoan')) openForm(a.assetId); } })
      .catch(function (e) { $('#list').innerHTML = '<div class="list"><div class="empty">' + esc(e.message) + '<br><button class="btn sm" style="margin-top:10px" id="retry">ลองใหม่</button></div></div>'; });
  }

  var dlg = $('#dlg');
  function closeDlg() { if (dlg.open) dlg.close(); }
  function openForm(id) {
    var a = find(id); if (!a) return; var today = S.cfg.today, min = a.state === 'onLoan' && a.dueDate ? addDays(a.dueDate, 1) : today, to = addDays(min, S.cfg.defaultLoanDays || 7);
    dlg.innerHTML = '<form id="rqForm" class="rq" novalidate><h2>ขอยืม: ' + esc(a.name) + '</h2><p class="hint" style="margin-bottom:14px">' + esc([a.assetNo, a.location].filter(Boolean).join(' · ')) + '</p>' +
      '<div class="fg"><div><label for="fn">ชื่อ <em>*</em></label><input id="fn" name="firstName" type="text" autocomplete="given-name" maxlength="60" required></div>' +
      '<div><label for="ln">นามสกุล <em>*</em></label><input id="ln" name="lastName" type="text" autocomplete="family-name" maxlength="60" required></div>' +
      '<div class="full"><label for="ph">เบอร์โทรศัพท์ <em>*</em></label><input id="ph" name="phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="12" placeholder="0812345678" required><p class="hint">เจ้าหน้าที่ใช้โทรกลับเมื่ออนุมัติ</p></div>' +
      '<div><label for="df">วันที่ต้องการใช้ <em>*</em></label><input id="df" name="from" type="date" min="' + min + '" value="' + min + '" required></div>' +
      '<div><label for="dt">วันที่จะคืน <em>*</em></label><input id="dt" name="to" type="date" min="' + min + '" value="' + to + '" required></div>' +
      '<div class="full"><label for="pp">วัตถุประสงค์ (ถ้ามี)</label><textarea id="pp" name="purpose" maxlength="300" placeholder="เช่น ใช้ดูแลผู้ป่วยติดเตียงที่บ้าน"></textarea></div>' +
      '<div class="hp" aria-hidden="true"><label>เว็บไซต์<input name="website" tabindex="-1" autocomplete="off"></label></div></div>' +
      '<p class="err" role="alert" id="rqErr" hidden></p><div class="foot"><button class="btn pri" type="submit">ส่งคำขอ</button><button class="btn" type="button" data-close>ยกเลิก</button></div>' +
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
    dlg.innerHTML = '<div class="rq done"><h2>ส่งคำขอเรียบร้อย</h2><div class="id">' + esc(r.reqId) + '</div><p>กรุณาจดเลขคำขอไว้ เจ้าหน้าที่จะพิจารณาและโทรกลับที่ <b>' + esc(d.phone) + '</b></p>' +
      '<dl class="kv"><dt>อุปกรณ์</dt><dd>' + esc(r.assetName) + '</dd><dt>ผู้ขอ</dt><dd>' + esc(d.firstName + ' ' + d.lastName) + '</dd><dt>ช่วงที่ขอ</dt><dd>' + fd(d.from) + ' – ' + fd(d.to) + '</dd></dl>' +
      '<div class="foot" style="justify-content:center"><button class="btn pri" type="button" data-close>เรียบร้อย</button></div></div>';
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-id],[data-cat],[data-close],#retry'); if (!t) return;
    if (t.hasAttribute('data-close')) return closeDlg();
    if (t.id === 'retry') { $('#list').innerHTML = '<p class="loading">กำลังโหลดรายการ…</p>'; return load(); }
    if (t.hasAttribute('data-cat')) { S.cat = t.getAttribute('data-cat'); paintCats(); return paint(); }
    if (t.hasAttribute('data-id') && !t.disabled) openForm(t.getAttribute('data-id'));
  });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDlg(); });
  $('#q').addEventListener('input', function (e) { S.q = e.target.value.trim(); paint(); });
  $('#stForm').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target, out = $('#stOut'), id = f.elements.id.value.trim(), ph = f.elements.phone.value.trim();
    if (!id || !ph) { out.innerHTML = '<p class="err" role="alert">กรุณากรอกเลขคำขอและเบอร์โทร</p>'; return; }
    out.innerHTML = '<p class="loading" style="color:var(--ink2)">กำลังตรวจสอบ…</p>';
    API.call('requestStatus', { reqId: id, phone: ph }).then(function (r) {
      var c = r.status === 'อนุมัติแล้ว' ? 'ok' : r.status === 'ปฏิเสธ' ? 'bad' : 'warn';
      out.innerHTML = '<div class="stat"><b>' + esc(r.reqId) + ' · ' + esc(r.assetName) + '</b><span class="badge ' + c + '">' + esc(r.status) + '</span><p class="hint">ช่วงที่ขอ ' + fd(r.from) + ' – ' + fd(r.to) + (r.note ? ' · หมายเหตุจากเจ้าหน้าที่: ' + esc(r.note) : '') + (r.status === 'อนุมัติแล้ว' ? ' · เจ้าหน้าที่จะนัดรับอุปกรณ์ทางโทรศัพท์' : '') + '</p></div>';
    }).catch(function (x) { out.innerHTML = '<p class="err" role="alert">' + esc(x.message) + '</p>'; });
  });
  load();
})();
