import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDriveIdentity} from './drive-native.js';
test('native bridge correlates replies, rejects foreign origins and cancels pending sign-in',async()=>{
 const listeners={},sent=[];
 globalThis.window={ReactNativeWebView:{postMessage:s=>sent.push(JSON.parse(s))},addEventListener:(event,fn)=>listeners[event]=fn};
 globalThis.document={addEventListener:()=>{}};globalThis.location={origin:'https://reader.example'};
 try {
  const identity=nativeDriveIdentity();
  const request=identity.signIn();const id=sent[0].id;
  listeners.message({origin:'https://other.example',data:{type:'notecomplete-drive-auth-result',id,token:{access_token:'wrong'}}});
  listeners.message({data:JSON.stringify({type:'notecomplete-drive-auth-result',id,token:{access_token:'right'}})});
  assert.equal((await request).access_token,'right');
  const silent=identity.refresh({clearToken:'stale'});
  assert.equal(sent.at(-1).type,'notecomplete-drive-auth');
  assert.equal(sent.at(-1).silent,true);
  assert.equal(sent.at(-1).clearToken,'stale');
  listeners.message({data:JSON.stringify({type:'notecomplete-drive-auth-result',id:sent.at(-1).id,token:{access_token:'refreshed'}})});
  assert.equal((await silent).access_token,'refreshed');
  const cancelled=identity.signIn();identity.cancel();await assert.rejects(cancelled,/cancelled/);
  assert.equal(sent.at(-1).type,'notecomplete-drive-cancel');
 } finally {delete globalThis.window;delete globalThis.document;delete globalThis.location;}
});
