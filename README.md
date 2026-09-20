# COOP / COEP / CORP 与 SharedArrayBuffer 能力检测系统

零依赖原生 ESM 实现的跨源隔离（Cross-Origin Isolation）能力检测、降级、兼容矩阵与报告系统。
检测覆盖：**COOP、COEP、CORP、SharedArrayBuffer、Feature/Permissions Policy、Web Worker（经典/Module/Shared）、Worker 内 SAB 与 IndexedDB、主线程 IndexedDB CRUD 自检**。

## 快速开始

```bash
npm run check          # 构建 Worker 产物 + 跑全部 node:test
npm start              # http://localhost:8080/        普通页（无隔离头，演示降级）
npm run start:isolated # 全服务带 COOP+COEP+CORP（ISOLATED=1）
# 也可只访问隔离页（无论是否 ISOLATED 模式都带头）：
#   http://localhost:8080/isolated.html
```

页面上点击“开始检测”，可导出 **JSON / Markdown / CSV / HTML** 报告，或上报到 `/api/report`。
Node/无 DOM 环境可通过 `runCapabilityProbe()` 以注入 host 的方式运行（测试即用此法）。

## 目录结构

```
src/
  core/        env（UA/浏览器/响应策略解析） model（结果模型） runner（异常隔离） errors（错误码）
  detect/      coop / coep / corp(fetch 探测) / sab(主线程自检) /
               feature-policy / workers(Worker 探针) / idb(CRUD 自检)
  worker/      probe-source.js —— 打包进 public/coi-probe-worker.js 的 Worker 探针源码
  matrix/      data.js（6 浏览器 × 14 特性的版本矩阵 + 来源） engine.js（实测对账）
  fallback/    rules.js（能力分级与动作） adapters.js（Mutex / 任务执行器降级）
  report/      storage.js（IndexedDB→内存自动降级） exporter.js（4 格式 + 下载 + 控制台）
  ui/app.js    仪表盘渲染、Toast 异常提示、导出/上报
public/        index.html（普通） isolated.html（隔离） styles.css coi-probe-worker.js
scripts/       server.js（零依赖静态服务 + /api/report + /api/health） build-worker.js
test/          node:test，9 个测试文件（含端到端集成与服务器离屏测试）
```

## 特性检测口径

| 检测项 | 判定方式 |
| --- | --- |
| COOP | 响应头/meta 读取；`same-origin` 支持，`same-origin-allow-popups` 部分，`unsafe-none`/缺失不支持；Report-Only 仅告警 |
| COEP | `require-corp` / `credentialless` 支持（credentialless 标注 Firefox/Safari 不支持），缺失不支持 |
| CORP | 文档头 + `fetch(no-cors)` 资源探测逐个校验响应头，异常映射错误码 |
| SharedArrayBuffer | 构造函数存在性 + 实例化 + Atomics 读写自检 + `self.crossOriginIsolated`；存在但未隔离判“不支持（可通过头修复）” |
| Worker 内 SAB/IDB | 真实创建经典/Module Worker 与 SharedWorker，在 Worker 内执行 SAB+Atomics 往返和 IndexedDB 写读事务 |
| Feature Policy | `document.featurePolicy`（旧）与 `document.permissionsPolicy`（新）双探测 + `allowedFeatures/allowsFeature` + iframe `allow` 属性 |
| IndexedDB | open/upgrade/put/get/delete 完整 CRUD 自检 + `storage.estimate()` 配额预警，open/blocked/配额/超时均有错误码 |

注：响应头来自浏览器实际生效的头。测试服务器会在隔离页注入 `window.__COI_HEADERS__`，生产中可由服务端注入真实响应头值；读不到时结论为“未知”，并提示需配置 COOP/COEP。

## 降级链

计算能力分级（`fallback/adapters.js`）：

1. `shared-memory-worker`：SAB+Atomics+Worker 完整，零拷贝共享内存并行
2. `shared-memory-main`：SAB 仅主线程可用，去除跨 Worker 共享视图假设
3. `postmessage-worker`：Worker 可用但 SAB 不可用 → 结构化克隆 / Transferable
4. `atomics-main` / `main-thread`：主线程分片（<4ms 让出）串行执行

其他降级：

- **互斥锁**：Web Locks API → SAB+Atomics 自旋 → 单上下文 Promise 链
- **存储**：IndexedDB 持久化 → 写失败自动转内存 LRU → 引导 JSON 文件导出
- **Worker 形态**：Module Worker → 经典 Worker + `importScripts`；SharedWorker → BroadcastChannel/事件协调
- **资源**：require-corp 下跨源资源改 CORS 或补 CORP；Chrome/Edge 可用 credentialless，Firefox/Safari 走 require-corp
- **策略头**：同时发送旧 `Feature-Policy` 与新 `Permissions-Policy`，iframe 保留 `allow`

降级等级：`full` / `degraded-partial` / `degraded-critical`，并产出可执行动作列表（区域、级别、标题、细节）。

## 兼容矩阵

`src/matrix/data.js` 覆盖 Chrome/Edge/Firefox/Safari/Samsung Internet/Opera × 14 个特性的**首次默认启用大版本**，
灰度/平台不确定的单元格以 `approx` 标记并在 UI 显示 `~`。矩阵会与实时检测对账（`matrix.engine`），
当“版本预期支持但实测不支持”或反之，列入 `mismatches` 并在界面标红。

关键版本（桌面，详见数据文件注释与引用）：COOP/COEP Chrome 83、Firefox 79、Safari 15.2；
SAB 隔离后 Chrome 88（桌面 79 灰度）、Firefox 79、Safari 15.2；COEP credentialless 仅 Chromium 96+；
SharedWorker Safari 16；Module Worker Chrome 80/Firefox 114/Safari 15。

> 网络受限时无法实时核对 caniuse/MDN，数据按公开版本记录整理，矩阵内附 MDN/web.dev 引用链接；
> **实时特性检测永远优先于版本表**，这正是对账机制存在的原因。

## 异常处理

统一 `ProbeError` + 错误码（`UNSUPPORTED_API / WORKER_SPAWN_FAILED / WORKER_TIMEOUT /
PROBE_BLOCKED / PROBE_HTTP_ERROR / STORAGE_UNAVAILABLE / STORAGE_QUOTA / EXPORT_FAILED / UNEXPECTED`）。
单项检测异常被 runner 隔离：该检测项标 `error`，异常进 `report.exceptions`，其余检测与降级方案照常产出；
UI 右下角 Toast 提示，报告“异常记录”区列出全部异常。

## 报告导出

- JSON（完整 schema `coi-capability-report/1.0`，含耗时、警告、异常、矩阵、降级策略）
- Markdown / CSV / HTML（摘要 + 完整版本矩阵 + 降级动作 + 异常）
- 浏览器内走 Blob 下载；Node 环境返回内容字符串；导出失败有 `EXPORT_FAILED` 异常
- IndexedDB 自动保存最近一次报告（`__coi_reports__`），存储失败降级内存并在报告中标记

## 验收对照

- 准确报告可用性：7 类检测 + Worker 内 SAB/IDB，端到端测试验证隔离/未隔离两页结论
- 降级可用：计算/锁/存储/Worker 形态/资源五条降级链，均有测试与 UI 动作
- 兼容矩阵完整：6×14 全覆盖、含来源、实测对账与 mismatch
- 报告可导出：4 种格式 + 下载 + 服务端上报，测试覆盖
- 异常有提示：错误码体系 + runner 隔离 + Toast + 报告异常区
