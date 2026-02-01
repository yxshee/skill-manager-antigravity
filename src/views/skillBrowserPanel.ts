import * as vscode from 'vscode';
import { GitHubService } from '../services/githubService';
import { SkillParser } from '../services/skillParser';
import { SkillInstaller } from '../services/skillInstaller';
import { Skill } from '../models/skill';

/**
 * Webview panel for browsing and installing skills
 */
export class SkillBrowserPanel {
  public static currentPanel: SkillBrowserPanel | undefined;
  private static readonly viewType = 'skillBrowser';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private skills: Skill[] = [];

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
        switch (message.command) {
          case 'install':
            await this.handleInstall(message.skillId);
            break;
          case 'installBatch':
            await this.handleBatchInstall(message.skillIds);
            break;
          case 'search':
            await this.handleSearch(message.query);
            break;
          case 'refresh':
            await this.loadSkills();
            break;
          case 'filterCategory':
            await this.handleCategoryFilter(message.category);
            break;
        }
      },
      null,
      this.disposables
    );

    // Load skills
    this.loadSkills();
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
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.joinPath(context.extensionUri, 'src', 'views', 'webview')
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
      this.panel.webview.html = this.getLoadingHtml();
      
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

      // Update UI
      this.panel.webview.html = this.getMainHtml();
      this.sendSkillsToWebview();

    } catch (error) {
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
   * Send skills data to webview
   */
  private sendSkillsToWebview(): void {
    this.panel.webview.postMessage({
      type: 'skills',
      skills: this.skills
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

    if (result.success) {
      skill.isInstalled = true;
      this.panel.webview.postMessage({
        type: 'installComplete',
        skillId,
        success: true
      });
    } else {
      this.panel.webview.postMessage({
        type: 'installComplete',
        skillId,
        success: false,
        error: result.error
      });
    }
  }

  /**
   * Handle batch installation
   */
  private async handleBatchInstall(skillIds: string[]): Promise<void> {
    const skillsToInstall = this.skills.filter(s => skillIds.includes(s.id) && !s.isInstalled);
    
    this.panel.webview.postMessage({
      type: 'batchInstallStart',
      total: skillsToInstall.length
    });

    let completed = 0;
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
      }
      completed++;
    }

    this.panel.webview.postMessage({
      type: 'batchInstallComplete',
      installed: completed
    });

    this.sendSkillsToWebview();
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
   * Get loading HTML
   */
  private getLoadingHtml(): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Loading Skills</title>
      <style>
        ${this.getStyles()}
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
          border: 4px solid rgba(255, 255, 255, 0.1);
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
      <script>
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
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Error</title>
      <style>
        ${this.getStyles()}
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
        .error-icon {
          font-size: 48px;
        }
        .error-message {
          color: var(--vscode-errorForeground);
          max-width: 500px;
        }
        .retry-btn {
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="error-container">
        <div class="error-icon">⚠️</div>
        <h2>Failed to load skills</h2>
        <p class="error-message">${this.escapeHtml(error)}</p>
        <button class="btn retry-btn" onclick="retry()">Retry</button>
      </div>
      <script>
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
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Skill Browser</title>
      <style>${this.getStyles()}</style>
    </head>
    <body>
      <div class="container">
        <header class="header">
          <h1>🧠 Antigravity Skill Browser</h1>
          <p class="subtitle">Browse and install skills for your Antigravity IDE</p>
        </header>
        
        <div class="toolbar">
          <div class="search-container">
            <input type="text" id="searchInput" class="search-input" placeholder="Search skills..." />
          </div>
          <div class="filter-container">
            <select id="categoryFilter" class="category-filter">
              <option value="all">All Categories</option>
              <option value="security">Security</option>
              <option value="engineering">Engineering</option>
              <option value="testing">Testing</option>
              <option value="documentation">Documentation</option>
              <option value="devops">DevOps</option>
              <option value="database">Database</option>
              <option value="creative">Creative</option>
              <option value="utility">Utility</option>
            </select>
          </div>
          <div class="actions">
            <button class="btn btn-secondary" onclick="refresh()">🔄 Refresh</button>
            <button class="btn btn-primary" id="installSelectedBtn" onclick="installSelected()" disabled>
              📦 Install Selected (<span id="selectedCount">0</span>)
            </button>
          </div>
        </div>
        
        <div class="stats">
          <span id="totalCount">0</span> skills available • 
          <span id="installedCount">0</span> installed
        </div>
        
        <div id="skillsGrid" class="skills-grid">
          <!-- Skills will be rendered here -->
        </div>
        
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
      
      <script>
        ${this.getScript()}
      </script>
    </body>
    </html>`;
  }

  /**
   * Get CSS styles
   */
  private getStyles(): string {
    return `
      :root {
        --bg-primary: var(--vscode-editor-background);
        --bg-secondary: var(--vscode-sideBar-background);
        --bg-card: var(--vscode-editorWidget-background);
        --text-primary: var(--vscode-editor-foreground);
        --text-secondary: var(--vscode-descriptionForeground);
        --border-color: var(--vscode-widget-border);
        --accent-color: var(--vscode-button-background);
        --accent-hover: var(--vscode-button-hoverBackground);
        --success-color: #28a745;
        --warning-color: #ffc107;
      }
      
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      
      body {
        font-family: var(--vscode-font-family);
        background: var(--bg-primary);
        color: var(--text-primary);
        line-height: 1.6;
      }
      
      .container {
        max-width: 1400px;
        margin: 0 auto;
        padding: 20px;
      }
      
      .header {
        text-align: center;
        margin-bottom: 30px;
        padding: 20px;
        background: linear-gradient(135deg, rgba(66, 133, 244, 0.1), rgba(156, 39, 176, 0.1));
        border-radius: 12px;
        border: 1px solid var(--border-color);
      }
      
      .header h1 {
        font-size: 2em;
        margin-bottom: 8px;
        background: linear-gradient(135deg, #4285f4, #9c27b0);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      
      .subtitle {
        color: var(--text-secondary);
      }
      
      .toolbar {
        display: flex;
        gap: 16px;
        margin-bottom: 20px;
        flex-wrap: wrap;
        align-items: center;
      }
      
      .search-container {
        flex: 1;
        min-width: 250px;
      }
      
      .search-input {
        width: 100%;
        padding: 10px 16px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 14px;
      }
      
      .search-input:focus {
        outline: none;
        border-color: var(--accent-color);
      }
      
      .category-filter {
        padding: 10px 16px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 14px;
        cursor: pointer;
      }
      
      .actions {
        display: flex;
        gap: 10px;
      }
      
      .btn {
        padding: 10px 20px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      
      .btn-primary {
        background: var(--accent-color);
        color: white;
      }
      
      .btn-primary:hover:not(:disabled) {
        background: var(--accent-hover);
        transform: translateY(-1px);
      }
      
      .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .btn-secondary {
        background: var(--bg-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
      }
      
      .btn-secondary:hover {
        background: var(--bg-card);
      }
      
      .stats {
        margin-bottom: 20px;
        color: var(--text-secondary);
        font-size: 14px;
      }
      
      .skills-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 16px;
      }
      
      .skill-card {
        background: var(--bg-card);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        padding: 20px;
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
      }
      
      .skill-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        border-color: var(--accent-color);
      }
      
      .skill-card.installed {
        border-left: 4px solid var(--success-color);
      }
      
      .skill-card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 12px;
      }
      
      .skill-name {
        font-size: 16px;
        font-weight: 600;
        margin: 0;
        word-break: break-word;
      }
      
      .skill-checkbox {
        width: 18px;
        height: 18px;
        cursor: pointer;
      }
      
      .skill-description {
        color: var(--text-secondary);
        font-size: 13px;
        margin-bottom: 12px;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      
      .skill-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      
      .skill-tag {
        background: rgba(66, 133, 244, 0.1);
        color: var(--accent-color);
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 500;
      }
      
      .skill-category {
        background: rgba(156, 39, 176, 0.1);
        color: #9c27b0;
      }
      
      .skill-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: auto;
      }
      
      .skill-repo {
        color: var(--text-secondary);
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 150px;
      }
      
      .install-btn {
        padding: 6px 14px;
        font-size: 12px;
      }
      
      .install-btn.installed {
        background: var(--success-color);
        cursor: default;
      }
      
      .install-btn.installing {
        background: var(--warning-color);
        color: #000;
      }
      
      .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      
      .modal.hidden {
        display: none;
      }
      
      .modal-content {
        background: var(--bg-card);
        padding: 30px;
        border-radius: 12px;
        min-width: 300px;
        text-align: center;
      }
      
      .progress-bar {
        width: 100%;
        height: 8px;
        background: var(--bg-secondary);
        border-radius: 4px;
        margin: 20px 0;
        overflow: hidden;
      }
      
      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-color), #9c27b0);
        border-radius: 4px;
        transition: width 0.3s ease;
        width: 0%;
      }
      
      .empty-state {
        text-align: center;
        padding: 60px 20px;
        color: var(--text-secondary);
      }
      
      .empty-state-icon {
        font-size: 48px;
        margin-bottom: 16px;
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
      let selectedSkills = new Set();
      
      // Handle messages from extension
      window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
          case 'skills':
            allSkills = message.skills;
            renderSkills(allSkills);
            updateStats();
            break;
          case 'searchResults':
          case 'filterResults':
            renderSkills(message.skills);
            break;
          case 'installStart':
            setCardInstalling(message.skillId, true);
            break;
          case 'installComplete':
            setCardInstalling(message.skillId, false);
            if (message.success) {
              setCardInstalled(message.skillId);
            }
            break;
          case 'batchInstallStart':
            showProgressModal(0, message.total, 'Starting...');
            break;
          case 'batchInstallProgress':
            showProgressModal(message.current, message.total, message.skillName);
            break;
          case 'batchInstallComplete':
            hideProgressModal();
            updateStats();
            break;
        }
      });
      
      function renderSkills(skills) {
        const grid = document.getElementById('skillsGrid');
        
        if (skills.length === 0) {
          grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><p>No skills found</p></div>';
          return;
        }
        
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
            <div class="skill-card-header">
              <h3 class="skill-name">\${escapeHtml(skill.name)}</h3>
              <input type="checkbox" class="skill-checkbox" 
                     onchange="toggleSelect('\${escapeHtml(skill.id)}')" 
                     \${isChecked} \${skill.isInstalled ? 'disabled' : ''} />
            </div>
            <p class="skill-description">\${escapeHtml(skill.description || 'No description available')}</p>
            <div class="skill-meta">
              \${skill.category ? \`<span class="skill-tag skill-category">\${escapeHtml(skill.category)}</span>\` : ''}
              \${(skill.tags || []).slice(0, 2).map(t => \`<span class="skill-tag">\${escapeHtml(t)}</span>\`).join('')}
            </div>
            <div class="skill-footer">
              <span class="skill-repo">\${escapeHtml(skill.repository)}</span>
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
      
      function installSelected() {
        if (selectedSkills.size === 0) return;
        vscode.postMessage({ command: 'installBatch', skillIds: Array.from(selectedSkills) });
        selectedSkills.clear();
        updateSelectedCount();
      }
      
      function refresh() {
        vscode.postMessage({ command: 'refresh' });
      }
      
      function updateStats() {
        document.getElementById('totalCount').textContent = allSkills.length;
        document.getElementById('installedCount').textContent = allSkills.filter(s => s.isInstalled).length;
      }
      
      function setCardInstalling(skillId, installing) {
        const card = document.querySelector(\`[data-id="\${skillId}"]\`);
        if (!card) return;
        const btn = card.querySelector('.install-btn');
        if (installing) {
          btn.classList.add('installing');
          btn.textContent = 'Installing...';
          btn.disabled = true;
        }
      }
      
      function setCardInstalled(skillId) {
        const card = document.querySelector(\`[data-id="\${skillId}"]\`);
        if (!card) return;
        card.classList.add('installed');
        const btn = card.querySelector('.install-btn');
        btn.classList.remove('installing');
        btn.classList.add('installed');
        btn.textContent = '✓ Installed';
        btn.disabled = true;
        const checkbox = card.querySelector('.skill-checkbox');
        checkbox.checked = false;
        checkbox.disabled = true;
      }
      
      function showProgressModal(current, total, skillName) {
        const modal = document.getElementById('progressModal');
        const fill = document.getElementById('progressFill');
        const text = document.getElementById('progressText');
        modal.classList.remove('hidden');
        fill.style.width = ((current / total) * 100) + '%';
        text.textContent = 'Installing ' + skillName + ' (' + current + '/' + total + ')';
      }
      
      function hideProgressModal() {
        document.getElementById('progressModal').classList.add('hidden');
      }
      
      // Search debounce
      let searchTimeout;
      document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          vscode.postMessage({ command: 'search', query: e.target.value });
        }, 300);
      });
      
      // Category filter
      document.getElementById('categoryFilter').addEventListener('change', (e) => {
        vscode.postMessage({ command: 'filterCategory', category: e.target.value });
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
