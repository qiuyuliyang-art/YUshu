import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { ContentItem, PublishJob, Platform, PlatformStatus } from '../types.js';

function readJsonFile<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T[];
}

function writeJsonFile<T>(filePath: string, data: T[]): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

const contentFile = () => path.join(config.contentDir, 'content.json');
const jobsFile = () => path.join(config.contentDir, 'jobs.json');

// --- Content ---

export function listContent(): ContentItem[] {
  return readJsonFile<ContentItem>(contentFile());
}

export function getContent(id: string): ContentItem | undefined {
  return listContent().find((c) => c.id === id);
}

export function createContent(data: {
  title: string;
  description: string;
  hashtags?: string[];
  contentType?: string;
}): ContentItem {
  const items = listContent();
  const item: ContentItem = {
    id: randomUUID(),
    title: data.title,
    description: data.description,
    hashtags: data.hashtags || [],
    contentType: (data.contentType as ContentItem['contentType']) || 'image-text',
    images: [],
    publishStatus: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  items.push(item);
  writeJsonFile(contentFile(), items);
  return item;
}

export function updateContent(id: string, data: Partial<ContentItem>): ContentItem | undefined {
  const items = listContent();
  const index = items.findIndex((c) => c.id === id);
  if (index === -1) return undefined;
  const updated = { ...items[index]!, ...data, id, updatedAt: new Date().toISOString() };
  items[index] = updated;
  writeJsonFile(contentFile(), items);
  return updated;
}

export function deleteContent(id: string): boolean {
  const items = listContent();
  const filtered = items.filter((c) => c.id !== id);
  if (filtered.length === items.length) return false;
  writeJsonFile(contentFile(), filtered);
  return true;
}

export function addFilesToContent(id: string, files: string[]): ContentItem | undefined {
  const items = listContent();
  const index = items.findIndex((c) => c.id === id);
  if (index === -1) return undefined;
  items[index]!.images.push(...files);
  items[index]!.updatedAt = new Date().toISOString();
  writeJsonFile(contentFile(), items);
  return items[index];
}

export function setVideoForContent(id: string, videoPath: string): ContentItem | undefined {
  const items = listContent();
  const index = items.findIndex((c) => c.id === id);
  if (index === -1) return undefined;
  items[index]!.video = videoPath;
  items[index]!.updatedAt = new Date().toISOString();
  writeJsonFile(contentFile(), items);
  return items[index];
}

// --- Jobs ---

export function listJobs(): PublishJob[] {
  return readJsonFile<PublishJob>(jobsFile());
}

export function getJob(id: string): PublishJob | undefined {
  return listJobs().find((j) => j.id === id);
}

export function createJob(contentId: string, platforms: Platform[]): PublishJob {
  const jobs = listJobs();
  const platformStatus: Record<Platform, PlatformStatus> = {} as Record<Platform, PlatformStatus>;
  for (const p of platforms) platformStatus[p] = 'pending';

  const job: PublishJob = {
    id: randomUUID(),
    contentId,
    platforms,
    status: 'pending',
    platformStatus,
    logs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.push(job);
  writeJsonFile(jobsFile(), jobs);
  return job;
}

export function updateJob(id: string, data: Partial<PublishJob>): PublishJob | undefined {
  const jobs = listJobs();
  const index = jobs.findIndex((j) => j.id === id);
  if (index === -1) return undefined;
  const updated = { ...jobs[index]!, ...data, id, updatedAt: new Date().toISOString() };
  jobs[index] = updated;
  writeJsonFile(jobsFile(), jobs);
  return updated;
}

export function appendJobLog(id: string, log: string): void {
  const jobs = listJobs();
  const index = jobs.findIndex((j) => j.id === id);
  if (index === -1) return;
  jobs[index]!.logs.push(`[${new Date().toLocaleTimeString()}] ${log}`);
  jobs[index]!.updatedAt = new Date().toISOString();
  writeJsonFile(jobsFile(), jobs);
}
