{
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today=()=>iso(new Date());
const parse=s=>{const[y,m,d]=String(s).split('-').map(Number);return new Date(y,(m||1)-1,d||1)};
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return iso(d)};
const diff=(a,b)=>Math.round((parse(b)-parse(a))/864e5);
const fmt=s=>s?parse(s).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric'}):'';
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,9);
const OFFS=[[7,'1 week before'],[3,'3 days before'],[1,'1 day before'],[0,'On return day']];
const lab=n=>(OFFS.find(o=>o[0]===n)||[0,n+' days before'])[1];

/* database field names (snake_case) <-> page names (camelCase) */
const RK={customerId:'customer_id',customerName:'customer_name',customerPhone:'customer_phone',customerEmail:'customer_email',itemName:'item_name',itemTag:'item_tag',itemDesc:'item_desc',startDate:'start_date',endDate:'end_date',emailCustomer:'email_customer',photosBefore:'photos_before',photosAfter:'photos_after',returnedAt:'returned_at',createdAt:'created_at',idNote:'id_note',ownerEmail:'owner_email'};
const RV=Object.fromEntries(Object.entries(RK).map(([a,b])=>[b,a]));
const NULLABLE=['price','deposit','returnedAt','startDate','endDate'];
const toDb=o=>{const r={};for(const[k,v]of Object.entries(o)){if(k==='id')continue;r[RK[k]||k]=(v===''&&NULLABLE.includes(k))?null:v}return r};
const fromDb=o=>{const r={};for(const[k,v]of Object.entries(o||{}))r[RV[k]||k]=v;return r};
const ok=async p=>{const{data,error}=await p;if(error)throw error;return data};

let sb=null,me=null,rentals=[],customers=[],settings={ownerEmail:'',days:[7,1]},urls={};
let filter='active',q='',cq='',openId=null,openKind=null,pendingBefore=[],customDates=[];

const toast=m=>{const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(toast.h);toast.h=setTimeout(()=>t.style.display='none',3600)};
const fail=e=>toast('Could not save: '+((e&&e.message)||'please try again'));
const img=p=>urls[p.path]||'';

function buildAuto(end,days){return days.filter(n=>addDays(end,-n)>=today()||n===0).map(n=>({id:uid(),date:addDays(end,-n),label:lab(n),auto:true,offset:n,sent:false}))}
function status(r){
  if(r.status==='returned')return{k:'done',t:'Returned'};
  const d=diff(today(),r.endDate);
  if(d<0)return{k:'late',t:(-d)+' day'+(d===-1?'':'s')+' overdue'};
  if(d===0)return{k:'today',t:'Due today'};
  if(d<=7)return{k:'soon',t:'Due in '+d+' day'+(d===1?'':'s')};
  return{k:'ok',t:'Due in '+d+' days'};
}
const nextRem=r=>(r.reminders||[]).filter(x=>!x.sent&&x.date>=today()).sort((a,b)=>a.date.localeCompare(b.date))[0];

/* ---------- routing ---------- */
function route(){
  const v=(location.hash||'#rentals').slice(1);
  const k=['rentals','new','customers','setup'].includes(v)?v:'rentals';
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+k));
  document.querySelectorAll('#nav a[data-v]').forEach(a=>a.classList.toggle('on',a.dataset.v===k));
}
addEventListener('hashchange',route);route();

