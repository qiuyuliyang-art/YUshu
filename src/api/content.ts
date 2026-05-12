import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import * as store from '../data/store.js';

export const contentRouter = Router();

function getId(req: { params: Record<string, unknown> }): string {
  return String(req.params.id);
}

// File upload setup
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const contentId = getId(req);
      const dir = path.join(config.uploadDir, contentId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

// List all content
contentRouter.get('/', (_req, res) => {
  res.json(store.listContent());
});

// Get single content
contentRouter.get('/:id', (req, res) => {
  const item = store.getContent(getId(req));
  if (!item) return res.status(404).json({ error: 'Content not found' });
  res.json(item);
});

// Create content
contentRouter.post('/', (req, res) => {
  const { title, description, hashtags, contentType } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: 'title and description are required' });
  }
  const item = store.createContent({ title, description, hashtags, contentType });
  res.status(201).json(item);
});

// Update content
contentRouter.put('/:id', (req, res) => {
  const item = store.updateContent(getId(req), req.body);
  if (!item) return res.status(404).json({ error: 'Content not found' });
  res.json(item);
});

// Delete content
contentRouter.delete('/:id', (req, res) => {
  const deleted = store.deleteContent(getId(req));
  if (!deleted) return res.status(404).json({ error: 'Content not found' });
  res.json({ success: true });
});

// Upload files to content
contentRouter.post('/:id/upload', upload.array('files', 20), (req, res) => {
  const id = getId(req);
  const content = store.getContent(id);
  if (!content) return res.status(404).json({ error: 'Content not found' });

  const files = (req.files as Express.Multer.File[]).map((f) => f.path);
  const videoFiles = files.filter((f) => /\.(mp4|mov|avi|webm)$/i.test(f));
  const imageFiles = files.filter((f) => !/\.(mp4|mov|avi|webm)$/i.test(f));

  if (imageFiles.length > 0) {
    store.addFilesToContent(id, imageFiles);
  }
  if (videoFiles.length > 0) {
    store.setVideoForContent(id, videoFiles[0]!);
  }

  const updated = store.getContent(id);
  res.json(updated);
});
