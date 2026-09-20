import { SUPPORT } from '../core/model.js';

const ISOLATING = new Set(['same-origin', 'same-origin-plus-COEP']);
const ISOLATING_ALLOW_POPUPS = new Set(['same-origin-allow-popups']);

export function createCoopDetector() {
  return async function detectCoop(host) {
    const policy = host.documentPolicy();
    const warnings = [];
    let support = SUPPORT.UNKNOWN;
    let active = !!policy.coop;
    if (policy.coopReportOnly && !policy.coop) {
      warnings.push('仅配置了 COOP-Report-Only，尚未实际启用隔离');
    }
    if (!active) {
      support = SUPPORT.UNSUPPORTED;
    } else if (ISOLATING.has(policy.coop)) {
      support = SUPPORT.SUPPORTED;
    } else if (ISOLATING_ALLOW_POPUPS.has(policy.coop)) {
      support = SUPPORT.PARTIAL;
      warnings.push('same-origin-allow-popups 可隔离当前文档，但会放行弹窗的跨源引用');
    } else if (policy.coop === 'unsafe-none') {
      support = SUPPORT.UNSUPPORTED;
    } else {
      support = SUPPORT.PARTIAL;
      warnings.push(`未识别的 COOP 指令: ${policy.coop}`);
    }
    return {
      support,
      details: {
        header: policy.coop,
        reportOnly: policy.coopReportOnly,
        isolating: active && ISOLATING.has(policy.coop)
      },
      warnings
    };
  };
}
