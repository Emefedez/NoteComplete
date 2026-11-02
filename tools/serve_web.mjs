// Static files only. Opened notes never leave the browser.
import http from 'node:http';
import {stat,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const root=fileURLToPath(new URL('../apps/reader/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.noteful':'application/octet-stream'};
// precache.json with the hashes of the files as they are now, so the service worker (sw.js,
// which keeps a file until its hash changes) picks up an edit without a rebuild.
const hashes=new Map();
async function currentManifest(file){
 const manifest=JSON.parse(await readFile(file,'utf8'));
 for(const name of Object.keys(manifest.files||{})){
  const info=await stat(path.join(root,name)).catch(()=>null);
  if(!info)continue;
  const version=`${info.size}-${info.mtimeMs}`;
  if(hashes.get(name)?.version!==version)hashes.set(name,{version,hash:createHash('sha256').update(await readFile(path.join(root,name))).digest('hex').slice(0,16)});
  manifest.files[name]=hashes.get(name).hash;
 }
 return Buffer.from(JSON.stringify(manifest));
}
export function readerServer(){return http.createServer(async(req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 try{
  const url=new URL(req.url,'http://localhost');
  const rel=decodeURIComponent(url.pathname)==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
  const file=path.resolve(root,rel);
  if(!file.startsWith(root)||rel.split(/[\\/]/).some(p=>p.startsWith('.')||p==='node_modules')||rel.endsWith('.map')){res.writeHead(403);return res.end();}
  const info=await stat(file);if(!info.isFile()){res.writeHead(404);return res.end();}
  const body=rel==='precache.json'?await currentManifest(file):null;
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':body?body.length:info.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'});
  if(req.method==='HEAD'||body)return res.end(req.method==='HEAD'?undefined:body);
  const stream=createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 }catch{res.writeHead(404);res.end('Not found');}
});}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.argv[2]||8767),host=process.argv.includes('--lan')?'0.0.0.0':'127.0.0.1';
 readerServer().listen(port,host,()=>console.log(`NoteComplete: http://${host}:${port}/`));
}
