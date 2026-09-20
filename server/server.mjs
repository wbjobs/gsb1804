// 启动入口：双端口（应用 + 跨源探针）。沙箱/受限环境若禁止监听，
// 仍可直接对 http-app.mjs 导出的 server 做无端口注入测试（见测试脚本）。
import { createAppServer, createOrigin2Server } from './http-app.mjs';

const port = Number(process.env.PORT || 8080);
const origin2Port = Number(process.env.ORIGIN2_PORT || port + 1);
const host = process.env.HOST || '127.0.0.1';

const app = createAppServer({ origin2Port });
const origin2 = createOrigin2Server();

app.listen(port, host, () => {
  console.log(`app       http://${host}:${port}/`);
  console.log(`isolated  http://${host}:${port}/isolated`);
  console.log(`origin2   http://${host}:${origin2Port}/ (跨源探针)`);
});
origin2.listen(origin2Port, host).on('error', (err) => {
  console.warn(`[warn] 跨源端口 ${origin2Port} 启动失败（${err.message}）；跨源探针将不可用。`);
});
