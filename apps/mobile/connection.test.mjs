import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readerURL,exportRequest,allowsNavigation} from './connection.mjs';
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
 assert.equal(app.expo.ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking,true);
 assert.ok(app.expo.ios.infoPlist.NSLocalNetworkUsageDescription);
});
