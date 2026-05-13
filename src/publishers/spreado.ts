import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import type { ContentItem, PublisherResult, Platform } from '../types.js';

const SPREADO_PYTHON = config.spreadoPython || 'D:/Antigravity/.venv/Scripts/python.exe';
const SCRIPTS_DIR = path.resolve('scripts');

async function runCommand(cmd: string, args: string[], timeoutMs = 300000): Promise<{ success: boolean; output: string; error: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ success: false, output: stdout, error: 'Timeout' });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, output: stdout, error: stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: stdout, error: err.message });
    });
  });
}

function log(platform: string, msg: string): string {
  const entry = `[${platform}] ${msg}`;
  console.log(entry);
  return entry;
}

export async function publishWithSpreado(content: ContentItem, platform: Platform): Promise<PublisherResult> {
  const logs: string[] = [];
  const platformName = platform === 'douyin' ? '抖音' : '小红书';

  try {
    logs.push(log(platform, `开始发布到${platformName}...`));

    if (content.contentType === 'video' && content.video) {
      // 视频发布：使用 spreado upload
      logs.push(log(platform, '使用 Spreado 上传视频...'));

      const args = [
        '-m', 'spreado', 'upload', platform,
        '--video', content.video,
        '--title', content.title,
        '--content', content.description,
      ];

      if (content.hashtags.length > 0) {
        args.push('--tags', content.hashtags.join(','));
      }

      const result = await runCommand(SPREADO_PYTHON, args, 600000);

      if (result.success) {
        logs.push(log(platform, '视频上传成功'));
        return { success: true, platform, message: `${platformName}视频发布成功`, logs };
      } else {
        logs.push(log(platform, `视频上传失败: ${result.error || result.output}`));
        return { success: false, platform, message: `视频上传失败: ${result.error}`, logs };
      }

    } else if (content.images.length > 0) {
      // 图文发布：使用自定义 Python 脚本
      logs.push(log(platform, '使用 Spreado 发布图文...'));

      const scriptPath = path.join(SCRIPTS_DIR, 'spreado_publish.py');

      if (!fs.existsSync(scriptPath)) {
        logs.push(log(platform, `脚本不存在: ${scriptPath}`));
        return { success: false, platform, message: '发布脚本不存在', logs };
      }

      const args = [
        scriptPath,
        platform,
        '--images', ...content.images,
        '--title', content.title,
        '--content', content.description,
      ];

      if (content.hashtags.length > 0) {
        args.push('--tags', content.hashtags.join(','));
      }

      const result = await runCommand(SPREADO_PYTHON, args, 600000);

      // 尝试解析 JSON 输出
      try {
        const jsonMatch = result.output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.success) {
            logs.push(log(platform, '图文发布成功'));
            return { success: true, platform, message: `${platformName}图文发布成功`, logs };
          } else {
            logs.push(log(platform, `图文发布失败: ${parsed.error || parsed.message}`));
            return { success: false, platform, message: parsed.error || '发布失败', logs };
          }
        }
      } catch {
        // JSON 解析失败，检查输出
      }

      if (result.success) {
        logs.push(log(platform, '图文发布成功'));
        return { success: true, platform, message: `${platformName}图文发布成功`, logs };
      } else {
        logs.push(log(platform, `图文发布失败: ${result.error || result.output}`));
        return { success: false, platform, message: `图文发布失败: ${result.error}`, logs };
      }

    } else {
      return { success: false, platform, message: '没有可发布的内容', logs };
    }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logs.push(log(platform, `ERROR: ${errorMsg}`));
    return { success: false, platform, message: `发布失败: ${errorMsg}`, logs };
  }
}

// 保留原有的发布函数作为别名
export const publishToDouyin = (content: ContentItem) => publishWithSpreado(content, 'douyin');
export const publishToXiaohongshu = (content: ContentItem) => publishWithSpreado(content, 'xiaohongshu');
