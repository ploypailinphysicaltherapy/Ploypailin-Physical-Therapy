// ทดสอบหน้า Apps Script (gas/index.html): ศูนย์ควบคุมอุปกรณ์ = ดูอย่างเดียว + สร้างนัดหมายจากคำขอออนไลน์
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'..','gas','index.html'),'utf8');
let pass=0,fail=0;const T=(n,c,d)=>{if(c){pass++;console.log('PASS',n)}else{fail++;console.log('FAIL',n,d||'')}};
const blocks=[...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const big=blocks.reduce((a,b)=>a.length>b.length?a:b);
// ---- ส่วน 1: eqc ----
{
 const a=big.indexOf('var _eqc = {'),b=big.indexOf('// ---------- เปิดจากการสแกน QR');
 const start=big.lastIndexOf('\n  var EQC_',a)>0?big.lastIndexOf('\n  var EQC_',a):a;
 const body=big.slice(big.indexOf('var EQC_'),b);
 const view=html.slice(html.indexOf('<div id="view-equipment"'),html.indexOf('<div id="view-trend"'));
 const dom=new JSDOM('<body>'+view+'</body>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 const items=[{assetId:'A00001',assetNo:'WK-1',name:'วอล์คเกอร์',category:'อุปกรณ์ช่วยเดิน',status:'ใช้งานได้',loanable:'Y',photoIds:[],qrText:'x'},{assetId:'A00002',assetNo:'WC-2',name:'รถเข็น',category:'อุปกรณ์ช่วยเดิน',status:'ใช้งานได้',loanable:'Y',photoIds:[]}];
 const ov={today:'2026-11-20',frontendUrl:'https://x.github.io/p/loan/',dashboard:{total:2,available:1,onLoan:1,overdue:1,checkDue:0,checkList:[]},
  state:{A00001:{loan:{assetId:'A00001',borrowerName:'สมชาย',overdue:true,daysLate:3,loanDate:'2026-11-01',dueDate:'2026-11-17'},checkDue:null},A00002:{loan:null,checkDue:null}},
  openLoans:[{assetId:'A00001',assetNo:'WK-1',assetName:'วอล์คเกอร์',borrowerName:'สมชาย',borrowerType:'ผู้ป่วย / ญาติ',phone:'081',loanDate:'2026-11-01',dueDate:'2026-11-17',overdue:true,daysLate:3}],recentLoans:[],checks:[],logs:[]};
 const calls=[];
 w.google={script:{run:new Proxy({},{get:(t,k)=>{ if(k==='withSuccessHandler')return ok=>({withFailureHandler:f=>new Proxy({},{get:(t2,fn)=>(...a)=>{calls.push(fn);setTimeout(()=>ok(fn==='assetList'?items:fn==='lcAdminOverview'?ov:[]),0)}})});return undefined}})}};
 let shown='';w.Modal={fire:o=>{shown+=(o.html||'');return {then(){}}}};w.Swal={fire:o=>{shown+=(o.html||'');return {then(){}}},mixin:()=>({fire:o=>{shown+=(o.html||'');return {then(){}}}})};
 w.eval(body+';window.__t={eqcLoad,eqcInit,eqcOpen,_eqc};');
 w.__t.eqcInit();
 setTimeout(()=>{
  const d=w.document;
  T('assetList + lcAdminOverview both called',calls.join()==='assetList,lcAdminOverview,lcReqList,lcDemoStatus',calls.join());
  T('registry shows loan badge overdue',/เกินกำหนดคืน 3 วัน/.test(d.getElementById('eqc-list').innerHTML));
  T('no add/QR buttons in header',!/eqcForm\(\)|eqcQrDialog\(\)/.test(view.replace(/eqcForm\(\)\s*\{/,'')) );
  T('open loan center link set',d.getElementById('eqc-open-lc').href==='https://x.github.io/p/loan/staff.html');
  T('loan tab badge shows overdue',!d.getElementById('eqc-loan-badge').hidden&&/1/.test(d.getElementById('eqc-loan-badge').textContent));
  d.querySelector('[data-tab="loan"]').click();
  T('loan pane lists open loan',/สมชาย/.test(d.getElementById('eqc-loan').innerHTML)&&/เกินกำหนด 3 วัน/.test(d.getElementById('eqc-loan').innerHTML),d.getElementById('eqc-loan').innerHTML.slice(0,200));
  w.__t.eqcOpen('A00001');
  T('detail: link to loan center, no edit/void',/#\/asset\/A00001/.test(shown)&&!/eqcForm|eqcVoid/.test(shown),shown.slice(0,120));
  console.log(`\n${pass} passed, ${fail} failed (eqc)`);
  part2();
 },60);
}
function part2(){
 // ---- ส่วน 2: สร้างนัดหมายจากคำขอ ----
 const blk=fs.readFileSync(path.join(__dirname,'..','tests','fixtures','req_block.js'),'utf8');
 const dom=new JSDOM('<body><div id="view-requests" class="view active"><div id="public-req-list"></div></div></body>',{runScripts:'outside-only'});
 const w=dom.window,log=[];
 const slots=[{id:'M1',name:'💆 OPD พลอย',slots:[{time:'09:00',booked:false},{time:'10:00',booked:true}]},{id:'M2',name:'🏠 HOME',slots:[{time:'09:00',booked:false}]}];
 let gds=slots;
 w.Modal={fire:o=>({then:f=>{}}),showLoading(){},close(){}};
 w.Swal={fire:o=>{log.push('swal:'+(o.title||o));return {then:f=>{log.push('swalthen');f&&f({})}}}};
 w.fmtReqDate=d=>d;w.refreshNotificationBadge=()=>{};w.loadPublicRequests=()=>log.push('reload');
 w.openDayModal=d=>log.push('day:'+d);
 w.openBookingForm=(d,t,m,n)=>{log.push(`form:${d}|${t}|${m}`);const x=w.document.createElement('div');x.innerHTML='<div><div class="form-group"><input id="inp-name"></div><input id="inp-phone"></div>';w.document.body.appendChild(x)};
 w.google={script:{run:{withSuccessHandler:ok=>({withFailureHandler:f=>({getDailySlots:d=>setTimeout(()=>ok(gds),0)})})}}};
 w.gasRun=(fn,args,ok)=>{log.push('gas:'+fn+':'+args);ok({success:true})};
 w.eval(blk);
 const fut=new Date(Date.now()+3*864e5).toISOString().slice(0,10);
 w._pubReqs={R1:{requestId:'R1',name:'สมหญิง',phone:'0812345678',note:'ปวดเข่า',visitStatus:'พบแพทย์แล้ว',therapistName:'OPD พลอย',date:fut,time:'09:00:00'.slice(0,5)},
             R2:{requestId:'R2',name:'ก',phone:'1',therapistName:'OPD พลอย',date:fut,time:'10:00'},
             R3:{requestId:'R3',name:'ข',phone:'2',therapistName:'',date:'2020-01-01',time:'09:00'}};
 w.reqToBooking('R1');
 setTimeout(()=>{
  T('free slot → opens booking form with right therapist/time',log.includes(`form:${fut}|09:00|M1`),log.join(' / '));
  setTimeout(()=>{
   T('form prefilled name+phone',w.document.getElementById('inp-name').value==='สมหญิง'&&w.document.getElementById('inp-phone').value==='0812345678');
   T('banner shows request id',/R1/.test(w.document.body.innerHTML));
   // book other date/time → must NOT close request
   w.reqBookingDone({date:fut,time:'11:00'});
   T('different booking does not close request',!log.some(x=>x.startsWith('gas:approvePublicRequest')));
   w.reqBookingDone({date:fut,time:'09:00'});
   T('matching booking closes request automatically',log.includes('gas:approvePublicRequest:R1'));
   T('context cleared',w._reqCtx===null);
   log.length=0; w.reqToBooking('R2');
   setTimeout(()=>{
    T('booked slot → falls back to day picker',log.includes('day:'+fut),log.join(' / '));
    log.length=0; w.reqToBooking('R3');
    T('past date → no form',!log.some(x=>x.startsWith('form')),log.join(' / '));
    console.log(`\n${pass} passed, ${fail} failed (total)`);process.exit(fail?1:0);
   },80);
  },400);
 },80);
}
