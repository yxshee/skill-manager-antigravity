import * as vscode from 'vscode';
import { InstalledSkill } from '../models/skill';
import { SkillInstaller } from '../services/skillInstaller';
import { GitHubService } from '../services/githubService';
import { SkillParser } from '../services/skillParser';

/**
 * Tree item representing a skill in the sidebar
 */
export class SkillTreeItem extends vscode.TreeItem {
  constructor(
    public readonly skill: InstalledSkill,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(skill.name, collapsibleState);
    
    this.tooltip = skill.description || skill.name;
    this.description = skill.category || '';
    this.contextValue = 'installedSkill';
    this.iconPath = new vscode.ThemeIcon('extensions');
    
    // Show skill folder on click
    this.command = {
      command: 'vscode.open',
      title: 'Open SKILL.md',
      arguments: [vscode.Uri.file(`${skill.localPath}/SKILL.md`)]
    };
  }
}

/**
 * Tree data provider for installed skills
 */
export class SkillTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SkillTreeItem | undefined | null | void> = 
    new vscode.EventEmitter<SkillTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SkillTreeItem | undefined | null | void> = 
    this._onDidChangeTreeData.event;

  constructor(
    private skillInstaller: SkillInstaller,
    private githubService: GitHubService,
    private skillParser: SkillParser
  ) {}

  /**
   * Refresh the tree view
   */
  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get tree item for display
   */
  public getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children of a tree item
   */
  public async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    if (element) {
      // Skills don't have children for now
      return [];
    }

    // Get all installed skills
    const installed = await this.skillInstaller.listInstalled();
    
    return installed.map(skill => 
      new SkillTreeItem(skill, vscode.TreeItemCollapsibleState.None)
    );
  }
}
