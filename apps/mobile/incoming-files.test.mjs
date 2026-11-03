import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {IncomingFiles,incomingFile,incomingName,OPEN_TYPES,OWN_EXTENSIONS} from './incoming-files.mjs';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('file intents accept local grants and reject remote or malformed links',()=>{
 assert.deepEqual(incomingFile('content://downloads/42'),{uri:'content://downloads/42',name:'Imported file'});
 assert.equal(incomingFile('file:///tmp/My%20note.noteful').name,'My note.noteful');
 for(const uri of [null,'https://example.com/a.noteful','javascript:alert(1)','exp://192.0.2.1:8081','content://['])assert.equal(incomingFile(uri),null);
});
test('cold/warm opens wait for reader readiness, preserve order and release data on acknowledgement',async()=>{
 const sent=[],read=[],errors=[];
 const queue=new IncomingFiles({read:async uri=>{read.push(uri);return 'qrvM3g==';},post:m=>sent.push(m),error:e=>errors.push(e)});
 queue.open('content://notes/first');queue.open('content://notes/first');
 assert.equal(read.length,0);queue.setReady(true);await settle();
 assert.equal(read.length,1);assert.equal(sent.length,1);
 queue.open('content://notes/second');assert.equal(sent.length,1);
 queue.setReady(false);queue.setReady(true);assert.equal(sent.length,2);assert.equal(read.length,1,'reload reuses pending bytes');
 queue.acknowledge(999);assert.ok(queue.current);
 queue.acknowledge(1);await settle();assert.equal(sent.at(-1).id,2);
 queue.acknowledge(2);assert.equal(queue.current,null);assert.equal(queue.queue.length,0);assert.equal(errors.length,0);
});
test('expired URI grants report failure without blocking the next open',async()=>{
 const sent=[],errors=[];
 const queue=new IncomingFiles({read:async uri=>{if(uri.endsWith('bad'))throw Error('Permission denied');return 'qrvM3g==';},post:m=>sent.push(m),error:e=>errors.push(e.message)});
 queue.open('content://notes/bad');queue.open('content://notes/good');queue.setReady(true);await settle();
 assert.deepEqual(errors,['Permission denied']);assert.equal(sent[0].id,2);
});
test('incoming files keep their real name and extension instead of becoming .noteful',()=>{
 assert.equal(incomingFile('file:///sdcard/Download/Informe.docx').name,'Informe.docx');
 assert.equal(incomingFile('content://com.android.externalstorage.documents/document/primary%3ADownload%2FVentas.xlsx').name,'Ventas.xlsx');
 // The provider's display name wins over an opaque URI; the MIME type fills a missing extension.
 assert.equal(incomingName('content://media/external/file/1000',{name:'scan.JPG',mime:'image/jpeg'}),'scan.JPG');
 assert.equal(incomingName('content://media/external/file/1000',{name:'Apuntes',mime:'text/markdown'}),'Apuntes.md');
 assert.equal(incomingName('content://x/1',{mime:'application/pdf'}),'Imported file.pdf');
 assert.equal(incomingName('content://x/1',{name:'doc.bin',mime:'application/vnd.oasis.opendocument.text'}),'doc.odt');
 // Unknown: a plain name, and the reader recognises the bytes.
 assert.equal(incomingName('content://x/1',{name:'mystery',mime:'application/octet-stream'}),'mystery');
});
test('the provider is asked for the name before the bytes are read',async()=>{
 const sent=[];
 const queue=new IncomingFiles({describe:async()=>({name:'Tabla.csv',mime:'text/csv'}),read:async()=>'YSxi',post:m=>sent.push(m),error:()=>{}});
 queue.open('content://provider/7');queue.setReady(true);await settle();
 assert.equal(sent[0].name,'Tabla.csv');
 const failing=new IncomingFiles({describe:async()=>{throw Error('no');},read:async()=>'YSxi',post:m=>sent.push(m),error:()=>{}});
 failing.open('file:///tmp/a.md');failing.setReady(true);await settle();
 assert.equal(sent[1].name,'a.md');
});
test('app.json offers every supported type for VIEW and SEND, and own extensions as octet-stream',()=>{
 const filters=JSON.parse(readFileSync(new URL('./app.json',import.meta.url),'utf8')).expo.android.intentFilters;
 const mimesOf=f=>f.data.map(d=>d.mimeType).filter(Boolean);
 const view=filters.find(f=>f.action==='VIEW'&&f.data.some(d=>d.mimeType==='application/pdf'));
 assert.deepEqual(view.data.filter(d=>d.scheme).map(d=>d.scheme),['content','file']);
 for(const action of ['SEND','SEND_MULTIPLE'])assert.deepEqual(mimesOf(filters.find(f=>f.action===action)),Object.keys(OPEN_TYPES));
 assert.deepEqual(mimesOf(view),Object.keys(OPEN_TYPES));
 const octet=filters.find(f=>f.data.some(d=>d.mimeType==='application/octet-stream'&&d.pathPattern));
 for(const ext of OWN_EXTENSIONS)for(const scheme of ['content','file'])
  assert.ok(octet.data.some(d=>d.scheme===scheme&&d.pathPattern===`.*\\.${ext}`),`${scheme} ${ext}`);
 for(const f of filters)assert.ok(f.category.includes('DEFAULT'));
});
