// ทดสอบ V38 (jsdom): กระดิ่ง/ค้นหา · รายงาน + ส่งออก · ปฏิทินการยืม · ใบยืม-คืนสำหรับพิมพ์
const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path');
const {call,run}=require('./mock_gas.js');
const D=path.join(__dirname,'..','loan');
const html=fs.readFileSync(D+'/staff.html','utf8').replace(/<script src[^>]*><\/script>/g,'').replace(/<link[^>]*>/g,'');
const dom=new JSDOM(html,{url:'https://org.github.io/elc/staff.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;
w.fetch=(u,o)=>{const b=JSON.parse(o.body);const r=call(b.action,b.args,b.token);return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(r)})};
w.scrollTo=()=>{};w.Element.prototype.scrollIntoView=function(){};w.confirm=()=>true;w.print=()=>{w.__printed=(w.__printed||0)+1};
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.onclose&&this.onclose()};
w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};let clicked=[];w.HTMLAnchorElement.prototype.click=function(){clicked.push(this.download||this.href)};
w.eval(fs.readFileSync(D+'/config.js','utf8').replace(/https:\/\/script\.google\.com[^']*/,'https://mock/exec'));
w.eval(fs.readFileSync(D+'/qr.js','utf8'));w.eval(fs.readFileSync(D+'/api.js','utf8'));
w.eval(fs.readFileSync(D+'/app.js','utf8'));
w.ELC_XLSX_TIMEOUT=300;w.eval(fs.readFileSync(D+'/reports.js','utf8'));   // ปกติโหลดแบบ lazy ผ่าน <script> — ในเทสต์ใส่ตรง ๆ
const $=s=>w.document.querySelector(s),$$=s=>[...w.document.querySelectorAll(s)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,msg,ms=4000){const t=Date.now();while(Date.now()-t<ms){try{const v=f();if(v)return v}catch(e){}await sleep(15)}throw new Error('timeout: '+msg)}
let pass=0,fail=0;
const T=async(n,f)=>{try{const v=await f();pass++;console.log('PASS',n,v===undefined?'':v)}catch(e){fail++;console.log('FAIL',n,'→',e.message)}};
const set=(sel,v)=>{const e=$(sel);e.value=v;e.dispatchEvent(new w.Event('input',{bubbles:true}))};
const submit=f=>f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
const click=e=>e.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const plus=n=>run(`lc_addDays_(lc_today_(),${n})`);
const errs=[];w.addEventListener('error',e=>errs.push(e.message));
(async()=>{
await T('login → dashboard',async()=>{await until(()=>$('#loginForm'),'login');set('#ln','พลอย');set('#lp','admin-456');submit($('#loginForm'));await until(()=>$('#view h1')&&/ภาพรวมวันนี้/.test($('#view h1').textContent),'dash');return 'ok'});
let id;
await T('เตรียมข้อมูล: ครุภัณฑ์ + ยืม',async()=>{w.location.hash='#/asset/new';await until(()=>$('form[data-form=asset]'),'form');set('#f-name','เครื่องวัดความดัน');set('#f-assetNo','BP-001');set('#f-category','เครื่องวัด');set('#f-location','ห้องตรวจ');submit($('form[data-form=asset]'));await until(()=>/#\/asset\/A\d+$/.test(w.location.hash),'saved');id=/A\d+/.exec(w.location.hash)[0];
  w.location.hash='#/asset/'+id+'/loan';await until(()=>$('form[data-form=loan]'),'loan form');set('#f-borrowerName','สมชาย ใจดี');set('#f-dueDate',plus(5));submit($('form[data-form=loan]'));await until(()=>/สมชาย ใจดี/.test($('#view').textContent),'loaned');return id});
await T('เมนู: รายงาน + ปฏิทินการยืม',()=>{const t=$$('.nav a').map(a=>a.textContent).join('|');if(!/รายงาน \/ Excel/.test(t)||!/ปฏิทินการยืม/.test(t))throw new Error(t);return 'ok'});
await T('ปุ่มค้นหา/กระดิ่งอยู่ทั้งแถบข้างและแถบมือถือ',()=>{if($$('[data-do=search]').length!==2||$$('[data-do=bell]').length!==2)throw new Error('buttons');return 'ok'});
await T('ค้นหา: เลขครุภัณฑ์ + ชื่อผู้ยืม',async()=>{click($('[data-do=search]'));await until(()=>$('#gsq'),'search dlg');set('#gsq','bp-001');await until(()=>/BP-001/.test($('#gsr').textContent),'asset hit');set('#gsq','สมชาย');await until(()=>/ยืม.*BP-001/.test($('#gsr').textContent),'loan hit');set('#gsq','ไม่มีอย่างนี้');await until(()=>/ไม่พบ/.test($('#gsr').textContent),'none');$('#dlg').close();return 'ok'});
await T('ค้นหา: ข้อความที่ผู้ใช้พิมพ์ถูก escape',async()=>{click($('[data-do=search]'));await until(()=>$('#gsq'),'dlg');set('#gsq','<img src=x onerror=window.__x=1>');await until(()=>/ไม่พบ/.test($('#gsr').textContent),'none');if(w.__x||$('#gsr img'))throw new Error('XSS');$('#dlg').close();return 'safe'});
await T('คีย์ลัด / เปิดค้นหา',async()=>{w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'/',bubbles:true}));await until(()=>$('#gsq'),'kbd');$('#dlg').close();return 'ok'});
await T('กระดิ่ง: เกินกำหนด → ตัวเลขแดง + รายการ',async()=>{const L=run('lc_lix_()');run('(function(){})()');const rows=require('./mock_gas.js').sheets.AssetLoans.data;rows[rows.length-1][L.dueDate]=plus(-4);w.location.hash='#/';await until(()=>$('#view .sum'),'dash');await until(()=>{const b=$('.tbtn .bdg');return b&&!b.hidden&&b.classList.contains('bad')},'badge');click($('[data-do=bell]'));await until(()=>/เกิน 4 วัน/.test($('#dlg').textContent),'bell list');$('#dlg').close();return $('.tbtn .bdg').textContent});
await T('รายงาน: การ์ดสรุป + รายการ',async()=>{w.location.hash='#/reports';await until(()=>$('.rfilter'),'reports');const t=$('.sum').textContent.replace(/\s+/g,' ');if(!/1\s*ยืมในช่วงนี้/.test(t)||!/1\s*เกินกำหนด/.test(t))throw new Error(t);if(!/BP-001/.test($('#rlist').textContent))throw new Error('no row');return t});
await T('รายงาน: กรอง "เกินกำหนด" / ค้นหา',async()=>{click($('[data-rt=over]'));if(!/BP-001/.test($('#rlist').textContent))throw new Error('over');set('#rq','ไม่มี');if(/BP-001/.test($('#rlist').textContent))throw new Error('search');set('#rq','');click($('[data-rt=all]'));return 'ok'});
await T('รายงาน: ช่วงเวลา 1 ปี โหลดใหม่',async()=>{click($('[data-rp=year]'));await until(()=>$('.rfilter')&&/BP-001/.test($('#rlist').textContent),'reload');return $('#rf').value+'→'+$('#rt').value});
await T('ส่งออก Excel: สร้าง workbook 3 แผ่น (SheetJS จริง)',async()=>{let X;try{X=require('xlsx')}catch(e){try{X=require('/tmp/claude-0/work/swal/node_modules/xlsx')}catch(e2){return 'ข้าม (ไม่มี xlsx ในเครื่องทดสอบ)'}}
  let out=null;w.XLSX=Object.assign({},X,{writeFile:(wb,name)=>{out={wb,name}}});click($('[data-ra=xlsx]'));await until(()=>out,'xlsx',8000);delete w.XLSX;
  const n=out.wb.SheetNames;if(n.join('|')!=='สรุป|รายการยืม-คืน|ครุภัณฑ์')throw new Error(n.join('|'));
  const loans=X.utils.sheet_to_json(out.wb.Sheets['รายการยืม-คืน']);if(loans.length!==1||loans[0]['ผู้ยืม']!=='สมชาย ใจดี'||!/^\d{2}\/\d{2}\/25\d{2}$/.test(loans[0]['วันที่ยืม']))throw new Error(JSON.stringify(loans[0]));
  const as=X.utils.sheet_to_json(out.wb.Sheets['ครุภัณฑ์']);if(as.length<1||as[0]['เลขครุภัณฑ์']!=='BP-001')throw new Error(JSON.stringify(as[0]));
  if(JSON.stringify(as).indexOf('data:image')>=0)throw new Error('รูปรั่วเข้า Excel');return out.name});
await T('ส่งออก: ไม่มี SheetJS → ได้ CSV (BOM) แทน ไม่พัง',async()=>{clicked=[];click($('[data-ra=xlsx]'));await until(()=>clicked.length,'csv',8000);if(!/\.csv$/.test(clicked[0]))throw new Error(clicked[0]);return clicked[0]});
await T('พิมพ์รายงาน',async()=>{w.__printed=0;click($('[data-ra=print]'));await until(()=>w.__printed,'print');if(!/ใบ|รายงานการยืม-คืน/.test($('#printRoot').textContent)||!/BP-001/.test($('#printRoot').textContent))throw new Error('content');return 'ok'});
await T('ใบยืม-คืน: พิมพ์จากปุ่มในรายการ',async()=>{w.location.hash='#/reports';await until(()=>$('#rlist [data-do=printLoan]'),'btn');w.__printed=0;click($('#rlist [data-do=printLoan]'));await until(()=>w.__printed,'print');const t=$('#printRoot').textContent;if(!/ใบยืม-คืนครุภัณฑ์/.test(t)||!/สมชาย ใจดี/.test(t)||!/BP-001/.test(t)||!/ส่วนรับคืน/.test(t))throw new Error(t.slice(0,200));return 'ok'});
await T('ใบยืม-คืน: จากหน้า ยืม-คืน (รับคืน) มีปุ่มพิมพ์',async()=>{w.location.hash='#/loans';await until(()=>$('#lList [data-do=printLoan]'),'btn');return 'ok'});
await T('ปฏิทินการยืม: heat map + แตะวันดูรายการ',async()=>{w.location.hash='#/calendar';await until(()=>$('.hc[data-d]'),'cal');const n=$$('.hc[data-d]').length;if(n<360||n>372)throw new Error('cells '+n);const td=run('lc_today_()');const c=$('.hc[data-d="'+td+'"]');if(!c||!/l[1-4]/.test(c.className))throw new Error('today not colored: '+(c&&c.className));click(c);await until(()=>/BP-001/.test($('#dayBox').textContent),'day list');return n+' cells'});
await T('ปฏิทิน: สลับเป็น "วันที่คืน" (ยังไม่มีการคืน = 0)',async()=>{click($('[data-m=return]'));await until(()=>/ทั้งปี/.test($('.sum').textContent),'metric');if(!/0\s*รายการการคืนทั้งปี/.test($('.sum').textContent.replace(/\s+/g,' ')))throw new Error($('.sum').textContent);return 'ok'});
await T('ไม่มี error ในหน้า',()=>{if(errs.length)throw new Error(errs.join(' | '));return 'clean'});
console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})();
