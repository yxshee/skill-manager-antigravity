#!/usr/bin/env node
/**
 * Script to install all Antigravity skills from configured repositories
 * Run with: node scripts/install-all-skills.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const REPOSITORIES = [
  'rominirani/antigravity-skills',
  'sickn33/antigravity-awesome-skills'
];

const INSTALL_PATH = path.join(os.homedir(), '.gemini', 'antigravity', 'skills');
const GITHUB_API = 'https://api.github.com';
const RAW_GITHUB = 'https://raw.githubusercontent.com';

// Stats
let totalSkills = 0;
let installedSkills = 0;
let failedSkills = 0;

/**
 * Make HTTPS GET request
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Skill-Manager-Installer',
        'Accept': 'application/vnd.github+json'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Download raw file
 */
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Skill-Manager-Installer' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Find all skill directories (directories containing SKILL.md)
 */
async function findSkillDirectories(repo) {
  console.log(`\n📂 Fetching repository tree for ${repo}...`);
  
  const tree = await httpsGet(`${GITHUB_API}/repos/${repo}/git/trees/main?recursive=1`);
  const skillDirs = [];
  
  for (const node of tree.tree) {
    if (node.type === 'blob' && node.path.endsWith('SKILL.md')) {
      const dir = node.path.replace('/SKILL.md', '').replace('SKILL.md', '');
      skillDirs.push(dir || '.');
    }
  }
  
  console.log(`   Found ${skillDirs.length} skills in ${repo}`);
  return { tree: tree.tree, skillDirs };
}

/**
 * Install a single skill
 */
async function installSkill(repo, skillPath, tree) {
  const skillName = skillPath === '.' ? repo.split('/')[1] : skillPath.split('/').pop();
  const localPath = path.join(INSTALL_PATH, skillName);
  
  // Skip if already installed
  if (fs.existsSync(localPath)) {
    console.log(`   ⏭️  Skipping ${skillName} (already installed)`);
    return { success: true, skipped: true };
  }
  
  try {
    ensureDir(localPath);
    
    // Get files in this skill directory
    const prefix = skillPath === '.' ? '' : `${skillPath}/`;
    const files = tree.filter(node => {
      if (prefix) {
        if (!node.path.startsWith(prefix)) return false;
        const relativePath = node.path.slice(prefix.length);
        return !relativePath.includes('/'); // Only direct children
      } else {
        return !node.path.includes('/') && node.type === 'blob';
      }
    });
    
    // Download each file
    for (const file of files) {
      if (file.type !== 'blob') continue;
      
      const fileName = file.path.split('/').pop();
      const fileUrl = `${RAW_GITHUB}/${repo}/main/${file.path}`;
      
      try {
        const content = await downloadFile(fileUrl);
        fs.writeFileSync(path.join(localPath, fileName), content);
      } catch (err) {
        console.error(`      ⚠️  Failed to download ${fileName}: ${err.message}`);
      }
    }
    
    // Verify SKILL.md exists
    if (!fs.existsSync(path.join(localPath, 'SKILL.md'))) {
      fs.rmdirSync(localPath, { recursive: true });
      throw new Error('SKILL.md not found');
    }
    
    // Save metadata
    const metadata = {
      repository: repo,
      path: skillPath,
      installedAt: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(localPath, '.skill-manager.json'),
      JSON.stringify(metadata, null, 2)
    );
    
    console.log(`   ✅ Installed ${skillName}`);
    return { success: true };
    
  } catch (err) {
    console.error(`   ❌ Failed to install ${skillName}: ${err.message}`);
    // Clean up on failure
    if (fs.existsSync(localPath)) {
      fs.rmdirSync(localPath, { recursive: true });
    }
    return { success: false, error: err.message };
  }
}

/**
 * Install all skills from a repository
 */
async function installFromRepo(repo) {
  console.log(`\n🚀 Installing skills from ${repo}...`);
  
  try {
    const { tree, skillDirs } = await findSkillDirectories(repo);
    totalSkills += skillDirs.length;
    
    for (const skillPath of skillDirs) {
      const result = await installSkill(repo, skillPath, tree);
      if (result.success && !result.skipped) {
        installedSkills++;
      } else if (!result.success) {
        failedSkills++;
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (err) {
    console.error(`❌ Failed to process ${repo}: ${err.message}`);
  }
}

/**
 * Main installation function
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   🧠 Antigravity Skill Manager - Bulk Installer');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n📁 Install path: ${INSTALL_PATH}`);
  
  // Ensure install directory exists
  ensureDir(INSTALL_PATH);
  
  // Install from each repository
  for (const repo of REPOSITORIES) {
    await installFromRepo(repo);
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('   📊 Installation Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Total skills found:  ${totalSkills}`);
  console.log(`   Newly installed:     ${installedSkills}`);
  console.log(`   Failed:              ${failedSkills}`);
  console.log(`   Skipped (existing):  ${totalSkills - installedSkills - failedSkills}`);
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // List installed skills
  const installed = fs.readdirSync(INSTALL_PATH).filter(f => 
    fs.statSync(path.join(INSTALL_PATH, f)).isDirectory()
  );
  console.log(`\n📋 All installed skills (${installed.length}):`);
  installed.forEach(skill => console.log(`   • ${skill}`));
}

main().catch(console.error);
