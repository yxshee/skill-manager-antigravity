import { SkillMetadata, ValidationResult } from '../models/skill';

/**
 * Parse YAML frontmatter from SKILL.md content
 */
export class SkillParser {
  
  /**
   * Extract YAML frontmatter from markdown content
   */
  private extractFrontmatter(content: string): { frontmatter: string; body: string } | null {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);
    
    if (!match) {
      return null;
    }
    
    return {
      frontmatter: match[1],
      body: match[2]
    };
  }

  /**
   * Parse simple YAML (handles basic key: value pairs)
   */
  private parseSimpleYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');
    let currentKey = '';
    let currentArray: string[] | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      // Check for array item
      if (trimmed.startsWith('- ')) {
        if (currentArray) {
          currentArray.push(trimmed.slice(2).trim());
        }
        continue;
      }
      
      // Check for key: value pair
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        // Save previous array if exists
        if (currentArray && currentKey) {
          result[currentKey] = currentArray;
          currentArray = null;
        }
        
        currentKey = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();
        
        if (value === '') {
          // Might be an array starting on next line
          currentArray = [];
        } else {
          // Remove quotes if present
          result[currentKey] = value.replace(/^["']|["']$/g, '');
        }
      }
    }
    
    // Don't forget the last array
    if (currentArray && currentKey) {
      result[currentKey] = currentArray;
    }
    
    return result;
  }

  /**
   * Extract description from markdown body
   */
  private extractDescription(body: string): string {
    // Get first paragraph or first few lines
    const lines = body.trim().split('\n');
    const descriptionLines: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip headers
      if (trimmed.startsWith('#')) {
        continue;
      }
      
      // Stop at empty line or code block
      if (!trimmed || trimmed.startsWith('```')) {
        if (descriptionLines.length > 0) {
          break;
        }
        continue;
      }
      
      descriptionLines.push(trimmed);
      
      // Limit to reasonable length
      if (descriptionLines.length >= 3) {
        break;
      }
    }
    
    return descriptionLines.join(' ').slice(0, 300);
  }

  /**
   * Parse SKILL.md content and extract metadata
   */
  public parseSkillMd(content: string): SkillMetadata {
    const extracted = this.extractFrontmatter(content);
    
    if (!extracted) {
      // No frontmatter, try to extract from body
      return {
        name: 'Unknown Skill',
        description: this.extractDescription(content)
      };
    }
    
    const yaml = this.parseSimpleYaml(extracted.frontmatter);
    const description = (yaml.description as string) || this.extractDescription(extracted.body);
    
    return {
      name: (yaml.name as string) || 'Unknown Skill',
      description,
      category: yaml.category as string | undefined,
      tags: yaml.tags as string[] | undefined,
      author: yaml.author as string | undefined,
      version: yaml.version as string | undefined,
      triggers: yaml.triggers as string[] | undefined,
      dependencies: yaml.dependencies as string[] | undefined
    };
  }

  /**
   * Validate skill metadata
   */
  public validateSkill(metadata: SkillMetadata): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Required fields
    if (!metadata.name || metadata.name === 'Unknown Skill') {
      errors.push('Skill name is required in SKILL.md frontmatter');
    }
    
    if (!metadata.description) {
      warnings.push('Skill description is recommended');
    }
    
    // Validate name format
    if (metadata.name && !/^[\w\s-]+$/.test(metadata.name)) {
      warnings.push('Skill name should only contain letters, numbers, spaces, and hyphens');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Infer category from skill name or path
   */
  public inferCategory(skillName: string, path: string): string | undefined {
    const text = `${skillName} ${path}`.toLowerCase();
    
    const categoryPatterns: Record<string, string[]> = {
      'security': ['security', 'audit', 'vulnerability', 'owasp', 'penetration'],
      'engineering': ['code', 'develop', 'engineer', 'debug', 'refactor'],
      'testing': ['test', 'spec', 'jest', 'mocha', 'coverage'],
      'documentation': ['doc', 'readme', 'comment', 'jsdoc'],
      'devops': ['deploy', 'docker', 'kubernetes', 'ci', 'cd', 'pipeline'],
      'database': ['sql', 'database', 'mongo', 'postgres', 'redis'],
      'creative': ['design', 'ui', 'ux', 'creative', 'style'],
      'utility': ['util', 'helper', 'tool', 'format', 'validate']
    };
    
    for (const [category, patterns] of Object.entries(categoryPatterns)) {
      if (patterns.some(pattern => text.includes(pattern))) {
        return category;
      }
    }
    
    return undefined;
  }
}
