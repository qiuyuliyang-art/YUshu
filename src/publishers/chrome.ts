import { execSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import {
  CdpConnection,
  findChromeExecutable as findChromeExecutableBase,
  findExistingChromeDebugPort as findExistingChromeDebugPortBase,
  getFreePort as getFreePortBase,
  launchChrome as launchChromeBase,
  resolveSharedChromeProfileDir,
  sleep,
  waitForChromeDebugPort,
  type PlatformCandidates,
} from 'baoyu-chrome-cdp';

export { CdpConnection, sleep, waitForChromeDebugPort };

const CHROME_CANDIDATES: PlatformCandidates = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
  default: [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ],
};

let wslHome: string | null | undefined;
function getWslWindowsHome(): string | null {
  if (wslHome !== undefined) return wslHome;
  if (!process.env.WSL_DISTRO_NAME) { wslHome = null; return null; }
  try {
    const raw = execSync('cmd.exe /C "echo %USERPROFILE%"', { encoding: 'utf-8', timeout: 5_000 }).trim().replace(/\r/g, '');
    wslHome = execSync(`wslpath -u "${raw}"`, { encoding: 'utf-8', timeout: 5_000 }).trim() || null;
  } catch { wslHome = null; }
  return wslHome;
}

export interface ChromeSession {
  cdp: CdpConnection;
  sessionId: string;
  targetId: string;
}

export function findChromeExecutable(chromePathOverride?: string): string | undefined {
  if (chromePathOverride?.trim()) return chromePathOverride.trim();
  return findChromeExecutableBase({
    candidates: CHROME_CANDIDATES,
    envNames: ['PUBLISH_PLATFORM_CHROME_PATH'],
  });
}

export function getDefaultProfileDir(): string {
  return resolveSharedChromeProfileDir({
    envNames: ['BAOYU_CHROME_PROFILE_DIR', 'PUBLISH_PLATFORM_CHROME_PROFILE_DIR'],
    wslWindowsHome: getWslWindowsHome(),
  });
}

export async function getFreePort(): Promise<number> {
  return await getFreePortBase('PUBLISH_PLATFORM_DEBUG_PORT');
}

export async function findExistingChromeDebugPort(profileDir?: string): Promise<number | null> {
  return await findExistingChromeDebugPortBase({ profileDir: profileDir ?? getDefaultProfileDir() });
}

export async function launchChrome(url: string, profileDir?: string, chromePathOverride?: string): Promise<number> {
  const chromePath = findChromeExecutable(chromePathOverride);
  if (!chromePath) throw new Error('Chrome not found. Set PUBLISH_PLATFORM_CHROME_PATH env var.');
  const profile = profileDir ?? getDefaultProfileDir();
  const port = await getFreePort();
  console.log(`[chrome] Launching Chrome (profile: ${profile})`);
  await launchChromeBase({
    chromePath,
    profileDir: profile,
    port,
    url,
    extraArgs: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });
  return port;
}

export async function connectToChrome(port: number): Promise<CdpConnection> {
  const wsUrl = await waitForChromeDebugPort(port, 30_000);
  return await CdpConnection.connect(wsUrl, 30_000, { defaultTimeoutMs: 15_000 });
}

export async function getPageSession(cdp: CdpConnection, urlPattern: string): Promise<ChromeSession> {
  const targets = await cdp.send<{ targetInfos: Array<{ targetId: string; url: string; type: string }> }>('Target.getTargets');
  const pageTarget = targets.targetInfos.find((t) => t.type === 'page' && t.url.includes(urlPattern));
  if (!pageTarget) throw new Error(`Page not found: ${urlPattern}`);

  const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: pageTarget.targetId, flatten: true,
  });
  await cdp.send('Page.enable', {}, { sessionId });
  await cdp.send('Runtime.enable', {}, { sessionId });
  await cdp.send('DOM.enable', {}, { sessionId });
  return { cdp, sessionId, targetId: pageTarget.targetId };
}

