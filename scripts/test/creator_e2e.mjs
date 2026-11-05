#!/usr/bin/env node
/**
 * Stage 5 end-to-end test for the Creator Studio API.
 *
 * Starts the real Studio with temporary storage and no provider keys, then
 * exercises project CRUD, validation, consent, a real WAV asset, script
 * persistence, captions/publishing honesty, ZIP export, and a contract
 * stand-in worker for the per-scene voice job. The fake worker returns a real
 * PCM WAV for every scene, so the final captions and chapters use measured
 * durations, not estimates. A local ffmpeg render then verifies that fade and
 * flash transitions preserve those durations while changing the frames.
 *
 *     node scripts/test/creator_e2e.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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
const WORKER_TOKEN = 'creator-test-token';

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

/** 16-bit mono PCM WAV with a quiet tone, valid for the reference/worker contract. */
function wavBytes(seconds = 3, sampleRate = 16000) {
  const samples = Math.round(seconds * sampleRate);
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
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 6000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
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

function requireBinary(binary) {
  try {
    execFileSync(binary, ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error(`${binary} is required for the creator render test and was not found.`);
  }
}

async function createVisual(filePath, color) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=64x64`,
      '-frames:v',
      '1',
      filePath
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  return fs.readFile(filePath);
}

/** Decode one frame to a single RGB pixel so transition brightness is measurable. */
function framePixel(filePath, seconds) {
  const buffer = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(seconds),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-vf',
      'scale=1:1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-'
    ],
    { maxBuffer: 1024 }
  );
  assert.equal(buffer.length, 3, `expected one RGB pixel at ${seconds}s, got ${buffer.length} bytes`);
  return [buffer[0], buffer[1], buffer[2]];
}

function probeDuration(filePath) {
  const value = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      filePath
    ],
    { encoding: 'utf8' }
  ).trim();
  return Number(value);
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
  const calls = [];
  const server = http.createServer(async (request, response) => {
    try {
      const body = await readBody(request);
      if (
        request.method !== 'POST' ||
        (request.url !== '/clone_voice' && request.url !== '/synthesize')
      ) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ detail: 'not found' }));
        return;
      }
      if (request.headers.authorization !== `Bearer ${WORKER_TOKEN}`) {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ detail: 'bad worker token' }));
        return;
      }
      const payload = JSON.parse(body.toString('utf8'));
      calls.push(payload);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          status: 'success',
          audio_base64: audioBase64,
          sample_rate: 16000,
          chunks: 1,
          model: 'voxcpm2-test'
        })
      );
    } catch (error) {
      console.error('[test] fake worker failed:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ detail: 'fake worker failed' }));
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        calls,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}

function createApi(baseUrl) {
  return async function api(pathname, init) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {})
      }
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, text, json };
  };
}

function expectStatus(response, expected, label) {
  assert.equal(
    response.status,
    expected,
    `${label}: expected HTTP ${expected}, got ${response.status}: ${response.text}`
  );
}

async function main() {
  requireBinary('ffmpeg');
  requireBinary('ffprobe');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'voxindica-creator-test-'));
  const port = await freePort();
  const studioUrl = `http://127.0.0.1:${port}`;
  const api = createApi(studioUrl);

  const webDir = path.join(temp, 'web');
  const docsDir = path.join(temp, 'docs');
  const notebooksDir = path.join(temp, 'notebooks');
  const envFile = path.join(temp, '.env');
  await Promise.all([
    fs.mkdir(webDir, { recursive: true }),
    fs.mkdir(docsDir, { recursive: true }),
    fs.mkdir(notebooksDir, { recursive: true }),
    fs.writeFile(envFile, '')
  ]);

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    VOXINDICA_WEB_DIR: webDir,
    VOXINDICA_DOCS_DIR: docsDir,
    VOXINDICA_NOTEBOOKS_DIR: notebooksDir,
    VOXINDICA_CREATOR_DATA_DIR: path.join(temp, 'projects'),
    VOXINDICA_BATCH_DATA_DIR: path.join(temp, 'batches'),
    VOXINDICA_ENV_FILE: envFile,
    VOXINDICA_CALLBACK_PORT: '0'
  };
  // The no-provider-key assertion must not inherit a developer's real keys.
  for (const key of ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY']) {
    delete env[key];
  }

  const server = spawn(tsx, ['server.ts'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  server.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  const worker = await startFakeWorker(wavBytes(2).toString('base64'));

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
        const response = await fetch(`${studioUrl}/healthz`);
        return response.ok;
      } catch {
        return false;
      }
    }, 10000, 'Studio /healthz');

    // --- health without provider keys ---------------------------------
    const health = await api('/api/creator/health');
    expectStatus(health, 200, 'creator health');
    assert.equal(health.json?.ok, true);
    assert.equal(health.json?.providers?.gemini?.configured, false);
    assert.equal(health.json?.providers?.groq?.configured, false);
    assert.equal(health.json?.providers?.openrouter?.configured, false);
    assert.equal(
      path.resolve(health.json.storageRoot),
      path.resolve(env.VOXINDICA_CREATOR_DATA_DIR)
    );

    // --- validation and project CRUD ----------------------------------
    const shortTopic = await api('/api/creator/projects', {
      method: 'POST',
      body: JSON.stringify({ topic: 'ab', language: 'bn-IN', tone: 'news', videoMode: 'cinematic' })
    });
    expectStatus(shortTopic, 400, 'short project topic');

    const missingMode = await api('/api/creator/projects', {
      method: 'POST',
      body: JSON.stringify({ topic: 'A valid topic', language: 'bn-IN', tone: 'news' })
    });
    expectStatus(missingMode, 400, 'missing video mode');

    const created = await api('/api/creator/projects', {
      method: 'POST',
      body: JSON.stringify({
        topic: 'Bengali Culture and Craft',
        language: 'bn-IN',
        tone: 'documentary',
        audience: 'general viewers',
        targetDurationSeconds: 60,
        videoMode: 'cinematic',
        extraInstructions: 'Keep the narration factual and calm.'
      })
    });
    expectStatus(created, 201, 'create project');
    const project = created.json.project;
    assert.ok(project?.id, 'created project must have an id');
    assert.equal(project.status, 'draft');
    assert.equal(project.script, null);
    assert.equal(project.consent, null);
    assert.deepEqual(project.assets, []);
    assert.deepEqual(project.captionStyle, {
      fontScale: 1,
      textColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 3,
      position: 'bottom',
      background: false
    });
    const projectId = project.id;

    const list = await api('/api/creator/projects');
    expectStatus(list, 200, 'list projects');
    assert.ok(list.json.projects.some((entry) => entry.id === projectId));
    assert.equal(
      list.json.projects.find((entry) => entry.id === projectId).hasScript,
      false
    );

    const missing = await api('/api/creator/projects/00000000-0000-4000-8000-000000000000');
    expectStatus(missing, 404, 'missing project');

    const badStyle = await api(`/api/creator/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ captionStyle: { textColor: 'yellow' } })
    });
    expectStatus(badStyle, 400, 'invalid caption colour');
    assert.match(badStyle.json.error, /RRGGBB/);

    // --- consent ------------------------------------------------------
    const badConsent = await api(`/api/creator/projects/${projectId}/consent`, {
      method: 'POST',
      body: JSON.stringify({ presenterName: 'x', confirmed: true })
    });
    expectStatus(badConsent, 400, 'invalid consent');

    const consent = await api(`/api/creator/projects/${projectId}/consent`, {
      method: 'POST',
      body: JSON.stringify({
        presenterName: 'Sandip Mandal',
        confirmed: true,
        notes: 'Local end-to-end test consent.'
      })
    });
    expectStatus(consent, 200, 'record consent');
    assert.equal(consent.json.project.consent.confirmed, true);
    assert.equal(consent.json.project.consent.presenterName, 'Sandip Mandal');

    // --- real WAV asset upload and download ---------------------------
    const referenceWav = wavBytes(3);
    const upload = await api(`/api/creator/projects/${projectId}/assets`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'reference_audio',
        fileName: 'reference.wav',
        mimeType: 'audio/wav',
        dataBase64: `data:audio/wav;base64,${referenceWav.toString('base64')}`
      })
    });
    expectStatus(upload, 201, 'upload reference asset');
    const asset = upload.json.asset;
    assert.ok(asset?.id, 'uploaded asset must have an id');
    assert.equal(asset.kind, 'reference_audio');
    assert.equal(asset.mimeType, 'audio/wav');
    assert.ok(
      asset.durationSeconds >= 2.9 && asset.durationSeconds <= 3.1,
      `expected a ~3s asset, got ${asset.durationSeconds}`
    );

    const download = await fetch(
      `${studioUrl}/api/creator/projects/${projectId}/assets/${asset.id}`
    );
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-type') || '', /audio\/wav/);
    assert.match(download.headers.get('cache-control') || '', /private/);
    const downloaded = Buffer.from(await download.arrayBuffer());
    assert.equal(downloaded.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(downloaded.subarray(8, 12).toString('ascii'), 'WAVE');

    // --- persist a valid script without a provider --------------------
    const scriptContent = {
      title: 'Bengali Culture and Craft',
      hook: 'A short look at living traditions.',
      script:
        'Bengali culture lives in its rivers, crafts and everyday rituals. This local test script has two scenes.',
      scenes: [
        {
          id: 'scene-1',
          voiceText: 'প্রথম দৃশ্যের বর্ণনা।',
          visualPrompt: 'A calm river at sunrise',
          videoType: 'b-roll',
          camera: 'wide shot',
          subtitle: 'নদী ও ভোর',
          transition: 'dissolve',
          durationSeconds: 3
        },
        {
          id: 'scene-2',
          voiceText: 'দ্বিতীয় দৃশ্যের বর্ণনা।',
          visualPrompt: 'Pottery close-up in warm light',
          videoType: 'b-roll',
          camera: 'medium shot',
          subtitle: 'মাটির শিল্প',
          transition: 'flash',
          durationSeconds: 3
        }
      ],
      description: 'A short documentary about Bengali culture and craft.',
      tags: ['bangla', 'culture'],
      hashtags: ['#bangla', '#culture'],
      chapters: [
        { title: 'সূচনা', timestamp: '0:00' },
        { title: 'মাটির শিল্প', timestamp: '0:03' }
      ],
      thumbnailPrompt: 'A warm collage of Bengali rivers and pottery',
      sources: ['https://example.com/bengali-culture'],
      disclosure: 'Narration is synthesized for this local test.'
    };

    const patched = await api(`/api/creator/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ script: scriptContent })
    });
    expectStatus(patched, 200, 'patch script');
    assert.equal(patched.json.project.status, 'script_ready');
    assert.equal(patched.json.project.script.meta.provider, 'manual');
    assert.equal(patched.json.project.script.scenes.length, 2);
    assert.equal(patched.json.project.script.scenes[0].transition, 'fade');
    assert.equal(patched.json.project.script.scenes[1].transition, 'flash');

    const reloaded = await api(`/api/creator/projects/${projectId}`);
    expectStatus(reloaded, 200, 'reload project');
    assert.equal(reloaded.json.project.script.title, scriptContent.title);
    assert.equal(reloaded.json.project.script.meta.model, 'manual edit');

    // --- real scene visuals for the transition render -----------------
    const redPng = await createVisual(path.join(temp, 'scene-1.png'), 'red');
    const bluePng = await createVisual(path.join(temp, 'scene-2.png'), 'blue');
    const visuals = [];
    for (const [sceneId, fileName, bytes] of [
      ['scene-1', 'scene-1.png', redPng],
      ['scene-2', 'scene-2.png', bluePng]
    ]) {
      const uploaded = await api(`/api/creator/projects/${projectId}/assets`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'scene_visual',
          fileName,
          mimeType: 'image/png',
          dataBase64: `data:image/png;base64,${bytes.toString('base64')}`,
          sceneId
        })
      });
      expectStatus(uploaded, 201, `upload visual for ${sceneId}`);
      assert.equal(uploaded.json.asset.kind, 'scene_visual');
      assert.equal(uploaded.json.asset.sceneId, sceneId);
      visuals.push(uploaded.json.asset);
    }
    assert.equal(visuals.length, 2);

    // --- captions/publishing stay honest before narration -------------
    const noCaptions = await api(`/api/creator/projects/${projectId}/captions?format=srt`);
    expectStatus(noCaptions, 400, 'captions before narration');
    assert.match(noCaptions.json.error, /Synthesize narration for every scene/);
    assert.match(noCaptions.json.error, /2 missing/);

    const badFormat = await api(`/api/creator/projects/${projectId}/captions?format=vtt`);
    expectStatus(badFormat, 400, 'unsupported caption format');
    assert.match(badFormat.json.error, /Unsupported caption format/);

    const incompletePublishing = await api(`/api/creator/projects/${projectId}/publishing`);
    expectStatus(incompletePublishing, 200, 'publishing before narration');
    assert.match(
      incompletePublishing.headers.get('content-type') || '',
      /text\/markdown/
    );
    assert.match(
      incompletePublishing.text,
      /_Chapters are generated from real scene narration timings\./
    );
    assert.match(
      incompletePublishing.text,
      /SRT becomes available after every scene has synthesized narration\./
    );
    assert.doesNotMatch(incompletePublishing.text, /- 0:00 —/);

    // --- ZIP export ---------------------------------------------------
    const exported = await fetch(`${studioUrl}/api/creator/projects/${projectId}/export`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type') || '', /application\/zip/);
    assert.ok(Number(exported.headers.get('content-length') || 0) > 0);
    const zip = Buffer.from(await exported.arrayBuffer());
    assert.equal(zip.subarray(0, 2).toString('ascii'), 'PK');

    // --- no-key script generation fails honestly ----------------------
    const generation = await api('/api/creator/scripts/generate', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        topic: 'Bengali Culture and Craft',
        language: 'bn-IN',
        tone: 'documentary',
        audience: 'general viewers',
        targetDurationSeconds: 60,
        videoMode: 'cinematic',
        extraInstructions: 'Keep it factual.'
      })
    });
    expectStatus(generation, 500, 'script generation without keys');
    assert.match(generation.json.error, /No script provider is configured/);
    assert.equal(
      (await api(`/api/creator/projects/${projectId}`)).json.project.script.title,
      scriptContent.title,
      'a failed generation must not replace the saved script'
    );

    // --- real per-scene voice job against a contract worker -----------
    const voiceStart = await api(`/api/creator/projects/${projectId}/voice`, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'local',
        workerUrl: worker.url,
        workerToken: WORKER_TOKEN,
        referenceAssetId: asset.id,
        voiceName: 'Local Test Voice'
      })
    });
    expectStatus(voiceStart, 202, 'start voice job');

    const completedVoice = await waitFor(async () => {
      const response = await api(`/api/creator/projects/${projectId}/voice`);
      if (response.status !== 200) return null;
      const status = response.json?.voice?.status;
      if (status === 'complete') return response.json;
      if (status === 'failed' || status === 'cancelled' || status === 'interrupted') {
        throw new Error(`voice job ended ${status}: ${response.text}`);
      }
      return null;
    }, 15000, 'complete voice job');

    assert.equal(completedVoice.running, false);
    assert.equal(completedVoice.voice.scenes['scene-1'] !== undefined, true);
    assert.equal(completedVoice.voice.scenes['scene-2'] !== undefined, true);
    assert.ok(completedVoice.voice.scenes['scene-1'].durationSeconds >= 1.9);
    assert.ok(completedVoice.voice.scenes['scene-2'].durationSeconds >= 1.9);
    assert.equal(worker.calls.length, 2);
    assert.match(worker.calls[0].text, /প্রথম দৃশ্য/);
    assert.equal(worker.calls[0].language, 'bn-IN');
    const sentReference = Buffer.from(worker.calls[0].reference_audio, 'base64');
    assert.equal(sentReference.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(sentReference.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(sentReference.equals(referenceWav), true);

    // --- captions and publishing use measured durations --------------
    const srt = await api(`/api/creator/projects/${projectId}/captions?format=srt`);
    expectStatus(srt, 200, 'SRT after narration');
    assert.match(srt.headers.get('content-type') || '', /application\/subrip/);
    assert.match(srt.text, /00:00:00,000 --> 00:00:02,000/);
    assert.match(srt.text, /00:00:02,000 --> 00:00:04,000/);
    assert.match(srt.text, /নদী ও ভোর/);
    assert.match(srt.text, /মাটির শিল্প/);

    const ass = await api(`/api/creator/projects/${projectId}/captions?format=ass`);
    expectStatus(ass, 200, 'ASS after narration');
    assert.match(ass.headers.get('content-type') || '', /text\/x-ssa/);
    assert.match(ass.text, /\[Script Info\]/);
    assert.match(ass.text, /PlayResX: 1280/);
    assert.match(ass.text, /PlayResY: 720/);
    assert.match(ass.text, /Noto Sans Bengali/);
    assert.match(ass.text, /Dialogue: 0,0:00:00\.00,0:00:02\.00/);
    assert.ok(
      ass.text.includes(
        'Style: VoxIndica,Noto Sans Bengali,44,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,70,70,48,1'
      ),
      'the default caption style must match the previous ASS output'
    );

    // Partial PATCH merges with the saved style instead of resetting it.
    const partialStyle = await api(`/api/creator/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ captionStyle: { position: 'middle' } })
    });
    expectStatus(partialStyle, 200, 'partial caption style patch');
    assert.deepEqual(partialStyle.json.project.captionStyle, {
      fontScale: 1,
      textColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 3,
      position: 'middle',
      background: false
    });

    const styledProject = await api(`/api/creator/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        captionStyle: {
          fontScale: 1.5,
          textColor: '#FFCC00',
          outlineColor: '#112233',
          outlineWidth: 5,
          position: 'top',
          background: true
        }
      })
    });
    expectStatus(styledProject, 200, 'save caption style');
    assert.deepEqual(styledProject.json.project.captionStyle, {
      fontScale: 1.5,
      textColor: '#FFCC00',
      outlineColor: '#112233',
      outlineWidth: 5,
      position: 'top',
      background: true
    });

    const styledAss = await api(`/api/creator/projects/${projectId}/captions?format=ass`);
    expectStatus(styledAss, 200, 'ASS with custom caption style');
    assert.ok(
      styledAss.text.includes(
        'Style: VoxIndica,Noto Sans Bengali,66,&H0000CCFF,&H000000FF,&H00332211,&H80000000,0,0,0,0,100,100,0,0,3,5,1,8,70,70,48,1'
      ),
      `custom ASS style line missing:\n${styledAss.text}`
    );

    const publishing = await api(`/api/creator/projects/${projectId}/publishing`);
    expectStatus(publishing, 200, 'publishing after narration');
    assert.match(publishing.text, /- 00:00 — সূচনা/);
    assert.match(publishing.text, /- 00:02 — মাটির শিল্প/);
    assert.match(publishing.text, /SRT available: 2 cues covering 4\.00 seconds/);
    assert.doesNotMatch(publishing.text, /no timestamps are estimated/);

    // --- duration-preserving scene transitions in a real render -------
    const renderOptions = {
      preset: 'landscape',
      burnCaptions: false,
      normalizeAudio: false
    };
    const renderStart = await api(`/api/creator/projects/${projectId}/render`, {
      method: 'POST',
      body: JSON.stringify(renderOptions)
    });
    expectStatus(renderStart, 202, 'start transition render');

    const finishedRender = await waitFor(async () => {
      const response = await api(`/api/creator/projects/${projectId}/render`);
      if (response.status !== 200) return null;
      const status = response.json?.render?.status;
      if (status === 'complete') return response.json;
      if (status === 'failed' || status === 'cancelled' || status === 'interrupted') {
        throw new Error(`render ended ${status}: ${response.text}`);
      }
      return null;
    }, 120000, 'complete transition render');

    assert.equal(finishedRender.running, false);
    assert.match(finishedRender.render.message, /scene transitions/);
    assert.equal(finishedRender.render.scenes['scene-1'].transition, 'fade');
    assert.equal(finishedRender.render.scenes['scene-1'].outgoingTransition, 'flash');
    assert.equal(finishedRender.render.scenes['scene-2'].transition, 'flash');
    assert.equal(finishedRender.render.scenes['scene-2'].outgoingTransition, 'cut');
    assert.deepEqual(finishedRender.render.captionStyle, {
      fontScale: 1.5,
      textColor: '#FFCC00',
      outlineColor: '#112233',
      outlineWidth: 5,
      position: 'top',
      background: true
    });
    assert.ok(finishedRender.render.outputAssetId, 'completed render must have an output asset');

    const videoResponse = await fetch(
      `${studioUrl}/api/creator/projects/${projectId}/assets/${finishedRender.render.outputAssetId}`
    );
    assert.equal(videoResponse.status, 200);
    assert.match(videoResponse.headers.get('content-type') || '', /video\/mp4/);
    const finalVideo = Buffer.from(await videoResponse.arrayBuffer());
    assert.equal(finalVideo.subarray(4, 8).toString('ascii'), 'ftyp');
    const finalPath = path.join(temp, 'transition-render.mp4');
    await fs.writeFile(finalPath, finalVideo);
    const finalDuration = probeDuration(finalPath);
    assert.ok(
      Math.abs(finalDuration - 4) < 0.15,
      `transitions must preserve the 4.00s narration duration, got ${finalDuration}s`
    );

    const fadeIn = framePixel(finalPath, 0.05);
    const redScene = framePixel(finalPath, 0.8);
    const flashOut = framePixel(finalPath, 1.9);
    const flashIn = framePixel(finalPath, 2.05);
    const blueScene = framePixel(finalPath, 2.8);
    assert.ok(
      fadeIn[0] < 110 && fadeIn[1] < 60 && fadeIn[2] < 60,
      `scene 1 should fade in from black, got rgb(${fadeIn.join(',')})`
    );
    assert.ok(
      redScene[0] > 150 && redScene[1] < 80 && redScene[2] < 80,
      `scene 1 should be red after the fade, got rgb(${redScene.join(',')})`
    );
    assert.ok(
      flashOut[0] > 130 && flashOut[1] > 130 && flashOut[2] > 130,
      `scene 1 should flash to white before the boundary, got rgb(${flashOut.join(',')})`
    );
    assert.ok(
      flashIn[0] > 130 && flashIn[1] > 130 && flashIn[2] > 130,
      `scene 2 should start white after the flash, got rgb(${flashIn.join(',')})`
    );
    assert.ok(
      blueScene[2] > 150 && blueScene[0] < 80 && blueScene[1] < 80,
      `scene 2 should be blue after the flash, got rgb(${blueScene.join(',')})`
    );

    const duplicateRender = await api(`/api/creator/projects/${projectId}/render`, {
      method: 'POST',
      body: JSON.stringify(renderOptions)
    });
    expectStatus(duplicateRender, 409, 'duplicate transition render');
    assert.match(duplicateRender.json.error, /already has a finished render/);

    // Changing the incoming transition for scene 2 changes both the outgoing
    // effect on scene 1 and the incoming effect on scene 2, so no clip is reused.
    const changedScript = {
      ...scriptContent,
      scenes: scriptContent.scenes.map((scene, index) =>
        index === 1 ? { ...scene, transition: 'cut' } : scene
      )
    };
    const changedProject = await api(`/api/creator/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ script: changedScript })
    });
    expectStatus(changedProject, 200, 'change scene transition');
    assert.equal(changedProject.json.project.script.scenes[1].transition, 'cut');

    const rerender = await api(`/api/creator/projects/${projectId}/render`, {
      method: 'POST',
      body: JSON.stringify(renderOptions)
    });
    expectStatus(rerender, 202, 'transition change invalidates scene clips');
    assert.equal(rerender.json.job.completedScenes, 0);
    assert.equal(rerender.json.project.render.scenes['scene-1'].status, 'pending');
    assert.equal(rerender.json.project.render.scenes['scene-2'].status, 'pending');

    const cancelled = await api(`/api/creator/projects/${projectId}/render/cancel`, {
      method: 'POST'
    });
    expectStatus(cancelled, 200, 'cancel transition re-render');
    assert.equal(cancelled.json.project.render.status, 'cancelled');

    // --- delete -------------------------------------------------------
    const deleted = await api(`/api/creator/projects/${projectId}`, { method: 'DELETE' });
    expectStatus(deleted, 200, 'delete project');
    const gone = await api(`/api/creator/projects/${projectId}`);
    expectStatus(gone, 404, 'deleted project');

    console.log('PASS creator health, CRUD and validation');
    console.log('PASS consent and real WAV asset upload/download');
    console.log('PASS script persistence and honest no-key generation failure');
    console.log('PASS captions/publishing honesty before narration');
    console.log('PASS ZIP export');
    console.log('PASS contract-worker voice job and measured captions/chapters');
    console.log('PASS caption style persistence and ASS styling');
    console.log('PASS fade/flash transition render and cache invalidation');
    console.log('PASS creator end-to-end');
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    await stop();
  }
}

main().catch((error) => {
  console.error('[test] creator end-to-end test failed:', error);
  process.exitCode = 1;
});
