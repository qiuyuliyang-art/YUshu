export type ContentType = 'image-text' | 'video' | 'carousel';
export type Platform = 'douyin' | 'xiaohongshu';
export type JobStatus = 'pending' | 'running' | 'chrome-open' | 'completed' | 'failed';
export type PlatformStatus = 'pending' | 'filling' | 'ready' | 'failed' | 'error';

export interface ContentItem {
  id: string;
  title: string;
  description: string;
  hashtags: string[];
  contentType: ContentType;
  images: string[];
  video?: string;
  publishStatus: Partial<Record<Platform, 'published' | 'pending'>>;
  generateStatus?: 'idle' | 'generating' | 'done' | 'error';
  generateTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishJob {
  id: string;
  contentId: string;
  platforms: Platform[];
  status: JobStatus;
  platformStatus: Record<Platform, PlatformStatus>;
  logs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateContentRequest {
  title: string;
  description: string;
  hashtags?: string[];
  contentType?: ContentType;
}

export interface UpdateContentRequest {
  title?: string;
  description?: string;
  hashtags?: string[];
  contentType?: ContentType;
}

export interface PublishRequest {
  contentId: string;
  platforms: Platform[];
}

export interface PublisherResult {
  success: boolean;
  platform: Platform;
  message: string;
  logs: string[];
}

export interface GenerateRequest {
  contentId: string;
  topic: string;
  style?: string;
  layout?: string;
  imageCount?: number;
}

export interface PlatformAccountStatus {
  platform: Platform;
  loggedIn: boolean;
  username?: string;
  checkedAt: string;
}
