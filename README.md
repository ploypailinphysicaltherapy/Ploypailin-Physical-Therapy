# Ploypailin-Physical-Therapy — PT Station (รพ.สต.บางขะแยง)

เว็บเดียวจบทั้งระบบ — โฟลเดอร์นี้เผยแพร่ด้วย GitHub Pages (Branch `main` / folder `/ (root)`)

| ที่อยู่ | คืออะไร | ใครใช้ |
|---|---|---|
| `/` (`index.html`) | หน้าแรกของคลินิก · ลิงก์นัดหมายออนไลน์ | ผู้รับบริการ |
| `/loan/` | **ศูนย์ยืม-คืนอุปกรณ์ / ทะเบียนครุภัณฑ์ + QR** — ทำรายการจริงทั้งหมดที่นี่ | เจ้าหน้าที่ (ใช้ PIN) |
| `/loan/scan.html` | หน้าที่ป้าย QR ชี้มา (ข้อมูลพื้นฐานสาธารณะ) | ทุกคนที่สแกน |
| `/posters.html` | โปสเตอร์ประชาสัมพันธ์ | — |
| `/gas/` | ซอร์สฝั่ง Google Apps Script (backend + ระบบแอดมินดูข้อมูล) — **วางลง script.google.com ไม่ได้รันบน GitHub** | ผู้ดูแลระบบ |

## โครงสร้างระบบ

```
GitHub Pages (เว็บเดียว)                     Google Apps Script (โปรเจกต์ PT Station เดียว, Web App ลิงก์เดียว)
 ├─ index.html          ── JSONP ────────►  Code.gs        ปฏิทิน/นัดหมาย/คิวว่าง/KPI/LINE (เดิม)
 ├─ loan/index.html     ── POST JSON ────►  LoanCenter.gs  API ศูนย์ยืม-คืน (PIN → token)
 └─ loan/scan.html      ── GET ?action=scan► (ชีตเดียวกัน: AssetRegister, AssetLog, AssetLoans, AssetChecks)
                                            index.html     ระบบแอดมิน (เมนู ศูนย์ควบคุมอุปกรณ์ = ดูอย่างเดียว)
```

- **ทำรายการ** (เพิ่ม/แก้ครุภัณฑ์ · ยืม · รับคืน · ตรวจสภาพ · พิมพ์ QR) → `/loan/` บน GitHub เท่านั้น ต้องใส่ PIN
- **ดูภาพรวม** (ใครยืมอยู่ เกินกำหนด ถึงรอบตรวจ ประวัติ) → ลิงก์ Apps Script เมนู "ศูนย์ควบคุมอุปกรณ์" อ่านอย่างเดียว

## ติดตั้ง/อัปเดต

ดูขั้นตอนทีละข้อใน [`gas/README.md`](gas/README.md)

## ทดสอบ

```
npm install
npm test
```
ทดสอบ backend ที่รวมแล้ว (Code.gs + LoanCenter.gs) ด้วยระบบจำลอง Apps Script และหน้าเว็บ `/loan` ด้วย jsdom

## ลิขสิทธิ์ไลบรารี
QR: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 — MIT License © Kazuhiko Arase
