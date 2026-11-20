// ตั้งค่าหน้าเว็บศูนย์ยืม-คืนอุปกรณ์ — แก้ไฟล์นี้ไฟล์เดียว
window.ELC_CONFIG = {
  // ลิงก์ Web App ของ Google Apps Script (โปรเจกต์ PT Station เดียวกัน ลิงก์เดียวกับหน้าแรก) ลงท้าย /exec
  API_URL: 'https://script.google.com/macros/s/AKfycbzIVunburtBYHAN8oj300unyxDqLlI6oYtcr075uglatGxBu8b6hsuWO-23ZFJ69xQ/exec',
  // ชื่อที่แสดงบนหัวระบบและบนป้าย QR
  ORG_NAME: 'ศูนย์ยืม-คืนอุปกรณ์',
  ORG_SUB: 'รพ.สต.บางขะแยง',
  // ปุ่ม "กลับระบบหลัก" → หน้าแรก PT Station (โฟลเดอร์ก่อนหน้า)
  HOME_URL: '../',
  // ทางเข้าระบบแอดมิน (Apps Script) — แสดงเฉพาะในเมนู "เจ้าหน้าที่" ท้ายหน้าขอยืม · เว้นว่างเพื่อซ่อน
  ADMIN_URL: 'https://script.google.com/macros/s/AKfycbzIVunburtBYHAN8oj300unyxDqLlI6oYtcr075uglatGxBu8b6hsuWO-23ZFJ69xQ/exec'
};
