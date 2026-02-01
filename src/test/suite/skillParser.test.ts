import * as assert from 'assert';
import { SkillParser } from '../../services/skillParser';

suite('SkillParser Test Suite', () => {
  let parser: SkillParser;

  setup(() => {
    parser = new SkillParser();
  });

  test('Parse skill with valid frontmatter', () => {
    const content = `---
name: Test Skill
description: A test skill for unit testing
category: testing
tags:
  - test
  - unit
author: Test Author
version: 1.0.0
---

# Test Skill

This is the body of the skill.
`;

    const metadata = parser.parseSkillMd(content);
    
    assert.strictEqual(metadata.name, 'Test Skill');
    assert.strictEqual(metadata.description, 'A test skill for unit testing');
    assert.strictEqual(metadata.category, 'testing');
    assert.deepStrictEqual(metadata.tags, ['test', 'unit']);
    assert.strictEqual(metadata.author, 'Test Author');
    assert.strictEqual(metadata.version, '1.0.0');
  });

  test('Parse skill without frontmatter', () => {
    const content = `# My Skill

This is a skill without YAML frontmatter. It should still extract a description from the body.
`;

    const metadata = parser.parseSkillMd(content);
    
    assert.strictEqual(metadata.name, 'Unknown Skill');
    assert.ok(metadata.description.includes('skill without YAML'));
  });

  test('Parse skill with minimal frontmatter', () => {
    const content = `---
name: Minimal Skill
---

# Minimal

Body content here.
`;

    const metadata = parser.parseSkillMd(content);
    
    assert.strictEqual(metadata.name, 'Minimal Skill');
    assert.strictEqual(metadata.description, 'Body content here.');
  });

  test('Validate skill with valid metadata', () => {
    const metadata = {
      name: 'Valid Skill',
      description: 'A valid description'
    };

    const result = parser.validateSkill(metadata);
    
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  test('Validate skill with missing name', () => {
    const metadata = {
      name: 'Unknown Skill',
      description: 'Some description'
    };

    const result = parser.validateSkill(metadata);
    
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.includes('name is required')));
  });

  test('Validate skill with missing description', () => {
    const metadata = {
      name: 'No Description Skill',
      description: ''
    };

    const result = parser.validateSkill(metadata);
    
    assert.strictEqual(result.isValid, true); // Warning, not error
    assert.ok(result.warnings.some(w => w.includes('description is recommended')));
  });

  test('Infer category from skill name', () => {
    assert.strictEqual(parser.inferCategory('Security Scanner', ''), 'security');
    assert.strictEqual(parser.inferCategory('Code Formatter', ''), 'engineering');
    assert.strictEqual(parser.inferCategory('Database Manager', ''), 'database');
    assert.strictEqual(parser.inferCategory('Test Runner', ''), 'testing');
    assert.strictEqual(parser.inferCategory('Docker Deploy', ''), 'devops');
    assert.strictEqual(parser.inferCategory('UI Designer', ''), 'creative');
    assert.strictEqual(parser.inferCategory('Random Name', ''), undefined);
  });

  test('Parse frontmatter with quoted values', () => {
    const content = `---
name: "Quoted Skill"
description: 'Single quoted desc'
---

Body
`;

    const metadata = parser.parseSkillMd(content);
    
    assert.strictEqual(metadata.name, 'Quoted Skill');
    assert.strictEqual(metadata.description, 'Single quoted desc');
  });
});
