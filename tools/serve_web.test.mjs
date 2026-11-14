import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readerServer} from './serve_web.mjs';
test('static host serves reader assets and rejects writes and private paths',async()=>{
 const server=readerServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const root=`http://127.0.0.1:${server.address().port}`;
 try {
  const page=await fetch(root);assert.equal(page.status,200);assert.match(await page.text(),/NoteComplete/);
  assert.equal(page.headers.get('cross-origin-opener-policy'),'same-origin');
  assert.equal(page.headers.get('cross-origin-embedder-policy'),'credentialless');
  // Framing is limited by a header (a meta policy cannot); the stricter policy only reports.
  assert.equal(page.headers.get('content-security-policy'),"frame-ancestors 'self'");
  assert.match(page.headers.get('content-security-policy-report-only'),/script-src 'self' 'wasm-unsafe-eval' blob: [^;]*; .*frame-ancestors 'self'$/);
  assert.doesNotMatch(page.headers.get('content-security-policy-report-only'),/script-src[^;]*'unsafe-(inline|eval)'/);
  assert.equal((await fetch(root+'/style.css')).headers.get('content-security-policy'),null);
  const head=await fetch(root+'/style.css',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.match(head.headers.get('content-type'),/text\/css/);
  for(const file of ['node_modules/pdfjs-dist/package.json','.env','%2e%2e%2fCargo.toml'])assert.equal((await fetch(root+'/'+file)).status,403);
  assert.equal((await fetch(root,{method:'POST',body:'note bytes'})).status,405);
  assert.equal((await fetch(root+'/missing')).status,404);
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
