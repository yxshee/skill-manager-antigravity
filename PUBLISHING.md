# VS Code Extension Publishing Guide

Complete step-by-step guide to publish the Skill Manager extension.

---

## Prerequisites

- [x] Extension built successfully (`npm run compile`)
- [x] README.md with clear description
- [x] CHANGELOG.md documenting v1.0.0
- [x] Extension icon (128x128 PNG)
- [ ] Microsoft/Azure account (free)
- [ ] VS Code Marketplace publisher account

---

## Step 1: Create Azure DevOps Account

1. Go to [Azure DevOps](https://dev.azure.com/)
2. Click **"Start free"**
3. Sign in with your Microsoft account (or create one)
4. Complete the organization setup

---

## Step 2: Create Personal Access Token (PAT)

1. In Azure DevOps, click your **profile icon** (top right)
2. Select **"Personal access tokens"**
3. Click **"+ New Token"**
4. Configure the token:
   - **Name**: `vscode-marketplace`
   - **Organization**: Select your organization or "All accessible organizations"
   - **Expiration**: Choose duration (max 1 year)
   - **Scopes**: Click **"Custom defined"**, then:
     - Find **"Marketplace"** section
     - Check **"Manage"** (full access)
5. Click **"Create"**
6. **IMPORTANT**: Copy the token immediately - you won't see it again!

> [!CAUTION]
> Save your PAT securely. If you lose it, you'll need to create a new one.

---

## Step 3: Create Marketplace Publisher

Open your terminal and run:

```bash
cd "/Users/venom/skill manager"
npx vsce create-publisher YOUR_PUBLISHER_NAME
```

When prompted:
- **Publisher name**: Your unique publisher ID (e.g., `venom-dev`)
- **Display name**: Your display name (e.g., `Venom Development`)
- **Email**: Your contact email
- **Personal Access Token**: Paste the PAT from Step 2

Example:
```
Publisher 'venom-dev' was successfully created.
```

---

## Step 4: Update package.json

Edit your `package.json` to use your publisher name:

```json
{
  "publisher": "YOUR_PUBLISHER_NAME",
  ...
}
```

For example, if your publisher name is `venom-dev`:
```json
{
  "publisher": "venom-dev",
  ...
}
```

---

## Step 5: Package the Extension

Create a `.vsix` file (the installable extension package):

```bash
cd "/Users/venom/skill manager"
npx vsce package
```

This creates: `skill-manager-antigravity-1.0.0.vsix`

> [!TIP]
> Test the package locally: 
> 1. In VS Code: Extensions → `...` menu → "Install from VSIX..."
> 2. Select the `.vsix` file
> 3. Verify extension works correctly

---

## Step 6: Publish to Marketplace

```bash
npx vsce publish
```

Or publish a specific version:
```bash
npx vsce publish 1.0.0
```

You'll see:
```
Publishing 'skill-manager-antigravity@1.0.0'...
Successfully published 'skill-manager-antigravity@1.0.0'!
```

---

## Step 7: Verify Publication

1. Go to [VS Code Marketplace](https://marketplace.visualstudio.com/)
2. Search for "Skill Manager Antigravity"
3. Verify your extension appears
4. Check the description, icon, and README render correctly

> [!NOTE]
> It may take 5-10 minutes for your extension to appear in search results.

---

## Quick Reference Commands

| Task | Command |
|------|---------|
| Create publisher | `npx vsce create-publisher NAME` |
| Package extension | `npx vsce package` |
| Publish extension | `npx vsce publish` |
| Publish specific version | `npx vsce publish 1.0.1` |
| Unpublish extension | `npx vsce unpublish PUBLISHER.EXTENSION` |
| Show extension info | `npx vsce show PUBLISHER.EXTENSION` |

---

## Updating the Extension

1. Update version in `package.json`:
   ```json
   "version": "1.0.1"
   ```

2. Update `CHANGELOG.md` with new changes

3. Package and publish:
   ```bash
   npx vsce publish
   ```

---

## Troubleshooting

### "Personal Access Token is invalid"
- Token may have expired
- Token may not have "Marketplace > Manage" scope
- Create a new PAT with correct permissions

### "Extension not found after publishing"
- Wait 5-10 minutes for indexing
- Verify at: `https://marketplace.visualstudio.com/items?itemName=PUBLISHER.EXTENSION`

### "Missing icon"
- Ensure `media/icon.png` exists
- Icon must be 128x128 pixels PNG

### "Invalid publisher"
- Run `npx vsce login YOUR_PUBLISHER_NAME` first
- Verify publisher name matches package.json

---

## Extension URLs After Publishing

- **GitHub Repository**: `https://github.com/yxshee/skill-manager-antigravity`
- **Marketplace Page**: `https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER.skill-manager-antigravity`
- **Install Command**: `ext install YOUR_PUBLISHER.skill-manager-antigravity`