/* ---------- data ---------- */
async function reload(){
  const [c,r,s]=await Promise.all([sb.from('customers').select('*'),sb.from('rentals').select('*'),sb.from('settings').select('*').maybeSingle()]);
  const err=c.error||r.error;
  if(err){$('#conn').style.display='';$('#conn').textContent='Could not load your data: '+err.message;return}
  customers=c.data.map(fromDb);rentals=r.data.map(fromDb);
  if(s.data)settings={ownerEmail:'',days:[7,1],...fromDb(s.data)};
  $('#conn').style.display='none';
  renderList();renderCustomers();renderSetup();
  if(!fN.elements.itemName.value){$('#rdChecks').innerHTML=checksHTML('rd',settings.days||[7,1]);previewRems()}
  refreshSheet();ensureUrls();
}
async function ensureUrls(){
  const need=new Set();
  for(const r of rentals)for(const p of [...(r.photosBefore||[]),...(r.photosAfter||[])])if(p&&p.path&&!urls[p.path])need.add(p.path);
  if(!need.size)return;
  const{data}=await sb.storage.from('photos').createSignedUrls([...need],21600);
  let got=0;(data||[]).forEach(d=>{if(d.signedUrl&&d.path){urls[d.path]=d.signedUrl;got++}});
  if(got){renderList();refreshSheet()}
}
const upd=async(id,data)=>{try{await ok(sb.from('rentals').update(toDb(data)).eq('id',id));await reload()}catch(e){fail(e)}};

/* ---------- rentals list ---------- */
function renderList(){
  const act=rentals.filter(r=>r.status!=='returned');
  $('#sLate').textContent=act.filter(r=>r.endDate<today()).length;
  $('#sSoon').textContent=act.filter(r=>{const d=diff(today(),r.endDate);return d>=0&&d<=7}).length;
  $('#sOut').textContent=act.length;
  let list=rentals.filter(r=>filter==='all'||(filter==='active'?r.status!=='returned':r.status==='returned'));
  if(q){const s=q.toLowerCase();list=list.filter(r=>[r.itemName,r.itemTag,r.customerName,r.customerPhone].join(' ').toLowerCase().includes(s))}
  list.sort((a,b)=>filter==='returned'?String(b.returnedAt||'').localeCompare(a.returnedAt||''):String(a.endDate).localeCompare(b.endDate));
  $('#list').innerHTML=list.length?list.map(r=>{
    const s=status(r),d=parse(r.endDate),n=nextRem(r),ph=(r.photosBefore||[])[0],u=ph&&img(ph);
    return `<button class="tag ${s.k}" data-id="${esc(r.id)}"><div class="stub"><span class="hole"></span><b>${d.getDate()}</b><span>${esc(d.toLocaleDateString(undefined,{month:'short'}))}</span></div>
    <div class="body"><div class="row1"><strong>${esc(r.itemName)}${r.qty>1?' ×'+esc(r.qty):''}</strong><span class="chip ${s.k}">${esc(s.t)}</span></div>
    <div class="meta">${esc(r.customerName)}${r.customerPhone?' · '+esc(r.customerPhone):''}</div>
    <div class="meta">${r.status==='returned'?'Back on '+esc(fmt(r.returnedAt)):n?'Next reminder '+esc(fmt(n.date)):'No reminders left'}</div></div>
    ${u?`<img class="thumb" src="${esc(u)}" alt="">`:''}</button>`}).join('')
  :`<div class="empty">${rentals.length?'Nothing matches here.':'No rentals yet. Add your first one under <a href="#new">New rental</a>.'}</div>`;
}
$('#list').addEventListener('click',e=>{const b=e.target.closest('.tag');if(b)openRental(b.dataset.id)});
$('#seg').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;filter=b.dataset.f;document.querySelectorAll('#seg button').forEach(x=>x.classList.toggle('on',x===b));renderList()});
$('#q').addEventListener('input',e=>{q=e.target.value.trim();renderList()});

