import path from 'node:path';
import fs from 'node:fs';
import {
  CdpConnection,
  sleep,
  launchChrome,
  connectToChrome,
  findExistingChromeDebugPort,
  getDefaultProfileDir,
  evaluate,
  type ChromeSession,
} from './chrome.js';
import type { Platform } from '../types.js';

const PLATFORM_CONFIG: Record<Platform, { loginUrl: string; homeUrl: string; loginCheck: string; qrSelector: string; successSelector: string }> = {
  douyin: {
    loginUrl: 'https://creator.douyin.com/',
    homeUrl: 'https://creator.douyin.com/creator-micro/home',
    loginCheck: `!window.location.href.includes('login') && !window.location.href.includes('passport') && !!document.querySelector('[class*="home"]') || !!document.querySelector('[class*="user"]')`,
    qrSelector: 'img[src*="qrcode"], [class*="qrcode"], canvas[class*="qr"], [class*="scan"]',
    successSelector: '[class*="user-name"], [class*="nickname"], [class*="avatar"]',
  },
  xiaohongshu: {
    loginUrl: 'https://creator.xiaohongshu.com/',
    homeUrl: 'https://creator.xiaohongshu.com/publish/publish',
    loginCheck: `!window.location.href.includes('login') && !window.location.href.includes('passport') && !!document.querySelector('[class*="publish"]') || !!document.querySelector('[class*="upload"]')`,
    qrSelector: 'img[src*="qrcode"], [class*="qrcode"], canvas[class*="qr"], [class*="scan"]',
    successSelector: '[class*="user-name"], [class*="nickname"], [class*="avatar"]',
  },
};

export interface AuthResult {
  success: boolean;
  platform: Platform;
  message: string;
  username?: string;
}

export async function openLoginWindow(platform: Platform): Promise<AuthResult> {
  const config = PLATFORM_CONFIG[platform];
  const profileDir = getDefaultProfileDir();

  fs.mkdirSync(profileDir, { recursive: true });

  const existingPort = await findExistingChromeDebugPort(profileDir);
  let cdp: CdpConnection;

  if (existingPort) {
    cdp = await connectToChrome(existingPort);
  } else {
    const port = await launchChrome(config.loginUrl, profileDir);
    cdp = await connectToChrome(port);
  }

  // 创建新标签页打开登录页
  const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: config.loginUrl });
  const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, { sessionId });
  await cdp.send('Runtime.enable', {}, { sessionId });

  await sleep(3000);

  // 检查是否已经登录
  const alreadyLoggedIn = await evaluate<boolean>({ cdp, sessionId, targetId }, config.loginCheck);

  if (alreadyLoggedIn) {
    return { success: true, platform, message: '已登录' };
  }

  // 等待二维码出现，提示用户扫码
  const qrFound = await waitForElement({ cdp, sessionId, targetId }, config.qrSelector, 10000);

  return {
    success: false,
    platform,
    message: qrFound
      ? '请在浏览器中扫码登录'
      : '请在浏览器中完成登录',
  };
}

export async function waitForLogin(platform: Platform, timeoutMs = 180000): Promise<AuthResult> {
  const config = PLATFORM_CONFIG[platform];
  const profileDir = getDefaultProfileDir();

  const existingPort = await findExistingChromeDebugPort(profileDir);
  if (!existingPort) {
    return { success: false, platform, message: 'Chrome 未启动，请先调用 openLoginWindow' };
  }

  const cdp = await connectToChrome(existingPort);

  try {
    const targets = await cdp.send<{ targetInfos: Array<{ targetId: string; url: string; type: string }> }>('Target.getTargets');
    const page = targets.targetInfos.find((t) => t.type === 'page' && t.url.includes(platform === 'douyin' ? 'douyin.com' : 'xiaohongshu.com'));

    if (!page) {
      return { success: false, platform, message: '未找到登录页面' };
    }

    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    await cdp.send('Page.enable', {}, { sessionId });
    await cdp.send('Runtime.enable', {}, { sessionId });

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const loggedIn = await evaluate<boolean>({ cdp, sessionId, targetId: page.targetId }, config.loginCheck);

      if (loggedIn) {
        // 尝试获取用户名
        let username = '';
        try {
          username = await evaluate<string>({ cdp, sessionId, targetId: page.targetId }, config.successSelector);
        } catch {}

        return {
          success: true,
          platform,
          message: '登录成功',
          username: username || undefined,
        };
      }

      await sleep(2000);
    }

    return { success: false, platform, message: '登录超时' };
  } finally {
    cdp.close();
  }
}

async function waitForElement(session: ChromeSession, selector: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await evaluate<boolean>(session, `!!document.querySelector('${selector}')`);
    if (found) return true;
    await sleep(500);
  }
  return false;
}
