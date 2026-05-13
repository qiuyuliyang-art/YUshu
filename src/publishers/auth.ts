import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import type { Platform } from '../types.js';

const SPREADO_PYTHON = config.spreadoPython || 'D:/Antigravity/.venv/Scripts/python.exe';
const COOKIES_DIR = path.resolve(config.cookiesDir || './cookies');
const SCRIPTS_DIR = path.resolve('scripts');

function getSpreadoArgs(platform: string, extraArgs: string[] = []): string[] {
  return ['-m', 'spreado', ...extraArgs, platform];
}

export interface AuthResult {
  success: boolean;
  platform: Platform;
  message: string;
  username?: string;
  cookiePath?: string;
}

export interface PlatformLoginStatus {
  platform: Platform;
  loggedIn: boolean;
  cookieValid: boolean;
  message: string;
}

async function runCommand(cmd: string, args: string[], timeoutMs = 180000): Promise<{ success: boolean; output: string; error: string }> {
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

export async function checkPlatformLogin(platform: Platform): Promise<PlatformLoginStatus> {
  // Spreado cookie 文件路径: cookies/{platform}_uploader/account.json
  const cookieFile = path.join(COOKIES_DIR, `${platform}_uploader`, 'account.json');

  if (!fs.existsSync(cookieFile)) {
    return {
      platform,
      loggedIn: false,
      cookieValid: false,
      message: 'Cookie 文件不存在，请先登录',
    };
  }

  // 调用 spreado verify 检查 cookie
  const result = await runCommand(SPREADO_PYTHON, getSpreadoArgs(platform, ['verify']), 30000);

  if (result.success) {
    return {
      platform,
      loggedIn: true,
      cookieValid: true,
      message: 'Cookie 有效',
    };
  }

  return {
    platform,
    loggedIn: false,
    cookieValid: false,
    message: 'Cookie 已过期或无效',
  };
}

export async function startLogin(platform: Platform): Promise<AuthResult> {
  const platformName = platform === 'douyin' ? '抖音' : '小红书';
  const loginScript = path.join(SCRIPTS_DIR, 'spreado_login.py');

  // 确保 cookies 目录存在
  fs.mkdirSync(COOKIES_DIR, { recursive: true });

  // 使用改进的登录脚本
  const child = spawn(SPREADO_PYTHON, [loginScript, platform, '--timeout', '300'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
    detached: false,
  });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
      // 实时输出进度
      const lines = chunk.toString('utf-8').split('\n');
      for (const line of lines) {
        if (line.includes('[INFO]')) {
          console.log(line);
        }
      }
    });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });

    // 5秒后如果还在运行，说明需要用户扫码
    const quickCheck = setTimeout(() => {
      resolve({
        success: false,
        platform,
        message: `请在浏览器中扫码登录${platformName}，登录完成后系统会自动检测`,
      });
    }, 5000);

    child.on('close', (code) => {
      clearTimeout(quickCheck);

      // 尝试解析 JSON 输出
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          if (result.success) {
            resolve({
              success: true,
              platform,
              message: result.message || `${platformName}登录成功`,
              cookiePath: result.cookie_path,
            });
            return;
          } else {
            resolve({
              success: false,
              platform,
              message: result.error || `${platformName}登录失败`,
            });
            return;
          }
        }
      } catch {
        // JSON 解析失败
      }

      if (code === 0) {
        resolve({
          success: true,
          platform,
          message: `${platformName}登录流程完成`,
        });
      } else {
        resolve({
          success: false,
          platform,
          message: `${platformName}登录失败: ${stderr || stdout}`,
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(quickCheck);
      resolve({
        success: false,
        platform,
        message: `启动失败: ${err.message}`,
      });
    });
  });
}

export async function waitForLogin(platform: Platform, timeoutMs = 300000): Promise<AuthResult> {
  const cookieFile = path.join(COOKIES_DIR, `${platform}_uploader`, 'account.json');
  const start = Date.now();

  // 轮询检查 cookie 文件是否生成
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(cookieFile)) {
      // 验证 cookie
      const result = await runCommand(SPREADO_PYTHON, getSpreadoArgs(platform, ['verify']), 15000);
      if (result.success) {
        return {
          success: true,
          platform,
          message: '登录成功，Cookie 已保存',
        };
      }
    }

    // 等待2秒再检查
    await new Promise((r) => setTimeout(r, 2000));
  }

  return {
    success: false,
    platform,
    message: '登录超时',
  };
}
