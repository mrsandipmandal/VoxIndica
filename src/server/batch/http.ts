import express, { type Request, type RequestHandler } from 'express';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * The global Studio parser preserves the exact bytes so webhook HMACs can be
 * verified over the same representation the worker signed.
 */
export function captureRawJson(limit = '50mb'): RequestHandler {
  return express.json({
    limit,
    verify: (request, _response, buffer) => {
      (request as RawBodyRequest).rawBody = Buffer.from(buffer);
    },
  });
}
