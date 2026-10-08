import { execFileSync } from 'node:child_process';
import { exists } from './fs.js';

export function git(args, cwd = process.cwd(), { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (allowFail) return null;
    const detail = err.stderr ? String(err.stderr).trim() : err.message;
    throw Object.assign(new Error(detail), { code: 'GIT_ERROR', exitCode: 1 });
  }
}

export function isGitRepo(dir) {
  return exists(`${dir}/.git`) && git(['rev-parse', '--is-inside-work-tree'], dir, { allowFail: true }) === 'true';
}

export function headSha(cwd) {
  return git(['rev-parse', 'HEAD'], cwd, { allowFail: true });
}

export function currentBranch(cwd) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, { allowFail: true });
}

export function commitAll(cwd, message) {
  git(['add', '-A'], cwd);
  git(
    ['-c', 'user.name=asdlc-bot', '-c', 'user.email=asdlc-bot@example.invalid', 'commit', '-m', message],
    cwd,
  );
  return headSha(cwd);
}

export function tag(cwd, name, { message } = {}) {
  if (message) git(['tag', '-a', name, '-m', message], cwd);
  else git(['tag', name], cwd);
  return name;
}

// TRUE only when `sha` is an ancestor of `ref` (i.e. actually merged into ref).
export function isAncestor(cwd, sha, ref) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, ref], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function commitInfo(cwd, sha) {
  const out = git(['log', '-1', '--format=%an%x09%ae%x09%s', sha], cwd, { allowFail: true });
  if (!out) return null;
  const [name, email, subject] = out.split('\t');
  return { name, email, subject };
}

// TRUE when `relPath` is committed (tracked) in this repo. Used to distinguish a
// committed schema copy (an override) from a CI-materialized working-tree copy.
export function isPathTracked(cwd, relPath) {
  const out = git(['ls-files', '--', relPath], cwd, { allowFail: true });
  return Boolean(out && out.trim());
}

// The last commit on `ref` that touched any of `paths` - this IS the "approved
// commit" (v6 4): path-limited, so review.md/tasks.md commits never move it.
export function lastCommitTouching(cwd, ref, paths = []) {
  if (!paths.length) return null;
  return git(['log', '-1', '--format=%H', ref, '--', ...paths], cwd, { allowFail: true }) || null;
}

// TRUE when the change dir already exists on `ref` (so this is a revision/impl,
// not a first spec PR).
export function changeOnRef(cwd, ref, slug) {
  return Boolean(git(['log', '-1', '--format=%H', ref, '--', `openspec/changes/${slug}/proposal.md`], cwd, { allowFail: true }));
}
