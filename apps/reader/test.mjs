import {readFileSync,readdirSync} from 'node:fs';
import {strict as assert} from 'node:assert';
import init,{inspect_document,verify_document} from './pkg/noteful_wasm.js';
await init({module_or_path:readFileSync(new URL('./pkg/noteful_wasm_bg.wasm',import.meta.url))});
const folder=new URL('../../samples/',import.meta.url);
const files=readdirSync(folder).filter(n=>n.endsWith('.noteful'));
assert.equal(files.length,10);
for(const name of files){
 const bytes=readFileSync(new URL(encodeURIComponent(name),folder));
 const result=JSON.parse(inspect_document(bytes));
 assert.equal(result.schema_version,1);assert.equal(verify_document(bytes),true);assert.deepEqual(result.warnings,[]);
 if(name==='Examen wuolah.noteful'){assert.equal(result.pages,3);assert.equal(result.strokes,2008);assert.equal(result.objects,74);}
 console.log(name,result.pages,result.strokes,result.objects);
}
assert.throws(()=>inspect_document(new Uint8Array([1,2,3])));
console.log('WASM runtime: ten samples verified; invalid file rejected.');
const {EditorSession}=await import('./pkg/noteful_wasm.js');
let session=new EditorSession(readFileSync(new URL('../../samples/Examen%20wuolah.noteful',import.meta.url)));
const view=page=>JSON.parse(session.view(page));
assert.equal([0,1,2].reduce((n,p)=>n+view(p).visible_imported,0),2082);
const original=view(0).svg;
session.draw(0,JSON.stringify({points:[[10,10],[100,10]],width:2,rgba:[0,0,1,1]}));
assert.equal(view(0).visible_added,1);
session.erase(0,JSON.stringify([[50,0],[50,20]]),1);
assert.equal(view(0).visible_added,0);
session.undo();assert.equal(view(0).visible_added,1);
const saved=session.save_project();const loaded=EditorSession.load_project(saved);
assert.deepEqual(JSON.parse(loaded.view(0)),view(0));loaded.redo();assert.equal(JSON.parse(loaded.view(0)).visible_added,0);
session.undo();assert.equal(view(0).svg,original);
assert.throws(()=>session.draw(0,JSON.stringify({points:[],width:2,rgba:[0,0,1,1]})));
loaded.free();session.free();
console.log('WASM editor: 2082 imported elements, draw, swept erase, undo/redo, project reload, invalid edit rejection passed.');
const textSession=new EditorSession(readFileSync(new URL('../../samples/texto.noteful',import.meta.url)));
const textView=JSON.parse(textSession.view(0));assert.equal(textView.texts.length,3);assert.deepEqual(textView.warnings,[]);
for(const [content,size,bold,italic] of [['texto texto ',16,false,false],['Bocadillo',16,true,false],['Hola',12,false,true]]){
 const r=textView.texts.flatMap(t=>t.runs).find(r=>r.text===content);assert.ok(r);assert.ok(Math.abs(r.font_size*6/11-size)<1e-10);assert.equal(r.bold,bold);assert.equal(r.italic,italic);assert.ok(textView.svg.includes(content.trim()));
}
textSession.free();
const audioSession=new EditorSession(readFileSync(new URL('../../tests/fixtures/audio-synthetic.noteful',import.meta.url)));
const audioView=JSON.parse(audioSession.view(0));assert.equal(audioView.audio[0].kind,'wav');const audioBytes=audioSession.audio_bytes('synthetic-audio');assert.equal(new TextDecoder().decode(audioBytes.slice(0,4)),'RIFF');
const audioRestored=EditorSession.load_project(audioSession.save_project());assert.deepEqual(audioRestored.audio_bytes('synthetic-audio'),audioBytes);audioSession.free();audioRestored.free();
console.log('WASM text: three real text blocks, sizes and traits verified. Synthetic WAV: exact project preservation verified; sync not claimed.');
const {inkOpacity}=await import('./timeline.js');
for(const file of ['../../samples/Practice book (vol. 1).noteful','../../tests/fixtures/multi-audio-synthetic.noteful']){
 const e=new EditorSession(readFileSync(new URL(file,import.meta.url))),v=JSON.parse(e.view(8));
 assert.equal(v.pages,193);assert.equal(v.timings.length,3);assert.equal(v.pdf_background.page_index,8);
 assert.equal(new TextDecoder().decode(e.pdf_bytes(v.pdf_background.resource_id).slice(0,5)),'%PDF-');
 const multi=file.includes('multi-audio');assert.equal(v.recordings.length,multi?2:1);assert.equal(v.audio.length,multi?2:1);
 for(const t of v.timings){assert.equal(inkOpacity(t,t.start-1e-6),.2);assert.equal(inkOpacity(t,t.start),1);}
 const first=v.timings.filter(t=>t.recording_id===v.recordings[0].id);
 for(const [time,count] of [[0,0],[8.5,1],[10,2],[13,multi?2:3]])assert.equal(first.filter(t=>inkOpacity(t,time)===1).length,count);
 if(multi)assert.equal(v.timings.filter(t=>t.recording_id===v.recordings[1].id).length,1);
 const restored=EditorSession.load_project(e.save_project());
 for(const asset of v.audio)assert.deepEqual(restored.audio_bytes(asset.id),e.audio_bytes(asset.id));
 assert.deepEqual(restored.pdf_bytes(v.pdf_background.resource_id),e.pdf_bytes(v.pdf_background.resource_id));
 restored.free();e.free();
}
assert.equal(inkOpacity(undefined,0),1);
console.log('PDF backgrounds: paper and imported PDF references. Audio: real timestamps, two independent recordings, seeking boundaries, exact media round-trip passed.');
const {shapePoints}=await import('./shapes.js');
const exportSession=new EditorSession(readFileSync(new URL('../../samples/nota_vacia.noteful',import.meta.url)));
exportSession.set_layer(JSON.stringify({id:1,name:'Highlights',visible:true,locked:false,opacity:1}));
for(const kind of ['line','rectangle','ellipse','triangle','arrow']){
 const points=shapePoints(kind,[10,10],[110,70]);assert.ok(points.length>=2);assert.ok(points.flat().every(Number.isFinite));
 exportSession.draw(0,JSON.stringify({points,width:4,rgba:[1,.8,0,1],tool:1,layer:1}));
}
const nativeBytes=exportSession.export_noteful();assert.equal(verify_document(nativeBytes),true);
const reopened=new EditorSession(nativeBytes),nativeView=JSON.parse(reopened.view(0));assert.equal(nativeView.visible_imported,5);assert.equal(nativeView.layers.length,2);assert.ok(nativeView.svg.includes('mix-blend-mode:multiply'));
exportSession.set_layer(JSON.stringify({id:1,name:'Highlights',visible:false,locked:false,opacity:1}));assert.equal(JSON.parse(exportSession.view(0)).visible_added,0);
exportSession.undo();assert.equal(JSON.parse(exportSession.view(0)).visible_added,5);
reopened.free();exportSession.free();console.log('WASM native export: empty note, five shapes, highlighter, layers, hide/undo and native reopen passed.');
const shapeSession=new EditorSession(readFileSync(new URL('../../samples/nota_vacia.noteful',import.meta.url)));
shapeSession.draw(0,JSON.stringify({points:[],width:2,rgba:[0,0,1,1],shape:{kind:'rectangle',start:[100,100],end:[200,200]}}));
shapeSession.resize_shape(0,'new:0',JSON.stringify({kind:'rectangle',start:[50,60],end:[240,260]}));
assert.deepEqual(JSON.parse(shapeSession.view(0)).shapes[0].line.shape.start,[50,60]);
shapeSession.undo();assert.deepEqual(JSON.parse(shapeSession.view(0)).shapes[0].line.shape.start,[100,100]);shapeSession.redo();
const shapeRestored=EditorSession.load_project(shapeSession.save_project());assert.deepEqual(JSON.parse(shapeRestored.view(0)).shapes,JSON.parse(shapeSession.view(0)).shapes);shapeRestored.free();shapeSession.free();
console.log('WASM shape resize: corners, undo/redo and project reload passed.');
const modifySession=new EditorSession(readFileSync(new URL('../../samples/nota_vacia.noteful',import.meta.url)));
modifySession.draw(0,JSON.stringify({points:[[20,20],[120,20]],width:3,rgba:[1,1,0,1],tool:1}));
const picked=JSON.parse(modifySession.pick_item(0,70,20,5));assert.equal(picked.id,'new:0');
const patch=JSON.parse(modifySession.adjust_item(0,picked.id,JSON.stringify({translation:[60,80],scale:[1.5,1],rotation:45,width:12,rgba:[0,1,0,1]})));
assert.equal(patch.edit_count,2);assert.ok(patch.svg.includes('stroke-width="12"'));assert.ok(patch.svg.includes('multiply'));assert.equal(patch.selection.adjustment.rotation,45);
assert.equal(patch.pages,undefined);assert.equal(patch.pdf_background,undefined);assert.ok(patch.svg.length<1000);
const modifiedProject=EditorSession.load_project(modifySession.save_project());assert.deepEqual(JSON.parse(modifiedProject.view(0)),JSON.parse(modifySession.view(0)));
modifiedProject.undo();assert.equal(JSON.parse(modifiedProject.selection(0,'new:0')).adjustment.rotation,0);modifiedProject.redo();
const modifiedNative=new EditorSession(modifiedProject.export_noteful());assert.ok(JSON.parse(modifiedNative.view(0)).svg.includes('rgb(0,255,0)'));
modifiedNative.free();modifiedProject.free();modifySession.free();
console.log('WASM item editing: hit selection, compact item patch, style/rotation, project undo/redo and native export passed.');

