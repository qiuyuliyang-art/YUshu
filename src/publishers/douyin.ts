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

const PLATFORM: Platform = 'douyin';
const CREATOR_URL = 'https://creator.douyin.com';
const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';

function log(msg: string): string {
  const entry = `[douyin] ${msg}`;
  console.log(entry);
  return entry;
}

export async function publishToDouyin(content: ContentItem): Promise<PublisherResult> {
  const logs: string[] = [];

  try {
    logs.push(log('Starting Douyin publisher...'));

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

    // Create a new tab for content upload
    logs.push(log('Opening content upload page...'));
    const session = await (async (): Promise<ChromeSession> => {
      const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: UPLOAD_URL });
      await sleep(3000);
      return await getPageSession(cdp, UPLOAD_URL);
    })();

    // Wait for login
    await ensureLoggedIn(session,
      `!!document.querySelector('[class*="upload"]') || !!document.querySelector('[class*="content-manager"]')`,
      120_000,
    );
    logs.push(log('Logged in successfully'));

    await sleep(2000);

    // --- Navigate to correct content type ---
    if (content.contentType === 'image-text' || content.contentType === 'carousel') {
      // Click on "图文" tab if available
      try {
        const hasImageTab = await evaluate<boolean>(session,
          `!!Array.from(document.querySelectorAll('div, span, button')).find(el => el.textContent.trim() === '图文')`
        );
        if (hasImageTab) {
          await evaluate(session,
            `Array.from(document.querySelectorAll('div, span, button')).find(el => el.textContent.trim() === '图文').click()`
          );
          await sleep(2000);
          logs.push(log('Switched to image-text mode'));
        }
      } catch {
        // Already on image upload page
      }
    }

    // --- Upload images ---
    if (content.images.length > 0) {
      logs.push(log(`Uploading ${content.images.length} image(s)...`));

      const fileInputSelectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="jpeg"]',
        'input[type="file"]',
        '.semi-upload input[type="file"]',
        '[class*="upload"] input[type="file"]',
      ];

      let uploaded = false;
      for (const selector of fileInputSelectors) {
        try {
          await uploadFiles(session, selector, content.images);
          uploaded = true;
          logs.push(log(`Images uploaded via: ${selector}`));
          break;
        } catch {
          // Try next
        }
      }

      if (!uploaded) {
        logs.push(log('WARNING: Could not find file input. Please upload images manually.'));
      }

      await sleep(5000);
      logs.push(log('Waiting for image processing...'));
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
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        '[class*="title"] input',
        '[class*="title"] textarea',
        '.title-input input',
      ];
      let titleFilled = false;
      for (const selector of titleSelectors) {
        try {
          await clickElement(session, selector);
          await sleep(300);
          await typeText(session, content.title);
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
        'div[contenteditable="true"]',
        'textarea[placeholder*="描述"]',
        'textarea[placeholder*="正文"]',
        '[class*="editor"] [contenteditable="true"]',
        '[class*="content"] textarea',
      ];
      let descFilled = false;
      for (const selector of descSelectors) {
        try {
          await clickElement(session, selector);
          await sleep(300);
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
      message: 'Content filled in Douyin creator portal. Please review and publish manually.',
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
