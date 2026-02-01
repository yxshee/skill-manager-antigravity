/**
 * GitHub repository data model
 */
export interface Repository {
  /** Repository owner */
  owner: string;
  /** Repository name */
  name: string;
  /** Full repository path (owner/name) */
  fullName: string;
  /** Repository description */
  description?: string;
  /** Default branch */
  defaultBranch: string;
  /** Last update timestamp */
  updatedAt?: Date;
}

/**
 * GitHub tree node (file or directory)
 */
export interface TreeNode {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

/**
 * Repository tree response
 */
export interface RepositoryTree {
  sha: string;
  url: string;
  tree: TreeNode[];
  truncated: boolean;
}

/**
 * File content response from GitHub API
 */
export interface FileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string;
  encoding: 'base64' | 'utf-8';
  downloadUrl: string;
}

/**
 * Rate limit information
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}
