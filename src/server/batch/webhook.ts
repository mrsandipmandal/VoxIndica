import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { RawBodyRequest } from './http';
import type { BatchCallbackPayload } from './types';
import { BatchCallbackError, applyBatchCallback } from './events';
import { findBatchByCallbackToken } from './store';

const MAX_CLOCK_SKEW_SECONDS = 300;
const SIGNATURE_PREFIX = 'sha256=';

function unauthorized(response: Response, message: string): void {
  response.status(401).json({ error: message });
}

export async function handleBatchWebhook(request: Request, response: Response): Promise<void> {
  try {
    const token = String(request.params.token ?? '');
    const job = await findBatchByCallbackToken(token);
    if (!job) {
      response.status(404).json({ error: 'Unknown batch callback' });
      return;
    }

    const rawBody = (request as RawBodyRequest).rawBody;
    if (!rawBody || rawBody.length === 0) {
      response.status(400).json({ error: 'Callback body must be raw JSON' });
      return;
    }

    const timestampHeader = request.get('x-voxindica-timestamp')?.trim() ?? '';
    const timestamp = Number(timestampHeader);
    if (
      !timestampHeader ||
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() / 1000 - timestamp) > MAX_CLOCK_SKEW_SECONDS
    ) {
      unauthorized(response, 'Callback timestamp is missing or outside the 5-minute window');
      return;
    }

    const signatureHeader = request.get('x-voxindica-signature')?.trim() ?? '';
    const providedHex = signatureHeader.startsWith(SIGNATURE_PREFIX)
      ? signatureHeader.slice(SIGNATURE_PREFIX.length).toLowerCase()
      : '';
    if (!/^[a-f0-9]{64}$/.test(providedHex)) {
      unauthorized(response, 'Callback signature is missing or malformed');
      return;
    }

    const expectedHex = createHmac('sha256', job.callbackSecret)
      .update(`${timestampHeader}.`)
      .update(rawBody)
      .digest('hex');
    const expected = Buffer.from(expectedHex, 'hex');
    const provided = Buffer.from(providedHex, 'hex');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      unauthorized(response, 'Callback signature is invalid');
      return;
    }

    const payload = request.body as BatchCallbackPayload;
    if (!payload || typeof payload !== 'object' || typeof payload.event !== 'string') {
      response.status(400).json({ error: 'Callback payload is invalid' });
      return;
    }
    if (payload.job_id !== job.id) {
      response.status(400).json({ error: 'Callback job_id does not match this job' });
      return;
    }

    const result = await applyBatchCallback(job.id, payload);
    response.status(200).json({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    if (error instanceof BatchCallbackError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error('[batch] callback processing failed:', error);
    response.status(500).json({ error: 'Callback processing failed' });
  }
}

export function getWebhookRoute(): string {
  return '/api/providers/batch/webhook/:token';
}
