# COOP / COEP / CORP 与 SharedArrayBuffer 可用性检测工具

零依赖的纯前端特性检测应用，附带一个零依赖 Node.js 测试服务器，用于在真实
`COOP: same-origin` + `COEP: require-corp` 响应头下联调。

覆盖验收项：

- **特性检测**：`crossOriginIsolated`、`SharedArrayBuffer`/`Atomics`、Worker
  内隔离状态、COEP 子资源强制、CORP 跨源拦截、Feature/Permissions Policy、
  Module Worker、IndexedDB（含 SAB 持久化）、ReportingObserver、
  BroadcastChannel / MessageChannel、`Atomics.waitAsync`。
- **降级方案**：5 档能力分层（SAB Worker → Transferable → Structured Clone
  主/Worker → 分块主线程 → 内存存储），自动选型并提供存储抽象，带可运行的
  缓冲计算演示。
- **兼容矩阵**：Chrome / Edge / Firefox / Safari × 全部检测项，内置参考版本
  数据（2025-09，MDN/项目知识库），并与本次实机检测结果并列展示。
- **报告**：JSON / Markdown / CSV / 控制台 四种导出，可打印，历史报告通过
  IndexedDB 持久化，跨标签实时同步（BroadcastChannel）。
- **异常提示**：每项检测均有 `skipped/error/timeout` 状态、错误原因、
  `severity` 分级与统一的异常中心；非安全上下文、`file://`、无服务器探针等
  场景均给出明确提示而非静默失败。

## 快速开始

```bash
node server/server.mjs            # 默认 http://localhost:8080
PORT=9000 ORIGIN2_PORT=9001 node server/server.mjs
```

然后浏览器访问：

- `http://localhost:8080/` —— 普通页面（非跨源隔离），演示检测与降级。
- `http://localhost:8080/isolated` —— 带 `COOP/COEP` 响应头的隔离页面，
  `SharedArrayBuffer` 完整可用；跨源资源探针走 `http://localhost:8081`。

不启动服务器时直接打开 `public/index.html`（`file://`）也可运行：网络探针类
检测会自动 `skipped` 并给出原因，其余检测照常工作。

## 目录

```
public/
  index.html          入口（普通模式 / 隔离模式同页自适应）
  css/app.css
  js/util.js          异常包装、安全探测、下载等工具
  js/detector.js      全部特性检测（含 Web Worker / 网络探针）
  js/fallback.js      降级分层引擎 + 存储抽象
  js/matrix.js        兼容矩阵（参考数据 + 实机合并）
  js/report.js        报告生成 / 导出 / IndexedDB 历史
  js/app.js           UI 编排、异常中心、跨标签同步
server/server.mjs     双端口测试服务器（隔离页面与各类探针头）
```

## 需要服务器配合的探针

| 路由 | 响应头 | 用途 |
| --- | --- | --- |
| `/isolated` | `COOP: same-origin`、`COEP: require-corp` | 隔离页面 |
| `/probe/no-corp`（同源） | 无 CORP | 同源资源基线（应成功） |
| `http://ORIGIN2/probe/no-corp` | 跨源、无 CORP | COEP 强制拦截检测 |
| `http://ORIGIN2/probe/corp-cors` | `Cross-Origin-Resource-Policy: cross-origin` | CORP 放行检测 |
| `/probe/coep-report-only` | `COEP-Report-Only: require-corp`、`Reporting-Endpoints` | Report-Only + Reporting API |
| `/probe/permission-policy` | `Permissions-Policy: shared-array-buffer=()` | 策略阻断检测 |

## 测试

零依赖 Node 测试（无需启动监听，服务器用注入方式验证路由与响应头）：

```bash
npm test
# 或
node tests/test-logic.mjs       # 分层选型 / 矩阵合并 / 报告导出 / 历史存取
node tests/test-detector.mjs    # 检测器：隔离 / 普通 / file:// 三场景共 23 项
node tests/test-channel.mjs     # 降级通道：第 1-4 档缓冲计算
node tests/test-http-inject.mjs # 服务器：16 个路由/响应头断言（含路径穿越防护）
```

> 注：受限沙箱可能禁止监听端口，此时浏览器手测可在普通环境用
> `npm start`；所有业务逻辑仍可由上述无监听测试覆盖。

## 异常处理约定

- 每个检测项独立 try/catch，单项失败不影响其他项；错误归一为
  `error`/`timeout`/`skipped`，附带 `name/message` 与耗时。
- 网络探针区分“被策略拦截 / 网络失败 / 服务未运行”，后两者标记 `skipped`
  而不是误报“不支持”。
- 页面级异常（非安全上下文、`file://`、未隔离）通过顶部告警条提示。
- 浏览器违规报告（COEP/COOP）由 `ReportingObserver` 采集，toast + 控制台双通道提示。
