import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import type { Platform } from '../types.js';

const SPREADO_PYTHON = config.spreadoPython || 'D:/Antigravity/.venv/Scripts/python.exe';
const COOKIES_DIR = path.resolve(config.cookiesDir || './cookies');

function getSpreadoArgs(platform: string, extraArgs: string[] = []): string[] {
  return ['-m', 'spreado', ...extraArgs, platform];
}

export interface AuthResult {
  success: boolean;
  platform: Platform;
  message: string;
  username?: string;
}

export interface PlatformLoginStatus {
  platform: Platform;
  loggedIn: boolean;
  cookieValid: boolean;
  message: string;
}

async function runSpreadoCommand(args: string[], timeoutMs = 180000): Promise<{ success: boolean; output: string; error: string }> {
  return new Promise((resolve) => {
    const child = spawn(SPREADO_PYTHON, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: COOKIES_DIR,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
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
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: stdout, error: err.message });
    });
  });
}

export async function checkPlatformLogin(platform: Platform): Promise<PlatformLoginStatus> {
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
  const result = await runSpreadoCommand(getSpreadoArgs(platform, ['verify']), 30000);

  if (result.success && result.output.includes('有效')) {
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

  // 确保 cookies 目录存在
  fs.mkdirSync(COOKIES_DIR, { recursive: true });

  // 启动 spreado login（打开浏览器窗口，异步等待）
  const child = spawn(SPREADO_PYTHON, getSpreadoArgs(platform, ['login']), {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: COOKIES_DIR,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
    detached: false,
  });

  // 等待3秒看是否快速完成（已有cookie）或需要用户交互
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });

    // 3秒后如果还在运行，说明需要用户扫码
    const quickCheck = setTimeout(() => {
      // 进程仍在运行 → 等待用户扫码
      resolve({
        success: false,
        platform,
        message: `请在浏览器中扫码登录${platformName}`,
      });
    }, 3000);

    child.on('close', (code) => {
      clearTimeout(quickCheck);
      if (code === 0 && stdout.includes('成功')) {
        resolve({
          success: true,
          platform,
          message: `${platformName}登录成功`,
        });
      } else if (code === 0) {
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

export async function waitForLogin(platform: Platform, timeoutMs = 180000): Promise<AuthResult> {
  const cookieFile = path.join(COOKIES_DIR, `${platform}_uploader`, 'account.json');
  const start = Date.now();

  // 轮询检查 cookie 文件是否生成
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(cookieFile)) {
      // 验证 cookie
      const verifyResult = await runSpreadoCommand(getSpreadoArgs(platform, ['verify']), 15000);
      if (verifyResult.success) {
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
