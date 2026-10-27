import test from 'node:test';
import assert from 'node:assert/strict';
import { driveBrowser } from './drive-browser.js';
import { FOLDER_MIME } from './drive-client.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.value = ''; this.open = false; }
  append(...nodes) { for(const node of nodes) this.children.push(...(node.tag === 'fragment' ? node.children : [node])); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute() {}
  closest() { return this; }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
function setup(t, overrides = {}) {
  const thumbs = overrides.thumbs || { get: () => Promise.resolve(''), cancel() {} };
  const originals = Object.fromEntries(['document','window','location','localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(() => { for(const [key,value] of Object.entries(originals)) { if(value) Object.defineProperty(globalThis,key,value); else delete globalThis[key]; } });
  const nodes = new Map(), node = id => { if(!nodes.has(id)) nodes.set(id,new Element()); return nodes.get(id); };
  globalThis.document = { getElementById:node, querySelector:selector=>selector.includes('google-drive-api-key')&&overrides.siteApiKey?{content:overrides.siteApiKey}:null, createElement:tag=>new Element(tag), createDocumentFragment:()=>new Element('fragment') };
  globalThis.window = { isSecureContext:true };
  globalThis.location = { protocol:'https:' };
  globalThis.localStorage = { getItem:()=>null,setItem:()=>{} };
  const opened = [], calls = [];
  const folder = {id:'folder',name:'Noteful',mimeType:FOLDER_MIME};
  const file = {id:'file',name:'Test.noteful'};
  const client = {
    connected:false,token:'',apiKey:'',
    get publicAccess(){ return !this.connected&&!!this.apiKey; },
    get ready(){ return this.connected||this.publicAccess; },
    clear(){ this.connected=false;this.token=''; },
    authorize(){ this.connected=true;this.token='test'; },
    async search(){ calls.push('search');return {files:[folder]}; },
    async roots(){ calls.push('roots');return {files:[file]}; },
    async children(...args){ calls.push('children');(overrides.filters ??= []).push(args[3] ?? '');return {files:[file]}; },
    async folder(reference){ calls.push('open-folder:'+reference.id);return folder; },
    async download(){ calls.push('download');return new File(['bytes'],file.name); },
    ...Object.fromEntries(Object.entries(overrides).filter(([key])=>!['siteApiKey','thumbs','filters','library'].includes(key))),
  };
  let callback;
  const drive = driveBrowser({ open:async file=>{opened.push(file);return true;},client,thumbs,library:overrides.library,identityLoader:async()=>({}),authorize:(_id,_key,success)=>{callback=success;} });
  return {node,opened,calls,client,overrides,drive,authorize:()=>callback({})};
}
test('Drive panel lists without downloading and opens only the chosen file', async t => {
  const ui=setup(t);
  await ui.drive.show();
  ui.node('driveConnect').onclick();ui.authorize();await tick();
  assert.deepEqual(ui.calls,['search']);
  ui.node('driveList').querySelectorAll('button')[0].onclick();await tick();
  assert.deepEqual(ui.calls,['search','children']);
  assert.equal(ui.opened.length,0);
  ui.node('driveList').querySelectorAll('button')[0].onclick();await tick();
  assert.deepEqual(ui.calls,['search','children','download']);
  assert.equal(ui.opened[0].name,'Test.noteful');
});
test('leaving the home screen during a download ignores even a late successful response', async t => {
  let resolveDownload, signal;
  const ui=setup(t,{download:(_file,abort)=>{signal=abort;return new Promise(resolve=>{resolveDownload=resolve;});}});
  await ui.drive.show();ui.node('driveConnect').onclick();ui.authorize();await tick();
  ui.node('driveList').querySelectorAll('button')[0].onclick();await tick();
  ui.node('driveList').querySelectorAll('button')[0].onclick();await tick();
  ui.drive.hide();
  assert.equal(signal.aborted,true);
  resolveDownload(new File(['bytes'],'late.noteful'));await tick();
  assert.equal(ui.opened.length,0);
});
test('late OAuth completion after dismissal does not reconnect or request files', async t => {
  const ui=setup(t);
  await ui.drive.show();ui.node('driveConnect').onclick();
  ui.drive.hide();ui.authorize();await tick();
  assert.equal(ui.client.connected,false);assert.deepEqual(ui.calls,[]);
});
test('an API key opens a public folder link and downloads without sign-in', async t => {
  const ui=setup(t);
  await ui.drive.show();
  assert.equal(ui.node('driveUseFolder').disabled,true);
  ui.node('driveApiKey').value='AIza-test';ui.node('driveApiKey').oninput();
  assert.equal(ui.node('driveUseFolder').disabled,false);
  assert.equal(ui.node('driveFind').disabled,true);
  ui.node('driveFolderLink').value='https://drive.google.com/drive/folders/1Gm9OsGBbfXrtymnIUbHtDq3TO2KHllqs';
  ui.node('driveUseFolder').onclick();await tick();
  assert.deepEqual(ui.calls,['open-folder:1Gm9OsGBbfXrtymnIUbHtDq3TO2KHllqs','children']);
  assert.equal(ui.node('driveBack').disabled,true);
  ui.node('driveList').querySelectorAll('button')[0].onclick();await tick();
  assert.equal(ui.opened[0].name,'Test.noteful');
  assert.equal(ui.client.connected,false);
});
test('the site key opens public links by default and a personal key overrides it', async t => {
  const ui=setup(t,{siteApiKey:'AIza-site'});
  assert.equal(ui.client.apiKey,'AIza-site');
  assert.equal(ui.node('driveApiKey').value,'');
  await ui.drive.show();
  assert.equal(ui.node('driveUseFolder').disabled,false);
  assert.equal(ui.node('driveLinkSetup').open,true);
  ui.node('driveApiKey').value='AIza-personal';ui.node('driveApiKey').oninput();
  assert.equal(ui.client.apiKey,'AIza-personal');
  ui.node('driveApiKey').value='';ui.node('driveApiKey').oninput();
  assert.equal(ui.client.apiKey,'AIza-site');
});
test('search filters inside a folder and a cleared box lists the top level', async t => {
  const filters = [];
  const ui = setup(t, { filters });
  await ui.drive.show();
  ui.node('driveConnect').onclick();ui.authorize();await tick();
  ui.node('driveList').querySelectorAll('button')[0].onclick();await tick();
  assert.deepEqual(ui.calls,['search','children']);
  assert.equal(filters.at(-1),'');
  ui.node('driveSearch').value='Examen';
  ui.node('driveFind').onclick();await tick();
  assert.equal(filters.at(-1),'Examen');
  assert.deepEqual(ui.calls,['search','children','children']);
  // Back first undoes the filter, then leaves the folder for the search it came from.
  ui.node('driveBack').onclick();await tick();
  assert.deepEqual([ui.calls.at(-1), filters.at(-1), ui.node('driveSearch').value],['children','','']);
  ui.node('driveBack').onclick();await tick();
  assert.equal(ui.calls.at(-1),'search');
  ui.node('driveSearch').value='';
  ui.node('driveFind').onclick();await tick();
  assert.equal(ui.calls.at(-1),'roots');
});
test('file cards request a preview and leaving the home screen cancels pending work', async t => {
  const requested = [];
  let cancelled = 0;
  const ui = setup(t, { thumbs: { get: file => { requested.push(file.name); return Promise.resolve(''); }, cancel() { cancelled++; } } });
  await ui.drive.show();
  ui.node('driveConnect').onclick();ui.authorize();await tick();
  assert.deepEqual(requested,[]);
  ui.node('driveList').querySelectorAll('button')[0].onclick();await tick();
  assert.deepEqual(requested,['Test.noteful']);
  ui.drive.hide();
  assert.equal(cancelled,1);
});
test('a kept copy opens without downloading and new downloads are kept', async t => {
  const kept = [];
  let cachedFile = null;
  const library = { cached: async () => cachedFile, keep: async (file, blob) => { kept.push(file.id); }, touch: async () => {}, key: f => 'drive:' + f.id };
  const ui = setup(t, { library });
  await ui.drive.show(); ui.node('driveConnect').onclick(); ui.authorize(); await tick();
  ui.node('driveList').querySelectorAll('button')[0].onclick(); await tick();
  ui.node('driveList').querySelectorAll('button')[0].onclick(); await tick();
  assert.deepEqual(ui.calls, ['search', 'children', 'download']);
  assert.deepEqual(kept, ['file']);
  cachedFile = new File(['kept'], 'Test.noteful');
  ui.node('driveList').querySelectorAll('button')[0].onclick(); await tick();
  assert.deepEqual(ui.calls, ['search', 'children', 'download'], 'no second download');
  assert.equal(ui.opened.at(-1), cachedFile);
});
test('the last folder reopens after connecting', async t => {
  const saved = new Map();
  const ui = setup(t);
  globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  await ui.drive.show(); ui.node('driveConnect').onclick(); ui.authorize(); await tick();
  ui.node('driveList').querySelectorAll('button')[0].onclick(); await tick();
  assert.match(saved.get('notecomplete-drive-folder-v1'), /"id":"folder"/);
  ui.drive.hide(); ui.client.clear();
  await ui.drive.show(); ui.node('driveConnect').onclick(); ui.authorize(); await tick(); await tick();
  assert.deepEqual(ui.calls.slice(-2), ['open-folder:folder', 'children']);
});
test('Back after filtering a reopened folder returns to that folder, not a Drive-wide search', async t => {
  const saved = new Map([['notecomplete-drive-folder-v1', JSON.stringify([{ id: 'folder', name: 'Noteful' }])]]);
  const filters = [];
  const ui = setup(t, { filters });
  globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  await ui.drive.show(); ui.node('driveConnect').onclick(); ui.authorize(); await tick(); await tick();
  assert.deepEqual(ui.calls, ['open-folder:folder', 'children']);
  ui.node('driveSearch').value = 'Tema';
  ui.node('driveFind').onclick(); await tick();
  assert.equal(filters.at(-1), 'Tema');
  assert.equal(ui.node('driveBack').disabled, false);
  ui.node('driveBack').onclick(); await tick();
  assert.deepEqual([ui.calls.at(-1), filters.at(-1), ui.node('driveSearch').value], ['children', '', '']);
  assert.ok(!ui.calls.includes('search'));
});
