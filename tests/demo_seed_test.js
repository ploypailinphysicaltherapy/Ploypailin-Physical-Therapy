// ทดสอบข้อมูลตัวอย่าง (lcDemoSeed / lcDemoClear) บนระบบจำลอง Apps Script
const M=require('./mock_gas.js');const {call,run}=M;
let pass=0,fail=0;const T=(n,f)=>{try{f();pass++;console.log('PASS',n)}catch(e){fail++;console.log('FAIL',n,'→',e.message)}};
const eq=(a,b,m)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((m||'')+' got '+JSON.stringify(a)+' want '+JSON.stringify(b))};
const ok=r=>{if(!r.ok)throw new Error(r.code+': '+r.error);return r.data};
const login=ok(call('login',{name:'ผู้ทดสอบ',pin:'admin-456'})).token;
const real=ok(call('assetSave',{name:'เครื่องจริง',assetNo:'REAL-1',loanable:'Y',status:'ใช้งานได้'},login));
T('ก่อนสร้าง: ตัวอย่าง=0',()=>eq(run('lcDemoStatus()').assets,0));
T('สร้างตัวอย่าง',()=>{const r=run("lcDemoSeed('ผู้ทดสอบ')");eq([r.assets,r.loans,r.requests],[12,8,5])});
T('สร้างซ้ำไม่ซ้อน',()=>{run("lcDemoSeed('ผู้ทดสอบ')");const s=run('lcDemoStatus()');eq([s.assets,s.loans,s.requests],[12,8,5])});
T('แดชบอร์ดมีเกินกำหนด/ใกล้ครบ/ถึงรอบตรวจ',()=>{const d=ok(call('dashboard',{},login));if(d.overdue<1||d.dueSoon.length<1||d.checkDue<1||d.onLoan<4)throw new Error(JSON.stringify(d).slice(0,200))});
T('แคตตาล็อกผู้ยืมเห็นครบหลายสถานะ',()=>{const c=ok(call('requestCatalog',{}));const st={};c.items.forEach(i=>st[i.state]=1);if(!st.available||!st.onLoan||!st.overdue)throw new Error(JSON.stringify(st))});
T('ติดตามคำขอ DEMOR001',()=>eq(ok(call('requestStatus',{reqId:'demor001',phone:'0812345001'})).status,'รออนุมัติ'));
T('สแกน QR ตัวอย่าง',()=>{const r=ok(call('scan',{id:'DEMO001',k:'d3a0c001'}));eq(r.valid,true)});
T('อนุมัติคำขอตัวอย่าง',()=>eq(run("lcReqDecide('DEMOR001','approve','','ผู้ทดสอบ')").status,'อนุมัติแล้ว'));
T('ลบตัวอย่างไม่แตะข้อมูลจริง',()=>{const r=run("lcDemoClear('x')");eq([r.assets,r.loans,r.checks,r.requests],[12,9,5,5]);
  eq(ok(call('assetList',{},login)).map(x=>x.assetId),[real.assetId]);eq(ok(call('loanList',{scope:'all',limit:300},login)).length,0);eq(run('lcDemoStatus()').has,false)});
T('ประวัติจริงยังอยู่ ตัวอย่างหาย',()=>{const lg=ok(call('assetLogList',{limit:150},login));if(lg.some(x=>String(x.assetId).startsWith('DEMO')))throw new Error('ค้าง');if(!lg.some(x=>x.assetId===real.assetId))throw new Error('log จริงหาย')});
console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
