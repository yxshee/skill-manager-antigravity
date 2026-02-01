import * as vscode from 'vscode';
import { GitHubService } from '../services/githubService';
import { SkillParser } from '../services/skillParser';
import { SkillInstaller } from '../services/skillInstaller';
import { Skill } from '../models/skill';

/**
 * Activity log entry
 */
interface ActivityEntry {
  timestamp: Date;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
}

/**
 * Webview panel for browsing and installing skills
 */
export class SkillBrowserPanel {
  public static currentPanel: SkillBrowserPanel | undefined;
  private static readonly viewType = 'skillBrowser';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private skills: Skill[] = [];
  private activityLog: ActivityEntry[] = [];
  private currentStatus: 'idle' | 'loading' | 'installing' = 'idle';

  private constructor(
    panel: vscode.WebviewPanel,
    private context: vscode.ExtensionContext,
    private githubService: GitHubService,
    private skillParser: SkillParser,
    private skillInstaller: SkillInstaller
  ) {
    this.panel = panel;

    // Set initial HTML content
    this.panel.webview.html = this.getLoadingHtml();

    // Listen for panel disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );

    // Load skills
    this.loadSkills();
  }

  /**
   * Handle messages from webview with validation
   */
  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') {
      return;
    }

    const msg = message as Record<string, unknown>;
    const command = msg.command;

    // Validate command is in allowed list
    const allowedCommands = ['install', 'installBatch', 'search', 'refresh', 'filterCategory', 'openReadme', 'openSource', 'clearSearch'];
    if (typeof command !== 'string' || !allowedCommands.includes(command)) {
      return;
    }

    switch (command) {
      case 'install':
        if (typeof msg.skillId === 'string') {
          await this.handleInstall(msg.skillId);
        }
        break;
      case 'installBatch':
        if (Array.isArray(msg.skillIds)) {
          await this.handleBatchInstall(msg.skillIds as string[]);
        }
        break;
      case 'search':
        if (typeof msg.query === 'string') {
          await this.handleSearch(msg.query);
        }
        break;
      case 'refresh':
        await this.loadSkills();
        break;
      case 'filterCategory':
        if (typeof msg.category === 'string') {
          await this.handleCategoryFilter(msg.category);
        }
        break;
      case 'clearSearch':
        this.sendSkillsToWebview();
        break;
    }
  }

  /**
   * Add entry to activity log
   */
  private logActivity(type: 'info' | 'success' | 'error' | 'warning', message: string): void {
    this.activityLog.unshift({
      timestamp: new Date(),
      type,
      message
    });

    // Keep only last 50 entries
    if (this.activityLog.length > 50) {
      this.activityLog.pop();
    }

    this.sendActivityUpdate();
  }

  /**
   * Send activity update to webview
   */
  private sendActivityUpdate(): void {
    this.panel.webview.postMessage({
      type: 'activityUpdate',
      status: this.currentStatus,
      log: this.activityLog.slice(0, 10).map(e => ({
        time: e.timestamp.toLocaleTimeString(),
        type: e.type,
        message: e.message
      }))
    });
  }

  /**
   * Create or show the skill browser panel
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    githubService: GitHubService,
    skillParser: SkillParser,
    skillInstaller: SkillInstaller
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If panel exists, show it
    if (SkillBrowserPanel.currentPanel) {
      SkillBrowserPanel.currentPanel.panel.reveal(column);
      return;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
      SkillBrowserPanel.viewType,
      'Skill Browser',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media')
        ]
      }
    );

    SkillBrowserPanel.currentPanel = new SkillBrowserPanel(
      panel,
      context,
      githubService,
      skillParser,
      skillInstaller
    );
  }

  /**
   * Load skills from configured repositories
   */
  private async loadSkills(): Promise<void> {
    try {
      this.currentStatus = 'loading';
      this.panel.webview.html = this.getLoadingHtml();
      this.logActivity('info', 'Starting to load skills from repositories...');
      
      this.skills = await this.githubService.fetchAllSkills((current, total, repo) => {
        this.panel.webview.postMessage({
          type: 'loadingProgress',
          current,
          total,
          repo
        });
      });

      // Enrich skills with metadata
      await this.enrichSkillsWithMetadata();
      
      // Check installation status
      await this.updateInstallationStatus();

      this.currentStatus = 'idle';
      this.logActivity('success', `Loaded ${this.skills.length} skills from repositories`);

      // Update UI
      this.panel.webview.html = this.getMainHtml();
      this.sendSkillsToWebview();
      this.sendActivityUpdate();

    } catch (error) {
      this.currentStatus = 'idle';
      this.logActivity('error', `Failed to load skills: ${error instanceof Error ? error.message : String(error)}`);
      this.panel.webview.html = this.getErrorHtml(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Fetch and parse SKILL.md for each skill
   */
  private async enrichSkillsWithMetadata(): Promise<void> {
    const batchSize = 10;
    
    for (let i = 0; i < this.skills.length; i += batchSize) {
      const batch = this.skills.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (skill) => {
        try {
          const skillMdPath = skill.path ? `${skill.path}/SKILL.md` : 'SKILL.md';
          const content = await this.githubService.fetchFileContent(skill.repository, skillMdPath);
          const metadata = this.skillParser.parseSkillMd(content);
          
          skill.name = metadata.name || skill.name;
          skill.description = metadata.description || '';
          skill.category = metadata.category || this.skillParser.inferCategory(skill.name, skill.path);
          skill.tags = metadata.tags;
          skill.author = metadata.author;
          skill.version = metadata.version;
        } catch {
          // Keep basic info if SKILL.md fetch fails
          skill.category = this.skillParser.inferCategory(skill.name, skill.path);
        }
      }));
    }
  }

  /**
   * Update installation status for all skills
   */
  private async updateInstallationStatus(): Promise<void> {
    const installed = await this.skillInstaller.listInstalled();
    const installedNames = new Set(installed.map(s => s.name.toLowerCase()));
    
    for (const skill of this.skills) {
      skill.isInstalled = installedNames.has(skill.name.toLowerCase());
    }
  }

  /**
   * Get categories with counts
   */
  private getCategoriesWithCounts(): { name: string; count: number }[] {
    const categoryMap = new Map<string, number>();
    
    for (const skill of this.skills) {
      const cat = skill.category || 'uncategorized';
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    }

    return Array.from(categoryMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Send skills data to webview
   */
  private sendSkillsToWebview(): void {
    const categories = this.getCategoriesWithCounts();
    const installedCount = this.skills.filter(s => s.isInstalled).length;

    this.panel.webview.postMessage({
      type: 'skills',
      skills: this.skills,
      categories,
      totalCount: this.skills.length,
      installedCount
    });
  }

  /**
   * Handle skill installation
   */
  private async handleInstall(skillId: string): Promise<void> {
    const skill = this.skills.find(s => s.id === skillId);
    if (!skill) {
      return;
    }

    this.currentStatus = 'installing';
    this.logActivity('info', `Installing ${skill.name}...`);

    this.panel.webview.postMessage({
      type: 'installStart',
      skillId
    });

    const result = await this.skillInstaller.install(skill, (msg) => {
      this.panel.webview.postMessage({
        type: 'installProgress',
        skillId,
        message: msg
      });
    });

    this.currentStatus = 'idle';

    if (result.success) {
      skill.isInstalled = true;
      this.logActivity('success', `Installed ${skill.name} successfully`);
      this.panel.webview.postMessage({
        type: 'installComplete',
        skillId,
        success: true
      });
    } else {
      this.logActivity('error', `Failed to install ${skill.name}: ${result.error}`);
      this.panel.webview.postMessage({
        type: 'installComplete',
        skillId,
        success: false,
        error: result.error
      });
    }

    this.sendActivityUpdate();
  }

  /**
   * Handle batch installation
   */
  private async handleBatchInstall(skillIds: string[]): Promise<void> {
    const skillsToInstall = this.skills.filter(s => skillIds.includes(s.id) && !s.isInstalled);
    
    this.currentStatus = 'installing';
    this.logActivity('info', `Starting batch install of ${skillsToInstall.length} skills...`);

    this.panel.webview.postMessage({
      type: 'batchInstallStart',
      total: skillsToInstall.length
    });

    let completed = 0;
    let failed = 0;

    for (const skill of skillsToInstall) {
      const result = await this.skillInstaller.install(skill, (msg) => {
        this.panel.webview.postMessage({
          type: 'batchInstallProgress',
          current: completed + 1,
          total: skillsToInstall.length,
          skillName: skill.name,
          message: msg
        });
      });

      if (result.success) {
        skill.isInstalled = true;
        this.logActivity('success', `Installed ${skill.name}`);
      } else {
        failed++;
        this.logActivity('error', `Failed: ${skill.name}`);
      }
      completed++;
    }

    this.currentStatus = 'idle';
    this.logActivity('info', `Batch install complete: ${completed - failed} succeeded, ${failed} failed`);

    this.panel.webview.postMessage({
      type: 'batchInstallComplete',
      installed: completed - failed,
      failed
    });

    this.sendSkillsToWebview();
    this.sendActivityUpdate();
  }

  /**
   * Handle search
   */
  private async handleSearch(query: string): Promise<void> {
    const lowerQuery = query.toLowerCase();
    const filtered = this.skills.filter(skill =>
      skill.name.toLowerCase().includes(lowerQuery) ||
      skill.description.toLowerCase().includes(lowerQuery) ||
      skill.category?.toLowerCase().includes(lowerQuery) ||
      skill.tags?.some(t => t.toLowerCase().includes(lowerQuery))
    );

    this.panel.webview.postMessage({
      type: 'searchResults',
      skills: filtered,
      query
    });
  }

  /**
   * Handle category filter
   */
  private async handleCategoryFilter(category: string): Promise<void> {
    const filtered = category === 'all' 
      ? this.skills 
      : this.skills.filter(skill => skill.category === category);

    this.panel.webview.postMessage({
      type: 'filterResults',
      skills: filtered,
      category
    });
  }

  /**
   * Generate nonce for CSP
   */
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * Get loading HTML
   */
  private getLoadingHtml(): string {
    const nonce = this.getNonce();
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Loading Skills</title>
      <style>
        ${this.getBaseStyles()}
        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          gap: 20px;
        }
        .spinner {
          width: 50px;
          height: 50px;
          border: 4px solid var(--vscode-editorWidget-border);
          border-left-color: var(--vscode-button-background);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="loading-container">
        <div class="spinner"></div>
        <p id="loadingText">Loading skills from repositories...</p>
      </div>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        window.addEventListener('message', event => {
          const message = event.data;
          if (message.type === 'loadingProgress') {
            document.getElementById('loadingText').textContent = 
              'Loading from ' + message.repo + ' (' + message.current + '/' + message.total + ')...';
          }
        });
      </script>
    </body>
    </html>`;
  }

  /**
   * Get error HTML
   */
  private getErrorHtml(error: string): string {
    const nonce = this.getNonce();
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Error</title>
      <style>
        ${this.getBaseStyles()}
        .error-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          gap: 20px;
          text-align: center;
          padding: 20px;
        }
        .error-icon { font-size: 48px; }
        .error-message { color: var(--vscode-errorForeground); max-width: 500px; }
        .error-tips { color: var(--vscode-descriptionForeground); font-size: 13px; margin-top: 16px; }
        .error-tips li { margin: 8px 0; text-align: left; }
      </style>
    </head>
    <body>
      <div class="error-container">
        <div class="error-icon">⚠️</div>
        <h2>Failed to load skills</h2>
        <p class="error-message">${this.escapeHtml(error)}</p>
        <div class="error-tips">
          <p><strong>Troubleshooting tips:</strong></p>
          <ul>
            <li>Check your internet connection</li>
            <li>Verify GitHub API rate limits haven't been exceeded</li>
            <li>Add a GitHub token in settings for higher limits</li>
            <li>Check if the configured repositories exist</li>
          </ul>
        </div>
        <button class="btn btn-primary" onclick="retry()">🔄 Retry</button>
      </div>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        function retry() {
          vscode.postMessage({ command: 'refresh' });
        }
      </script>
    </body>
    </html>`;
  }

  /**
   * Get main browser HTML
   */
  private getMainHtml(): string {
    const nonce = this.getNonce();
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Skill Browser</title>
      <style>${this.getStyles()}</style>
    </head>
    <body>
      <div class="app">
        <!-- HERO SECTION -->
        <header class="hero">
          <div class="hero-content">
            <h1>🧠 Antigravity Skill Manager</h1>
            <p class="hero-subtitle">Browse and install skills to enhance your Antigravity IDE</p>
            <p class="hero-path">📁 Skills install to: <code>~/.gemini/antigravity/skills/</code></p>
          </div>
          <div class="hero-actions">
            <button class="btn btn-secondary" onclick="refresh()">
              <span class="codicon">↻</span> Refresh
            </button>
            <button class="btn btn-secondary" onclick="openSettings()">
              <span class="codicon">⚙</span> Settings
            </button>
          </div>
        </header>

        <div class="main-layout">
          <!-- CATEGORIES SIDEBAR -->
          <aside class="sidebar">
            <h2 class="sidebar-title">Categories</h2>
            <div id="categoriesList" class="categories-list">
              <!-- Populated by JS -->
            </div>
          </aside>

          <!-- MAIN CONTENT -->
          <main class="content">
            <!-- SEARCH & ACTIONS -->
            <div class="toolbar">
              <div class="search-box">
                <input type="text" id="searchInput" placeholder="🔍 Search skills..." />
                <button id="clearSearch" class="btn-clear hidden" onclick="clearSearch()">✕</button>
              </div>
              <div class="toolbar-stats">
                <span id="resultCount">0 skills</span>
              </div>
              <button class="btn btn-primary" id="installSelectedBtn" onclick="installSelected()" disabled>
                📦 Install Selected (<span id="selectedCount">0</span>)
              </button>
            </div>

            <!-- SKILLS GRID -->
            <div id="skillsGrid" class="skills-grid">
              <!-- Populated by JS -->
            </div>

            <!-- EMPTY STATE -->
            <div id="emptyState" class="empty-state hidden">
              <div class="empty-icon">🔍</div>
              <h3>No skills found</h3>
              <p>Try a different search term or clear filters</p>
              <button class="btn btn-secondary" onclick="clearSearch()">Clear Search</button>
            </div>
          </main>
        </div>

        <!-- ACTIVITY PANEL -->
        <footer class="activity-panel">
          <div class="activity-header">
            <span id="statusIndicator" class="status-indicator status-idle">● Idle</span>
            <span class="activity-title">Activity</span>
          </div>
          <div id="activityLog" class="activity-log">
            <!-- Populated by JS -->
          </div>
        </footer>

        <!-- PROGRESS MODAL -->
        <div id="progressModal" class="modal hidden">
          <div class="modal-content">
            <h3>Installing Skills</h3>
            <div class="progress-bar">
              <div id="progressFill" class="progress-fill"></div>
            </div>
            <p id="progressText">Installing...</p>
          </div>
        </div>
      </div>
      
      <script nonce="${nonce}">
        ${this.getScript()}
      </script>
    </body>
    </html>`;
  }

  /**
   * Get base CSS styles
   */
  private getBaseStyles(): string {
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: var(--vscode-font-family);
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        line-height: 1.5;
      }
      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.15s ease;
      }
      .btn-primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .btn-primary:hover:not(:disabled) {
        background: var(--vscode-button-hoverBackground);
      }
      .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
      .btn-secondary:hover { filter: brightness(1.1); }
    `;
  }

  /**
   * Get CSS styles
   */
  private getStyles(): string {
    return `
      ${this.getBaseStyles()}
      
      .app {
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
      }

      /* HERO */
      .hero {
        padding: 20px 24px;
        background: linear-gradient(135deg, 
          color-mix(in srgb, var(--vscode-button-background) 15%, transparent),
          color-mix(in srgb, #9c27b0 10%, transparent)
        );
        border-bottom: 1px solid var(--vscode-widget-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 16px;
      }
      .hero h1 {
        font-size: 1.5rem;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .hero-subtitle {
        color: var(--vscode-descriptionForeground);
        font-size: 14px;
      }
      .hero-path {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-top: 4px;
      }
      .hero-path code {
        background: var(--vscode-textCodeBlock-background);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: var(--vscode-editor-font-family);
      }
      .hero-actions { display: flex; gap: 8px; }

      /* MAIN LAYOUT */
      .main-layout {
        display: flex;
        flex: 1;
        overflow: hidden;
      }

      /* SIDEBAR */
      .sidebar {
        width: 200px;
        padding: 16px;
        border-right: 1px solid var(--vscode-widget-border);
        background: var(--vscode-sideBar-background);
        overflow-y: auto;
      }
      .sidebar-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 12px;
      }
      .category-item {
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        margin-bottom: 4px;
      }
      .category-item:hover {
        background: var(--vscode-list-hoverBackground);
      }
      .category-item.active {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
      }
      .category-count {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }

      /* CONTENT */
      .content {
        flex: 1;
        padding: 16px 24px;
        overflow-y: auto;
      }

      /* TOOLBAR */
      .toolbar {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 16px;
      }
      .search-box {
        flex: 1;
        position: relative;
      }
      .search-box input {
        width: 100%;
        padding: 10px 36px 10px 14px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font-size: 14px;
      }
      .search-box input:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
      }
      .btn-clear {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        font-size: 14px;
      }
      .hidden { display: none !important; }
      .toolbar-stats {
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        white-space: nowrap;
      }

      /* SKILLS GRID */
      .skills-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
      }

      /* SKILL CARD */
      .skill-card {
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 10px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        transition: all 0.2s ease;
      }
      .skill-card:hover {
        border-color: var(--vscode-focusBorder);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      }
      .skill-card.installed {
        border-left: 3px solid var(--vscode-charts-green);
      }
      .skill-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 8px;
      }
      .skill-name {
        font-weight: 600;
        font-size: 14px;
        word-break: break-word;
      }
      .skill-checkbox { width: 16px; height: 16px; cursor: pointer; }
      .skill-description {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        margin-bottom: 12px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        flex: 1;
      }
      .skill-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .skill-tag {
        background: color-mix(in srgb, var(--vscode-button-background) 20%, transparent);
        color: var(--vscode-button-background);
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 10px;
      }
      .skill-tag.category {
        background: color-mix(in srgb, #9c27b0 20%, transparent);
        color: #9c27b0;
      }
      .skill-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: auto;
        padding-top: 12px;
        border-top: 1px solid var(--vscode-widget-border);
      }
      .skill-actions { display: flex; gap: 4px; }
      .skill-actions button {
        padding: 4px 8px;
        font-size: 11px;
        background: transparent;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 4px;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
      }
      .skill-actions button:hover {
        background: var(--vscode-list-hoverBackground);
      }
      .install-btn {
        padding: 6px 12px;
        font-size: 12px;
      }
      .install-btn.installed {
        background: var(--vscode-charts-green);
      }
      .install-btn.installing {
        background: var(--vscode-charts-yellow);
        color: #000;
      }

      /* EMPTY STATE */
      .empty-state {
        text-align: center;
        padding: 60px 20px;
        color: var(--vscode-descriptionForeground);
      }
      .empty-icon { font-size: 48px; margin-bottom: 16px; }

      /* ACTIVITY PANEL */
      .activity-panel {
        border-top: 1px solid var(--vscode-widget-border);
        background: var(--vscode-sideBar-background);
        padding: 8px 16px;
        max-height: 120px;
      }
      .activity-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }
      .status-indicator {
        font-size: 12px;
        font-weight: 500;
      }
      .status-idle { color: var(--vscode-descriptionForeground); }
      .status-loading { color: var(--vscode-charts-yellow); }
      .status-installing { color: var(--vscode-charts-blue); }
      .activity-title {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
      }
      .activity-log {
        font-size: 11px;
        max-height: 60px;
        overflow-y: auto;
      }
      .log-entry {
        padding: 2px 0;
        display: flex;
        gap: 8px;
      }
      .log-time { color: var(--vscode-descriptionForeground); }
      .log-success { color: var(--vscode-charts-green); }
      .log-error { color: var(--vscode-errorForeground); }
      .log-warning { color: var(--vscode-charts-yellow); }

      /* MODAL */
      .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      .modal-content {
        background: var(--vscode-editorWidget-background);
        padding: 24px;
        border-radius: 12px;
        min-width: 300px;
        text-align: center;
      }
      .progress-bar {
        width: 100%;
        height: 6px;
        background: var(--vscode-progressBar-background);
        border-radius: 3px;
        margin: 16px 0;
        overflow: hidden;
      }
      .progress-fill {
        height: 100%;
        background: var(--vscode-button-background);
        border-radius: 3px;
        transition: width 0.3s ease;
        width: 0%;
      }
    `;
  }

  /**
   * Get JavaScript for webview
   */
  private getScript(): string {
    return `
      const vscode = acquireVsCodeApi();
      let allSkills = [];
      let displayedSkills = [];
      let categories = [];
      let selectedSkills = new Set();
      let activeCategory = 'all';

      // Handle messages from extension
      window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
          case 'skills':
            allSkills = message.skills;
            displayedSkills = allSkills;
            categories = message.categories;
            renderCategories();
            renderSkills(displayedSkills);
            updateResultCount(displayedSkills.length);
            break;
          case 'searchResults':
          case 'filterResults':
            displayedSkills = message.skills;
            renderSkills(displayedSkills);
            updateResultCount(displayedSkills.length);
            break;
          case 'installStart':
            setCardState(message.skillId, 'installing');
            break;
          case 'installComplete':
            setCardState(message.skillId, message.success ? 'installed' : 'failed');
            break;
          case 'batchInstallStart':
            showProgressModal(0, message.total, 'Starting...');
            break;
          case 'batchInstallProgress':
            showProgressModal(message.current, message.total, message.skillName);
            break;
          case 'batchInstallComplete':
            hideProgressModal();
            break;
          case 'activityUpdate':
            updateActivityPanel(message.status, message.log);
            break;
        }
      });

      function renderCategories() {
        const container = document.getElementById('categoriesList');
        let html = '<div class="category-item ' + (activeCategory === 'all' ? 'active' : '') + '" onclick="filterCategory(\\'all\\')"><span>All</span><span class="category-count">' + allSkills.length + '</span></div>';
        
        for (const cat of categories.slice(0, 15)) {
          const isActive = activeCategory === cat.name ? 'active' : '';
          html += '<div class="category-item ' + isActive + '" onclick="filterCategory(\\'' + escapeHtml(cat.name) + '\\')"><span>' + escapeHtml(cat.name) + '</span><span class="category-count">' + cat.count + '</span></div>';
        }
        container.innerHTML = html;
      }

      function renderSkills(skills) {
        const grid = document.getElementById('skillsGrid');
        const empty = document.getElementById('emptyState');
        
        if (skills.length === 0) {
          grid.innerHTML = '';
          empty.classList.remove('hidden');
          return;
        }
        
        empty.classList.add('hidden');
        grid.innerHTML = skills.map(skill => createSkillCard(skill)).join('');
      }

      function createSkillCard(skill) {
        const isChecked = selectedSkills.has(skill.id) ? 'checked' : '';
        const installedClass = skill.isInstalled ? 'installed' : '';
        const btnClass = skill.isInstalled ? 'installed' : '';
        const btnText = skill.isInstalled ? '✓ Installed' : 'Install';
        const btnDisabled = skill.isInstalled ? 'disabled' : '';
        
        return \`
          <div class="skill-card \${installedClass}" data-id="\${escapeHtml(skill.id)}">
            <div class="skill-header">
              <span class="skill-name">\${escapeHtml(skill.name)}</span>
              <input type="checkbox" class="skill-checkbox" 
                     onchange="toggleSelect('\${escapeHtml(skill.id)}')" 
                     \${isChecked} \${skill.isInstalled ? 'disabled' : ''} />
            </div>
            <p class="skill-description">\${escapeHtml(skill.description || 'No description')}</p>
            <div class="skill-tags">
              \${skill.category ? \`<span class="skill-tag category">\${escapeHtml(skill.category)}</span>\` : ''}
              \${(skill.tags || []).slice(0, 2).map(t => \`<span class="skill-tag">\${escapeHtml(t)}</span>\`).join('')}
            </div>
            <div class="skill-footer">
              <div class="skill-actions">
                <button onclick="openReadme('\${escapeHtml(skill.id)}')">📖</button>
              </div>
              <button class="btn btn-primary install-btn \${btnClass}" 
                      onclick="install('\${escapeHtml(skill.id)}')" \${btnDisabled}>\${btnText}</button>
            </div>
          </div>
        \`;
      }

      function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      function install(skillId) {
        vscode.postMessage({ command: 'install', skillId });
      }

      function toggleSelect(skillId) {
        if (selectedSkills.has(skillId)) {
          selectedSkills.delete(skillId);
        } else {
          selectedSkills.add(skillId);
        }
        updateSelectedCount();
      }

      function updateSelectedCount() {
        const count = selectedSkills.size;
        document.getElementById('selectedCount').textContent = count;
        document.getElementById('installSelectedBtn').disabled = count === 0;
      }

      function updateResultCount(count) {
        document.getElementById('resultCount').textContent = count + ' skills';
      }

      function installSelected() {
        if (selectedSkills.size === 0) return;
        vscode.postMessage({ command: 'installBatch', skillIds: Array.from(selectedSkills) });
        selectedSkills.clear();
        updateSelectedCount();
      }

      function refresh() {
        vscode.postMessage({ command: 'refresh' });
      }

      function openSettings() {
        // TODO: Open extension settings
      }

      function clearSearch() {
        document.getElementById('searchInput').value = '';
        document.getElementById('clearSearch').classList.add('hidden');
        vscode.postMessage({ command: 'clearSearch' });
        filterCategory('all');
      }

      function filterCategory(category) {
        activeCategory = category;
        renderCategories();
        vscode.postMessage({ command: 'filterCategory', category });
      }

      function setCardState(skillId, state) {
        const card = document.querySelector('[data-id="' + skillId + '"]');
        if (!card) return;
        const btn = card.querySelector('.install-btn');
        
        if (state === 'installing') {
          btn.classList.add('installing');
          btn.textContent = 'Installing...';
          btn.disabled = true;
        } else if (state === 'installed') {
          card.classList.add('installed');
          btn.classList.remove('installing');
          btn.classList.add('installed');
          btn.textContent = '✓ Installed';
          const checkbox = card.querySelector('.skill-checkbox');
          if (checkbox) {
            checkbox.checked = false;
            checkbox.disabled = true;
          }
        } else if (state === 'failed') {
          btn.classList.remove('installing');
          btn.textContent = 'Retry';
          btn.disabled = false;
        }
      }

      function showProgressModal(current, total, skillName) {
        document.getElementById('progressModal').classList.remove('hidden');
        document.getElementById('progressFill').style.width = ((current / total) * 100) + '%';
        document.getElementById('progressText').textContent = 'Installing ' + skillName + ' (' + current + '/' + total + ')';
      }

      function hideProgressModal() {
        document.getElementById('progressModal').classList.add('hidden');
      }

      function updateActivityPanel(status, log) {
        const indicator = document.getElementById('statusIndicator');
        indicator.className = 'status-indicator status-' + status;
        indicator.textContent = '● ' + status.charAt(0).toUpperCase() + status.slice(1);
        
        const logContainer = document.getElementById('activityLog');
        logContainer.innerHTML = log.map(entry => 
          '<div class="log-entry"><span class="log-time">' + entry.time + '</span><span class="log-' + entry.type + '">' + escapeHtml(entry.message) + '</span></div>'
        ).join('');
      }

      // Search with debounce
      let searchTimeout;
      document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value;
        document.getElementById('clearSearch').classList.toggle('hidden', !query);
        searchTimeout = setTimeout(() => {
          vscode.postMessage({ command: 'search', query });
        }, 250);
      });
    `;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Dispose panel
   */
  public dispose(): void {
    SkillBrowserPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
