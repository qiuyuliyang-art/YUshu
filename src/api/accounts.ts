import { Router } from 'express';
import { openLoginWindow, waitForLogin } from '../publishers/auth.js';
import { checkPlatformLogin } from './platforms.js';
import type { Platform } from '../types.js';
import type { AuthResult } from '../publishers/auth.js';

export const accountsRouter = Router();

// 检查所有平台登录状态
accountsRouter.get('/status', async (_req, res) => {
  const results = await Promise.allSettled([
    checkPlatformLogin('douyin'),
    checkPlatformLogin('xiaohongshu'),
  ]);

  const statuses = results.map((r) =>
    r.status === 'fulfilled' ? r.value : { platform: 'unknown', loggedIn: false, checkedAt: new Date().toISOString() }
  );

  res.json(statuses);
});

// 打开登录窗口
accountsRouter.post('/login', async (req, res) => {
  const { platform } = req.body as { platform?: Platform };

  if (!platform || !['douyin', 'xiaohongshu'].includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform, must be douyin or xiaohongshu' });
  }

  try {
    const result = await openLoginWindow(platform);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// 等待登录完成（轮询）
accountsRouter.get('/login/:platform/wait', async (req, res) => {
  const platform = req.params.platform as Platform;

  if (!['douyin', 'xiaohongshu'].includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }

  try {
    const result = await waitForLogin(platform, 120000);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
