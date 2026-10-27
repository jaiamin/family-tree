// The SQL used by this application is SQLite on both deployments. Only this
// small execution contract varies; domain operations own transactions and SQL.
export interface QueryResult<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult>;
}
export interface SqlStore {
  prepare(sql: string): Statement;
  batch<T = Record<string, unknown>>(statements: Statement[]): Promise<QueryResult<T>[]>;
}
export interface BlobInfo {
  key: string; etag: string; size: number;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string };
}
export interface StoredBlob extends BlobInfo {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  json<T>(): Promise<T>;
}
export interface BlobStore {
  get(key: string): Promise<StoredBlob | null>;
  head(key: string): Promise<BlobInfo | null>;
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: {
    onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
    httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>;
  }): Promise<BlobInfo | null>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{ objects: BlobInfo[]; truncated: boolean; cursor?: string }>;
  delete(key: string): Promise<void>;
}
