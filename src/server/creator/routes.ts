import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import {
  assetUploadSchema,
  consentSchema,
  createProjectSchema,
  generateScriptSchema,
  generateThumbnailSchema,
  startRenderSchema,
  startVoiceJobSchema,
  updateProjectSchema,
  zodMessage
} from './schema';
import {
  CreatorError,
  assetFilePath,
  createProject,
  creatorDataRoot,
  deleteProject,
  exportProjectZip,
  listProjects,
  readProject,
  saveAsset,
  saveConsent,
  updateProject
} from './storage';
import { generateScript, providerStatus } from './providers';
import { cancelVoiceJob, isVoiceJobRunning, startVoiceJob, voiceJobInfo } from './voice';
import {
  cancelRender,
  isRenderJobRunning,
  renderJobInfo,
  startRender
} from './render';
import { assCaptionsForProject, captionsForProject, publishingForProject } from './publish';
import { generateThumbnail, thumbnailProviderStatus } from './thumbnail';

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

function fail(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ ok: false, error: zodMessage(error) });
    return;
  }
  if (error instanceof CreatorError) {
    res.status(error.status).json({ ok: false, error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected creator error.';
  res.status(500).json({ ok: false, error: message });
}

function wrap(handler: AsyncHandler) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error) => fail(res, error));
  };
}

export function registerCreatorRoutes(app: Express): void {
  app.get(
    '/api/creator/health',
    wrap(async (_req, res) => {
      res.json({
        ok: true,
        storageRoot: creatorDataRoot(),
        providers: providerStatus(),
        image: thumbnailProviderStatus()
      });
    })
  );

  app.post(
    '/api/creator/projects/:id/thumbnail/generate',
    wrap(async (req, res) => {
      const body = generateThumbnailSchema.parse(req.body ?? {});
      const thumbnail = await generateThumbnail(req.params.id, body.prompt);
      res.json({ ok: true, thumbnail });
    })
  );

  app.get(
    '/api/creator/projects',
    wrap(async (_req, res) => {
      const projects = await listProjects();
      res.json({ ok: true, projects });
    })
  );

  app.post(
    '/api/creator/projects',
    wrap(async (req, res) => {
      const body = createProjectSchema.parse(req.body);
      const project = await createProject(body);
      res.status(201).json({ ok: true, project });
    })
  );

  app.get(
    '/api/creator/projects/:id',
    wrap(async (req, res) => {
      const project = await readProject(req.params.id);
      res.json({ ok: true, project });
    })
  );

  app.patch(
    '/api/creator/projects/:id',
    wrap(async (req, res) => {
      const body = updateProjectSchema.parse(req.body);
      const project = await updateProject(req.params.id, body);
      res.json({ ok: true, project });
    })
  );

  app.delete(
    '/api/creator/projects/:id',
    wrap(async (req, res) => {
      await deleteProject(req.params.id);
      res.json({ ok: true });
    })
  );

  app.post(
    '/api/creator/scripts/generate',
    wrap(async (req, res) => {
      const input = generateScriptSchema.parse(req.body);
      const result = await generateScript(input);

      let project;
      if (input.projectId) {
        const current = await readProject(input.projectId);
        project = await updateProject(current.id, {
          script: result.script,
          status: current.status === 'draft' ? 'script_ready' : current.status
        });
      }

      res.json({
        ok: true,
        script: result.script,
        attempts: result.attempts,
        project
      });
    })
  );

  app.post(
    '/api/creator/projects/:id/assets',
    wrap(async (req, res) => {
      const body = assetUploadSchema.parse(req.body);
      const result = await saveAsset(req.params.id, body);
      res.status(201).json({
        ok: true,
        asset: result.asset,
        project: result.project
      });
    })
  );

  app.get(
    '/api/creator/projects/:id/assets/:assetId',
    wrap(async (req, res) => {
      const { filePath, asset } = await assetFilePath(req.params.id, req.params.assetId);
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.sendFile(filePath);
    })
  );

  app.post(
    '/api/creator/projects/:id/consent',
    wrap(async (req, res) => {
      const body = consentSchema.parse(req.body);
      const project = await saveConsent(req.params.id, body);
      res.json({ ok: true, project });
    })
  );

  app.get(
    '/api/creator/projects/:id/voice',
    wrap(async (req, res) => {
      const project = await readProject(req.params.id);
      res.json({
        ok: true,
        voice: project.voice,
        job: voiceJobInfo(project),
        running: isVoiceJobRunning(req.params.id)
      });
    })
  );

  app.post(
    '/api/creator/projects/:id/voice',
    wrap(async (req, res) => {
      const body = startVoiceJobSchema.parse(req.body);
      const project = await startVoiceJob(req.params.id, body);
      res.status(202).json({
        ok: true,
        project,
        job: voiceJobInfo(project)
      });
    })
  );

  app.post(
    '/api/creator/projects/:id/voice/cancel',
    wrap(async (req, res) => {
      const project = await cancelVoiceJob(req.params.id);
      res.json({ ok: true, project, job: voiceJobInfo(project) });
    })
  );

  app.get(
    '/api/creator/projects/:id/render',
    wrap(async (req, res) => {
      const project = await readProject(req.params.id);
      res.json({
        ok: true,
        render: project.render,
        job: renderJobInfo(project.render),
        running: isRenderJobRunning(req.params.id)
      });
    })
  );

  app.post(
    '/api/creator/projects/:id/render',
    wrap(async (req, res) => {
      const body = startRenderSchema.parse(req.body ?? {});
      const project = await startRender(req.params.id, body);
      res.status(202).json({
        ok: true,
        project,
        job: renderJobInfo(project.render)
      });
    })
  );

  app.post(
    '/api/creator/projects/:id/render/cancel',
    wrap(async (req, res) => {
      const project = await cancelRender(req.params.id);
      res.json({ ok: true, project, job: renderJobInfo(project.render) });
    })
  );

  app.get(
    '/api/creator/projects/:id/captions',
    wrap(async (req, res) => {
      const format = String(req.query.format || 'srt').toLowerCase();
      if (format === 'ass') {
        const { ass, fileName } = await assCaptionsForProject(req.params.id);
        res.setHeader('Content-Type', 'text/x-ssa; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(ass);
        return;
      }
      if (format !== 'srt') {
        throw new CreatorError(`Unsupported caption format "${format}". Use srt or ass.`, 400);
      }
      const { srt, fileName } = await captionsForProject(req.params.id);
      res.setHeader('Content-Type', 'application/subrip; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(srt);
    })
  );

  app.get(
    '/api/creator/projects/:id/publishing',
    wrap(async (req, res) => {
      const { markdown, fileName } = await publishingForProject(req.params.id);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(markdown);
    })
  );

  app.get(
    '/api/creator/projects/:id/export',
    wrap(async (req, res) => {
      const { buffer, fileName } = await exportProjectZip(req.params.id);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    })
  );
}
