/* HTTPS relay: no external signaling server or direct device connection. */
const COOP_OFFLINE='Сервер совместной игры недоступен. Одиночная игра работает как обычно — попробуй позже.';
class CoopConnection {
 constructor(room,host,onMessage,onStatus,options={}){
  this.options=options;this.slot=host?0:1;this.capacity=options.capacity||2;
  this.room=room;this.host=host;this.onMessage=onMessage;this.onStatus=onStatus;
  this.key=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  this.open=false;this.closed=false;this.cursor=0;this.queue=[];this.sending=false;
 }
 async request(action,extra={}){
  let response;
  try{response=await fetch('/.netlify/functions/coop',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({action,room:this.room,key:this.key,...extra}),signal:AbortSignal.timeout(12000)
  });}catch(e){throw new Error(COOP_OFFLINE);}
  const data=await response.json().catch(()=>null);
  if(!data){const e=new Error(COOP_OFFLINE);e.permanent=response.status===404;throw e;}
  if(!response.ok){const e=new Error(data.error||'Ошибка подключения');e.permanent=response.status<500;throw e;}
  return data;
 }
 async connect(){
  for(let attempt=0;attempt<3;attempt++){
   try{const data=await this.request(this.options.enter?'enter':this.host?'create':'join',{capacity:this.capacity});this.slot=data.slot??this.slot;this.capacity=data.capacity||this.capacity;this.host=this.slot===0;this.cursor=data.cursor||0;break;}
   catch(e){if(e.permanent||attempt===2)throw e;await new Promise(r=>setTimeout(r,1000));}
  }
  if(this.closed)return;
  this.open=true;this.lastOk=Date.now();this.poll();
 }
 send(payload){if(this.closed)return;if(payload.t==='soulPosition')this.queue=this.queue.filter((m,i)=>i===0&&this.sending||m.payload.t!=='soulPosition');this.queue.push({id:crypto.randomUUID?crypto.randomUUID():this.key.slice(0,8)+Date.now().toString(36)+Math.random().toString(36).slice(2),payload});this.flush();}
 async flush(){
  if(this.sending||this.closed)return;
  this.sending=true;
  try{
   while(this.queue.length&&!this.closed){await this.request('send',this.queue[0]);this.queue.shift();}
  }catch(e){this.onStatus(e.message||'Связь прервана. Повторяем отправку…');}
  finally{this.sending=false;if(this.queue.length&&!this.closed)this.sendTimer=setTimeout(()=>this.flush(),1500);}
 }
 async poll(){
  if(this.closed)return;
  try{
   const response=await fetch('/.netlify/functions/coop?'+new URLSearchParams({room:this.room,key:this.key,after:String(this.cursor)}),{
    cache:'no-store',signal:AbortSignal.timeout(12000)
   });
   const data=await response.json().catch(()=>null);
   if(data&&(response.status===404||response.status===403)){this.close();if(this.onDisconnect)this.onDisconnect();return;}
   if(!data||!response.ok)throw new Error(data&&data.error||COOP_OFFLINE);
   this.lastOk=Date.now();
   this.onStatus('Соединение с сервером установлено.');
   if(data.slots&&this.onMembers)this.onMembers(data.slots);
   for(const message of data.messages){
    if(this.closed)break;
    this.onMessage(message.payload);this.cursor=message.seq;
   }
  }catch(e){if(!this.closed){if(Date.now()-(this.lastOk||Date.now())>30000){this.close();if(this.onDisconnect)this.onDisconnect();return;}this.onStatus(e.name==='TypeError'||e.name==='TimeoutError'?'Связь с сервером потеряна. Восстанавливаем соединение…':e.message||'Восстанавливаем соединение…');}}
  finally{if(!this.closed)this.pollTimer=setTimeout(()=>this.poll(),typeof SOUL!=='undefined'&&SOUL&&!SOUL.over?120:700);}
 }
 leave(){fetch('/.netlify/functions/coop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'leave',room:this.room,key:this.key}),keepalive:true}).catch(()=>{});this.close();}
 close(){this.closed=true;this.open=false;clearTimeout(this.pollTimer);clearTimeout(this.sendTimer);}
}
