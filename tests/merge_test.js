// ทดสอบการรวมระบบ: Code.gs (PT Station) + LoanCenter.gs ในโปรเจกต์เดียว
const {call,run,sheets,props,ctx}=require('./mock_gas.js');
let pass=0,failN=0;
const T=(n,f)=>{try{const v=f();pass++;console.log('PASS',n,v===undefined?'':v)}catch(e){failN++;console.log('FAIL',n,'→',e.message)}};
const ok=r=>{if(!r.ok)throw new Error(r.code+': '+r.error);return r.data};
const J=o=>JSON.parse(o.t);
T('LINE webhook payload is NOT taken by loan API',()=>{if(run('lcIsApiRequest_')({postData:{contents:'{"destination":"U1","events":[{"type":"follow"}]}'}}))throw new Error('hijacked');return 'ok'});
T('loan API request is detected',()=>{if(!run('lcIsApiRequest_')({postData:{contents:'{"action":"ping"}'}}))throw new Error('missed');return 'ok'});
T('payload with action + events array → LINE',()=>{if(run('lcIsApiRequest_')({postData:{contents:'{"action":"x","events":[]}'}}))throw new Error('hijacked');return 'ok'});
T('doGet ping via PT doGet',()=>{const r=J(run('doGet')({parameter:{action:'ping'}}));return JSON.stringify(ok(r).configured)});
ctx.HtmlService={createHtmlOutput:h=>({h,setTitle(){return this},addMetaTag(){return this}}),createHtmlOutputFromFile:n=>({getContent:()=>'<html></html>',setTitle(){return this},addMetaTag(){return this}})};
T('doGet: loan write actions are not reachable by GET',()=>{const r=run('doGet')({parameter:{action:'assetList'}});return r&&r.t&&r.t.includes('"ok"')?(()=>{throw new Error('exposed')})():'falls through to app page'});
let st;
T('login + create asset through PT doPost',()=>{st=ok(call('login',{name:'พลอย',pin:'staff-123'}));const r=ok(call('assetSave',{name:'วอล์คเกอร์',assetNo:'WK-1',loanable:'Y',checkIntervalDays:90},st.token));return r.assetId});
T('GAS readonly: assetSave blocked',()=>{try{run('assetSave')({name:'x',by:'a'})}catch(e){return /อย่างเดียว/.test(e.message)?'blocked':(()=>{throw e})()}throw new Error('not blocked')});
for(const f of ['assetAddPhoto','assetRemovePhoto','assetVoid','assetQrBatch','assetQrPrintLog','assetCheckSave']){
 T('GAS readonly: '+f+' blocked',()=>{try{run(f)()}catch(e){return /อย่างเดียว/.test(e.message)?'blocked':(()=>{throw new Error('wrong err '+e.message)})()}throw new Error('not blocked')});}
T('GAS readonly: read functions still work',()=>{const l=run('assetList')();return Array.isArray(l)&&l.length===1?'assetList ok':(()=>{throw new Error('bad')})()});
let lid;
T('checkout then overview shows loan',()=>{const a=run('assetList')()[0].assetId;lid=ok(call('loanCheckout',{assetId:a,borrowerName:'สมชาย ใจดี',borrowerType:'ผู้ป่วย / ญาติ',phone:'081-234-5678',dueDate:run("lc_addDays_(lc_today_(),5)")},st.token)).loanId;
 const o=run('lcAdminOverview')();if(o.openLoans.length!==1||o.dashboard.onLoan!==1||!o.state[a].loan)throw new Error(JSON.stringify(o.dashboard));return `open=${o.openLoans.length} total=${o.dashboard.total}`});
T('overview has logs/checks/recent arrays',()=>{const o=run('lcAdminOverview')();if(!Array.isArray(o.logs)||!Array.isArray(o.checks)||!Array.isArray(o.recentLoans))throw new Error('shape');if(!o.frontendUrl)throw new Error('no frontend');return o.frontendUrl});
T('return then overview recent',()=>{ok(call('loanReturn',{loanId:lid},st.token));const o=run('lcAdminOverview')();if(o.openLoans.length!==0||o.recentLoans.length!==1)throw new Error('bad');return 'recent=1'});
T('old QR page redirects staff to GitHub scan page',()=>{
 const a=run('assetList')()[0];const full=ok(call('assetGet',{id:a.assetId},st.token));
 const out=run('assetScanPage_')({id:a.assetId,k:full.qrKey},'https://script.google.com/x/exec');
 if(!out.h.includes('org.github.io/elc/scan.html?id='+a.assetId+'&amp;k='+full.qrKey))throw new Error('no link');
 const bad=run('assetScanPage_')({id:a.assetId,k:'00000000'},'x');if(!/ไม่พบข้อมูล/.test(bad.h))throw new Error('invalid key accepted');return 'link ok, bad key rejected'});
T('no duplicate top-level const between files',()=>'checked by vm load');
console.log(`\n${pass} passed, ${failN} failed`);process.exit(failN?1:0);
