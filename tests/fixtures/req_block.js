  // =====================================================================
  // ✅ V30: สร้างนัดหมายจากคำขอออนไลน์ — เปิดฟอร์มจองพร้อมข้อมูลผู้ขอ ตรวจช่วงเวลาว่าง และปิดคำขอให้อัตโนมัติเมื่อจองสำเร็จ
  // =====================================================================
  function reqNormName(n) { return String(n || '').replace(/^[\s\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]+/u, '').trim().toLowerCase(); }
  window.reqToBooking = function (id) {
    var r = (window._pubReqs || {})[id];
    if (!r) { Swal.fire('ไม่พบคำขอ', 'กรุณารีเฟรชหน้าคำขอแล้วลองใหม่', 'warning'); return; }
    var d = String(r.date || '').slice(0, 10), t = String(r.time || '').slice(0, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { Swal.fire('วันที่ไม่ถูกต้อง', 'อ่านวันที่ของคำขอนี้ไม่ได้ กรุณาสร้างนัดหมายจากปฏิทินด้วยตนเอง', 'warning'); return; }
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (new Date(d) < today) { Swal.fire('เลยวันที่ขอมาแล้ว', 'วันที่ ' + fmtReqDate(d) + ' ผ่านไปแล้ว — โทรประสานผู้ขอเพื่อนัดวันใหม่ หรือกดยกเลิกคำขอ', 'info'); return; }
    window._reqCtx = { requestId: id, name: r.name || '', phone: r.phone || '', note: r.note || '', visit: r.visitStatus || '', therapist: r.therapistName || '', date: d, time: t, armed: false };
    Modal.fire({ title: 'กำลังตรวจสอบช่วงเวลา...', allowOutsideClick: false, didOpen: function () { Modal.showLoading(); } });
    google.script.run.withSuccessHandler(function (groups) {
      Modal.close();
      groups = groups || [];
      if (groups.length === 1 && groups[0].isHoliday) { Swal.fire('วันหยุดทำการ', (groups[0].reason || '') + ' — โทรประสานผู้ขอเพื่อนัดวันใหม่', 'info'); return; }
      var want = reqNormName(r.therapistName), hits = [];
      groups.forEach(function (m) {
        var nm = reqNormName(m.name);
        (m.slots || []).forEach(function (sl) {
          if (String(sl.time || '').slice(0, 5) === t && !sl.booked && sl.type !== 'lunch' && !(sl.info && sl.info.hn === 'LUNCH')) hits.push({ m: m, slot: sl, same: !!want && (nm.indexOf(want) >= 0 || want.indexOf(nm) >= 0) });
        });
      });
      var pick = hits.filter(function (h) { return h.same; })[0] || (hits.length === 1 ? hits[0] : null);
      if (pick) {
        window._reqCtx.armed = true;
        window.openBookingForm(d, pick.slot.time, pick.m.id, pick.m.name);
      } else {
        Swal.fire({ icon: 'info', title: 'ช่วงเวลาที่ขอไม่ว่างแล้ว', text: 'เวลา ' + t + ' น. ของ ' + (r.therapistName || 'OPD') + ' ' + (hits.length ? 'มีหลายตัวเลือก' : 'เต็มหรือปิดแล้ว') + ' — เลือกเวลาใหม่จากปฏิทินที่จะเปิดให้ต่อไป', confirmButtonText: 'เลือกเวลาใหม่' }).then(function () {
          window._reqCtx.armed = true; window._reqCtx.pickAny = true; openDayModal(d);
        });
      }
    }).withFailureHandler(function (e) { Modal.close(); Swal.fire('โหลดตารางเวลาไม่สำเร็จ', String((e && e.message) || e), 'error'); }).getDailySlots(d);
  };
  (function () {
    var _obf = window.openBookingForm;
    window.openBookingForm = function (date, time, mid, mName) {
      _obf.apply(this, arguments);
      var c = window._reqCtx;
      if (!c || !c.armed) return;
      c.armed = false; c.bookedDate = date; c.bookedTime = time;
      var n = 0, iv = setInterval(function () {
        var nm = document.getElementById('inp-name'), ph = document.getElementById('inp-phone');
        if (nm && ph) {
          clearInterval(iv);
          if (c.name) nm.value = c.name;
          if (c.phone) ph.value = c.phone;
          var box = document.createElement('div');
          box.className = 'info-box';
          box.style.cssText = 'margin:0 0 14px;text-align:left;';
          var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (ch) { return '&#' + ch.charCodeAt(0) + ';'; }); };
          box.innerHTML = '<span class="material-icons-outlined">mark_email_read</span><div><strong>จากคำขอออนไลน์ ' + esc(c.requestId) + '</strong><br>' + esc(c.name) + ' · ' + esc(c.phone) + (c.visit ? ' · ' + esc(c.visit) : '') + (c.note ? '<br>หมายเหตุ: ' + esc(c.note) : '') + (c.date !== date || c.time !== time ? '<br><b>ช่วงเวลาที่ขอ ' + esc(c.date) + ' ' + esc(c.time) + ' ไม่ว่าง — กำลังจองเวลาใหม่ ' + esc(String(time).slice(0, 5)) + ' (โปรดแจ้งผู้ขอ)</b>' : '') + '<br>กรอก HN (หรือค้นหาผู้ป่วย) แล้วกดยืนยันจอง — ระบบจะปิดคำขอนี้ให้อัตโนมัติ</div>';
          var host = nm.closest('.form-group') ? nm.closest('.form-group').parentNode : nm.parentNode;
          host.insertBefore(box, host.firstChild);
        } else if (++n > 40) clearInterval(iv);
      }, 100);
    };
    window.reqBookingDone = function (data) {
      var c = window._reqCtx;
      if (!c || !c.bookedDate || data.date !== c.bookedDate || data.time !== c.bookedTime) return;
      window._reqCtx = null;
      gasRun('approvePublicRequest', [c.requestId], function (res) {
        if (res && res.success) {
          if (typeof refreshNotificationBadge === 'function') refreshNotificationBadge();
          if (document.getElementById('view-requests') && document.getElementById('view-requests').classList.contains('active')) loadPublicRequests();
          if (typeof Toast !== 'undefined' && Toast.fire) Toast.fire({ icon: 'success', title: 'ปิดคำขอออนไลน์ ' + c.requestId + ' แล้ว' });
        }
      }, function () {});
    };
  })();