// Exercise the actual worker protocol, including failed replacement preservation.
const responses=[];
globalThis.self={};globalThis.postMessage=message=>responses.push(message);
await import('./worker.js');
const send=async data=>{await self.onmessage({data});return responses.findLast(r=>r.id===data.id);};
const source=readFileSync(new URL('../../samples/nota_vacia.noteful',import.meta.url));
assert.ok((await send({id:1,op:'open',bytes:source})).result);
await send({id:2,op:'draw',line:{points:[[10,10],[100,100]],width:2,rgba:[0,0,1,1]}});
const before=(await send({id:3,op:'save'})).result;
assert.ok((await send({id:4,op:'open',project:true,bytes:new TextEncoder().encode('{"invalid":true}')})).error);
assert.equal((await send({id:5,op:'save'})).result,before);
const imported=await send({id:6,op:'open',title:'PDF import',sizes:[[612,792],[792,612]],bytes:new TextEncoder().encode('%PDF-1.7\nfixture\n%%EOF')});
assert.equal(imported.result.pages,2);
const image={base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=',mime:'image/png',bounds:[10,20,100,60],layer:0};
assert.equal((await send({id:7,op:'image',page:1,image})).result.visible_added,1);
const savedImport=(await send({id:8,op:'save'})).result;
const reloadedImport=EditorSession.load_project(savedImport);
assert.equal(JSON.parse(reloadedImport.view(1)).visible_added,1);
reloadedImport.undo();assert.equal(JSON.parse(reloadedImport.view(1)).visible_added,0);reloadedImport.free();
console.log('WASM imports: PDF pages, image undo/reload and failed document replacement preserve the session.');
{
 const {compose_preview}=await import('./pkg/noteful_wasm.js');
 const md='# CELLS\n## Parts\n- nucleus ==DNA==\n> [sky] NOTE: text\n\\pagebreak\n## Two';
 const preview=JSON.parse(compose_preview(md,JSON.stringify({paper:'grid'}),1));
 assert.equal(preview.total,2);assert.equal(preview.pages.length,1);assert.deepEqual(preview.warnings,[]);assert.ok(preview.pages[0].includes('nc-paper-grid'));
 assert.throws(()=>compose_preview('x',JSON.stringify({theme:'neon'}),1));
 const hw=EditorSession.create_handwritten('Cells',md,'{}');const v=JSON.parse(hw.view(0));
 assert.equal(v.pages,2);assert.equal(v.title,'Cells');assert.ok(v.visible_added>50);
 const exam=new EditorSession(readFileSync(new URL('../../samples/Examen%20wuolah.noteful',import.meta.url)));
 const added=JSON.parse(exam.insert_handwritten(1,'## Added\n- one',JSON.stringify({look:'classic'})));
 assert.deepEqual(added.pages,[1]);assert.equal(JSON.parse(exam.view(1)).pages,4);
 const reopened=new EditorSession(exam.export_noteful());assert.equal(JSON.parse(reopened.view(1)).pages,4);
 hw.free();exam.free();reopened.free();
 console.log('WASM handwriting: preview, new notebook and inserted pages passed.');
}