/* ---------- new rental form ---------- */
const fN=$('#fNew');
function checksHTML(name,sel){return OFFS.map(([n,t])=>`<label class="ck"><input type="checkbox" name="${name}" value="${n}" ${sel.includes(n)?'checked':''}> ${t}</label>`).join('')}
function resetNew(){
  fN.reset();pendingBefore=[];customDates=[];
  fN.elements.startDate.value=today();
  $('#rdChecks').innerHTML=checksHTML('rd',settings.days||[7,1]);
  $('#beforePrev').innerHTML='';toggleNewCust();previewRems();
}
function toggleNewCust(){$('#newCust').style.display=fN.elements.cust.value==='new'?'':'none'}
function previewRems(){
  const end=fN.elements.endDate.value;
  const days=[...fN.querySelectorAll('[name=rd]:checked')].map(x=>+x.value);
  const list=end?[...buildAuto(end,days),...customDates.map(d=>({date:d,label:'Your date'}))].sort((a,b)=>a.date.localeCompare(b.date)):[];
  $('#remPreview').innerHTML=list.length?list.map(r=>`<li><span class="when">${esc(fmt(r.date))}</span><span>${esc(r.label)}</span>${r.label==='Your date'?`<button type="button" class="sm" data-rm="${esc(r.date)}">Remove</button>`:''}</li>`).join(''):`<li><span class="note">Pick a return date to see when emails go out.</span></li>`;
}
fN.addEventListener('change',e=>{if(e.target.name==='cust')toggleNewCust();if(['endDate','rd'].includes(e.target.name))previewRems()});
fN.addEventListener('reset',()=>setTimeout(resetNew));
$('#addCus').onclick=()=>{const v=$('#cusDate').value;if(!v)return toast('Pick a date first');if(!customDates.includes(v))customDates.push(v);$('#cusDate').value='';previewRems()};
$('#remPreview').addEventListener('click',e=>{const d=e.target.dataset.rm;if(d){customDates=customDates.filter(x=>x!==d);previewRems()}});
$('#beforeIn').addEventListener('change',e=>{pendingBefore.push(...e.target.files);e.target.value='';
  $('#beforePrev').innerHTML=pendingBefore.map(f=>`<button type="button" tabindex="-1"><img src="${URL.createObjectURL(f)}" alt=""></button>`).join('')});

async function shrink(file){
  try{const b=await createImageBitmap(file),sc=Math.min(1,1600/Math.max(b.width,b.height)),c=document.createElement('canvas');
    c.width=Math.round(b.width*sc);c.height=Math.round(b.height*sc);c.getContext('2d').drawImage(b,0,0,c.width,c.height);
    return await new Promise(r=>c.toBlob(x=>r(x||file),'image/jpeg',.85));}catch(e){return file}
}
async function upload(files){
  const out=[];
  for(const f of files){const b=await shrink(f);const path=me.id+'/'+uid()+'.jpg';
    await ok(sb.storage.from('photos').upload(path,b,{contentType:b.type||'image/jpeg'}));
    out.push({path,at:new Date().toISOString()})}
  return out;
}

fN.addEventListener('submit',async e=>{
  e.preventDefault();if(!sb||!me)return toast('Please sign in first');
  const el=fN.elements,v=n=>el[n].value.trim();
  if(!v('itemName'))return toast('Add the item name');
  if(!v('endDate'))return toast('Add the return date');
  if(v('startDate')&&v('endDate')<v('startDate'))return toast('Return date is before the start date');
  let cid=el.cust.value,c;
  if(cid==='new'&&!v('cName'))return toast('Add the customer name');
  const btn=$('#saveNew');btn.disabled=true;btn.textContent='Saving…';
  try{
    if(cid==='new'){c={name:v('cName'),phone:v('cPhone'),email:v('cEmail'),address:v('cAddress'),idNote:v('cId')};
      const row=await ok(sb.from('customers').insert(toDb(c)).select().single());cid=row.id;}
    else c=customers.find(x=>x.id===cid)||{};
    if(el.emailCust.checked&&!c.email)toast('This customer has no email, so only you will get reminders');
    const photos=pendingBefore.length?await upload(pendingBefore):[];
    const days=[...fN.querySelectorAll('[name=rd]:checked')].map(x=>+x.value);
    const rem=[...buildAuto(v('endDate'),days),...customDates.map(d=>({id:uid(),date:d,label:'Your date',auto:false,sent:false}))].sort((a,b)=>a.date.localeCompare(b.date));
    await ok(sb.from('rentals').insert(toDb({customerId:cid,customerName:c.name||'',customerPhone:c.phone||'',customerEmail:c.email||'',
      itemName:v('itemName'),itemTag:v('itemTag'),itemDesc:v('itemDesc'),qty:+v('qty')||1,price:v('price'),deposit:v('deposit'),
      startDate:v('startDate')||today(),endDate:v('endDate'),reminders:rem,emailCustomer:el.emailCust.checked,
      photosBefore:photos,photosAfter:[],notes:'',status:'active'})));
    resetNew();location.hash='#rentals';toast('Rental saved');await reload();
  }catch(err){fail(err)}
  btn.disabled=false;btn.textContent='Save rental';
});

