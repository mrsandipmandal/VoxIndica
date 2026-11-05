#!/usr/bin/env node
/**
 * Builds the desktop sidecar: the Express server bundled by esbuild and injected
 * into a copy of the current Node binary as a single executable application
 * (SEA). Tauri ships the result through `bundle.externalBin`.
 *
 * Why Node SEA instead of PyInstaller: the studio backend is server.ts
 * (Express). The FastAPI worker in workers/ is a remote/local inference worker,
 * not the desktop app server, so packaging it would not serve the UI or
 * /api/creator routes.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build', 'desktop');
const binariesDir = path.join(root, 'src-tauri', 'binaries');

function targetTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  if (process.env.VOXINDICA_TARGET_TRIPLE) return process.env.VOXINDICA_TARGET_TRIPLE;
  try {
    return execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
  } catch {
    const verbose = execFileSync('rustc', ['-Vv'], { encoding: 'utf8' });
    const match = verbose.match(/^host:\s*(\S+)$/m);
    if (!match) throw new Error('Could not determine the Rust host target triple.');
    return match[1];
  }
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit', cwd: root });
}

async function main() {
  const triple = targetTriple();
  const extension = process.platform === 'win32' ? '.exe' : '';
  const output = path.join(binariesDir, `voxindica-server-${triple}${extension}`);

  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(binariesDir, { recursive: true });

  const bundlePath = path.join(buildDir, 'server.cjs');
  console.log(`[sidecar] bundling server.ts → ${path.relative(root, bundlePath)}`);
  await build({
    entryPoints: [path.join(root, 'server.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    legalComments: 'none',
    external: ['vite'],
    // The packaged server is always the production server. Defining this at
    // build time also tree-shakes the dev-only Vite middleware path.
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  const seaConfigPath = path.join(buildDir, 'sea-config.json');
  fs.writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: bundlePath,
        output: path.join(buildDir, 'server.blob'),
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2
    )
  );

  console.log('[sidecar] generating SEA blob');
  run(process.execPath, ['--experimental-sea-config', seaConfigPath]);

  console.log(`[sidecar] copying node runtime → ${path.relative(root, output)}`);
  fs.copyFileSync(process.execPath, output);
  if (process.platform !== 'win32') fs.chmodSync(output, 0o755);

  // macOS refuses to inject into a signed binary; ad-hoc sign again afterwards.
  if (process.platform === 'darwin') {
    try {
      run('codesign', ['--remove-signature', output]);
    } catch {
      console.warn('[sidecar] codesign --remove-signature failed (continuing)');
    }
  }

  // Windows node.exe ships signed; remove the signature when signtool exists.
  if (process.platform === 'win32') {
    try {
      run('signtool', ['remove', '/s', output]);
    } catch {
      console.warn('[sidecar] signtool unavailable; injecting into a signed node.exe');
    }
  }

  console.log('[sidecar] injecting NODE_SEA_BLOB');
  const postjectArgs = [
    require.resolve('postject/dist/cli.js'),
    output,
    'NODE_SEA_BLOB',
    path.join(buildDir, 'server.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  // postject requires an explicit Mach-O segment name on macOS.
  if (process.platform === 'darwin') {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  }
  run(process.execPath, postjectArgs);

  if (process.platform === 'darwin') {
    run('codesign', ['--sign', '-', output]);
  }

  const size = fs.statSync(output).size;
  console.log(`[sidecar] ready: ${path.relative(root, output)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`[sidecar] target triple: ${triple}`);
}

main().catch((error) => {
  console.error('[sidecar] build failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
