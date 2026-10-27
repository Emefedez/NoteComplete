// Isolated controller tests; real codec playback is covered separately in browser QA.
import {strict as assert} from 'node:assert';
const elements=new Map();
function element(){return {value:'',checked:true,hidden:false,disabled:false,textContent:'',options:[],append(v){this.options.push(v);},replaceChildren(){this.options=[];},removeAttribute(){},setAttribute(){},dataset:{},pause(){this.paused=true;},load(){this.currentTime=0;},currentTime:0,duration:13.467574,paused:true,readyState:4};}
globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};
globalThis.cancelAnimationFrame=()=>{};globalThis.requestAnimationFrame=()=>1;
const {AudioController}=await import('./audio.js');
const jumps=[],reads=[],changes=[];
const controller=new AudioController(async id=>{reads.push(id);return new Uint8Array([1,2,3]);},page=>jumps.push(page),()=>changes.push(true));
controller.open([{id:'a',mime:'audio/mp4',kind:'m4a'},{id:'b',mime:'audio/mp4',kind:'m4a'}],[{id:'r1',asset_id:'a',name:'Lecture one',start_us:'811003055158749',pages:[8]},{id:'r2',asset_id:'b',name:'Questions',start_us:'811003075158749',pages:[12]}]);
await Promise.resolve();await Promise.resolve();
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
controller.reset();assert.ok(elements.get('audioBar').hidden);console.log('Audio transport: real names, positions, resource cache, page jumps, timed-stroke seeking and disabled sync passed.');
