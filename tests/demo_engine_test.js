// ทดสอบโหมดตัวอย่างบนเว็บ (loan/demo.js + loan/api.js) — จำลองเบราว์เซอร์ด้วย vm แล้วรัน LoanCenter.gs ตัวจริง
const fs=require('fs'),vm=require('vm'),path=require('path');const ROOT=path.join(__dirname,'..');
const mk=()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]},_m:m}};
function browser(url,st){const u=new URL(url);const win={ELC_CONFIG:{},sessionStorage:st.s,localStorage:st.l,location:{href:url,pathname:u.pathname,search:u.search,hash:''},history:{replaceState(a,b,x){win.location.search=x.includes('?')?'?'+x.split('?')[1]:''}},
 dispatchEvent(){return true},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o&&o.detail}},Event:class{constructor(t){this.type=t}},URL,URLSearchParams,TextEncoder,btoa,atob,crypto:require('crypto').webcrypto,console,setTimeout,clearTimeout,Promise,JSON,Date,Math,
 fetch:()=>fs.promises.readFile(path.join(ROOT,'gas','LoanCenter.gs'),'utf8').then(t=>({ok:true,text:()=>t})),AbortController};
 win.window=win;vm.createContext(win);for(const f of['demo.js','api.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,'loan',f),'utf8'),win,{filename:f});return win}
let pass=0,fail=0;const T=async(n,f)=>{try{await f();pass++;console.log('PASS',n)}catch(e){fail++;console.log('FAIL',n,'→',e.message)}};
const eq=(a,b,m)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((m||'')+' got '+JSON.stringify(a)+' want '+JSON.stringify(b))};
const REAL=JSON.stringify({token:'t',name:'x',role:'admin',exp:Date.now()+36e5});
(async()=>{
 await T('ไม่ได้ล็อกอินจริง: ?demo=1 ใช้ไม่ได้ ไม่เปิดโหมด และล้างพารามิเตอร์',async()=>{const x={s:mk(),l:mk()};const w0=browser('https://x.github.io/R/loan/?demo=1',x);eq(w0.ELC_DEMO.active(),false);eq(w0.ELC_API.demo,false);eq(x.s.getItem('elc.demo'),null);eq(w0.location.search,'')});
 await T('ตั้งธง demo ไว้เอง แต่ไม่มีเซสชันจริง: ถูกล้างทิ้ง',async()=>{const x={s:mk(),l:mk()};x.s.setItem('elc.demo','1');x.s.setItem('elc.demo.db','{}');const w0=browser('https://x.github.io/R/loan/',x);eq(w0.ELC_DEMO.active(),false);eq(x.s.getItem('elc.demo'),null);eq(x.s.getItem('elc.demo.db'),null);eq(w0.ELC_DEMO.enter(),false)});
 await T('ล็อกอินจริงแล้ว: enter() เปิดได้ และเมื่อเซสชันจริงหมดอายุโหมดปิดเอง',async()=>{const x={s:mk(),l:mk()};x.l.setItem('elc.session',REAL);const w0=browser('https://x.github.io/R/loan/',x);eq(w0.ELC_DEMO.enter(),true);eq(w0.ELC_DEMO.active(),true);x.l.removeItem('elc.session');eq(w0.ELC_DEMO.active(),false);eq(x.s.getItem('elc.demo'),null)});
 const st={s:mk(),l:mk()};st.l.setItem('elc.session',REAL);const w=browser('https://x.github.io/R/loan/?demo=1',st);w.ELC_DEMO.latency=0;const A=w.ELC_API;
 await T('?demo=1 เปิดโหมดและล้างพารามิเตอร์',()=>{eq(w.ELC_DEMO.active(),true);eq(A.demo,true);eq(w.location.search,'')});
 await T('แคตตาล็อกจากข้อมูลตัวอย่าง',async()=>{const d=await A.call('requestCatalog');const s={};d.items.forEach(i=>s[i.state]=1);eq(Object.keys(s).sort(),['available','onLoan','overdue','unavailable'])});
 await T('ส่งคำขอ: ตรวจข้อมูลเหมือนจริง + สำเร็จ',async()=>{try{await A.call('requestCreate',{assetId:'DEMO001',firstName:'ก',lastName:'ข',phone:'1',to:'2099-01-01'});throw new Error('ควรไม่ผ่าน')}catch(e){eq(e.code,'BAD_REQUEST')}
  const t=new Date(Date.now()+7*36e5).toISOString().slice(0,10);eq((await A.call('requestCreate',{assetId:'DEMO009',firstName:'ทดลอง',lastName:'ระบบ',phone:'0899999999',from:t,to:t})).reqId,'R00001')});
 await T('ติดตามคำขอตัวอย่าง',async()=>eq((await A.call('requestStatus',{reqId:'DEMOR001',phone:'0812345001'})).status,'รออนุมัติ'));
 await T('ล็อกอินผิด/ถูก และเก็บเซสชันแยกจากของจริง',async()=>{try{await A.call('login',{name:'ทดสอบ',pin:'0'});throw new Error('ควรไม่ผ่าน')}catch(e){eq(e.code,'AUTH')}
  eq((await A.login('ผู้ทดลอง','123456')).role,'admin');eq(Object.keys(st.l._m),['elc.session'],'ห้ามเขียนทับเซสชันจริง');eq(Object.keys(st.s._m).includes('elc.demo.session'),true)});
 await T('เจ้าหน้าที่: แดชบอร์ด/ยืม/คืน/ตรวจ/เพิ่มรายการ',async()=>{const d=await A.call('dashboard');eq(d.overdue>=1&&d.checkDue>=1,true);
  const due=new Date(Date.now()+7*36e5+3*864e5).toISOString().slice(0,10);const c=await A.call('loanCheckout',{assetId:'DEMO001',borrowerName:'ทดลอง ยืม',borrowerType:'บุคลากร',dueDate:due});await A.call('loanReturn',{loanId:c.loanId});
  await A.call('assetCheckSave',{assetId:'DEMO001',result:'ปกติ'});eq((await A.call('assetSave',{name:'รายการทดลอง',assetNo:'T-1',loanable:'Y'})).created,true)});
 await T('ข้อมูลคงอยู่ข้ามหน้า',async()=>{const w2=browser('https://x.github.io/R/loan/staff.html',st);w2.ELC_DEMO.latency=0;eq(!!w2.ELC_API.session(),true);eq((await w2.ELC_API.call('assetList')).length,13)});
 await T('รีเซ็ตแล้วได้ชุดใหม่',async()=>{w.ELC_DEMO.reset();eq((await A.call('assetList').catch(e=>e)).code,'AUTH_REQUIRED')});
 await T('?demo=0 ปิดโหมดและล้างข้อมูล',async()=>{const w3=browser('https://x.github.io/R/loan/?demo=0',st);eq(w3.ELC_DEMO.active(),false);eq(st.s.getItem('elc.demo.db'),null)});
 console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0)})();
