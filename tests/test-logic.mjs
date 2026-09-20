import assert from 'node:assert/strict';
import { Fallback, TIERS } from '../public/js/fallback.js';
import { buildMatrixRows, detectBrowser, MATRIX } from '../public/js/matrix.js';
import { Report } from '../public/js/report.js';

const mk = (id, status) => ({ id, name: id, group: 'g', status, detail: '', durationMs: 1, severity: status });
const full = ['secure_context','cross_origin_isolated','sab','atomics','coop_inference','coep_inference',
  'corp_header_support','feature_policy_api','reporting_observer','worker','worker_sab','module_worker',
  'idb','idb_sab','transferable','message_channel','broadcast_channel','server_reachable','same_origin_no_corp',
  'coep_enforcement','corp_cors','coep_report_only','permissions_policy_enforcement']
  .map((id) => mk(id, 'supported'));
const report = (overrides = {}) => ({ tier: Fallback.selectTier({ results: overrides.results || full }),
  results: overrides.results || full, warnings: [], env: { href:'http://localhost:8080/isolated', isolatedPath:true, isSecure:true, userAgent: UA_CHROME } });

const UA_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Tier 1
assert.equal(Fallback.selectTier(report()), 1, 'full isolation => tier1');

// No isolation but worker+transfer => tier 2
let r2 = full.map((x) => x.id === 'cross_origin_isolated' ? mk(x.id,'unsupported') : x);
assert.equal(Fallback.selectTier({ results: r2 }), 2, 'worker without isolation => tier2');

// No worker => tier 4 (main chunked, IDB supported)
let r4 = full.map((x) => x.id === 'worker' ? mk(x.id,'unsupported') : x)
            .map((x) => x.id === 'cross_origin_isolated' ? mk(x.id,'unsupported') : x)
            .map((x) => x.id === 'transferable' ? mk(x.id,'unsupported') : x);
assert.equal(Fallback.selectTier({ results: r4 }), 4, 'no worker => tier4');

// No IDB + no worker => tier 5
let r5 = r4.map((x) => x.id === 'idb' ? mk(x.id,'unsupported') : x);
assert.equal(Fallback.selectTier({ results: r5 }), 5, 'no worker no idb => tier5');

// gaps content
const gaps = Fallback.gaps({ results: full.map((x) => x.id==='cross_origin_isolated'?mk(x.id,'unsupported'):x) });
assert.ok(gaps.some((g) => g.fix.includes('COOP/COEP')), 'gap suggests COOP/COEP headers');

// UA detection
assert.deepEqual(detectBrowser(UA_CHROME), { key:'chrome', version:128 });
const edge = UA_CHROME.replace('Chrome/128.0.0.0','Chrome/128.0.0.0 Edg/128.0.0.0');
assert.equal(detectBrowser(edge).key, 'edge');
const ff = 'Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0';
assert.equal(detectBrowser(ff).key, 'firefox');
const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
assert.equal(detectBrowser(safari).key, 'safari');

// matrix rows merge live status
const rows = buildMatrixRows(report());
assert.equal(rows.length, MATRIX.length);
const sabRow = rows.find((r) => r.id === 'sab');
assert.equal(sabRow.liveStatus, 'supported');
assert.equal(sabRow.currentBrowser, 'chrome');
assert.equal(sabRow.liveMeetsReference, true);

// report formats
const rep = report();
const json = JSON.parse(Report.toJSON(rep));
assert.equal(json.schemaVersion, 1);
assert.equal(json.checks.length, full.length);
assert.equal(json.selectedTier, 1);
assert.ok(json.id.startsWith('rpt-'));
const md = Report.toMarkdown(rep);
assert.match(md, /# COOP\/COEP\/CORP/);
assert.match(md, /特性检测明细|第 1 档/);
const csv = Report.toCSV(rep);
const lines = csv.trim().split('\n');
assert.equal(lines.length, full.length + 1);
assert.ok(lines[0].startsWith('"id","name"'));
// CSV quoting of commas/quotes
assert.ok(lines[1].startsWith('"secure_context"'));

// report persistence fake store
const mem = new Map();
const fakeStore = { set: async (k,v)=>mem.set(k,JSON.stringify(v)), get: async (k)=>mem.has(k)?JSON.parse(mem.get(k)):null,
  keys: async ()=>[...mem.keys()], delete: async (k)=>mem.delete(k) };
const saved = await Report.save(rep, fakeStore);
const listed = await Report.list(fakeStore);
assert.equal(listed.length, 1);
assert.equal(listed[0].id, saved.id);
await Report.remove(fakeStore, saved.id);
assert.equal((await Report.list(fakeStore)).length, 0);

console.log('ALL LOGIC TESTS PASSED', { tiers:'1/2/4/5', checks: full.length, matrixRows: rows.length });