/* ---------- side sheet ---------- */
function openSheet(html){const sh=$('#sheet'),top=sh.scrollTop,same=sh.dataset.k===openKind+openId;sh.innerHTML=html;sh.dataset.k=openKind+openId;document.body.classList.add('open');sh.scrollTop=same?top:0}
function closeSheet(){document.body.classList.remove('open');openId=null;openKind=null;$('#sheet').dataset.k=''}
$('#scrim').onclick=closeSheet;
addEventListener('keydown',e=>{if(e.key==='Escape'){if($('#lb').classList.contains('on'))$('#lb').classList.remove('on');else closeSheet()}});

function openRental(id){openId=id;openKind='rental';renderRental()}
function renderRental(){
  const r=rentals.find(x=>x.id===openId);if(!r)return closeSheet();
  const c=customers.find(x=>x.id===r.customerId)||{},s=status(r);
  const rem=[...(r.reminders||[])].sort((a,b)=>a.date.localeCompare(b.date));
  const ph=(arr,k)=>`<div class="photos">${(arr||[]).map((p,i)=>{const u=img(p);return u?`<button type="button" data-view="${esc(u)}"><img src="${esc(u)}" alt="${k} photo ${i+1}"></button>`:`<button type="button" disabled></button>`}).join('')||'<p class="note">No photos yet.</p>'}</div>
    <label class="file"><input type="file" accept="image/*" multiple data-up="${k}">Add ${k} photos</label>`;
  const phone=c.phone||r.customerPhone,email=c.email||r.customerEmail;
  openSheet(`<div class="sh-head"><h2>${esc(r.itemName)}</h2><span class="chip ${s.k}">${esc(s.t)}</span><button class="sm" data-close>Close</button></div>
  <div class="sh-body">
  <h3>Customer</h3><dl>
    <dt>Name</dt><dd>${esc(c.name||r.customerName)}</dd>
    ${phone?`<dt>Phone</dt><dd><a href="tel:${esc(phone)}">${esc(phone)}</a></dd>`:''}
    ${email?`<dt>Email</dt><dd>${esc(email)}</dd>`:''}
    ${c.address?`<dt>Address</dt><dd>${esc(c.address)}</dd>`:''}
    ${c.idNote?`<dt>ID no.</dt><dd>${esc(c.idNote)}</dd>`:''}</dl>
  <h3>Item</h3><dl>
    ${r.itemTag?`<dt>Tag / serial</dt><dd>${esc(r.itemTag)}</dd>`:''}<dt>Quantity</dt><dd>${esc(r.qty||1)}</dd>
    ${r.price!==''&&r.price!=null?`<dt>Price</dt><dd>${esc(Number(r.price).toFixed(2))}</dd>`:''}
    ${r.deposit!==''&&r.deposit!=null?`<dt>Deposit</dt><dd>${esc(Number(r.deposit).toFixed(2))}</dd>`:''}
    ${r.itemDesc?`<dt>Condition</dt><dd>${esc(r.itemDesc)}</dd>`:''}
    <dt>Rented on</dt><dd>${esc(fmt(r.startDate))}</dd><dt>Return by</dt><dd><strong>${esc(fmt(r.endDate))}</strong></dd>
    ${r.returnedAt?`<dt>Returned</dt><dd>${esc(fmt(r.returnedAt))}</dd>`:''}</dl>
  ${r.status!=='returned'?`<div class="inline" style="margin-top:10px"><label>Change return date<input type="date" id="newEnd" value="${esc(r.endDate)}"></label><button class="sm" data-act="end">Update</button></div><p class="note">Automatic reminders move with the new date. Your own dates stay.</p>`:''}
  <h3>Reminder emails</h3>
  <ul class="rems">${rem.map(x=>`<li><span class="when">${esc(fmt(x.date))}</span><span>${esc(x.label)}</span>${x.skipped?`<span class="past">Skipped</span>`:x.sent?`<span class="sent">Sent</span>`:x.date<today()?`<span class="past">Missed</span>`:''}${!x.sent?`<button class="sm" data-rem="${esc(x.id)}">Remove</button>`:''}</li>`).join('')||'<li><span class="note">No reminders.</span></li>'}</ul>
  <div class="inline"><label>Add a reminder date<input type="date" id="addRem"></label><button class="sm" data-act="addrem">Add</button></div>
  <label class="ck" style="margin-top:8px"><input type="checkbox" data-act="ecust" ${r.emailCustomer?'checked':''}> Also email the customer</label>
  <h3>Photos before</h3>${ph(r.photosBefore,'before')}
  <h3>Photos after return</h3>${ph(r.photosAfter,'after')}
  <h3>Notes</h3><textarea id="notes" placeholder="Damage found, deposit returned, etc.">${esc(r.notes||'')}</textarea>
  <button class="sm" data-act="notes" style="margin-top:6px">Save notes</button>
  <div class="actions">${r.status!=='returned'?`<button class="pri" data-act="ret">Mark as returned</button>`:`<button data-act="reopen">Mark as still out</button>`}<button class="danger" data-act="del">Delete rental</button></div>
  </div>`);
}
function renderCustomer(){
  const c=customers.find(x=>x.id===openId)||{};const mine=rentals.filter(r=>r.customerId===openId);
  openSheet(`<div class="sh-head"><h2>${openId?esc(c.name):'New customer'}</h2><button class="sm" data-close>Close</button></div>
  <form class="sh-body" id="fCust"><div class="grid" style="margin-top:14px">
    <label class="full">Name *<input name="name" value="${esc(c.name)}"></label>
    <label>Phone<input name="phone" type="tel" value="${esc(c.phone)}"></label><label>Email<input name="email" type="email" value="${esc(c.email)}"></label>
    <label>ID or licence number<input name="idNote" value="${esc(c.idNote)}"></label><label>Address<input name="address" value="${esc(c.address)}"></label>
    <label class="full">Notes<textarea name="notes">${esc(c.notes)}</textarea></label></div>
    <div class="actions"><button class="pri">Save customer</button></div>
    ${mine.length?`<h3>Rentals</h3><ul class="rems">${mine.map(r=>`<li><span class="when">${esc(fmt(r.endDate))}</span><span>${esc(r.itemName)}</span><button type="button" class="sm" data-open="${esc(r.id)}">${esc(status(r).t)}</button></li>`).join('')}</ul>`:''}
  </form>`);
}
$('#sheet').addEventListener('click',async e=>{
  const t=e.target;
  if(t.closest('[data-close]'))return closeSheet();
  const v=t.closest('[data-view]');if(v){$('#lb img').src=v.dataset.view;$('#lb').classList.add('on');return}
  const o=t.closest('[data-open]');if(o)return openRental(o.dataset.open);
  if(openKind!=='rental')return;
  const r=rentals.find(x=>x.id===openId);if(!r)return;
  const rm=t.closest('[data-rem]');if(rm)return upd(r.id,{reminders:(r.reminders||[]).filter(x=>x.id!==rm.dataset.rem)});
  const a=t.dataset.act;
  if(a==='end'){const ne=$('#newEnd').value;if(!ne)return;if(ne<r.startDate)return toast('Return date is before the start date');
    const offs=(r.reminders||[]).filter(x=>x.auto&&!x.sent).map(x=>x.offset);
    const keep=(r.reminders||[]).filter(x=>x.sent||!x.auto);
    await upd(r.id,{endDate:ne,reminders:[...keep,...buildAuto(ne,offs.length?offs:(settings.days||[7,1]))]});toast('Return date updated')}
  if(a==='addrem'){const d=$('#addRem').value;if(!d)return toast('Pick a date first');if(d<today())return toast('Pick today or a later date');
    await upd(r.id,{reminders:[...(r.reminders||[]),{id:uid(),date:d,label:'Your date',auto:false,sent:false}]});toast('Reminder added')}
  if(a==='notes'){await upd(r.id,{notes:$('#notes').value});toast('Notes saved')}
  if(a==='ret'){await upd(r.id,{status:'returned',returnedAt:today()});toast('Marked as returned. Add photos after return below.')}
  if(a==='reopen')await upd(r.id,{status:'active',returnedAt:null});
  if(a==='del'){
    if(t.dataset.sure){try{
        const paths=[...(r.photosBefore||[]),...(r.photosAfter||[])].map(p=>p.path).filter(Boolean);
        await ok(sb.from('rentals').delete().eq('id',r.id));
        if(paths.length)await sb.storage.from('photos').remove(paths);
        closeSheet();toast('Rental deleted');await reload();
      }catch(err){fail(err)}}
    else{t.dataset.sure='1';t.textContent='Tap again to delete';setTimeout(()=>{if(t.isConnected){delete t.dataset.sure;t.textContent='Delete rental'}},4000)}}
});
$('#sheet').addEventListener('change',async e=>{
  const t=e.target;
  if(t.dataset.act==='ecust'){const r=rentals.find(x=>x.id===openId);if(r)upd(r.id,{emailCustomer:t.checked})}
  if(t.dataset.up){const r=rentals.find(x=>x.id===openId);if(!r||!t.files.length)return;const k=t.dataset.up==='before'?'photosBefore':'photosAfter';
    toast('Uploading photos…');
    try{const add=await upload([...t.files]);const cur=rentals.find(x=>x.id===openId)||r;await upd(r.id,{[k]:[...(cur[k]||[]),...add]});toast('Photos saved')}
    catch(err){fail(err)}}
});
$('#sheet').addEventListener('submit',async e=>{
  e.preventDefault();if(e.target.id!=='fCust'||!sb)return;
  const el=e.target.elements,d={};['name','phone','email','idNote','address','notes'].forEach(k=>d[k]=el[k].value.trim());
  if(!d.name)return toast('Add the customer name');
  try{
    if(openId){
      await ok(sb.from('customers').update(toDb(d)).eq('id',openId));
      await ok(sb.from('rentals').update({customer_name:d.name,customer_phone:d.phone,customer_email:d.email}).eq('customer_id',openId).eq('status','active'));
    }else{const row=await ok(sb.from('customers').insert(toDb(d)).select().single());openId=row.id}
    toast('Customer saved');await reload();
  }catch(err){fail(err)}
});
$('#lb').onclick=()=>$('#lb').classList.remove('on');

