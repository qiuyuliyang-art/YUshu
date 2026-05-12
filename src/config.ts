import fs from 'node:fs';
import path from 'node:path';

function loadEnv(): Record<string, string> {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return env;
}

const env = loadEnv();

export const config = {
  port: parseInt(env.PORT || process.env.PORT || '3456', 10),
  chromeProfileDir: env.CHROME_PROFILE_DIR || process.env.CHROME_PROFILE_DIR || '',
  chromePath: env.CHROME_PATH || process.env.CHROME_PATH || '',
  contentDir: path.resolve(env.CONTENT_DIR || process.env.CONTENT_DIR || './data/content'),
  uploadDir: path.resolve(env.UPLOAD_DIR || process.env.UPLOAD_DIR || './data/uploads'),
};

// Ensure directories exist
fs.mkdirSync(config.contentDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
