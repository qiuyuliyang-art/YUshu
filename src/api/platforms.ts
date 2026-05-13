import { Router } from 'express';
import { checkPlatformLogin } from '../publishers/auth.js';
import type { Platform } from '../types.js';

export { checkPlatformLogin };

export const platformsRouter = Router();

// Check all platforms
platformsRouter.get('/status', async (_req, res) => {
  const results = await Promise.allSettled([
    checkPlatformLogin('douyin'),
    checkPlatformLogin('xiaohongshu'),
  ]);

  const statuses = results.map((r) =>
    r.status === 'fulfilled' ? r.value : { platform: 'unknown', loggedIn: false, cookieValid: false, message: '检测失败' }
  );

  res.json(statuses);
});

// Check single platform
platformsRouter.get('/status/:platform', async (req, res) => {
  const platform = req.params.platform as Platform;
  if (!['douyin', 'xiaohongshu'].includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }
  const status = await checkPlatformLogin(platform);
  res.json(status);
});
