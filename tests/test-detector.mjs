import assert from 'node:assert/strict';

const NodeURL = globalThis.URL;
class FakeURL {
  constructor(s, base) {
    const u = base ? new NodeURL(s, base) : new NodeURL(s);
    for (const k of ['href','origin','pathname','port','hostname','protocol']) this[k] = u[k];
  }
}
FakeURL.createObjectURL = () => `blob:fake-${Math.random().toString(36).slice(2)}`;
FakeURL.revokeObjectURL = () => {};
globalThis.URL = FakeURL;
let _location;
const setLocation = (s) => { _location = new FakeURL(s); };
setLocation('http://localhost:8080/isolated');
Object.defineProperty(globalThis, 'location', { get(){ return _location; }, configurable: true });
globalThis.isSecureContext = true;
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0.0.0 Safari/537.36' }, configurable: true,
});
globalThis.Blob = class { constructor(parts){ this.parts = parts; } };
globalThis.AbortController = AbortController;

class EventTargetShim {
  constructor(){ this.h = {}; }
  addEventListener(t, fn){ (this.h[t] ||= []).push(fn); }
  removeEventListener(t, fn){ this.h[t] = (this.h[t]||[]).filter((f)=>f!==fn); }
  dispatch(ev){ (this.h[ev.type]||[]).slice().forEach((f)=>f(ev)); }
}
class ReqShim extends EventTargetShim {
  constructor(){ super(); this._on = {}; }
  dispatch(ev){ super.dispatch(ev); const fn = this._on[ev.type]; if (fn) fn(ev); }
}
['onsuccess','onerror','onupgradeneeded','onblocked','oncomplete'].forEach((t)=>{
  const type = t.slice(2);
  Object.defineProperty(ReqShim.prototype, t, {
    get(){ return this._on[type]; }, set(f){ this._on[type] = f; }, configurable: true,
  });
});

class FakeWorker extends EventTargetShim {
  constructor(){ super(); setTimeout(()=>this.dispatch({type:'message',data:{type:'ready',isolated:true}}),0); }
  postMessage(msg){
    setTimeout(()=>{
      if (msg.cmd==='sab'){ const v=new Int32Array(msg.buffer); Atomics.add(v,0,7);
        return this.dispatch({type:'message',data:{id:msg.id,type:'sab-ok',before:0,after:7,isolated:true}}); }
      if (msg.cmd==='transfer') return this.dispatch({type:'message',data:{id:msg.id,type:'transfer-ok',byteLength:msg.buffer.byteLength}});
      if (msg.cmd==='sum'){ const v=new Uint8Array(msg.buffer); let sum=0; for (const x of v) sum+=x;
        return this.dispatch({type:'message',data:{id:msg.id,sum}}); }
      this.dispatch({type:'message',data:{id:msg.id,type:'pong'}});
    },0);
  }
  terminate(){}
}
globalThis.Worker = FakeWorker;
globalThis.crossOriginIsolated = true;
globalThis.MessageChannel = class { constructor(){ this.port1={}; this.port2={}; } };
globalThis.BroadcastChannel = class extends EventTargetShim { postMessage(){} close(){} };

function fire(target, type, payload={}) { setTimeout(()=>target.dispatch({type,...payload}),0); }
function makeIDB() {
  const dbs = new Map();
  return {
    open(name) {
      const req = new ReqShim();
      let db = dbs.get(name);
      const existed = !!db;
      if (!db) {
        db = {
          _stores: new Map(),
          objectStoreNames: { contains: (n)=>db._stores.has(n) },
          close(){},
          transaction(names, mode) {
            const list = Array.isArray(names) ? names : [names];
            const data = db._stores.get(list[0]);
            const tx = new ReqShim();
            const store = {
              put(v,k){ data.set(k, structuredClone(v)); },
              get(k){
                const q = new ReqShim();
                setTimeout(()=>{ q.result = data.has(k) ? structuredClone(data.get(k)) : undefined; fire(q,'success'); },0);
                return q;
              },
              getAllKeys(){
                const q = new ReqShim();
                setTimeout(()=>{ q.result = [...data.keys()]; fire(q,'success'); },0);
                return q;
              },
              delete(k){ data.delete(k); },
            };
            setTimeout(()=>fire(tx, mode==='readwrite' ? 'complete' : 'success'),2);
            tx.objectStore = () => store;
            return tx;
          },
        };
        dbs.set(name, db);
      }
      setTimeout(()=>{
        if (!existed) {
          req.result = {
            objectStoreNames: { contains: (n)=>db._stores.has(n) },
            createObjectStore(n){ db._stores.set(n, new Map()); },
          };
          fire(req, 'upgradeneeded');
        }
        setTimeout(()=>{ req.result = db; fire(req,'success'); },0);
      },0);
      return req;
    },
    deleteDatabase(){ const r = new ReqShim(); fire(r,'success'); return r; },
  };
}
globalThis.indexedDB = makeIDB();

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes(':8081/') && u.includes('no-corp')) throw new TypeError('Failed to fetch (simulated COEP block)');
  return { ok: true, status: 200, type: u.includes(':8081') ? 'cors' : 'basic' };
};

const { Detector } = await import('../public/js/detector.js');

// 场景 1：隔离页面
const rep1 = await Detector.run();
assert.equal(rep1.results.length, 23);
const errs = rep1.results.filter((r)=>['error','timeout'].includes(r.status)).map((r)=>`${r.id}:${r.detail}`);
assert.deepEqual(errs, [], 'isolated scenario errors');
const st = (id) => rep1.results.find((r)=>r.id===id).status;
for (const id of ['secure_context','cross_origin_isolated','sab','atomics','worker','worker_sab',
                  'idb','idb_sab','transferable','coep_enforcement','corp_cors','broadcast_channel']) {
  assert.equal(st(id), 'supported', `${id} should be supported`);
}
assert.equal(rep1.tier, 1);

// 场景 2：普通页面（非隔离）
setLocation('http://localhost:8080/');
globalThis.crossOriginIsolated = false;
const rep2 = await Detector.run();
assert.equal(rep2.results.find((r)=>r.id==='coep_enforcement').status, 'skipped');
assert.equal(rep2.results.find((r)=>r.id==='worker_sab').status, 'skipped');
assert.equal(rep2.results.find((r)=>r.id==='idb_sab').status, 'skipped');
assert.equal(rep2.tier, 2);
assert.equal(rep2.errorCount, 0);

// 场景 3：file://
setLocation('file:///home/u/index.html');
const rep3 = await Detector.run();
const probes = rep3.results.filter((r)=>r.group==='探针');
assert.ok(probes.every((r)=>r.status==='skipped'), 'all probes skipped under file://');
assert.equal(rep3.errorCount, 0);

console.log('DETECTOR E2E MOCK PASSED:', { isolatedTier: rep1.tier, normalTier: rep2.tier, fileProbesSkipped: probes.length, checks: rep1.results.length });
