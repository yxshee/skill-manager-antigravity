import * as vscode from 'vscode';
import { GitHubService, SkillParser, SkillInstaller } from './services';
import { SkillBrowserPanel } from './views/skillBrowserPanel';
import { SkillTreeProvider } from './views/skillTreeProvider';

let githubService: GitHubService;
let skillParser: SkillParser;
let skillInstaller: SkillInstaller;
let skillTreeProvider: SkillTreeProvider;

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Skill Manager for Antigravity is now active!');

  // Initialize services
  githubService = new GitHubService(context);
  skillParser = new SkillParser();
  skillInstaller = new SkillInstaller(githubService, skillParser, context);
  skillTreeProvider = new SkillTreeProvider(skillInstaller, githubService, skillParser);

  // Register tree view providers
  const installedTreeView = vscode.window.createTreeView('skillManager.installed', {
    treeDataProvider: skillTreeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(installedTreeView);

  // Register commands
  const browseCommand = vscode.commands.registerCommand(
    'skillManager.browse',
    () => SkillBrowserPanel.createOrShow(context, githubService, skillParser, skillInstaller)
  );

  const installCommand = vscode.commands.registerCommand(
    'skillManager.install',
    async () => {
      const repoInput = await vscode.window.showInputBox({
        prompt: 'Enter skill repository and path (e.g., rominirani/antigravity-skills/skills_tutorial/git-commit-formatter)',
        placeHolder: 'owner/repo/path/to/skill'
      });

      if (!repoInput) {
        return;
      }

      const parts = repoInput.split('/');
      if (parts.length < 3) {
        vscode.window.showErrorMessage('Invalid format. Please use owner/repo/path/to/skill');
        return;
      }

      const repo = `${parts[0]}/${parts[1]}`;
      const skillPath = parts.slice(2).join('/');

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Installing Skill',
          cancellable: false
        },
        async (progress) => {
          try {
            const tree = await githubService.fetchRepositoryTree(repo);
            const files = githubService.getSkillFiles(tree, skillPath);
            
            const skill = {
              id: `${repo}/${skillPath}`,
              name: skillPath.split('/').pop() || 'skill',
              description: '',
              repository: repo,
              path: skillPath,
              files
            };

            const result = await skillInstaller.install(skill, (msg) => {
              progress.report({ message: msg });
            });

            if (result.success) {
              vscode.window.showInformationMessage(`Successfully installed ${skill.name}`);
              skillTreeProvider.refresh();
            } else {
              vscode.window.showErrorMessage(`Failed to install: ${result.error}`);
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Installation failed: ${error}`);
          }
        }
      );
    }
  );

  const manageCommand = vscode.commands.registerCommand(
    'skillManager.manage',
    async () => {
      const installed = await skillInstaller.listInstalled();
      
      if (installed.length === 0) {
        vscode.window.showInformationMessage('No skills installed. Use "Browse Skills" to install some.');
        return;
      }

      const items = installed.map(skill => ({
        label: skill.name,
        description: skill.description,
        detail: `Installed: ${skill.installedAt.toLocaleDateString()}`,
        skill
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a skill to manage',
        matchOnDescription: true
      });

      if (!selected) {
        return;
      }

      const action = await vscode.window.showQuickPick(
        [
          { label: '$(folder) Open Skill Folder', action: 'open' },
          { label: '$(eye) View SKILL.md', action: 'view' },
          { label: '$(trash) Uninstall', action: 'uninstall' }
        ],
        { placeHolder: `What do you want to do with ${selected.skill.name}?` }
      );

      if (!action) {
        return;
      }

      switch (action.action) {
        case 'open':
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(selected.skill.localPath));
          break;
        case 'view':
          const skillMdPath = vscode.Uri.file(`${selected.skill.localPath}/SKILL.md`);
          vscode.window.showTextDocument(skillMdPath);
          break;
        case 'uninstall':
          const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to uninstall ${selected.skill.name}?`,
            { modal: true },
            'Uninstall'
          );
          if (confirm === 'Uninstall') {
            await skillInstaller.uninstall(selected.skill);
            vscode.window.showInformationMessage(`Uninstalled ${selected.skill.name}`);
            skillTreeProvider.refresh();
          }
          break;
      }
    }
  );

  const refreshCommand = vscode.commands.registerCommand(
    'skillManager.refresh',
    () => {
      githubService.clearCache();
      skillTreeProvider.refresh();
      vscode.window.showInformationMessage('Skills cache refreshed');
    }
  );

  // Uninstall command for tree view items
  const uninstallCommand = vscode.commands.registerCommand(
    'skillManager.uninstallSkill',
    async (item: { skill?: { name: string; localPath: string } }) => {
      if (!item?.skill) {
        return;
      }
      
      const confirm = await vscode.window.showWarningMessage(
        `Uninstall ${item.skill.name}?`,
        { modal: true },
        'Uninstall'
      );
      
      if (confirm === 'Uninstall') {
        await skillInstaller.uninstall(item.skill as any);
        vscode.window.showInformationMessage(`Uninstalled ${item.skill.name}`);
        skillTreeProvider.refresh();
      }
    }
  );

  // Open skill folder command
  const openFolderCommand = vscode.commands.registerCommand(
    'skillManager.openSkillFolder',
    (item: { skill?: { localPath: string } }) => {
      if (item?.skill?.localPath) {
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.skill.localPath));
      }
    }
  );

  context.subscriptions.push(
    browseCommand,
    installCommand,
    manageCommand,
    refreshCommand,
    uninstallCommand,
    openFolderCommand
  );

  // Show welcome message on first install
  const hasShownWelcome = context.globalState.get('hasShownWelcome');
  if (!hasShownWelcome) {
    vscode.window.showInformationMessage(
      'Skill Manager for Antigravity installed! Use "Skill Manager: Browse Skills" to get started.',
      'Browse Skills'
    ).then(selection => {
      if (selection === 'Browse Skills') {
        vscode.commands.executeCommand('skillManager.browse');
      }
    });
    context.globalState.update('hasShownWelcome', true);
  }
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  console.log('Skill Manager for Antigravity deactivated');
}
