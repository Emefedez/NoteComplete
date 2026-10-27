const $=id=>document.getElementById(id);
function recordingName(recording,index){
 if(recording?.name?.trim())return recording.name;
 if(recording?.start_us){const date=new Date((Number(BigInt(recording.start_us)/1000n)+978307200000));if(Number.isFinite(date.getTime()))return `Recording ${index+1} · ${date.toLocaleString('en',{dateStyle:'medium',timeStyle:'short'})}`;}
 return `Audio ${index+1}`;
}
const clock=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
export class AudioController {
 constructor(read,jump,changed){
  this.read=read;this.jump=jump;this.changed=changed;this.audio=$('audio');this.token=0;this.urls=new Map();this.positions=new Map();this.entries=[];
  $('recording').onchange=()=>this.select(Number($('recording').value));
  $('playAudio').onclick=async()=>{if(this.audio.paused){try{await this.processing?.resume();await this.audio.play();}catch(e){$('audioState').textContent=e.message;}}else this.audio.pause();};
  $('backAudio').onclick=()=>this.seek(Math.max(0,this.audio.currentTime-10));
  $('forwardAudio').onclick=()=>this.seek(Math.min(this.audio.duration||0,this.audio.currentTime+10));
  $('audioSeek').oninput=()=>this.seek(Number($('audioSeek').value));
  $('audioPage').onclick=()=>{const target=this.entries[this.index]?.recording?.pages?.[0];if(target!==undefined)this.jump(Number(target));};
  $('syncEnabled').onchange=()=>this.changed();
  this.audio.ontimeupdate=()=>this.update();this.audio.onseeked=()=>this.update();
  this.audio.onplay=()=>{this.lastTick=0;this.update();this.tick();};this.audio.onpause=()=>{cancelAnimationFrame(this.frame);this.processing?.suspend().catch(()=>{});this.update();};
  this.audio.onended=this.audio.onpause;
  this.audio.onerror=()=>{$('audioState').textContent='This browser cannot play this format. You can download the audio.';};
 }
 get recording(){return $('syncEnabled').checked?this.entries[this.index]?.recording:null;}
 get time(){return this.audio.currentTime||0;}
 tick(now=0){if(!this.lastTick||now-this.lastTick>=50){this.lastTick=now;this.changed();this.transcript?.update();}if(!this.audio.paused)this.frame=requestAnimationFrame(time=>this.tick(time));}
 seek(t){if(this.audio.readyState){this.audio.currentTime=t;this.update();}}
 label(entry){return recordingName(entry?.recording,Math.max(0,this.entries.indexOf(entry)));}
 async seekRecording(id,time){
  const index=this.entries.findIndex(entry=>entry.recording?.id===id);
  if(index<0||!this.entries[index].asset||!Number.isFinite(time)||time<0)return false;
  this.positions.set(index,time);
  if(this.index===index){this.seek(time);return true;}
  $('recording').value=String(index);
  await this.select(index);
  return true;
 }
 reset(){this.transcript?.reset();this.token++;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();cancelAnimationFrame(this.frame);for(const url of this.urls.values())URL.revokeObjectURL(url);this.urls.clear();this.positions.clear();this.entries=[];this.index=undefined;$('audioBar').hidden=true;$('audioToggle').hidden=true;$('audioToggle').setAttribute('aria-expanded','false');}
 open(assets,recordings){
  this.reset();this.entries=recordings.map(recording=>({recording,asset:assets.find(a=>a.id===recording.asset_id)}));
  for(const asset of assets)if(!recordings.some(r=>r.asset_id===asset.id))this.entries.push({asset});
  $('audioToggle').hidden=!this.entries.length;if(!this.entries.length)$('audioBar').hidden=true;$('recording').replaceChildren();
  for(const [i,e] of this.entries.entries()){const o=document.createElement('option');o.value=i;o.textContent=recordingName(e.recording,i);$('recording').append(o);}
  if(this.entries.length)this.select(0);
 }
 async select(index){
  if(this.index!==undefined)this.positions.set(this.index,this.time);
  this.audio.pause();const token=++this.token;this.index=index;const entry=this.entries[index];this.audio.onloadedmetadata=null;$('recordingTitle').textContent=recordingName(entry?.recording,index);$('recording').title=$('recordingTitle').textContent;
  this.transcript?.select(entry?.asset);
  this.audio.removeAttribute('src');this.audio.load();$('playAudio').disabled=true;$('audioSeek').disabled=true;$('audioState').textContent='Loading audio…';$('audioDownload').hidden=true;
  $('audioPage').disabled=!entry?.recording?.pages.length;this.changed();
  if(!entry?.asset){$('audioState').textContent='Audio resource is missing.';return;}
  try {
   const asset=entry.asset;
   if(!this.urls.has(asset.id)){const bytes=await this.read(asset.id);if(token!==this.token)return;this.urls.set(asset.id,URL.createObjectURL(new Blob([bytes],{type:asset.mime})));}
   if(token!==this.token)return;const url=this.urls.get(asset.id);
   this.audio.onloadedmetadata=()=>{if(token!==this.token)return;this.audio.currentTime=Math.min(this.positions.get(index)||0,this.audio.duration||0);$('playAudio').disabled=false;$('audioSeek').disabled=!Number.isFinite(this.audio.duration);$('audioSeek').max=this.audio.duration||0;$('audioState').textContent='';this.update();};
   this.audio.src=url;$('audioDownload').href=url;$('audioDownload').download=`audio-${index+1}.${asset.kind}`;$('audioDownload').hidden=false;
  } catch(e){if(token===this.token)$('audioState').textContent=e.message;}
 }
 update(){
  $('audioSeek').value=this.time;$('audioTime').textContent=`${clock(this.time)} / ${clock(this.audio.duration||0)}`;
  $('playAudio').dataset.state=this.audio.paused?'paused':'playing';$('playAudio').setAttribute('aria-label',this.audio.paused?'Play':'Pause');this.changed();this.transcript?.update();
 }
}
