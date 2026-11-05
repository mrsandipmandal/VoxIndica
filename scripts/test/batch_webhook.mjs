#!/usr/bin/env node
/**
 * End-to-end batch webhook test.
 *
 * Starts the real Studio server with a dedicated loopback callback listener,
 * points it at a fake worker, and verifies that signed worker callbacks update
 * the persisted job, store the returned WAV, and remain idempotent on retry.
 *
 *     node scripts/test/batch_webhook.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function wavBytes() {
  const sampleRate = 24000;
  const samples = 2400;
  const dataLength = samples * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function startFakeWorker(audioBase64) {
  const state = {
    callbackUrl: '',
    secret: '',
    jobId: '',
    total: 0,
    delivered: 0,
    signatureFailures: 0,
  };

  async function postCallback(payload) {
    assert.ok(state.callbackUrl, 'the fake worker must receive callback_url');
    assert.ok(state.secret, 'the fake worker must receive callback_secret');
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', state.secret)
      .update(`${timestamp}.`)
      .update(body)
      .digest('hex');
    const response = await fetch(state.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VoxIndica-Timestamp': timestamp,
        'X-VoxIndica-Signature': `sha256=${signature}`,
      },
      body,
    });
    if (response.status !== 200) {
      state.signatureFailures += 1;
      throw new Error(`callback ${payload.event} returned HTTP ${response.status}: ${await response.text()}`);
    }
    state.delivered += 1;
    return response.json();
  }

  const server = http.createServer(async (request, response) => {
    try {
      const body = await readBody(request);
      if (request.method !== 'POST' || request.url !== '/batch') {
        response.writeHead(404).end();
        return;
      }
      const payload = JSON.parse(body.toString('utf8'));
      state.callbackUrl = payload.callback_url;
      state.secret = payload.callback_secret;
      state.jobId = payload.batch_id;
      state.total = payload.items.length;
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'accepted', batch_id: payload.batch_id, total: state.total }));

      // Deliver item events in order, then the terminal batch event.
      for (let index = 0; index < payload.items.length; index += 1) {
        const item = payload.items[index];
        await postCallback({
          event: 'item.started',
          job_id: payload.batch_id,
          item_id: item.id,
          index,
          status: 'running',
          total: state.total,
          completed: index,
          failed: 0,
          sent_at: new Date().toISOString(),
        });
        await postCallback({
          event: 'item.completed',
          job_id: payload.batch_id,
          item_id: item.id,
          index,
          status: 'completed',
          audio_base64: audioBase64,
          sample_rate: 24000,
          duration_seconds: 0.1,
          chunks: 1,
          generation_seconds: 0.01,
          total: state.total,
          completed: index + 1,
          failed: 0,
          sent_at: new Date().toISOString(),
        });
      }
      await postCallback({
        event: 'batch.completed',
        job_id: payload.batch_id,
        status: 'completed',
        total: state.total,
        completed: state.total,
        failed: 0,
        sent_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[test] fake worker failed:', error);
      if (!response.headersSent) {
        response.writeHead(500).end();
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        state,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'voxindica-batch-test-'));
  const worker = await startFakeWorker(wavBytes().toString('base64'));
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    VOXINDICA_CALLBACK_PORT: '0',
    VOXINDICA_BATCH_DATA_DIR: path.join(temp, 'batches'),
    VOXINDICA_WEB_DIR: path.join(temp, 'web'),
    VOXINDICA_DOCS_DIR: path.join(temp, 'docs'),
    VOXINDICA_NOTEBOOKS_DIR: path.join(temp, 'notebooks'),
    VOXINDICA_CREATOR_DATA_DIR: path.join(temp, 'projects'),
    VOXINDICA_ENV_FILE: path.join(temp, '.env'),
  };
  await fs.mkdir(env.VOXINDICA_WEB_DIR, { recursive: true });
  await fs.mkdir(env.VOXINDICA_DOCS_DIR, { recursive: true });
  await fs.mkdir(env.VOXINDICA_NOTEBOOKS_DIR, { recursive: true });

  const server = spawn(tsx, ['server.ts'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  const stop = async () => {
    await worker.close().catch(() => {});
    if (!server.killed) server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!server.killed) server.kill('SIGKILL');
        resolve();
      }, 3000);
      server.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await fs.rm(temp, { recursive: true, force: true });
  };

  try {
    await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`);
        return response.ok;
      } catch {
        return false;
      }
    }, 10000, 'Studio /healthz');

    const create = await fetch(`http://127.0.0.1:${port}/api/providers/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'local',
        workerUrl: worker.url,
        language: 'bn-IN',
        isCloned: false,
        items: [
          { id: 'item-0001', text: 'প্রথম বাক্য।' },
          { id: 'item-0002', text: 'দ্বিতীয় বাক্য।' },
        ],
      }),
    });
    const createBody = await create.json();
    assert.equal(create.status, 202, JSON.stringify(createBody));
    assert.ok(createBody.job.id, 'Studio must return a batch job id');
    const jobId = createBody.job.id;

    const completed = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/providers/batch/${jobId}`);
      if (!response.ok) return null;
      const body = await response.json();
      return body.job.status === 'completed' ? body.job : null;
    }, 10000, 'completed batch callbacks');

    assert.equal(completed.total, 2);
    assert.equal(completed.completed, 2);
    assert.equal(completed.failed, 0);
    assert.equal(completed.items.length, 2);
    for (const item of completed.items) {
      assert.equal(item.status, 'completed');
      assert.ok(item.audioUrl, 'completed items must expose an audio URL');
      assert.equal(item.sampleRate, 24000);
    }
    assert.equal(worker.state.delivered, 5);
    assert.equal(worker.state.signatureFailures, 0);

    const audio = await fetch(`http://127.0.0.1:${port}${completed.items[0].audioUrl}`);
    assert.equal(audio.status, 200);
    assert.match(audio.headers.get('content-type') || '', /audio\/wav/);
    const audioBuffer = Buffer.from(await audio.arrayBuffer());
    assert.equal(audioBuffer.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(audioBuffer.subarray(8, 12).toString('ascii'), 'WAVE');

    // A retried terminal callback must be acknowledged without changing state.
    const duplicateBody = Buffer.from(
      JSON.stringify({
        event: 'batch.completed',
        job_id: jobId,
        status: 'completed',
        total: 2,
        completed: 2,
        failed: 0,
      }),
      'utf8'
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const duplicateSignature = createHmac('sha256', worker.state.secret)
      .update(`${timestamp}.`)
      .update(duplicateBody)
      .digest('hex');
    const duplicate = await fetch(worker.state.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VoxIndica-Timestamp': timestamp,
        'X-VoxIndica-Signature': `sha256=${duplicateSignature}`,
      },
      body: duplicateBody,
    });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);

    const unsigned = await fetch(worker.state.callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'batch.completed', job_id: jobId }),
    });
    assert.equal(unsigned.status, 401);

    console.log('PASS batch webhook end-to-end');
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    await stop();
  }
}

main().catch((error) => {
  console.error('[test] batch webhook test failed:', error);
  process.exitCode = 1;
});
