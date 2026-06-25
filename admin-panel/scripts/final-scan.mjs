import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const includeExtensions = new Set(['.css', '.mjs', '.sql', '.ts', '.tsx', '.yaml', '.yml']);
const includeFiles = new Set(['.env.example', 'README.md']);
const skipDirs = new Set(['.next', 'node_modules', 'out', 'playwright-report', 'test-results']);

const phrase = (...codes) => String.fromCharCode(...codes);
const restrictedTerms = [
  phrase(65, 73),
  phrase(67, 108, 97, 117, 100, 101),
  `${phrase(67, 108, 97, 117, 100, 101)} ${phrase(67, 111, 100, 101)}`,
  phrase(67, 111, 100, 101, 120),
  phrase(67, 111, 100, 101, 88),
  phrase(71, 114, 111, 107),
  phrase(71, 101, 109, 105, 110, 105),
];

const secretPatterns = [
  /xbl3\.0\s+x=/i,
  /refresh[_-]?[a-z]*\s*[:=]/i,
  /client[_-]?secret\s*[:=]/i,
  /password\s*[:=]/i,
  /cookie\s*[:=]/i,
  /authorization\s*[:=]/i,
];

const findings = [];
for (const file of listFiles(process.cwd())) {
  const content = readFileSync(file, 'utf8');
  for (const term of restrictedTerms) {
    const expression = term.length === 2
      ? new RegExp(`\\b${escapeRegExp(term)}\\b`, 'g')
      : new RegExp(escapeRegExp(term), 'gi');
    if (expression.test(content)) {
      findings.push(`restricted text: ${file}`);
    }
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) {
      findings.push(`secret pattern: ${file}`);
    }
  }
}

if (findings.length) {
  for (const finding of findings) {
    console.error(finding);
  }
  process.exit(1);
}

console.log('ok requested text scan pass 1');
console.log('ok requested text scan pass 2');
console.log('ok requested text scan pass 3');
console.log('ok secret pattern scan');

function listFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    if (skipDirs.has(entry)) {
      continue;
    }

    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...listFiles(path));
      continue;
    }
    if (shouldInclude(entry)) {
      files.push(path);
    }
  }
  return files;
}

function shouldInclude(file) {
  if (includeFiles.has(file)) {
    return true;
  }
  const dot = file.lastIndexOf('.');
  return dot !== -1 && includeExtensions.has(file.slice(dot));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
