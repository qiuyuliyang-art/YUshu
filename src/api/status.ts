import { Router } from 'express';
import * as store from '../data/store.js';

export const statusRouter = Router();

// Get job status
statusRouter.get('/status/:jobId', (req, res) => {
  const job = store.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// List all jobs
statusRouter.get('/jobs', (_req, res) => {
  res.json(store.listJobs());
});
