import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readerURL,exportRequest,shareRequest,allowsNavigation} from './connection.mjs';
test('QR host resolves the reader on the same LAN, with IPv6 and URL overrides',()=>{
 assert.equal(readerURL('', '192.168.1.24:8081'),'http://192.168.1.24:8768/');
 assert.equal(readerURL('', '[::1]:8081'),'http://[::1]:8768/');
 assert.equal(readerURL('https://example.com/reader/',null),'https://example.com/reader/');
 assert.throws(()=>readerURL('',null));assert.throws(()=>readerURL('file:///etc/passwd',null));
});
test('export bridge accepts reader files and rejects foreign origins and malformed messages',()=>{
 const data=JSON.stringify({type:'noteful-export',id:7,name:'../Note.nfedit',base64:'AA=='});
 assert.equal(exportRequest(data,'http://192.168.1.24:8768/','http://192.168.1.24:8768/').name,'.._Note.nfedit');
 assert.throws(()=>exportRequest(data,'https://other.test/','http://192.168.1.24:8768/'));
 assert.throws(()=>exportRequest('{}','http://a.test/','http://a.test/'));
});

test('share bridge validates share actions, sanitizes file names, and rejects foreign origins',()=>{
 const origin='http://127.0.0.1:8768/';
 const fileMsg=JSON.stringify({type:'notecomplete-share-file',id:1,name:'a/b.nfedit',mime:'application/json',base64:'AA=='});
 assert.deepEqual(shareRequest(fileMsg,origin,origin),{type:'notecomplete-share-file',id:1,name:'a_b.nfedit',mime:'application/json',base64:'AA=='});
 assert.deepEqual(shareRequest(JSON.stringify({type:'notecomplete-share-links',id:2,shareId:'abc123'}),origin,origin).shareId,'abc123');
 assert.deepEqual(shareRequest(JSON.stringify({type:'notecomplete-share-address',id:3,address:'192.168.1.5'}),origin,origin).address,'192.168.1.5');
 assert.deepEqual(shareRequest(JSON.stringify({type:'notecomplete-unshare',id:4,shareId:'abc123'}),origin,origin).shareId,'abc123');
 assert.throws(()=>shareRequest(fileMsg,'https://other.test/',origin));
 assert.throws(()=>shareRequest(JSON.stringify({type:'notecomplete-share-links',id:5,shareId:''}),origin,origin));
 assert.throws(()=>shareRequest(JSON.stringify({type:'unknown',id:6}),origin,origin));
});

test('navigation stays in the reader and malformed URLs fail closed',()=>{
 assert.ok(allowsNavigation('http://a.test/page','http://a.test/'));
 assert.ok(allowsNavigation('about:blank','http://a.test/'));
 assert.equal(allowsNavigation('https://other.test/','http://a.test/'),false);
 assert.equal(allowsNavigation('not a URL','http://a.test/'),false);
});

test('drawing tablets can reach the computer on the local network', async () => {
 const {networkSecurityConfig}=await import('./network-security.cjs');
 const xml=networkSecurityConfig();
 assert.match(xml,/<base-config cleartextTrafficPermitted="true"\/>/);
 // Pairing is a WebSocket from the reader, not a navigation: the WebView still stays in the reader.
 assert.equal(allowsNavigation('http://192.168.1.20:41237/tablet','http://127.0.0.1:8768/'),false);
 const app=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./app.json',import.meta.url),'utf8'));
 // iPhone and iPad use the web app: the native config is Android only.
 assert.equal(app.expo.ios,undefined);
});
