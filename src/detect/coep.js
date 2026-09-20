import { SUPPORT } from '../core/model.js';

export function createCoepDetector() {
  return async function detectCoep(host) {
    const policy = host.documentPolicy();
    const warnings = [];
    let support = SUPPORT.UNKNOWN;
    const active = !!policy.coep;
    if (policy.coepReportOnly && !policy.coep) {
      warnings.push('仅配置了 COEP-Report-Only，跨源资源不会被真正强制校验');
    }
    if (!active) {
      support = SUPPORT.UNSUPPORTED;
    } else if (policy.coep === 'require-corp') {
      support = SUPPORT.SUPPORTED;
      warnings.push('require-corp 要求所有跨源资源显式提供 CORP 或 CORS');
    } else if (policy.coep === 'credentialless') {
      support = SUPPORT.SUPPORTED;
      warnings.push('credentialless 不被 Firefox/Safari 支持，需按兼容矩阵准备 require-corp 回退');
    } else {
      support = SUPPORT.PARTIAL;
      warnings.push(`未识别的 COEP 指令: ${policy.coep}`);
    }
    return {
      support,
      details: {
        header: policy.coep,
        reportOnly: policy.coepReportOnly,
        mode: active ? policy.coep : null
      },
      warnings
    };
  };
}
