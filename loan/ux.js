/* UX ร่วม: แถบโหลดบนสุด · โครงโหลด (skeleton) · เลือนรูปเข้า · แถบโหมดตัวอย่าง
   โหลดหลัง api.js ในทุกหน้า (index / staff / scan) — ไม่มี dependency */
(function () {
  var D = document, root = D.documentElement, ELC = window.ELC_DEMO;
  root.classList.add('js');
  var bar = D.createElement('div'); bar.id = 'elc-bar'; bar.setAttribute('aria-hidden', 'true'); bar.innerHTML = '<i></i>';
  var showT = 0, hideT = 0, shownAt = 0;
  function mount() { if (!bar.parentNode && D.body) D.body.appendChild(bar); }
  window.addEventListener('elc:net', function (e) {
    var n = e.detail && e.detail.pending || 0; mount();
    clearTimeout(showT); clearTimeout(hideT);
    if (n > 0) showT = setTimeout(function () { shownAt = Date.now(); bar.classList.add('on'); }, 120);   // คำขอที่เสร็จใน 120 ms ไม่ต้องกะพริบ
    else { var wait = bar.classList.contains('on') ? Math.max(0, 380 - (Date.now() - shownAt)) : 0; hideT = setTimeout(function () { bar.classList.remove('on'); }, wait); }
  });
  function sk(c, st) { return '<i class="sk ' + (c || '') + '"' + (st ? ' style="' + st + '"' : '') + '></i>'; }
  function rows(n) { var h = ''; for (var i = 0; i < n; i++) h += '<div class="sk-row">' + sk('sq') + '<div>' + sk('t w60') + sk('t w40') + '</div>' + sk('t') + '</div>'; return h; }
  function head(b) { return '<div class="sk-ph"><div>' + sk('h') + sk('t w30') + '</div><div style="display:flex;gap:10px">' + (b || '') + '</div></div>'; }
  var K = {
    dash: function () { return head(sk('btn-s') + sk('btn-s')) + '<div class="sk-sum">' + [1, 2, 3, 4].map(function () { return '<div class="sk-card">' + sk('h', 'width:46%;height:30px;margin:0') + sk('t w60') + '</div>'; }).join('') + '</div><div>' + sk('tl w30', 'margin-bottom:10px') + '<div class="sk-list">' + rows(2) + '</div></div><div>' + sk('tl w40', 'margin-bottom:10px') + '<div class="sk-list">' + rows(3) + '</div></div>'; },
    list: function () { return head(sk('btn-s')) + '<div class="sk-card" style="padding:10px">' + sk('in', 'height:44px;border-radius:999px') + '</div><div style="display:flex;gap:8px">' + [1, 2, 3, 4].map(function () { return sk('', 'height:38px;width:92px;border-radius:999px'); }).join('') + '</div><div class="sk-list">' + rows(6) + '</div>'; },
    detail: function () { return sk('t w30', 'width:140px') + '<div class="sk-ph"><div>' + sk('t w30', 'margin-bottom:8px') + sk('h', 'width:min(420px,80%)') + sk('t w40') + '</div>' + sk('sq', 'width:112px;border-radius:12px') + '</div><div style="display:flex;gap:10px;flex-wrap:wrap">' + [1, 2, 3, 4].map(function () { return sk('btn-s'); }).join('') + '</div><div class="sk-cols"><div class="sk-card">' + [1, 2, 3, 4, 5, 6, 7].map(function (i) { return '<div style="display:grid;grid-template-columns:34% 1fr;gap:14px">' + sk('t') + sk('t w' + (i % 2 ? 80 : 60)) + '</div>'; }).join('') + '</div><div class="sk-card">' + sk('tl w60') + sk('t') + sk('t w80') + sk('tl w40', 'margin-top:10px') + sk('t') + sk('t w60') + '</div></div>'; },
    form: function () { return sk('t w30', 'width:140px') + sk('h') + '<div class="sk-card"><div class="sk-form">' + [1, 2, 3, 4, 5, 6].map(function () { return '<div class="sk-field">' + sk('t w40') + sk('in') + '</div>'; }).join('') + '</div></div>'; },
    plain: function () { return head('') + '<div class="sk-card">' + sk('tl w60') + sk('t') + sk('t w80') + '</div>'; },
    cards: function () { return '<div class="sk-cards">' + [1, 2, 3, 4, 5, 6].map(function () { return '<div class="sk-card">' + sk('pic') + '<div>' + sk('t w40') + sk('tl w80') + sk('t w60') + '</div></div>'; }).join('') + '</div>'; },
    track: function () { return '<div class="sk-card">' + sk('tl w40') + sk('t w60') + '<div style="display:grid;gap:14px;margin:8px 0">' + [1, 2, 3, 4].map(function () { return '<div style="display:flex;gap:12px;align-items:center">' + sk('', 'width:32px;height:32px;border-radius:50%;flex:none') + sk('t w60') + '</div>'; }).join('') + '</div></div>'; }
  };
  function skel(kind) { return '<div class="sk-wrap" role="status" aria-busy="true"><span class="sr">กำลังโหลด…</span>' + (K[kind] || K.list)() + '</div>'; }
  function ld(e) { var t = e.target; if (t && t.tagName === 'IMG') t.classList.add('ld'); }
  D.addEventListener('load', ld, true); D.addEventListener('error', ld, true);
  function sweep() { Array.prototype.forEach.call(D.images, function (i) { if (i.complete) i.classList.add('ld'); }); }
  function demoBar() {
    if (!ELC || !ELC.active() || D.getElementById('demo-bar')) return;
    var staff = /staff\.html/.test(location.pathname);
    var b = D.createElement('div'); b.id = 'demo-bar'; b.className = 'demo-bar'; b.setAttribute('role', 'status');
    b.innerHTML = '<b>โหมดตัวอย่าง</b><span>ข้อมูลจำลอง ไม่กระทบระบบจริง</span>' +
      (staff ? '<a href="index.html">ดูหน้าผู้ยืม</a>' : '<a href="staff.html">ดูหน้าเจ้าหน้าที่ (รหัส ' + ELC.pin + ')</a>') +
      '<button type="button" data-demo="reset">รีเซ็ตข้อมูล</button><button type="button" data-demo="exit">ออกจากโหมดตัวอย่าง</button>';
    D.body.insertBefore(b, D.body.firstChild);
    b.addEventListener('click', function (e) {
      var a = e.target.closest('[data-demo]'); if (!a) return;
      if (a.dataset.demo === 'reset') { ELC.reset(); location.reload(); } else ELC.exit();
    });
  }
  window.ELC_UX = { skel: skel };
  function ready() { mount(); demoBar(); sweep(); }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', ready); else ready();
})();
