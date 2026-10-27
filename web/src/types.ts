export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  BACKUP: R2Bucket;
  BASE_PATH: string;
  SITE_NAME: string;
  PUBLIC_ORIGIN?: string;
  OWNER_EMAIL: string;
  GOOGLE_CLIENT_ID?: string;
  FAMILY_PASSWORD?: string;
  MCP_TOKEN?: string;
  LOCAL_MODE?: string;
}
export interface Identity { role: "member" | "editor" | "owner"; email: string | null; name?: string; picture?: string }
