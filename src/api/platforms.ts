import { Router } from 'express';
import { findExistingChromeDebugPort, connectToChrome, evaluate, getDefaultProfileDir } from '../publishers/chrome.js';
import type { PlatformAccountStatus, Platform } from '../types.js';

export const platformsRouter = Router();

const PLATFORM_URLS: Record<Platform, { url: string; loginCheck: string; usernameCheck: string }> = {
  douyin: {
    url: 'creator.douyin.com',
    loginCheck: `!window.location.href.includes('login') && !window.location.href.includes('passport')`,
    usernameCheck: `document.querySelector('[class*="user-name"]')?.textContent?.trim() || document.querySelector('[class*="nickname"]')?.textContent?.trim() || ''`,
  },
  xiaohongshu: {
    url: 'creator.xiaohongshu.com',
    loginCheck: `!window.location.href.includes('login') && !window.location.href.includes('passport')`,
    usernameCheck: `document.querySelector('[class*="user-name"]')?.textContent?.trim() || document.querySelector('[class*="nickname"]')?.textContent?.trim() || ''`,
  },
};

export async function checkPlatformLogin(platform: Platform): Promise<PlatformAccountStatus> {
  const config = PLATFORM_URLS[platform];
  try {
    const port = await findExistingChromeDebugPort();
    if (!port) {
      return { platform, loggedIn: false, checkedAt: new Date().toISOString() };
    }

    const cdp = await connectToChrome(port);
    try {
      const targets = await cdp.send<{ targetInfos: Array<{ targetId: string; url: string; type: string }> }>('Target.getTargets');
      const page = targets.targetInfos.find((t) => t.type === 'page' && t.url.includes(config.url));

      if (!page) {
        return { platform, loggedIn: false, checkedAt: new Date().toISOString() };
      }

      const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
        targetId: page.targetId, flatten: true,
      });

      const loggedIn = await evaluate<boolean>(
        { cdp, sessionId, targetId: page.targetId },
        config.loginCheck,
      );

      let username = '';
      if (loggedIn) {
        try {
          username = await evaluate<string>(
            { cdp, sessionId, targetId: page.targetId },
            config.usernameCheck,
          );
        } catch {
          // ignore
        }
      }

      return {
        platform,
        loggedIn,
        username: username || undefined,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      cdp.close();
    }
  } catch {
    return { platform, loggedIn: false, checkedAt: new Date().toISOString() };
  }
}

// Check all platforms
platformsRouter.get('/status', async (_req, res) => {
  const results = await Promise.allSettled([
    checkPlatformLogin('douyin'),
    checkPlatformLogin('xiaohongshu'),
  ]);

  const statuses = results.map((r) =>
    r.status === 'fulfilled' ? r.value : { platform: 'unknown', loggedIn: false, checkedAt: new Date().toISOString() }
  );

  res.json(statuses);
});

// Check single platform
platformsRouter.get('/status/:platform', async (req, res) => {
  const platform = req.params.platform as Platform;
  if (!PLATFORM_URLS[platform]) {
    return res.status(400).json({ error: 'Invalid platform' });
  }
  const status = await checkPlatformLogin(platform);
  res.json(status);
});
