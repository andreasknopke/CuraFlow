// ---------------------------------------------------------------------------
// API layer types — request/response shapes for the client.
// ---------------------------------------------------------------------------

/** Standard API error response */
export interface ApiError {
  error: string;
  databaseError?: boolean;
  retryable?: boolean;
  code?: string | null;
  details?: string;
  stack?: string;
}

/** Generic DB proxy response (used by the table-based API) */
export interface DbListResponse<T> {
  data: T[];
  total?: number;
}

/** Generic mutation response */
export interface MutationResponse {
  success: boolean;
  message?: string;
  id?: string;
}

/** Health check response */
export interface HealthResponse {
  status: 'ok';
  timestamp: string;
  environment: string;
  version: string;
}

/** Request options for the API client */
export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  signal?: AbortSignal;
  skipAuth?: boolean;
}
