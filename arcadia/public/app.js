/* АРКАДИЯ как приложение: установка на телефон и компьютер (PWA) */
(function(){
 const ua=navigator.userAgent;
 const P={
  ios:/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),
  android:/Android/i.test(ua),
  standalone:matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: fullscreen)').matches||navigator.standalone===true,
  desktopApp:/Electron/i.test(ua)||location.protocol==='app:',
  file:location.protocol==='file:'
 };
 window.ARC_PLATFORM=P;
 let deferred=null;
 if('serviceWorker' in navigator&&!P.file&&!P.desktopApp&&(location.protocol==='https:'||location.hostname==='localhost')){
  addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
 }
 function refresh(){document.querySelectorAll('[data-install-state]').forEach(el=>{
  el.textContent=P.standalone||P.desktopApp?'✅ Приложение уже установлено и запущено':deferred?'Готово к установке — нажми кнопку':P.ios?'На iPhone/iPad: «Поделиться» → «На экран Домой»':'Если кнопка не сработала — меню браузера → «Установить приложение»';});
  document.querySelectorAll('[data-hide-installed]').forEach(el=>el.classList.toggle('hidden',!!(P.standalone||P.desktopApp)));}
 addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;refresh();});
 addEventListener('appinstalled',()=>{deferred=null;P.standalone=true;refresh();});
 addEventListener('DOMContentLoaded',refresh);
 window.installApp=async function(){
  if(P.standalone||P.desktopApp){alert('Аркадия уже открыта как приложение.');return;}
  if(P.file){location.href='https://admirable-rugelach-6de6cf.netlify.app/download.html';return;}
  if(deferred){deferred.prompt();const r=await deferred.userChoice.catch(()=>null);deferred=null;refresh();if(r&&r.outcome==='accepted')return;return;}
  if(P.ios){alert('iPhone / iPad:\n1. Открой сайт в Safari.\n2. Нажми «Поделиться» (квадрат со стрелкой).\n3. Выбери «На экран Домой» → «Добавить».\nИконка Аркадии появится на рабочем столе.');return;}
  if(P.android){alert('Android:\nОткрой меню браузера (⋮) → «Установить приложение» или «Добавить на главный экран».');return;}
  alert('Компьютер:\nВ Chrome, Edge или Яндекс Браузере нажми значок установки (⊕) в адресной строке или меню (⋮) → «Установить АРКАДИЯ».\nВ Safari на Mac: «Файл» → «Добавить в Dock».\n\nИли скачай настольную версию (.zip) на странице загрузки.');
 };
 window.openDownloads=function(){location.href=P.file?'https://admirable-rugelach-6de6cf.netlify.app/download.html':'/download.html';};
})();
