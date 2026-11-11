/* Экспорт: офлайн-версия игры, сохранения, проект для GitHub */
function arcDownload(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);}
async function arcFetchText(p){const r=await fetch(p,{cache:'no-store'});if(!r.ok)throw new Error('Не удалось загрузить '+p);return r.text();}
async function arcFetchDataURL(p){const r=await fetch(p);if(!r.ok)return p;const b=await r.blob();return await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(b);});}
async function downloadOfflineGame(btn){
 if(location.protocol==='file:'){alert('Это уже офлайн-версия игры.');return;}
 const old=btn&&btn.textContent;if(btn){btn.disabled=true;btn.textContent='Собираем…';}
 try{
  let html=await arcFetchText('/index.html');
  const [coop,soul,css,exp,app]=await Promise.all(['/coop.js','/soul.js','/soul.css','/export.js','/app.js'].map(arcFetchText));
  const js=s=>'<script>'+s.split('</script').join('<\\/script')+'</script>';
  // Один проход: вставленный код не сканируется повторно (в export.js есть те же строки-шаблоны)
  const inl={coop,soul,export:exp,app};
  html=html.replace(/<script src="\/(coop|soul|export|app)\.js"><\/script>|<link rel="stylesheet" href="\/soul\.css">/g,(m,n)=>n?js(inl[n]):'<style>'+css+'</style>');
  for(const n of [1,2,3]){const p='/assets/aeon-phase-'+n+'.jpg';if(html.includes(p))html=html.split(p).join(await arcFetchDataURL(p));}
  for(const p of ['/icons/icon-192.png','/icons/apple-touch-icon.png'])if(html.includes(p))html=html.split(p).join(await arcFetchDataURL(p));
  html=html.replace('<link rel="manifest" href="/manifest.webmanifest">','');
  html=html.replace('<head>','<head>\n<!-- Офлайн-версия АРКАДИИ. Сетевая игра требует онлайн-сайта. -->');
  arcDownload('arcadia-offline.html',new Blob([html],{type:'text/html;charset=utf-8'}));
 }catch(e){alert(e.message||'Ошибка сборки');}
 finally{if(btn){btn.disabled=false;btn.textContent=old;}}
}
function downloadSaves(){
 const data={format:'arcadia-saves',version:1,exported:new Date().toISOString(),storage:{}};
 for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^arc/.test(k))data.storage[k]=localStorage.getItem(k);}
 arcDownload('arcadia-saves-'+new Date().toISOString().slice(0,10)+'.json',new Blob([JSON.stringify(data,null,1)],{type:'application/json'}));
}
function importSaves(){
 const inp=document.createElement('input');inp.type='file';inp.accept='application/json,.json';
 inp.onchange=async()=>{try{const d=JSON.parse(await inp.files[0].text());if(d.format!=='arcadia-saves'||!d.storage)throw new Error('Это не файл сохранений Аркадии');
  if(!confirm('Загрузить сохранения из файла? Аккаунты с теми же именами будут перезаписаны.'))return;
  for(const [k,v] of Object.entries(d.storage))if(/^arc/.test(k)&&typeof v==='string')localStorage.setItem(k,v);
  alert('Сохранения загружены. Страница перезагрузится.');location.reload();}catch(e){alert(e.message||'Ошибка чтения файла');}};
 inp.click();
}
function downloadProject(){
 if(location.protocol==='file:'){alert('Архив проекта скачивается с онлайн-сайта игры.');return;}
 location.href='/api/project-zip';
}
function downloadDesktopApp(){
 if(location.protocol==='file:'||location.protocol==='app:'){location.href='https://admirable-rugelach-6de6cf.netlify.app/api/desktop-app';return;}
 location.href='/api/desktop-app';
}
function downloadLocalServer(){
 if(location.protocol.startsWith('http')&&!(typeof LAN!=='undefined'&&LAN)){location.href='/api/local-server';return;}
 location.href='https://admirable-rugelach-6de6cf.netlify.app/api/local-server';
}
