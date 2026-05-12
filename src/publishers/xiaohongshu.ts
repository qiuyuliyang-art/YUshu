import path from 'node:path';
import {
  CdpConnection,
  sleep,
  launchChrome,
  connectToChrome,
  findExistingChromeDebugPort,
  getPageSession,
  evaluate,
  clickElement,
  typeText,
  uploadFiles,
  waitForElement,
  ensureLoggedIn,
  type ChromeSession,
} from './chrome.js';
import type { ContentItem, PublisherResult, Platform } from '../types.js';
import { config } from '../config.js';

const PLATFORM: Platform = 'xiaohongshu';
const CREATOR_URL = 'https://creator.xiaohongshu.com';
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';

function log(msg: string): string {
  const entry = `[xhs] ${msg}`;
  console.log(entry);
  return entry;
}

export async function publishToXiaohongshu(content: ContentItem): Promise<PublisherResult> {
  const logs: string[] = [];

  try {
    logs.push(log('Starting Xiaohongshu publisher...'));

    const profileDir = config.chromeProfileDir || undefined;

    // Launch or reuse Chrome
    let cdp: CdpConnection;
    const existingPort = await findExistingChromeDebugPort(profileDir);
    if (existingPort) {
      logs.push(log(`Found existing Chrome on port ${existingPort}`));
      cdp = await connectToChrome(existingPort);
    } else {
      const port = await launchChrome(CREATOR_URL, profileDir, config.chromePath || undefined);
      cdp = await connectToChrome(port);
    }

    // Create a new tab for publishing
    logs.push(log('Opening publish page...'));
    const session = await (async (): Promise<ChromeSession> => {
      const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: PUBLISH_URL });
      await sleep(3000);
      return await getPageSession(cdp, PUBLISH_URL);
    })();

    // Wait for login
    await ensureLoggedIn(session,
      `!!document.querySelector('[class*="publish"]') || !!document.querySelector('[class*="upload"]')`,
      120_000,
    );
    logs.push(log('Logged in successfully'));

    // Wait for publish page to load
    await sleep(2000);

    // --- Upload images ---
    if (content.images.length > 0) {
      logs.push(log(`Uploading ${content.images.length} image(s)...`));

      // XHS uses a file input in the upload area
      const fileInputSelectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"]',
        '.upload-input input[type="file"]',
        '[class*="upload"] input[type="file"]',
      ];

      let uploaded = false;
      for (const selector of fileInputSelectors) {
        try {
          await uploadFiles(session, selector, content.images);
          uploaded = true;
          logs.push(log(`Images uploaded via selector: ${selector}`));
          break;
        } catch {
          // Try next selector
        }
      }

      if (!uploaded) {
        logs.push(log('WARNING: Could not find file input. Please upload images manually.'));
      }

      // Wait for upload to complete
      await sleep(5000);
      logs.push(log('Waiting for image upload processing...'));
    }

    // --- Upload video ---
    if (content.video) {
      logs.push(log('Uploading video...'));
      const videoSelectors = [
        'input[type="file"][accept*="video"]',
        'input[type="file"]',
      ];
      for (const selector of videoSelectors) {
        try {
          await uploadFiles(session, selector, [content.video]);
          logs.push(log('Video uploaded'));
          break;
        } catch {
          // Try next
        }
      }
      await sleep(5000);
    }

    // --- Fill title ---
    if (content.title) {
      logs.push(log(`Filling title: ${content.title.slice(0, 30)}...`));
      const titleSelectors = [
        '#title-textarea',
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        '[class*="title"] input',
        '[class*="title"] textarea',
      ];
      let titleFilled = false;
      for (const selector of titleSelectors) {
        try {
          await clickElement(session, selector);
          await sleep(300);
          await typeText(session, content.title.slice(0, 20));
          titleFilled = true;
          logs.push(log('Title filled'));
          break;
        } catch {
          // Try next
        }
      }
      if (!titleFilled) logs.push(log('WARNING: Could not find title input'));
    }

    // --- Fill description ---
    if (content.description) {
      logs.push(log('Filling description...'));
      const descSelectors = [
        '#post-textarea',
        'div[contenteditable="true"]',
        'textarea[placeholder*="正文"]',
        '[class*="content"] [contenteditable="true"]',
        '[class*="desc"] textarea',
      ];
      let descFilled = false;
      for (const selector of descSelectors) {
        try {
          await clickElement(session, selector);
          await sleep(300);
          // Build description with hashtags
          let fullText = content.description;
          if (content.hashtags.length > 0) {
            fullText += '\n\n' + content.hashtags.map((t) => `#${t}`).join(' ');
          }
          await typeText(session, fullText);
          descFilled = true;
          logs.push(log('Description filled'));
          break;
        } catch {
          // Try next
        }
      }
      if (!descFilled) logs.push(log('WARNING: Could not find description input'));
    }

    logs.push(log('Content filled. Please review and click Publish in the browser.'));

    return {
      success: true,
      platform: PLATFORM,
      message: 'Content filled in Xiaohongshu creator portal. Please review and publish manually.',
      logs,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logs.push(log(`ERROR: ${errorMsg}`));
    return {
      success: false,
      platform: PLATFORM,
      message: `Failed: ${errorMsg}`,
      logs,
    };
  }
}
