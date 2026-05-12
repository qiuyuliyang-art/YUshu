import { Router } from 'express';
import * as store from '../data/store.js';
import { publishToXiaohongshu } from '../publishers/xiaohongshu.js';
import { publishToDouyin } from '../publishers/douyin.js';
import type { Platform, ContentItem, PublisherResult } from '../types.js';

export const publishRouter = Router();

publishRouter.post('/', async (req, res) => {
  const { contentId, platforms } = req.body as { contentId?: string; platforms?: Platform[] };

  if (!contentId) return res.status(400).json({ error: 'contentId is required' });
  if (!platforms || platforms.length === 0) return res.status(400).json({ error: 'platforms is required' });

  const content = store.getContent(contentId);
  if (!content) return res.status(404).json({ error: 'Content not found' });

  if (content.images.length === 0 && !content.video) {
    return res.status(400).json({ error: 'Content must have at least one image or video' });
  }

  const job = store.createJob(contentId, platforms);
  store.appendJobLog(job.id, `Publishing to: ${platforms.join(', ')}`);
  store.updateJob(job.id, { status: 'running' });

  // Run publishers in parallel (don't await - respond immediately)
  const publisherMap: Record<Platform, (c: ContentItem) => Promise<PublisherResult>> = {
    xiaohongshu: publishToXiaohongshu,
    douyin: publishToDouyin,
  };

  const runPublishers = async () => {
    const results = await Promise.allSettled(
      platforms.map(async (platform) => {
        store.updateJob(job.id, {
          platformStatus: { ...job.platformStatus, [platform]: 'filling' },
        });
        store.appendJobLog(job.id, `[${platform}] Starting...`);

        try {
          const result = await publisherMap[platform](content);
          store.appendJobLog(job.id, `[${platform}] ${result.message}`);
          const currentJob = store.getJob(job.id);
          if (currentJob) {
            currentJob.platformStatus[platform] = result.success ? 'ready' : 'failed';
            store.updateJob(job.id, { platformStatus: currentJob.platformStatus });
          }
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          store.appendJobLog(job.id, `[${platform}] ERROR: ${msg}`);
          const currentJob = store.getJob(job.id);
          if (currentJob) {
            currentJob.platformStatus[platform] = 'error';
            store.updateJob(job.id, { platformStatus: currentJob.platformStatus });
          }
          return { success: false, platform, message: msg, logs: [] };
        }
      }),
    );

    const allSuccess = results.every(
      (r) => r.status === 'fulfilled' && r.value.success,
    );
    store.updateJob(job.id, {
      status: allSuccess ? 'chrome-open' : 'failed',
    });
    store.appendJobLog(job.id, allSuccess
      ? 'All platforms ready. Please review and publish in browser.'
      : 'Some platforms failed. Check logs for details.');
  };

  runPublishers(); // fire and forget

  res.status(202).json({ jobId: job.id, status: 'running' });
});
