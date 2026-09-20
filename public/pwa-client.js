(()=>{
  const DB_NAME='GEM_INSPECOES_PWA';
  const DB_VERSION=1;
  const MAX_QUEUE=10;
  const nativeFetch=window.fetch.bind(window);
  let syncing=false;
  let installPrompt=null;

  function openDb(){
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB_NAME,DB_VERSION);
      r.onupgradeneeded=()=>{
        const db=r.result;
        if(!db.objectStoreNames.contains('queue'))db.createObjectStore('queue',{keyPath:'client_record_id'});
        if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
      };
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>reject(r.error);
    });
  }

  async function tx(store,mode,fn){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const t=db.transaction(store,mode);const s=t.objectStore(store);let out;
      try{out=fn(s)}catch(e){reject(e);return}
      t.oncomplete=()=>resolve(out?.result!==undefined?out.result:out);
      t.onerror=()=>reject(t.error);
    });
  }

  const metaGet=async key=>{
    const db=await openDb();
    return new Promise(resolve=>{const t=db.transaction('meta','readonly');const r=t.objectStore('meta').get(key);r.onsuccess=()=>resolve(r.result?.value??null);r.onerror=()=>resolve(null)});
  };
  const metaSet=(key,value)=>tx('meta','readwrite',s=>s.put({key,value}));
  const metaDelete=key=>tx('meta','readwrite',s=>s.delete(key));
  const queueAll=async()=>{
    const db=await openDb();
    return new Promise(resolve=>{const t=db.transaction('queue','readonly');const r=t.objectStore('queue').getAll();r.onsuccess=()=>resolve((r.result||[]).sort((a,b)=>a.created_at-b.created_at));r.onerror=()=>resolve([])});
  };
  const queueDelete=id=>tx('queue','readwrite',s=>s.delete(id));
  const queuePut=item=>tx('queue','readwrite',s=>s.put(item));

  function uuid(){return crypto.randomUUID?crypto.randomUUID():'gem-'+Date.now()+'-'+Math.random().toString(16).slice(2)}
  function jsonResponse(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json'}})}
  function sameApi(input,path){try{const u=new URL(typeof input==='string'?input:input.url,location.origin);return u.origin===location.origin&&u.pathname===path}catch{return false}}
  function bodyOf(init){try{return JSON.parse(init?.body||'{}')}catch{return {}}}

  async function currentProfile(){return await metaGet('profile')}
  async function queueCount(){return (await queueAll()).length}

  async function enqueue(payload){
    const items=await queueAll();
    if(items.length>=MAX_QUEUE)return {ok:false,error:'Limite offline atingido: existem 10 registros pendentes. Conecte o celular à internet para sincronizar antes de continuar.'};
    const profile=await currentProfile();
    if(!profile||profile.role!=='INSPECTOR')return {ok:false,error:'O modo offline está disponível apenas para inspetores autenticados.'};
    const client_record_id=payload.client_record_id||uuid();
    await queuePut({client_record_id,payload:{...payload,client_record_id},created_at:Date.now(),attempts:0});
    renderWidget();
    showToast('Inspeção salva no celular. Aguardando sincronização.',false);
    try{const reg=await navigator.serviceWorker?.ready;if(reg?.sync)await reg.sync.register('gem-sync')}catch{}
    return {ok:true,client_record_id};
  }

  async function syncQueue(source='auto'){
    if(syncing||!navigator.onLine)return;
    const profile=await currentProfile();
    if(!profile||profile.role!=='INSPECTOR')return;
    syncing=true;renderWidget();
    let synced=0,authRequired=false;
    try{
      const items=await queueAll();
      for(const item of items){
        try{
          const r=await nativeFetch('/api/inspections',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(item.payload)});
          if(r.status===401){authRequired=true;break}
          if(r.ok){await queueDelete(item.client_record_id);synced++;continue}
          const data=await r.json().catch(()=>({}));
          await queuePut({...item,attempts:(item.attempts||0)+1,last_error:data.error||`HTTP ${r.status}`});
          if(r.status>=400&&r.status<500)break;
        }catch{break}
      }
      if(synced>0){showToast(`${synced} registro${synced>1?'s':''} sincronizado${synced>1?'s':''} com a nuvem.`,false);try{const h=await nativeFetch('/api/inspections',{cache:'no-store'});if(h.ok)await metaSet('history',await h.clone().json())}catch{}}
      if(authRequired)showToast('Há registros pendentes. Entre novamente no GEM para sincronizar.',true);
    }finally{syncing=false;renderWidget()}
  }

  async function renderWidget(){
    const profile=await currentProfile();
    let box=document.getElementById('gem-pwa-sync');
    if(!profile||profile.role!=='INSPECTOR'){if(box)box.remove();return}
    if(!box){
      box=document.createElement('div');box.id='gem-pwa-sync';box.className='gemPwaSync';
      box.innerHTML='<div class="gemPwaTop"><span class="gemPwaDot"></span><strong class="gemPwaState"></strong></div><div class="gemPwaMeta"></div><div class="gemPwaActions"><button type="button" class="gemPwaBtn gemPwaSyncBtn">Sincronizar agora</button><button type="button" class="gemPwaBtn gemPwaInstallBtn" hidden>Instalar app</button></div>';
      document.body.appendChild(box);
      box.querySelector('.gemPwaSyncBtn').addEventListener('click',()=>syncQueue('manual'));
      box.querySelector('.gemPwaInstallBtn').addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;renderWidget()});
    }
    const count=await queueCount();
    box.classList.toggle('offline',!navigator.onLine);
    box.classList.toggle('syncing',syncing);
    box.querySelector('.gemPwaState').textContent=syncing?'Sincronizando':navigator.onLine?'Online':'Offline';
    box.querySelector('.gemPwaMeta').textContent=count?`${count} de ${MAX_QUEUE} registro${count>1?'s':''} pendente${count>1?'s':''}`:'Todos os registros sincronizados';
    box.querySelector('.gemPwaSyncBtn').disabled=syncing||!navigator.onLine||count===0;
    box.querySelector('.gemPwaInstallBtn').hidden=!installPrompt;
  }

  function showToast(text,isError){
    let t=document.getElementById('gem-pwa-toast');
    if(!t){t=document.createElement('div');t.id='gem-pwa-toast';document.body.appendChild(t)}
    t.className='gemPwaToast'+(isError?' error':'');t.textContent=text;t.classList.add('show');
    clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),4200);
  }

  window.fetch=async function(input,init={}){
    const method=(init.method||((typeof input!=='string'&&input.method)||'GET')).toUpperCase();

    if(sameApi(input,'/api/auth/login')&&method==='POST'){
      const r=await nativeFetch(input,init);
      if(r.ok){try{const d=await r.clone().json();if(d.user?.role==='INSPECTOR'){await metaSet('profile',d.user);renderWidget();setTimeout(()=>syncQueue('login'),300)}else{await metaDelete('profile');renderWidget()}}catch{}}
      return r;
    }

    if(sameApi(input,'/api/auth/logout')&&method==='POST'){
      const r=await nativeFetch(input,init);await metaDelete('profile');await metaDelete('history');renderWidget();return r;
    }

    if(sameApi(input,'/api/me')&&method==='GET'){
      try{
        const r=await nativeFetch(input,init);
        if(r.ok){const d=await r.clone().json();if(d.user?.role==='INSPECTOR')await metaSet('profile',d.user);else await metaDelete('profile');renderWidget();return r}
        return r;
      }catch{
        const p=await currentProfile();if(p?.role==='INSPECTOR')return jsonResponse({user:p},200);throw new TypeError('Offline');
      }
    }

    if(sameApi(input,'/api/inspections')&&method==='GET'){
      try{
        const r=await nativeFetch(input,init);
        if(r.ok){const p=await currentProfile();if(p?.role==='INSPECTOR')await metaSet('history',await r.clone().json())}
        return r;
      }catch{
        const p=await currentProfile();const h=await metaGet('history');if(p?.role==='INSPECTOR'&&Array.isArray(h))return jsonResponse(h,200);throw new TypeError('Offline');
      }
    }

    if(sameApi(input,'/api/inspections')&&method==='POST'){
      const profile=await currentProfile();
      if(profile?.role!=='INSPECTOR')return nativeFetch(input,init);
      const payload={...bodyOf(init)};if(!payload.client_record_id)payload.client_record_id=uuid();
      const nextInit={...init,headers:{...(init.headers||{}),'Content-Type':'application/json'},body:JSON.stringify(payload)};
      if(navigator.onLine){
        try{const r=await nativeFetch(input,nextInit);if(r.ok){setTimeout(()=>syncQueue('after-save'),100);return r}if(r.status===401)return r}catch{}
      }
      const q=await enqueue(payload);
      if(!q.ok)return jsonResponse({error:q.error},507);
      return jsonResponse({offline:true,client_record_id:q.client_record_id,status:'Pendente de sincronização'},201);
    }

    return nativeFetch(input,init);
  };

  window.addEventListener('online',()=>{renderWidget();syncQueue('online')});
  window.addEventListener('offline',renderWidget);
  window.addEventListener('focus',()=>syncQueue('focus'));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncQueue('visible')});
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;renderWidget()});
  window.addEventListener('appinstalled',()=>{installPrompt=null;renderWidget();showToast('GEM Inspeções instalado no dispositivo.',false)});

  async function start(){
    if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('/sw.js',{scope:'/'});}catch(e){console.warn('Service Worker:',e)}}
    await renderWidget();
    if(navigator.onLine)setTimeout(()=>syncQueue('startup'),600);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
