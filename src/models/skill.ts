/**
 * Skill data model representing an Antigravity skill from a repository
 */
export interface Skill {
  /** Unique identifier for the skill (repository/path) */
  id: string;
  /** Skill name from SKILL.md frontmatter */
  name: string;
  /** Description from SKILL.md frontmatter */
  description: string;
  /** Category (e.g., security, engineering, creative) */
  category?: string;
  /** Repository source */
  repository: string;
  /** Path within repository */
  path: string;
  /** Files in the skill directory */
  files: SkillFile[];
  /** Whether the skill is currently installed */
  isInstalled?: boolean;
  /** Tags for filtering */
  tags?: string[];
  /** Author information */
  author?: string;
  /** Version string */
  version?: string;
}

/**
 * Represents a file within a skill directory
 */
export interface SkillFile {
  /** File name */
  name: string;
  /** File path relative to skill root */
  path: string;
  /** File type */
  type: 'file' | 'directory';
  /** SHA for caching */
  sha?: string;
  /** Download URL */
  downloadUrl?: string;
}

/**
 * Metadata extracted from SKILL.md frontmatter
 */
export interface SkillMetadata {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  author?: string;
  version?: string;
  triggers?: string[];
  dependencies?: string[];
}

/**
 * Installed skill with local path information
 */
export interface InstalledSkill extends Skill {
  /** Local installation path */
  localPath: string;
  /** Installation timestamp */
  installedAt: Date;
  /** Source repository version/commit */
  sourceVersion?: string;
}

/**
 * Result of skill installation
 */
export interface InstallResult {
  success: boolean;
  skill: Skill;
  localPath?: string;
  error?: string;
}

/**
 * Validation result for skill parsing
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
