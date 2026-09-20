import { SUPPORT } from '../core/model.js';

export function createFeaturePolicyDetector() {
  return async function detectFeaturePolicy(host) {
    const win = host.global;
    const doc = win.document;
    const legacy = typeof doc !== 'undefined' && doc && typeof doc.featurePolicy === 'object' && doc.featurePolicy !== null;
    const modern = typeof doc !== 'undefined' && doc && typeof doc.permissionsPolicy === 'object' && doc.permissionsPolicy !== null;
    const warnings = [];
    let support = SUPPORT.UNKNOWN;
    const features = {};
    if (legacy || modern) {
      support = legacy && modern ? SUPPORT.SUPPORTED : SUPPORT.PARTIAL;
      if (legacy && !modern) warnings.push('仅支持旧版 document.featurePolicy，请准备 Permissions Policy 适配');
      if (!legacy && modern) warnings.push('仅支持 document.permissionsPolicy，旧版浏览器需 featurePolicy 回退');
    } else {
      support = SUPPORT.UNKNOWN;
    }
    const policy = modern ? doc.permissionsPolicy : (legacy ? doc.featurePolicy : null);
    if (policy) {
      for (const name of ['cross-origin-isolation', 'cross-origin-isolated', 'sync-xhr', 'shared-autofill']) {
        try {
          if (typeof policy.allowedFeatures === 'function') {
            features[name] = policy.allowedFeatures().includes(name);
          } else if (typeof policy.allowsFeature === 'function') {
            features[name] = policy.allowsFeature(name);
          }
        } catch {
          features[name] = null;
        }
      }
    }
    const allowHeader = readAllowHeader(win, doc);
    const iframeAllowSupported = testIframeAllowAttribute(win, doc);
    return {
      support,
      details: {
        legacyFeaturePolicy: legacy,
        permissionsPolicy: modern,
        allowsFeature: typeof (policy && policy.allowsFeature) === 'function',
        allowedFeatures: typeof (policy && policy.allowedFeatures) === 'function',
        features,
        allowHeader: allowHeader,
        iframeAllowAttribute: iframeAllowSupported
      },
      warnings
    };
  };
}

function readAllowHeader(win, doc) {
  if (typeof win.__COI_HEADERS__ === 'object' && win.__COI_HEADERS__ && win.__COI_HEADERS__.Allow) {
    return win.__COI_HEADERS__.Allow;
  }
  return null;
}

function testIframeAllowAttribute(win, doc) {
  if (hostDocumentMissing(win, doc)) return null;
  try {
    const iframe = doc.createElement('iframe');
    iframe.setAttribute('allow', 'cross-origin-isolation');
    const supported = iframe.allow !== undefined || iframe.hasAttribute('allow');
    return supported;
  } catch {
    return null;
  }
}

function hostDocumentMissing(win, doc) {
  return !doc || typeof doc.createElement !== 'function' || !win.HTMLElement;
}