export async function createPageTab(cdp: CdpConnection, url: string): Promise<ChromeSession> {
  const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url });
  return await getPageSession(cdp, url);
}

export async function evaluate<T = unknown>(session: ChromeSession, expression: string): Promise<T> {
  const result = await session.cdp.send<{ result: { value: T } }>('Runtime.evaluate', {
    expression, returnByValue: true,
  }, { sessionId: session.sessionId });
  return result.result.value;
}

export async function clickElement(session: ChromeSession, selector: string): Promise<void> {
  const position = await session.cdp.send<{ result: { value: string } }>('Runtime.evaluate', {
    expression: `(function() {
      const el = document.querySelector('${selector}');
      if (!el) return 'null';
      el.scrollIntoView({ block: 'center' });
      const rect = el.getBoundingClientRect();
      return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    })()`,
    returnByValue: true,
  }, { sessionId: session.sessionId });

  if (position.result.value === 'null') throw new Error(`Element not found: ${selector}`);
  const pos = JSON.parse(position.result.value) as { x: number; y: number };

  await session.cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1,
  }, { sessionId: session.sessionId });
  await sleep(50);
  await session.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1,
  }, { sessionId: session.sessionId });
}

export async function typeText(session: ChromeSession, text: string): Promise<void> {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > 0) {
      await session.cdp.send('Input.insertText', { text: line }, { sessionId: session.sessionId });
    }
    if (i < lines.length - 1) {
      await session.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      }, { sessionId: session.sessionId });
      await session.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      }, { sessionId: session.sessionId });
    }
    await sleep(30);
  }
}

export async function uploadFiles(session: ChromeSession, fileInputSelector: string, files: string[]): Promise<void> {
  const absolutePaths = files.map((f) => path.resolve(f));

  // Strategy 1: Find file input and use DOM.setFileInputFiles
  const nodeIdResult = await session.cdp.send<{ nodeId: number }>('DOM.querySelector', {
    nodeId: (await session.cdp.send<{ root: { nodeId: number } }>('DOM.getDocument')).root.nodeId,
    selector: fileInputSelector,
  }, { sessionId: session.sessionId });

  if (nodeIdResult.nodeId && nodeIdResult.nodeId !== 0) {
    await session.cdp.send('DOM.setFileInputFiles', {
      nodeId: nodeIdResult.nodeId,
      files: absolutePaths,
    }, { sessionId: session.sessionId });
    return;
  }

  // Strategy 2: Use backendNodeId
  const backendResult = await session.cdp.send<{ backendNodeId: number }>('DOM.describeNode', {
    nodeId: (await session.cdp.send<{ root: { nodeId: number } }>('DOM.getDocument')).root.nodeId,
    selector: fileInputSelector,
  }, { sessionId: session.sessionId }).catch(() => ({ backendNodeId: 0 }));

  if (backendResult.backendNodeId) {
    await session.cdp.send('DOM.setFileInputFiles', {
      backendNodeId: backendResult.backendNodeId,
      files: absolutePaths,
    }, { sessionId: session.sessionId });
    return;
  }

  throw new Error(`File input not found: ${fileInputSelector}`);
}

export async function waitForElement(session: ChromeSession, selector: string, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await evaluate<boolean>(session, `!!document.querySelector('${selector}')`);
    if (found) return true;
    await sleep(1000);
  }
  return false;
}

export async function ensureLoggedIn(session: ChromeSession, loginCheckJs: string, timeoutMs = 120_000): Promise<void> {
  const isLoggedIn = await evaluate<boolean>(session, loginCheckJs);
  if (isLoggedIn) return;

  console.log('[chrome] Not logged in. Waiting for user to log in...');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(3000);
    const loggedIn = await evaluate<boolean>(session, loginCheckJs);
    if (loggedIn) {
      console.log('[chrome] Login detected.');
      return;
    }
  }
  throw new Error('Login timeout. Please log in first and try again.');
}
