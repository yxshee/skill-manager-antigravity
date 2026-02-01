import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { Skill, InstalledSkill, InstallResult } from '../models/skill';
import { GitHubService } from './githubService';
import { SkillParser } from './skillParser';

/**
 * Handles installing and managing skills in the local Antigravity directory
 */
export class SkillInstaller {
  private readonly defaultInstallPath: string;
  
  constructor(
    private githubService: GitHubService,
    private skillParser: SkillParser,
    private context: vscode.ExtensionContext
  ) {
    this.defaultInstallPath = path.join(os.homedir(), '.gemini', 'antigravity', 'skills');
  }

  /**
   * Get the install path from configuration or use default
   */
  private getInstallPath(): string {
    const config = vscode.workspace.getConfiguration('skillManager');
    const customPath = config.get<string>('installPath', '');
    return customPath || this.defaultInstallPath;
  }

  /**
   * Ensure the skills directory exists
   */
  private async ensureInstallDirectory(): Promise<void> {
    const installPath = this.getInstallPath();
    try {
      await fs.mkdir(installPath, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Get the local path for a skill
   */
  private getSkillLocalPath(skill: Skill): string {
    const installPath = this.getInstallPath();
    const skillName = skill.name.toLowerCase().replace(/\s+/g, '-');
    return path.join(installPath, skillName);
  }

  /**
   * Check if a skill is already installed
   */
  public async isInstalled(skill: Skill): Promise<boolean> {
    const localPath = this.getSkillLocalPath(skill);
    try {
      const stat = await fs.stat(localPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Install a single skill from a repository
   */
  public async install(
    skill: Skill,
    onProgress?: (message: string) => void
  ): Promise<InstallResult> {
    try {
      await this.ensureInstallDirectory();
      const localPath = this.getSkillLocalPath(skill);
      
      // Check if already installed
      if (await this.isInstalled(skill)) {
        return {
          success: false,
          skill,
          localPath,
          error: 'Skill is already installed'
        };
      }
      
      // Create skill directory
      onProgress?.(`Creating directory for ${skill.name}...`);
      await fs.mkdir(localPath, { recursive: true });
      
      // Download all files
      const filesToDownload = skill.files.filter(f => f.type === 'file');
      let downloaded = 0;
      
      for (const file of filesToDownload) {
        onProgress?.(`Downloading ${file.name} (${++downloaded}/${filesToDownload.length})...`);
        
        try {
          const content = await this.githubService.downloadFile(skill.repository, file.path);
          const filePath = path.join(localPath, file.name);
          await fs.writeFile(filePath, content);
        } catch (error) {
          console.error(`Failed to download ${file.name}:`, error);
          // Continue with other files
        }
      }
      
      // Handle subdirectories (download recursively)
      const subdirs = skill.files.filter(f => f.type === 'directory');
      for (const dir of subdirs) {
        await this.downloadDirectory(skill.repository, dir.path, path.join(localPath, dir.name), onProgress);
      }
      
      // Verify SKILL.md exists
      const skillMdPath = path.join(localPath, 'SKILL.md');
      try {
        await fs.access(skillMdPath);
      } catch {
        // Clean up if SKILL.md is missing
        await fs.rm(localPath, { recursive: true, force: true });
        return {
          success: false,
          skill,
          error: 'SKILL.md not found in skill directory'
        };
      }
      
      // Save installation metadata
      await this.saveInstallMetadata(skill, localPath);
      onProgress?.(`Successfully installed ${skill.name}`);
      
      return {
        success: true,
        skill,
        localPath
      };
      
    } catch (error) {
      return {
        success: false,
        skill,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Download a directory recursively
   */
  private async downloadDirectory(
    repo: string,
    remotePath: string,
    localPath: string,
    onProgress?: (message: string) => void
  ): Promise<void> {
    await fs.mkdir(localPath, { recursive: true });
    
    // Fetch directory contents from GitHub
    const tree = await this.githubService.fetchRepositoryTree(repo);
    const prefix = `${remotePath}/`;
    
    for (const node of tree.tree) {
      if (node.path.startsWith(prefix)) {
        const relativePath = node.path.slice(prefix.length);
        
        // Skip nested directories (handle them recursively)
        if (relativePath.includes('/')) {
          continue;
        }
        
        const itemLocalPath = path.join(localPath, relativePath);
        
        if (node.type === 'blob') {
          onProgress?.(`Downloading ${relativePath}...`);
          const content = await this.githubService.downloadFile(repo, node.path);
          await fs.writeFile(itemLocalPath, content);
        } else if (node.type === 'tree') {
          await this.downloadDirectory(repo, node.path, itemLocalPath, onProgress);
        }
      }
    }
  }

  /**
   * Save installation metadata
   */
  private async saveInstallMetadata(skill: Skill, localPath: string): Promise<void> {
    const metadata = {
      id: skill.id,
      name: skill.name,
      repository: skill.repository,
      path: skill.path,
      installedAt: new Date().toISOString(),
      version: skill.version
    };
    
    const metadataPath = path.join(localPath, '.skill-manager.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Uninstall a skill
   */
  public async uninstall(skill: Skill): Promise<void> {
    const localPath = this.getSkillLocalPath(skill);
    
    if (!(await this.isInstalled(skill))) {
      throw new Error(`Skill ${skill.name} is not installed`);
    }
    
    await fs.rm(localPath, { recursive: true, force: true });
  }

  /**
   * List all installed skills
   */
  public async listInstalled(): Promise<InstalledSkill[]> {
    const installPath = this.getInstallPath();
    const installedSkills: InstalledSkill[] = [];
    
    try {
      const entries = await fs.readdir(installPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        
        const skillPath = path.join(installPath, entry.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        const metadataPath = path.join(skillPath, '.skill-manager.json');
        
        try {
          // Check if SKILL.md exists
          await fs.access(skillMdPath);
          
          // Read SKILL.md and parse
          const skillMdContent = await fs.readFile(skillMdPath, 'utf-8');
          const metadata = this.skillParser.parseSkillMd(skillMdContent);
          
          // Try to read installation metadata
          let installMetadata: Record<string, unknown> = {};
          try {
            const metadataContent = await fs.readFile(metadataPath, 'utf-8');
            installMetadata = JSON.parse(metadataContent);
          } catch {
            // No metadata file, that's okay
          }
          
          installedSkills.push({
            id: (installMetadata.id as string) || entry.name,
            name: metadata.name,
            description: metadata.description,
            category: metadata.category,
            repository: (installMetadata.repository as string) || 'local',
            path: (installMetadata.path as string) || '',
            files: [],
            localPath: skillPath,
            installedAt: installMetadata.installedAt 
              ? new Date(installMetadata.installedAt as string) 
              : new Date(),
            isInstalled: true,
            tags: metadata.tags,
            author: metadata.author,
            version: metadata.version
          });
          
        } catch {
          // Not a valid skill directory, skip
          continue;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    
    return installedSkills;
  }

  /**
   * Install multiple skills in batch
   */
  public async installBatch(
    skills: Skill[],
    onProgress?: (current: number, total: number, skill: Skill, status: string) => void
  ): Promise<InstallResult[]> {
    const results: InstallResult[] = [];
    
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i];
      onProgress?.(i + 1, skills.length, skill, `Installing ${skill.name}...`);
      
      const result = await this.install(skill, (msg) => {
        onProgress?.(i + 1, skills.length, skill, msg);
      });
      
      results.push(result);
      
      // Small delay to avoid overwhelming the API
      if (i < skills.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }
}
