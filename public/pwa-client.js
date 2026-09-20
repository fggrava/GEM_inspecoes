(()=>{
  const DB_NAME='GEM_INSPECOES_PWA';
  const DB_VERSION=1;
  const MAX_QUEUE=10;
  const nativeFetch=window.fetch.bind(window);
  let syncing=false;
  let installPrompt=null;
  let statusTimer=null;

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
  function isStandalone(){return window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true}
  function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent)}
  async function currentProfile(){return await metaGet('profile')}
  async function queueCount(){return (await queueAll()).length}

  function ensureStatusBox(){
    let box=document.getElementById('gem-pwa-sync');
    if(box)return box;
    box=document.createElement('div');
    box.id='gem-pwa-sync';
    box.className='gemPwaSync';
    box.innerHTML='<div class="gemPwaTop"><span class="gemPwaDot"></span><strong class="gemPwaState"></strong></div><div class="gemPwaMeta"></div>';
    document.body.appendChild(box);
    return box;
  }

  async function showSaveStatus(mode){
    const profile=await currentProfile();
    if(!profile||profile.role!=='INSPECTOR')return;
    const box=ensureStatusBox();
    const count=await queueCount();
    box.classList.toggle('offline',mode==='offline');
    box.classList.remove('syncing');
    box.querySelector('.gemPwaState').textContent=mode==='offline'?'Salvo offline':'Salvo na nuvem';
    box.querySelector('.gemPwaMeta').textContent=mode==='offline'
      ? `Aguardando sincronização • ${count} de ${MAX_QUEUE} pendente${count===1?'':'s'}`
      : 'Registro sincronizado com sucesso';
    box.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer=setTimeout(()=>box.classList.remove('show'),5000);
  }

  function showToast(text,isError=false){
    let t=document.getElementById('gem-pwa-toast');
    if(!t){t=document.createElement('div');t.id='gem-pwa-toast';document.body.appendChild(t)}
    t.className='gemPwaToast'+(isError?' error':'');
    t.textContent=text;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer=setTimeout(()=>t.classList.remove('show'),5000);
  }

  async function triggerInstall(){
    if(isStandalone()){
      showToast('O GEM Inspeções já está instalado neste aparelho.');
      return;
    }
    if(installPrompt){
      installPrompt.prompt();
      const choice=await installPrompt.userChoice.catch(()=>null);
      if(choice?.outcome==='accepted')installPrompt=null;
      await renderMiniControls();
      return;
    }
    if(isIOS()){
      showToast('No Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.');
    }else{
      showToast('No navegador, toque no menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”.');
    }
  }

  async function renderMiniControls(){
    const profile=await currentProfile();
    let syncBtn=document.getElementById('gem-pwa-mini-sync');
    let installBtn=document.getElementById('gem-pwa-install');
    if(!profile||profile.role!=='INSPECTOR'){
      syncBtn?.remove();installBtn?.remove();
      const box=document.getElementById('gem-pwa-sync');box?.classList.remove('show');
      return;
    }

    const count=await queueCount();
    if(count>0){
      if(!syncBtn){
        syncBtn=document.createElement('button');
        syncBtn.id='gem-pwa-mini-sync';
        syncBtn.className='gemPwaMiniSync';
        syncBtn.type='button';
        syncBtn.setAttribute('aria-label','Sincronizar registros pendentes');
        syncBtn.title='Sincronizar registros pendentes';
        syncBtn.textContent='↻';
        syncBtn.addEventListener('click',()=>syncQueue('manual'));
        document.body.appendChild(syncBtn);
      }
      syncBtn.disabled=syncing||!navigator.onLine;
      syncBtn.dataset.count=String(count);
      syncBtn.classList.toggle('offline',!navigator.onLine);
      syncBtn.classList.toggle('syncing',syncing);
    }else syncBtn?.remove();

    if(!isStandalone()){
      if(!installBtn){
        installBtn=document.createElement('button');
        installBtn.id='gem-pwa-install';
        installBtn.className='gemPwaInstallChip';
        installBtn.type='button';
        installBtn.textContent='Instalar app';
        installBtn.addEventListener('click',triggerInstall);
        document.body.appendChild(installBtn);
      }
      installBtn.classList.toggle('ready',!!installPrompt);
      installBtn.title=installPrompt?'Instalar GEM Inspeções':'Ver instruções de instalação';
    }else installBtn?.remove();
  }

  async function enqueue(payload){
    const items=await queueAll();
    if(items.length>=MAX_QUEUE)return {ok:false,error:'Limite offline atingido: existem 10 registros pendentes. Conecte o celular à internet para sincronizar antes de continuar.'};
    const profile=await currentProfile();
    if(!profile||profile.role!=='INSPECTOR')return {ok:false,error:'O modo offline está disponível apenas para inspetores autenticados.'};
    const client_record_id=payload.client_record_id||uuid();
    await queuePut({client_record_id,payload:{...payload,client_record_id},created_at:Date.now(),attempts:0});
    await renderMiniControls();
    await showSaveStatus('offline');
    try{const reg=await navigator.serviceWorker?.ready;if(reg?.sync)await reg.sync.register('gem-sync')}catch{}
    return {ok:true,client_record_id};
  }

  async function syncQueue(source='auto'){
    if(syncing)return;
    if(!navigator.onLine){if(source==='manual')showToast('Sem conexão com a internet. Os registros continuam salvos no celular.',true);return}
    const profile=await currentProfile();
    if(!profile||profile.role!=='INSPECTOR')return;
    const items=await queueAll();
    if(!items.length){await renderMiniControls();return}

    syncing=true;await renderMiniControls();
    let synced=0,authRequired=false;
    try{
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
      if(synced>0){
        showToast(`${synced} registro${synced>1?'s':''} sincronizado${synced>1?'s':''} com a nuvem.`);
        try{const h=await nativeFetch('/api/inspections',{cache:'no-store'});if(h.ok)await metaSet('history',await h.clone().json())}catch{}
      }
      if(authRequired)showToast('Há registros pendentes. Entre novamente no GEM para sincronizar.',true);
    }finally{
      syncing=false;
      await renderMiniControls();
    }
  }

  window.fetch=async function(input,init={}){
    const method=(init.method||((typeof input!=='string'&&input.method)||'GET')).toUpperCase();

    if(sameApi(input,'/api/auth/login')&&method==='POST'){
      const r=await nativeFetch(input,init);
      if(r.ok){
        try{
          const d=await r.clone().json();
          if(d.user?.role==='INSPECTOR'){
            await metaSet('profile',d.user);
            await renderMiniControls();
            setTimeout(()=>syncQueue('login'),300);
          }else{
            await metaDelete('profile');
            await renderMiniControls();
          }
        }catch{}
      }
      return r;
    }

    if(sameApi(input,'/api/auth/logout')&&method==='POST'){
      const r=await nativeFetch(input,init);
      await metaDelete('profile');await metaDelete('history');await renderMiniControls();
      return r;
    }

    if(sameApi(input,'/api/me')&&method==='GET'){
      try{
        const r=await nativeFetch(input,init);
        if(r.ok){
          const d=await r.clone().json();
          if(d.user?.role==='INSPECTOR')await metaSet('profile',d.user);else await metaDelete('profile');
          await renderMiniControls();
        }
        return r;
      }catch{
        const p=await currentProfile();
        if(p?.role==='INSPECTOR')return jsonResponse({user:p},200);
        throw new TypeError('Offline');
      }
    }

    if(sameApi(input,'/api/inspections')&&method==='GET'){
      try{
        const r=await nativeFetch(input,init);
        if(r.ok){const p=await currentProfile();if(p?.role==='INSPECTOR')await metaSet('history',await r.clone().json())}
        return r;
      }catch{
        const p=await currentProfile();const h=await metaGet('history');
        if(p?.role==='INSPECTOR'&&Array.isArray(h))return jsonResponse(h,200);
        throw new TypeError('Offline');
      }
    }

    if(sameApi(input,'/api/inspections')&&method==='POST'){
      const profile=await currentProfile();
      if(profile?.role!=='INSPECTOR')return nativeFetch(input,init);
      const payload={...bodyOf(init)};
      if(!payload.client_record_id)payload.client_record_id=uuid();
      const nextInit={...init,headers:{...(init.headers||{}),'Content-Type':'application/json'},body:JSON.stringify(payload)};

      if(navigator.onLine){
        try{
          const r=await nativeFetch(input,nextInit);
          if(r.ok){await showSaveStatus('online');setTimeout(()=>syncQueue('after-save'),100);return r}
          if(r.status===401)return r;
        }catch{}
      }

      const q=await enqueue(payload);
      if(!q.ok)return jsonResponse({error:q.error},507);
      return jsonResponse({offline:true,client_record_id:q.client_record_id,status:'Pendente de sincronização'},201);
    }

    return nativeFetch(input,init);
  };

  window.addEventListener('online',()=>{renderMiniControls();syncQueue('online')});
  window.addEventListener('offline',renderMiniControls);
  window.addEventListener('focus',()=>syncQueue('focus'));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncQueue('visible')});
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;renderMiniControls()});
  window.addEventListener('appinstalled',()=>{installPrompt=null;renderMiniControls();showToast('GEM Inspeções instalado no dispositivo.')});
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change',renderMiniControls);
  if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='GEM_SYNC')syncQueue('background')});

  async function start(){
    if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('/sw.js',{scope:'/'});}catch(e){console.warn('Service Worker:',e)}}
    await renderMiniControls();
    if(navigator.onLine)setTimeout(()=>syncQueue('startup'),600);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