/* ---------- customers ---------- */
function renderCustomers(){
  const sel=fN.elements.cust,cur=sel.value;
  sel.innerHTML='<option value="new">+ New customer</option>'+[...customers].sort((a,b)=>String(a.name).localeCompare(b.name)).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.phone?' ('+esc(c.phone)+')':''}</option>`).join('');
  sel.value=[...sel.options].some(o=>o.value===cur)?cur:'new';toggleNewCust();
  let list=customers;if(cq){const s=cq.toLowerCase();list=list.filter(c=>[c.name,c.phone,c.email].join(' ').toLowerCase().includes(s))}
  list=[...list].sort((a,b)=>String(a.name).localeCompare(b.name));
  $('#custTable').innerHTML=list.length?`<table class="stack"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Out now</th><th></th></tr></thead><tbody>${list.map(c=>{
    const n=rentals.filter(r=>r.customerId===c.id&&r.status!=='returned').length;
    return `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td><td class="num">${n}</td><td><button class="sm" data-c="${esc(c.id)}">Open</button></td></tr>`}).join('')}</tbody></table>`
    :`<div class="empty">${customers.length?'No customer matches.':'No customers yet. They are added when you save a rental, or with Add customer.'}</div>`;
}
$('#custTable').addEventListener('click',e=>{const b=e.target.closest('[data-c]');if(b){openId=b.dataset.c;openKind='cust';renderCustomer()}});
$('#addCust').onclick=()=>{openId=null;openKind='cust';renderCustomer()};
$('#cq').addEventListener('input',e=>{cq=e.target.value.trim();renderCustomers()});

/* ---------- email setup ---------- */
const fS=$('#fSet');
function renderSetup(){if(fS.contains(document.activeElement))return;fS.elements.ownerEmail.value=settings.ownerEmail||'';$('#defChecks').innerHTML=checksHTML('dd',settings.days||[7,1])}
fS.addEventListener('submit',async e=>{e.preventDefault();if(!sb||!me)return toast('Please sign in first');
  const d={owner_id:me.id,owner_email:fS.elements.ownerEmail.value.trim(),days:[...fS.querySelectorAll('[name=dd]:checked')].map(x=>+x.value)};
  try{await ok(sb.from('settings').upsert(d));toast('Saved');await reload();resetNew()}catch(err){fail(err)}});

const refreshSheet=()=>{if(!openKind)return;const a=document.activeElement;if($('#sheet').contains(a)&&a.matches('input:not([type=checkbox]):not([type=file]),textarea'))return;openKind==='rental'?renderRental():renderCustomer()};

/* ---------- sign in ---------- */
function showLogin(){me=null;rentals=[];customers=[];urls={};closeSheet();document.body.classList.add('out');$('#conn').style.display='none';renderList();renderCustomers()}
async function signedIn(u){me=u;document.body.classList.remove('out');$('#conn').style.display='';$('#conn').textContent='Loading your rentals…';await reload()}
$('#login').addEventListener('submit',async e=>{
  e.preventDefault();const el=e.target.elements;$('#loginMsg').textContent='Signing in…';
  const{data,error}=await sb.auth.signInWithPassword({email:el.email.value.trim(),password:el.password.value});
  if(error){$('#loginMsg').textContent='Sign in failed: '+error.message;return}
  $('#loginMsg').textContent='';el.password.value='';signedIn(data.user);
});
$('#signOut').addEventListener('click',async e=>{e.preventDefault();if(sb)await sb.auth.signOut();showLogin()});

resetNew();renderList();renderCustomers();renderSetup();
(async()=>{
  let cfg=null;try{cfg=await (await fetch('/api/config')).json()}catch(e){}
  if(!cfg||!cfg.url||!cfg.anonKey){$('#conn').textContent='Setup needed: add SUPABASE_URL and SUPABASE_ANON_KEY in your Vercel project settings, then redeploy.';return}
  if(!window.supabase){$('#conn').textContent='Could not load the Supabase library. Check your internet connection and reload.';return}
  sb=window.supabase.createClient(cfg.url,cfg.anonKey);
  const{data:{session}}=await sb.auth.getSession();
  sb.auth.onAuthStateChange(ev=>{if(ev==='SIGNED_OUT')showLogin()});
  session?signedIn(session.user):showLogin();
})();
}
