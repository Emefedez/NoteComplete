// Isolated controller tests; real codec playback is covered separately in browser QA.
import {strict as assert} from 'node:assert';
const elements=new Map();
function element(){return {value:'',checked:true,hidden:false,disabled:false,textContent:'',options:[],append(v){this.options.push(v);},replaceChildren(){this.options=[];},removeAttribute(){},setAttribute(){},dataset:{},classList:{names:new Set(),toggle(c,on){on?this.names.add(c):this.names.delete(c);},contains(c){return this.names.has(c);}},pause(){this.paused=true;},load(){this.currentTime=0;},currentTime:0,duration:13.467574,paused:true,readyState:4};}
globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};
globalThis.cancelAnimationFrame=()=>{};globalThis.requestAnimationFrame=()=>1;
const {AudioController}=await import('./audio.js');
const jumps=[],reads=[],changes=[];
const controller=new AudioController(async id=>{reads.push(id);return new Uint8Array([1,2,3]);},page=>jumps.push(page),()=>changes.push(true));
controller.open([{id:'a',mime:'audio/mp4',kind:'m4a'},{id:'b',mime:'audio/mp4',kind:'m4a'}],[{id:'r1',asset_id:'a',name:'Lecture one',start_us:'811003055158749',pages:[8]},{id:'r2',asset_id:'b',name:'Questions',start_us:'811003075158749',pages:[12]}]);
await new Promise(r=>setTimeout(r,0));
assert.equal(elements.get('recordingTitle').textContent,'Lecture one');elements.get('audio').onloadedmetadata();controller.seek(8.5);
elements.get('audioPage').onclick();assert.deepEqual(jumps,[8]);
elements.get('recording').value='1';await elements.get('recording').onchange();elements.get('audio').onloadedmetadata();
assert.equal(elements.get('recordingTitle').textContent,'Questions');assert.equal(controller.time,0);assert.equal(controller.recording.id,'r2');
elements.get('audioPage').onclick();assert.deepEqual(jumps,[8,12]);controller.seek(11);
elements.get('recording').value='0';await elements.get('recording').onchange();elements.get('audio').onloadedmetadata();assert.equal(controller.time,8.5);assert.deepEqual(reads,['a','b']);
elements.get('syncEnabled').checked=false;assert.equal(controller.recording,null);elements.get('audioPage').onclick();assert.deepEqual(jumps,[8,12,8]);
assert.equal(await controller.seekRecording('missing',2),false);
assert.equal(await controller.seekRecording('r2',4.2),true);
assert.equal(elements.get('recording').value,'1');
elements.get('audio').onloadedmetadata();assert.equal(controller.time,4.2);
assert.equal(await controller.seekRecording('r2',7),true);assert.equal(controller.time,7);
assert.deepEqual(reads,['a','b']);
// Recordings added in NoteComplete follow the note's own, are read from their blobs, and a new one is selected.
globalThis.URL.createObjectURL=()=>'blob:x';globalThis.URL.revokeObjectURL=()=>{};
const take={id:'t1',name:'My take',mime:'audio/webm',created:1,blob:new Blob([new Uint8Array([9,9])])};
controller.setAdded([take]);await new Promise(r=>setTimeout(r,0));
assert.equal(elements.get('recordingTitle').textContent,'My take');assert.equal(controller.selected.added,take);
assert.deepEqual([...await controller.read('added:t1')],[9,9]);assert.deepEqual(reads,['a','b']);
controller.setAdded([]);assert.equal(controller.selected.recording.id,'r1');
controller.open([],[],[]);assert.equal(controller.entries.length,0);assert.equal(elements.get('audioToggle').hidden,false);assert.ok(elements.get('audioBar').classList.contains('no-audio'));
controller.reset();assert.ok(elements.get('audioBar').hidden);
// Playback speed: bounded to 0.5×–3×, steps through the menu, survives a new recording, keeps the pitch.
const speed=elements.get('audioSpeed');speed.options=[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3].map(v=>({value:String(v)}));
assert.equal(controller.setRate(1.5),1.5);assert.equal(elements.get('audio').playbackRate,1.5);assert.equal(elements.get('audio').defaultPlaybackRate,1.5);assert.equal(speed.value,'1.5');
assert.equal(controller.stepRate(1),1.75);assert.equal(controller.stepRate(-1),1.5);
assert.equal(controller.setRate(9),3);assert.equal(controller.stepRate(1),3);assert.equal(controller.setRate(0.1),0.5);assert.equal(controller.stepRate(-1),0.5);
speed.value='2';speed.onchange();assert.equal(controller.rate,2);assert.equal(speed.dataset.rate,'2');
console.log('Audio transport: real names, positions, resource cache, page jumps, timed-stroke seeking, disabled sync and playback speed passed.');
