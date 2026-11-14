const $=id=>document.getElementById(id);
function recordingName(recording,index,added){
 if(added?.name?.trim())return added.name;
 if(recording?.name?.trim())return recording.name;
 if(recording?.start_us){const date=new Date((Number(BigInt(recording.start_us)/1000n)+978307200000));if(Number.isFinite(date.getTime()))return `Recording ${index+1} · ${date.toLocaleString('en',{dateStyle:'medium',timeStyle:'short'})}`;}
 return `Audio ${index+1}`;
}
const clock=t=>Number.isFinite(t)?`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`:'0:00';
export class AudioController {
 constructor(read,jump,changed){
  // Recordings added in NoteComplete (recorder.js) are read from their kept blobs.
  this.read=async id=>{const added=this.entries.find(e=>e.added&&e.asset.id===id)?.added;return added?new Uint8Array(await added.blob.arrayBuffer()):read(id);};
  this.jump=jump;this.changed=changed;this.audio=$('audio');this.token=0;this.urls=new Map();this.positions=new Map();this.entries=[];
  $('recording').onchange=()=>this.select(Number($('recording').value));
  $('playAudio').onclick=async()=>{if(this.audio.paused){try{await this.processing?.resume();await this.audio.play();}catch(e){$('audioState').textContent=e.message;}}else this.audio.pause();};
  $('backAudio').onclick=()=>this.seek(Math.max(0,this.audio.currentTime-10));
  $('forwardAudio').onclick=()=>this.seek(Math.min(this.audio.duration||0,this.audio.currentTime+10));
  // Dragging the position bar: the time label follows at once, the element seeks at most once a frame
  // (each seek in a long WebM or MP3 is costly; seeking on every input event made dragging lag).
  $('audioSeek').oninput=()=>{this.dragTo=Number($('audioSeek').value);$('audioTime').textContent=`${clock(this.dragTo)} / ${clock(this.audio.duration||0)}`;if(!this.dragFrame)this.dragFrame=requestAnimationFrame(()=>{this.dragFrame=0;this.seek(this.dragTo);});};
  $('audioSeek').onchange=()=>{cancelAnimationFrame(this.dragFrame);this.dragFrame=0;this.seek(Number($('audioSeek').value));};
  // Playback speed, the same for every recording and remembered; the pitch stays natural.
  const speed=$('audioSpeed');
  if(speed){let saved=1;try{saved=Number(globalThis.localStorage?.getItem('notecomplete-audio-speed'))||1;}catch{/* Optional. */}speed.onchange=()=>this.setRate(Number(speed.value));this.setRate(saved,false);}
  $('audioPage').onclick=()=>{const target=this.entries[this.index]?.recording?.pages?.[0];if(target!==undefined)this.jump(Number(target));};
  $('syncEnabled').onchange=()=>this.changed();
  // While playing, tick() repaints; timeupdate (4 times a second) only matters when paused.
  this.audio.ontimeupdate=()=>{if(this.audio.paused)this.update();};this.audio.onseeked=()=>this.update();
  this.audio.onplay=()=>{this.lastTick=0;this.update();this.tick();};this.audio.onpause=()=>{cancelAnimationFrame(this.frame);this.processing?.suspend().catch(()=>{});this.update();};
  this.audio.onended=this.audio.onpause;
  this.audio.onerror=()=>{$('audioState').textContent='This browser cannot play this format. You can download the audio.';};
 }
 get recording(){return $('syncEnabled').checked?this.entries[this.index]?.recording:null;}
 get time(){return this.audio.currentTime||0;}
 get rate(){return this.audio.playbackRate||1;}
 // 0.5× to 3×; the nearest listed speed is shown in the menu.
 setRate(rate,save=true){
  rate=Math.min(3,Math.max(0.5,Number(rate)||1));
  this.audio.playbackRate=this.audio.defaultPlaybackRate=rate;
  if('preservesPitch' in this.audio)this.audio.preservesPitch=true;
  const speed=$('audioSpeed');
  if(speed){const options=[...(speed.options||[])],near=options.reduce((a,o)=>Math.abs(o.value-rate)<Math.abs((a?.value??99)-rate)?o:a,null);if(near)speed.value=near.value;speed.dataset.rate=String(rate);}
  if(globalThis.localStorage&&save)try{localStorage.setItem('notecomplete-audio-speed',String(rate));}catch{/* Optional. */}
  return rate;
 }
 // One step up or down the speed menu ([ and ]).
 stepRate(direction){const steps=[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3],at=steps.findIndex(s=>s>=this.rate-1e-6);return this.setRate(steps[Math.max(0,Math.min(steps.length-1,(at<0?steps.length-1:at)+direction))]);}
 // While playing: the time and position bar every frame are cheap; the ink and the transcript
 // (which walk many elements) about ten times a second, enough to follow speech even at 3×.
 tick(now=0){if(!this.lastTick||now-this.lastTick>=100){this.lastTick=now;this.paint();this.changed();this.transcript?.update();}if(!this.audio.paused)this.frame=requestAnimationFrame(time=>this.tick(time));}
 paint(){if(!this.dragFrame)$('audioSeek').value=this.time;$('audioTime').textContent=`${clock(this.time)} / ${clock(this.audio.duration||0)}`;}
 seek(t){if(this.audio.readyState){this.audio.currentTime=t;this.update();}}
 label(entry){return recordingName(entry?.recording,Math.max(0,this.entries.indexOf(entry)),entry?.added);}
 async seekRecording(id,time){
  const index=this.entries.findIndex(entry=>entry.recording?.id===id);
  if(index<0||!this.entries[index].asset||!Number.isFinite(time)||time<0)return false;
  this.positions.set(this.entries[index].asset.id,time);
  if(this.index===index){this.seek(time);return true;}
  $('recording').value=String(index);
  await this.select(index);
  return true;
 }
 reset(){this.transcript?.reset();this.token++;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();cancelAnimationFrame(this.frame);for(const url of this.urls.values())URL.revokeObjectURL(url);this.urls.clear();this.positions.clear();this.entries=[];this.index=undefined;$('audioBar').hidden=true;$('audioToggle').hidden=true;$('audioToggle').setAttribute('aria-expanded','false');}
 // The audio button is always there with a note open: recording and importing start from the panel.
 open(assets,recordings,added=[]){
  this.reset();this.entries=recordings.map(recording=>({recording,asset:assets.find(a=>a.id===recording.asset_id)}));
  for(const asset of assets)if(!recordings.some(r=>r.asset_id===asset.id))this.entries.push({asset});
  $('audioToggle').hidden=false;this.setAdded(added,false);
 }
 // Added recordings follow the note's own ones; a new one is selected.
 setAdded(added,selectNew=true){
  const before=new Set(this.entries.filter(e=>e.added).map(e=>e.added.id)),current=this.entries[this.index]?.asset?.id;
  if(current)this.positions.set(current,this.time);
  this.entries=[...this.entries.filter(e=>!e.added),...added.map(a=>({added:a,asset:{id:`added:${a.id}`,mime:a.mime,kind:a.mime.includes('webm')?'webm':a.mime.includes('mp4')?'m4a':a.mime.split('/')[1]?.split(';')[0]||'audio'}}))];
  for(const url of [...this.urls.keys()])if(url.startsWith('added:')&&!this.entries.some(e=>e.asset?.id===url)){URL.revokeObjectURL(this.urls.get(url));this.urls.delete(url);}
  $('recording').replaceChildren();
  for(const [i,e] of this.entries.entries()){const o=document.createElement('option');o.value=i;o.textContent=recordingName(e.recording,i,e.added);$('recording').append(o);}
  const fresh=selectNew?this.entries.findIndex(e=>e.added&&!before.has(e.added.id)):-1,kept=this.entries.findIndex(e=>e.asset?.id===current);
  const next=fresh>=0?fresh:kept>=0?kept:this.entries.length?0:-1;
  this.empty();
  const prev=this.index;this.index=undefined;
  if(next<0){this.transcript?.select(null);this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.update();return;}
  $('recording').value=String(next);
  if(fresh>=0||kept<0||next!==prev&&prev===undefined)this.select(next);else this.index=next;
 }
 empty(){
  const none=!this.entries.length;
  $('audioBar').classList.toggle('no-audio',none);
  if(none){$('recordingTitle').textContent='Audio';$('playAudio').disabled=true;$('audioSeek').disabled=true;$('audioPage').disabled=true;$('audioDownload').hidden=true;$('audioState').textContent='No audio in this note yet. Record or import one.';}
 }
 get selected(){return this.entries[this.index];}
 async select(index){
  if(this.index!==undefined&&this.entries[this.index]?.asset)this.positions.set(this.entries[this.index].asset.id,this.time);
  this.audio.pause();const token=++this.token;this.index=index;const entry=this.entries[index];this.audio.onloadedmetadata=null;$('recordingTitle').textContent=recordingName(entry?.recording,index,entry?.added);this.onselect?.(entry);$('recording').title=$('recordingTitle').textContent;
  this.transcript?.select(entry?.asset);
  this.audio.removeAttribute('src');this.audio.load();$('playAudio').disabled=true;$('audioSeek').disabled=true;$('audioState').textContent='Loading audio…';$('audioDownload').hidden=true;
  $('audioPage').disabled=!entry?.recording?.pages.length;this.changed();
  if(!entry?.asset){$('audioState').textContent='Audio resource is missing.';return;}
  try {
   const asset=entry.asset;
   if(!this.urls.has(asset.id)){const bytes=await this.read(asset.id);if(token!==this.token)return;this.urls.set(asset.id,URL.createObjectURL(new Blob([bytes],{type:asset.mime})));}
   if(token!==this.token)return;const url=this.urls.get(asset.id);
   const ready=()=>{this.audio.playbackRate=this.rate;this.audio.currentTime=Math.min(this.positions.get(entry.asset.id)||0,this.audio.duration||0);$('playAudio').disabled=false;$('audioSeek').disabled=!Number.isFinite(this.audio.duration);$('audioSeek').max=this.audio.duration||0;$('audioState').textContent='';this.update();};
   // Browser recordings (WebM) carry no duration: seeking past the end makes the element find it.
   this.audio.onloadedmetadata=()=>{if(token!==this.token)return;if(this.audio.duration!==Infinity)return ready();this.audio.ondurationchange=()=>{if(token!==this.token||!Number.isFinite(this.audio.duration))return;this.audio.ondurationchange=null;ready();};this.audio.currentTime=1e101;};
   this.audio.src=url;$('audioDownload').href=url;$('audioDownload').download=`audio-${index+1}.${asset.kind}`;$('audioDownload').hidden=false;
  } catch(e){if(token===this.token)$('audioState').textContent=e.message;}
 }
 update(){
  this.paint();
  $('playAudio').dataset.state=this.audio.paused?'paused':'playing';$('playAudio').setAttribute('aria-label',this.audio.paused?'Play':'Pause');this.changed();this.transcript?.update();
 }
}
