const CACHE='gem-pwa-v2';
const CORE=['/manifest.webmanifest','/gem-icon.svg','/gem-maskable.svg','/pwa-client.js'];

async function precacheShell(){
  const cache=await caches.open(CACHE);
  await Promise.all(CORE.map(async url=>{try{const r=await fetch(url,{cache:'reload'});if(r.ok)await cache.put(url,r)}catch{}}));
  try{
    const page=await fetch('/',{cache:'reload'});
    if(page.ok){
      const clone=page.clone();
      await cache.put('/',clone);
      const html=await page.text();
      const matches=[...html.matchAll(/(?:src|href)="([^\"]*\/_next\/static\/[^\"]+)"/g)].map(m=>m[1]);
      const urls=[...new Set(matches)];
      await Promise.all(urls.map(async url=>{try{const r=await fetch(url,{cache:'reload'});if(r.ok)await cache.put(url,r)}catch{}}));
    }
  }catch{}
}

self.addEventListener('install',event=>{
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/api/'))return;

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(req);
        if(fresh?.ok){const cache=await caches.open(CACHE);cache.put('/',fresh.clone())}
        return fresh;
      }catch{
        return (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(req);
    if(cached)return cached;
    try{
      const fresh=await fetch(req);
      if(fresh?.ok && (url.pathname.startsWith('/_next/static/') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.webmanifest'))){
        const cache=await caches.open(CACHE);
        cache.put(req,fresh.clone());
      }
      return fresh;
    }catch{
      return Response.error();
    }
  })());
});

self.addEventListener('sync',event=>{
  if(event.tag==='gem-sync'){
    event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{clients.forEach(c=>c.postMessage({type:'GEM_SYNC'}))}));
  }
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});
