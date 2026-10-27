import type { SqlStore, BlobStore } from "./platform/storage";
export interface Env {
  DB: SqlStore; PHOTOS: BlobStore; BACKUP: BlobStore;
  BASE_PATH: string; SITE_NAME: string; PUBLIC_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string; SETUP_TOKEN?: string; DEVELOPMENT?: string; CLIENT_IP?: string;
}
export interface Identity { id: string; role: "viewer" | "editor" | "owner"; email: string | null; name: string; picture?: string; automationId?: string }

export interface BackgroundTasks { waitUntil(promise: Promise<unknown>): void }
