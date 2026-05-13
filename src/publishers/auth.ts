import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import type { Platform } from '../types.js';

const SPREADO_PYTHON = config.spreadoPython || 'D:/Antigravity/.venv/Scripts/python.exe';
const COOKIES_DIR = path.resolve(config.cookiesDir || './cookies');

function getCookieFile(platform: Platform): string {
  return path.join(COOKIES_DIR, `${platform}_uploader`, 'account.json');
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
  const cookieFile = getCookieFile(platform);

  if (!fs.existsSync(cookieFile)) {
    return {
      platform,
      loggedIn: false,
      cookieValid: false,
      message: 'Cookie 文件不存在，请先登录',
    };
  }

  // 调用 spreado verify 检查 cookie，传入具体 cookie 文件路径
  const result = await runCommand(
    SPREADO_PYTHON,
    ['-m', 'spreado', 'verify', platform, '--cookies', cookieFile],
    30000,
  );

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
  const cookieFile = getCookieFile(platform);

  // 确保 cookies 目录存在
  fs.mkdirSync(path.dirname(cookieFile), { recursive: true });

  // 使用 Spreado 内置 login 命令，传入 --cookies 指定保存路径
  // 进程会保持运行直到用户完成登录（最长等待 300 秒）
  const child = spawn(
    SPREADO_PYTHON,
    ['-m', 'spreado', 'login', platform, '--cookies', cookieFile],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      detached: false,
    },
  );

  // 存储子进程，方便后续可以手动终止
  activeLoginProcesses.set(platform, child);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      stdout += text;
      // 实时输出进度
      for (const line of text.split('\n')) {
        if (line.includes('[INFO]') || line.includes('登录') || line.includes('cookie')) {
          console.log(`[login:${platform}] ${line.trim()}`);
        }
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('close', (code) => {
      activeLoginProcesses.delete(platform);

      // 检查 cookie 文件是否已保存
      if (fs.existsSync(cookieFile)) {
        resolve({
          success: true,
          platform,
          message: `${platformName}登录成功，Cookie 已保存`,
          cookiePath: cookieFile,
        });
        return;
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
          message: `${platformName}登录失败: ${stderr.slice(0, 200) || stdout.slice(0, 200)}`,
        });
      }
    });

    child.on('error', (err) => {
      activeLoginProcesses.delete(platform);
      resolve({
        success: false,
        platform,
        message: `启动失败: ${err.message}`,
      });
    });

    // 5秒后如果还在运行，说明需要用户扫码操作，先返回让用户等待
    setTimeout(() => {
      if (!child.killed) {
        resolve({
          success: false,
          platform,
          message: `请在浏览器中扫码登录${platformName}，登录完成后系统会自动检测`,
        });
      }
    }, 5000);
  });
}

// 跟踪活跃的登录子进程
const activeLoginProcesses = new Map<Platform, ReturnType<typeof spawn>>();

export async function waitForLogin(platform: Platform, timeoutMs = 300000): Promise<AuthResult> {
  const cookieFile = getCookieFile(platform);
  const platformName = platform === 'douyin' ? '抖音' : '小红书';
  const start = Date.now();

  // 轮询检查 cookie 文件是否生成
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(cookieFile)) {
      // cookie 文件已生成，验证其有效性
      const result = await runCommand(
        SPREADO_PYTHON,
        ['-m', 'spreado', 'verify', platform, '--cookies', cookieFile],
        15000,
      );
      if (result.success) {
        return {
          success: true,
          platform,
          message: '登录成功，Cookie 已保存',
          cookiePath: cookieFile,
        };
      }
    }

    // 检查子进程是否还在运行
    const child = activeLoginProcesses.get(platform);
    if (child && child.killed) {
      // 子进程已终止但没有 cookie
      return {
        success: false,
        platform,
        message: `${platformName}登录失败`,
      };
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
