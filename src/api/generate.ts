import { Router } from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as store from '../data/store.js';
import { config } from '../config.js';
import type { GenerateRequest } from '../types.js';

export const generateRouter = Router();

const BAOYU_IMAGINE_SCRIPT = path.resolve(
  'D:/Claude/.claude/recursing-gates-0a81bd/.agents/skills/baoyu-imagine/scripts/main.ts'
);

function getBunCmd(): string[] {
  try {
    const { execSync } = require('node:child_process');
    execSync('bun --version', { stdio: 'ignore' });
    return ['bun'];
  } catch {
    return ['npx', '-y', 'bun'];
  }
}

function buildPrompt(topic: string, style: string, index: number, total: number): string {
  const styleDesc: Record<string, string> = {
    cute: 'sweet adorable girly aesthetic, soft pink colors, hand-drawn illustration',
    fresh: 'clean refreshing natural, green and blue tones, minimalist',
    warm: 'cozy friendly approachable, warm orange and brown tones',
    bold: 'high impact attention-grabbing, strong contrast, vibrant',
    minimal: 'ultra-clean sophisticated, black white gray, elegant typography',
    notion: 'minimalist hand-drawn line art, intellectual, clean lines',
    'sketch-notes': 'hand-drawn educational infographic, macaron pastels, wobble lines',
  };

  const styleText = styleDesc[style] || styleDesc.cute!;

  if (index === 0) {
    return `A ${styleText} cover illustration for "${topic}". Title text in Chinese: ${topic}. Portrait 3:4 ratio, eye-catching social media card.`;
  }
  if (index === total - 1) {
    return `A ${styleText} ending card for "${topic}". Call to action text, follow for more. Portrait 3:4 ratio.`;
  }
  return `A ${styleText} content card about "${topic}", part ${index + 1} of ${total}. Key information point. Portrait 3:4 ratio.`;
}

generateRouter.post('/', async (req, res) => {
  const { contentId, topic, style = 'cute', imageCount = 4 } = req.body as GenerateRequest & { imageCount?: number };

  if (!contentId) return res.status(400).json({ error: 'contentId is required' });
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  const content = store.getContent(contentId);
  if (!content) return res.status(404).json({ error: 'Content not found' });

  // Update status to generating
  store.updateContent(contentId, { generateStatus: 'generating' });

  const taskId = randomUUID();
  store.updateContent(contentId, { generateTaskId: taskId });

  const uploadDir = path.join(config.uploadDir, contentId);
  fs.mkdirSync(uploadDir, { recursive: true });

  // Run generation in background
  const runGeneration = async () => {
    const bunCmd = getBunCmd();
    const generatedFiles: string[] = [];

    for (let i = 0; i < imageCount; i++) {
      const prompt = buildPrompt(topic, style, i, imageCount);
      const outputFile = path.join(uploadDir, `${String(i + 1).padStart(2, '0')}-generated.png`);

      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(bunCmd[0]!, [...bunCmd.slice(1), BAOYU_IMAGINE_SCRIPT, '--prompt', prompt, '--image', outputFile], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: path.dirname(BAOYU_IMAGINE_SCRIPT),
          });

          let stderr = '';
          child.stderr?.on('data', (chunk) => { stderr += chunk; });

          child.on('close', (code) => {
            if (code === 0 && fs.existsSync(outputFile)) {
              generatedFiles.push(outputFile);
              resolve();
            } else {
              reject(new Error(`Generation failed for image ${i + 1}: ${stderr}`));
            }
          });

          child.on('error', reject);
        });
      } catch (err) {
        console.error(`[generate] Image ${i + 1} failed:`, err);
      }
    }

    if (generatedFiles.length > 0) {
      store.addFilesToContent(contentId, generatedFiles);
      store.updateContent(contentId, { generateStatus: 'done' });
      // Auto-fill title if empty
      if (!content.title || content.title === '新内容') {
        store.updateContent(contentId, { title: topic });
      }
    } else {
      store.updateContent(contentId, { generateStatus: 'error' });
    }
  };

  runGeneration(); // fire and forget

  res.status(202).json({ taskId, status: 'generating' });
});

// Check generation status
generateRouter.get('/status/:contentId', (req, res) => {
  const content = store.getContent(req.params.contentId);
  if (!content) return res.status(404).json({ error: 'Content not found' });
  res.json({
    status: content.generateStatus || 'idle',
    imageCount: content.images.length,
  });
});
