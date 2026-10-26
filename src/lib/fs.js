import fs from 'node:fs';
import path from 'node:path';

export function exists(p) {
  return fs.existsSync(p);
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

export function writeText(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

export function readJson(p) {
  return JSON.parse(readText(p));
}

export function writeJson(p, value) {
  return writeText(p, `${JSON.stringify(value, null, 2)}\n`);
}

export function listDir(p) {
  if (!exists(p)) return [];
  return fs.readdirSync(p, { withFileTypes: true });
}

export function copyTree(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else {
      let attempts = 0;
      while (attempts < 3) {
        try {
          fs.copyFileSync(from, to);
          break;
        } catch (e) {
          if (e.code === 'EBUSY' && attempts < 2) {
            attempts++;
            const end = Date.now() + 50;
            while (Date.now() < end) {}
          } else {
            throw e;
          }
        }
      }
    }
  }
}

export function removeDir(p) {
  if (exists(p)) fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', 'vendor', 'target']);

// Recursively list files under `root` as POSIX-style paths relative to root.
export function walkFiles(root, { maxDepth = 4, limit = 4000 } = {}) {
  const out = [];
  const visit = (dir, depth) => {
    if (out.length >= limit || depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.isDirectory() && (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else out.push(path.relative(root, full).replaceAll('\\', '/'));
    }
  };
  visit(root, 0);
  return out;
}

export function findUp(startDir, predicate) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
