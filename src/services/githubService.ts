import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { RepositoryTree, TreeNode, FileContent, RateLimitInfo } from '../models/repository';
import { Skill, SkillFile } from '../models/skill';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Cache entry with expiration
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  etag?: string;
}

/**
 * Service for interacting with GitHub API to fetch skills from repositories
 */
export class GitHubService {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private rateLimitInfo?: RateLimitInfo;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Get configuration values
   */
  private getConfig() {
    const config = vscode.workspace.getConfiguration('skillManager');
    return {
      token: config.get<string>('githubToken', ''),
      cacheExpiry: config.get<number>('cacheExpiry', 3600) * 1000, // Convert to ms
      repositories: config.get<string[]>('repositories', [
        'rominirani/antigravity-skills',
        'sickn33/antigravity-awesome-skills'
      ])
    };
  }

  /**
   * Build headers for GitHub API requests
   */
  private getHeaders(etag?: string): Record<string, string> {
    const { token } = this.getConfig();
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Skill-Manager-VSCode-Extension'
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (etag) {
      headers['If-None-Match'] = etag;
    }
    
    return headers;
  }

  /**
   * Update rate limit info from response headers
   */
  private updateRateLimit(headers: Headers): void {
    const limit = headers.get('x-ratelimit-limit');
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');
    
    if (limit && remaining && reset) {
      this.rateLimitInfo = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        reset: new Date(parseInt(reset, 10) * 1000)
      };
    }
  }

  /**
   * Get current rate limit status
   */
  public getRateLimitInfo(): RateLimitInfo | undefined {
    return this.rateLimitInfo;
  }

  /**
   * Fetch data from cache or API
   */
  private async fetchWithCache<T>(
    url: string,
    cacheKey: string
  ): Promise<T> {
    const { cacheExpiry } = this.getConfig();
    const cached = this.cache.get(cacheKey) as CacheEntry<T> | undefined;
    
    // Return cached data if not expired
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // Make request with conditional headers
    const response = await fetch(url, {
      headers: this.getHeaders(cached?.etag)
    });
    
    this.updateRateLimit(response.headers as any);
    
    // Handle 304 Not Modified
    if (response.status === 304 && cached) {
      cached.expiresAt = Date.now() + cacheExpiry;
      return cached.data;
    }
    
    if (!response.ok) {
      if (response.status === 403 && this.rateLimitInfo?.remaining === 0) {
        throw new Error(`GitHub API rate limit exceeded. Resets at ${this.rateLimitInfo.reset.toLocaleTimeString()}`);
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as T;
    
    // Cache the response
    this.cache.set(cacheKey, {
      data,
      expiresAt: Date.now() + cacheExpiry,
      etag: response.headers.get('etag') || undefined
    });
    
    return data;
  }

  /**
   * Fetch repository tree (all files and directories)
   */
  public async fetchRepositoryTree(repo: string): Promise<RepositoryTree> {
    const url = `${GITHUB_API_BASE}/repos/${repo}/git/trees/main?recursive=1`;
    return this.fetchWithCache<RepositoryTree>(url, `tree:${repo}`);
  }

  /**
   * Fetch file content from repository
   */
  public async fetchFileContent(repo: string, path: string): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${repo}/contents/${path}`;
    const content = await this.fetchWithCache<FileContent>(url, `file:${repo}:${path}`);
    
    if (content.encoding === 'base64') {
      return Buffer.from(content.content, 'base64').toString('utf-8');
    }
    return content.content;
  }

  /**
   * Download raw file content
   */
  public async downloadFile(repo: string, path: string): Promise<Buffer> {
    const url = `https://raw.githubusercontent.com/${repo}/main/${path}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to download file: ${path}`);
    }
    
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Find all skill directories in a repository
   */
  public async findSkillDirectories(repo: string): Promise<string[]> {
    const tree = await this.fetchRepositoryTree(repo);
    const skillDirs: string[] = [];
    
    // Find all directories containing SKILL.md
    for (const node of tree.tree) {
      if (node.type === 'blob' && node.path.endsWith('/SKILL.md')) {
        // Get parent directory
        const dir = node.path.replace('/SKILL.md', '');
        skillDirs.push(dir);
      } else if (node.type === 'blob' && node.path === 'SKILL.md') {
        // Root level skill
        skillDirs.push('');
      }
    }
    
    return skillDirs;
  }

  /**
   * Get all files in a skill directory
   */
  public getSkillFiles(tree: RepositoryTree, skillPath: string): SkillFile[] {
    const prefix = skillPath ? `${skillPath}/` : '';
    const files: SkillFile[] = [];
    
    for (const node of tree.tree) {
      if (node.path.startsWith(prefix) || (skillPath === '' && !node.path.includes('/'))) {
        const relativePath = skillPath ? node.path.slice(prefix.length) : node.path;
        
        // Skip subdirectory contents (we only want top-level files in skill dir)
        if (relativePath.includes('/')) {
          continue;
        }
        
        files.push({
          name: relativePath,
          path: node.path,
          type: node.type === 'tree' ? 'directory' : 'file',
          sha: node.sha
        });
      }
    }
    
    return files;
  }

  /**
   * Fetch all skills from configured repositories
   */
  public async fetchAllSkills(
    onProgress?: (current: number, total: number, repo: string) => void
  ): Promise<Skill[]> {
    const { repositories } = this.getConfig();
    const allSkills: Skill[] = [];
    
    for (let i = 0; i < repositories.length; i++) {
      const repo = repositories[i];
      onProgress?.(i, repositories.length, repo);
      
      try {
        const tree = await this.fetchRepositoryTree(repo);
        const skillDirs = await this.findSkillDirectories(repo);
        
        for (const dir of skillDirs) {
          const skillId = `${repo}/${dir || 'root'}`;
          const files = this.getSkillFiles(tree, dir);
          
          // Create basic skill entry (metadata will be parsed separately)
          allSkills.push({
            id: skillId,
            name: dir.split('/').pop() || repo.split('/').pop() || 'Unknown',
            description: '',
            repository: repo,
            path: dir,
            files
          });
        }
      } catch (error) {
        console.error(`Failed to fetch skills from ${repo}:`, error);
        vscode.window.showWarningMessage(`Failed to fetch skills from ${repo}: ${error}`);
      }
    }
    
    onProgress?.(repositories.length, repositories.length, 'Complete');
    return allSkills;
  }

  /**
   * Clear the cache
   */
  public clearCache(): void {
    this.cache.clear();
  }
}
