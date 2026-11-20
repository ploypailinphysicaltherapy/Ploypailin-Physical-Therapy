// ระบบจำลอง Apps Script — โหลด gas/Code.gs + gas/LoanCenter.gs เข้าโปรเจกต์เดียวกันเหมือนบน script.google.com
const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),path=require('path');
const GAS=process.env.GAS_DIR||path.join(__dirname,'..','gas');
const strict=process.argv.includes('strict');
function mkSheet(name){const s={name,data:[[]],maxC:26,imgs:{},
 getLastRow(){let l=0;this.data.forEach((r,i)=>{if(r&&r.some(v=>v!==''&&v!=null))l=i+1});return l},
 deleteRows(a,n){this.data.splice(a-1,n)},getMaxColumns(){return this.maxC},insertColumnsAfter(a,n){this.maxC+=n},setFrozenRows(){},setRowHeight(){},setColumnWidth(){},
 getRange(r,c,nr=1,nc=1){const sh=this;if(strict&&c+nc-1>sh.maxC)throw new Error('outside grid '+name);
  return{getDisplayValues(){return this.getValues().map(r=>r.map(String))},getValues(){const o=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++){const v=(sh.data[r-1+i]||[])[c-1+j];row.push(v==null?'':v)}o.push(row)}return o},
  setValues(v){for(let i=0;i<nr;i++){sh.data[r-1+i]=sh.data[r-1+i]||[];for(let j=0;j<nc;j++)sh.data[r-1+i][c-1+j]=v[i][j]}return this},
  setValue(v){sh.data[r-1]=sh.data[r-1]||[];sh.data[r-1][c-1]=(v&&v.__img)?'':v;if(v&&v.__img)sh.imgs[r+','+c]=v;return this},
  setFormula(f){sh.data[r-1]=sh.data[r-1]||[];sh.data[r-1][c-1]=f;return this},setNumberFormat(){return this},setNumberFormats(){return this},setFontWeight(){return this}}}};return s}
const sheets={},ss={getName:()=>'TestSS',getSheetByName:n=>sheets[n]||null,insertSheet:n=>sheets[n]=mkSheet(n)};
const props={},cache={},files={};let fid=0;
const folder={getId:()=>'FOLDER',createFile:b=>{const id='FILE'+String(++fid).padStart(8,'0');files[id]={blob:b,trashed:false};return{getId:()=>id,setSharing(){}}}};
const ctx={console,Logger:{log:()=>{}},
 SpreadsheetApp:{openById:()=>ss,getActiveSpreadsheet:()=>null,newCellImage(){const o={__img:1};const b={setSourceUrl(u){o.url=u;return b},setAltTextTitle(){return b},setAltTextDescription(){return b},build(){return o}};return b}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>props[k]=v})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]??null,put:(k,v)=>cache[k]=v,remove:k=>delete cache[k]})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({t,setMimeType(){return this}})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{formatDate:(d,tz,f)=>{const p=n=>String(n).padStart(2,'0');const y=d.getFullYear(),m=p(d.getMonth()+1),dd=p(d.getDate());return f==='yyyy-MM-dd'?`${y}-${m}-${dd}`:f==='yyyyMMdd_HHmmss'?`${y}${m}${dd}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`:`${y}-${m}-${dd} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`},
  getUuid:()=>crypto.randomUUID(),base64Encode:b=>Buffer.from(b).toString('base64'),base64Decode:s=>Array.from(Buffer.from(s,'base64'),x=>x>127?x-256:x),
  newBlob:(bytes,type,name)=>({getBytes:()=>bytes,getContentType:()=>type,name}),DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},
  computeDigest:(a,s)=>Array.from(crypto.createHash('sha256').update(s,'utf8').digest(),x=>x>127?x-256:x)},
 DriveApp:{Access:{ANYONE_WITH_LINK:1},Permission:{VIEW:1},getFoldersByName:()=>({hasNext:()=>false}),createFolder:()=>folder,getFolderById:()=>folder,
  getFileById:id=>({setTrashed:t=>files[id].trashed=t,getParents:()=>{let u=false;return{hasNext:()=>!u,next:()=>{u=true;return folder}}},getBlob:()=>files[id].blob})},
 Date,Math,JSON,Array,Object,String,Number,RegExp,Error,Uint8Array,Int32Array,isFinite,parseInt,parseFloat,encodeURIComponent,Boolean};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(GAS+'/Code.gs','utf8'),ctx,{filename:'Code.gs'});vm.runInContext(fs.readFileSync(GAS+'/LoanCenter.gs','utf8'),ctx,{filename:'LoanCenter.gs'});
const run=c=>vm.runInContext(c,ctx);
function call(action,args,token){const r=run(`doPost`)({postData:{contents:JSON.stringify({action,token,args})}});return JSON.parse(r.t)}
let pass=0,failN=0;
const T=(n,f)=>{try{const v=f();pass++;console.log('PASS',n,v===undefined?'':v)}catch(e){failN++;console.log('FAIL',n,'→',e.message)}};
const ok=(r,m)=>{if(!r.ok)throw new Error((m||'')+' '+r.code+': '+r.error);return r.data};
const err=(r,code)=>{if(r.ok)throw new Error('expected error '+code);if(code&&r.code!==code)throw new Error('code '+r.code+' != '+code+' ('+r.error+')');return r.error};

const salt='salt-1';props.LC_PIN_SALT=salt;props.LC_ADMIN_PIN_HASH=run(`lc_hashPin_('admin-456',${JSON.stringify(salt)})`);props.LC_FRONTEND_URL='https://org.github.io/elc/';
module.exports={call,run,sheets,files,props,ctx};
