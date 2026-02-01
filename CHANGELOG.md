# Changelog

All notable changes to the "Skill Manager for Google Antigravity" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-02-01

### Added
- **Hero Section**: Welcome banner explaining extension purpose and install path
- **Categories Sidebar**: Filterable category list with skill counts
- **Activity Panel**: Real-time status and timestamped activity log
- **Enhanced Skill Cards**: Improved layout with tags and secondary actions

### Changed
- TreeView now opens Skill Browser instead of raw markdown files
- Improved search filtering across name, description, tags, and category

### Security
- Added CSP headers with nonce-based scripts
- Implemented message validation for webview communication

## [1.0.0] - 2026-02-01

### Added
- Initial release
- Browse skills from configured GitHub repositories
- Beautiful webview-based skill browser with search and filtering
- One-click skill installation
- Batch install multiple skills at once
- Sidebar tree view for installed skills
- Quick install via command palette
- Manage installed skills (view, open folder, uninstall)
- ETag-based response caching for fast browsing
- Rate limit handling with informative error messages
- Category inference from skill names and paths
- Multi-repository support via configuration
- Dark/light theme support (syncs with VS Code)

### Security
- XSS prevention in webview
- Proper Content Security Policy for webview

## [Unreleased]

### Planned
- Skill update detection and one-click updates
- Skill ratings and reviews
- Import/export installed skills list
- Skill dependency resolution
