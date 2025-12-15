export interface ThreadInfo {
  /** Backend that created this thread */
  backend: string;
  /** Thread/session ID from the backend */
  threadId: string;
  /** When the thread was created */
  createdAt: string;
  /** When the thread was last used */
  lastUsedAt: string;
}
