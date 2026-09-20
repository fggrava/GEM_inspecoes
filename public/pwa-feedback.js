(()=>{
  const previousFetch=window.fetch.bind(window);
  window.fetch=async function(input,init={}){
    const response=await previousFetch(input,init);
    try{
      const method=(init.method||((typeof input!=='string'&&input.method)||'GET')).toUpperCase();
      const url=new URL(typeof input==='string'?input:input.url,location.origin);
      if(method==='POST'&&url.origin===location.origin&&url.pathname==='/api/inspections'){
        const data=await response.clone().json().catch(()=>null);
        if(data?.offline){
          setTimeout(()=>{
            document.querySelectorAll('.status').forEach(el=>{
              if(el.textContent?.includes('Registro salvo no banco de dados'))el.textContent='Salvo no dispositivo — aguardando sincronização.';
            });
          },80);
        }
      }
    }catch{}
    return response;
  };
})();
