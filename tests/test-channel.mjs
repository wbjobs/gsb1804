import assert from 'node:assert/strict';
const NodeURL = globalThis.URL;
class FakeURL { constructor(s){ const u=new NodeURL(s); for(const k of['href','origin','pathname','port','hostname','protocol'])this[k]=u[k]; } }
FakeURL.createObjectURL = () => 'blob:x'; FakeURL.revokeObjectURL=()=>{};
globalThis.URL = FakeURL;
class ET { constructor(){this.h={};} addEventListener(t,f){(this.h[t]||=[]).push(f);} removeEventListener(){} dispatch(e){(this.h[e.type]||[]).slice().forEach(f=>f(e));} }
class W extends ET {
  constructor(){ super(); setTimeout(()=>this.dispatch({type:'message',data:{type:'ready'}}),0); }
  postMessage(msg){ setTimeout(()=>{ const v=new Uint8Array(msg.buffer); let sum=0; for(const x of v) sum+=x;
    this.dispatch({type:'message',data:{id:msg.id,sum}}); },0); }
  terminate(){}
}
globalThis.Worker = W;
globalThis.Blob = class { constructor(){} };
globalThis.requestIdleCallback = undefined;

const { BufferChannel } = await import('../public/js/fallback.js');
const SIZE = 1024*1024;

const c1 = new BufferChannel(1);
globalThis.SharedArrayBuffer = SharedArrayBuffer;
await c1.start();
const r1 = await c1.process(SIZE);
assert.equal(r1.sum, SIZE*7);
assert.match(r1.mode, /shared/);

const c2 = new BufferChannel(2); await c2.start();
const r2 = await c2.process(SIZE);
assert.equal(r2.sum, SIZE*7);
assert.match(r2.mode, /transfer/);

const c3 = new BufferChannel(3); await c3.start();
const r3 = await c3.process(SIZE);
assert.equal(r3.sum, SIZE*7);
assert.match(r3.mode, /clone/);

const c4 = new BufferChannel(4); await c4.start();
const r4 = await c4.process(300000);
assert.equal(r4.sum, 300000*7);
assert.match(r4.mode, /main/);

console.log('BUFFER CHANNEL TIERS 1-4 PASSED', { t1:r1.durationMs, t2:r2.durationMs, t3:r3.durationMs, t4:r4.durationMs });
