import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveNativeFiles,importName} from './import.js';
test('native imports retain bytes, detect unnamed projects, deduplicate delivery and respect unsaved edits',async()=>{
 const listeners={},replies=[],opened=[],errors=[];let replace=true,busy=false;
 globalThis.window={ReactNativeWebView:{postMessage:s=>replies.push(JSON.parse(s))},addEventListener:(type,fn)=>listeners[type]=fn};
 globalThis.document={addEventListener:()=>{}};
 receiveNativeFiles({open:async file=>opened.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())}),canReplace:()=>replace,isBusy:()=>busy,status:s=>errors.push(s)});
 const send=async(id,base64)=>listeners.message({data:JSON.stringify({type:'noteful-import',id,name:'Imported note.noteful',base64})});
 await send(1,'qrvM3g==');await send(1,'qrvM3g==');assert.equal(opened.length,1);assert.deepEqual([...opened[0].bytes],[170,187,204,222]);
 const json='{"format":"noteful-re-project"}';await send(2,Buffer.from(json).toString('base64'));assert.match(opened[1].name,/\.nfedit$/);
 replace=false;await send(3,'qrvM3g==');assert.equal(opened.length,2);assert.equal(replies.at(-1).id,3);
 busy=true;await send(4,'qrvM3g==');assert.equal(errors.length,1);assert.equal(opened.length,2);
 busy=false;replace=true;await send(5,'%%%');assert.equal(errors.length,2);assert.equal(replies.at(-1).id,5);
 delete globalThis.window;delete globalThis.document;
});
test('native imports keep the real name and extension, fixing only missing or contradicted ones',()=>{
 assert.equal(importName('Informe.docx','office'),'Informe.docx');
 assert.equal(importName('scan.JPG','image'),'scan.JPG');
 assert.equal(importName('Tabla.csv','text'),'Tabla.csv');
 assert.equal(importName('Memoria 1.noteful','note'),'Memoria 1.noteful');
 assert.equal(importName('Curso.notepart','notecomplete'),'Curso.notepart');
 assert.equal(importName('Imported note.noteful','project'),'Imported note.nfedit');
 assert.equal(importName('a.noteful','pdf'),'a.pdf');
 assert.equal(importName('README','text'),'README.txt');
 assert.equal(importName('','note'),'Imported file.noteful');
 assert.equal(importName(undefined,'image'),'Imported file.png');
});
test('an Office file shared from Android opens under its own name',async()=>{
 const listeners={},opened=[];
 globalThis.window={ReactNativeWebView:{postMessage:()=>{}},addEventListener:(type,fn)=>listeners[type]=fn};
 globalThis.document={addEventListener:()=>{}};
 receiveNativeFiles({open:async file=>opened.push(file.name),canReplace:()=>true,isBusy:()=>false,status:()=>{}});
 await listeners.message({data:JSON.stringify({type:'noteful-import',id:1,name:'Informe.docx',base64:'UEsDBA=='})});
 assert.deepEqual(opened,['Informe.docx']);
 delete globalThis.window;delete globalThis.document;
});
