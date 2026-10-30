import { LocalHardwareInfo } from '../types';

/**
 * Reads real hardware facts from the browser.
 *
 * Everything here is a genuine capability/identity read: the WebGL unmasked
 * renderer string is what the GPU driver reports, `hardwareConcurrency` is the
 * logical CPU count. Nothing is estimated or invented — a value we cannot read
 * is returned as null and rendered as "unknown".
 */

interface WebGLDebugInfo {
  UNMASKED_RENDERER_WEBGL: number;
  UNMASKED_VENDOR_WEBGL: number;
}

const readWebGLRenderer = (): { renderer: string | null; vendor: string | null } => {
  try {
    const canvas = document.createElement('canvas');
    const context = (canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;

    if (!context) return { renderer: null, vendor: null };

    const debugInfo = context.getExtension('WEBGL_debug_renderer_info') as WebGLDebugInfo | null;
    if (!debugInfo) {
      const fallback = context.getParameter(context.RENDERER);
      return { renderer: typeof fallback === 'string' ? fallback : null, vendor: null };
    }

    const renderer = context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    const vendor = context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);

    return {
      renderer: typeof renderer === 'string' ? renderer : null,
      vendor: typeof vendor === 'string' ? vendor : null
    };
  } catch {
    return { renderer: null, vendor: null };
  }
};

const detectArchitecture = (): string | null => {
  const ua = navigator.userAgent;
  if (/arm64|aarch64/i.test(ua)) return 'arm64';
  if (/Win64|WOW64|x86_64|x64/i.test(ua)) return 'x86_64';
  if (/i686|i386/i.test(ua)) return 'x86';
  return null;
};

const detectPlatform = (): string => {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return uaData.platform;
  if (typeof navigator.platform === 'string' && navigator.platform) return navigator.platform;
  return 'Unknown platform';
};

const looksLikeSoftwareRenderer = (renderer: string | null): boolean =>
  !!renderer && /swiftshader|llvmpipe|software|basic render/i.test(renderer);

export const detectLocalHardware = (): LocalHardwareInfo => {
  const { renderer, vendor } = readWebGLRenderer();
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  return {
    gpuRenderer: renderer,
    gpuVendor: vendor,
    cpuThreads: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 0,
    deviceMemoryGb: typeof deviceMemory === 'number' ? deviceMemory : null,
    platform: detectPlatform(),
    architecture: detectArchitecture(),
    webgpu: 'gpu' in navigator,
    wasm: typeof WebAssembly === 'object',
    softwareRendering: looksLikeSoftwareRenderer(renderer)
  };
};

/** Human-readable GPU label: strips the ANGLE/PCI wrapper noise. */
export const formatGpuLabel = (hardware: LocalHardwareInfo): string => {
  if (!hardware.gpuRenderer) return 'Unavailable (no WebGL context)';
  const angle = hardware.gpuRenderer.match(/ANGLE \(([^)]*)\)/);
  const cleaned = (angle ? angle[1] : hardware.gpuRenderer)
    .replace(/Direct3D\d*/gi, '')
    .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || hardware.gpuRenderer;
};
