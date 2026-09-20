import { mkdtempSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as clack from '@clack/prompts';
import { gh, ghJson, ghAwExtOk, ghAuthOk, repoExists, defaultBranch, have } from './gh.js';
import { createBoard } from './board.js';
import { openInstallPage, manifestInstallHint } from './app.js';
import { writeScaleSet, helmInstructions } from './arc.js';

const s = clack;
const note = (m, t = '') => s.log.message(m);

export function gatewayHost(baseUrl) {
  // Bare hostname/IP only: network.allowed rejects ports, paths, schemes.
  try {
    return new URL(baseUrl).hostname;
  } catch { return baseUrl.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]; }
}

export function preflight() {
  const missing = [];
  if (!have('gh')) missing.push('gh CLI (https://cli.github.com)');
  if (!ghAuthOk()) missing.push('gh auth login');
  if (!ghAwExtOk()) missing.push('gh extension install github/gh-aw');
  if (!have('git')) missing.push('git');
  return missing;
}

export async function stepApp({ appSlug, dry }) {
  s.log.step(`GitHub App: ${appSlug}`);
  note(`Install page opens in your browser. Install it on the target repo (or org), then come back.`);
  if (dry) return { opened: false };
  await openInstallPage(appSlug);
  await s.text({ message: 'Press Enter once the App is installed (type the installation id if you have it)', placeholder: 'Enter to continue' });
  return { opened: true };
}

export async function stepBoard({ owner, title, dry }) {
  s.log.step('Projects board (via GitHub API)');
  if (dry) return { url: '<board-url>' };
  const spin = s.spinner();
  spin.start('Creating Project V2 + fields');
  try {
    const proj = await createBoard({ owner, title });
    spin.stop(`Board ready: ${proj.url}`);
    return proj;
  } catch (e) {
    spin.stop('Board creation failed');
    if (e.message === 'NEED_PROJECT_SCOPE') {
      s.log.error('Token lacks the `project` scope (see .github/agent-factory note). Fix with:\n  gh auth refresh -s project\nthen re-run: npx wtfactory init OWNER/REPO');
    }
    throw e;
  }
}

export function renderFactory({ projectUrl, runnerLabel, piModel, gatewayHost }) {
  const tpl = readFileSync(new URL('../templates/factory.md', import.meta.url), 'utf8');
  return tpl
    .replaceAll('__PROJECT_URL__', projectUrl)
    .replaceAll('__RUNNER_LABEL__', runnerLabel)
    .replaceAll('__PI_MODEL__', piModel)
    .replaceAll('__PI_GATEWAY_HOST__', gatewayHost);
}

export async function stepWorkflows({ repo, branch, boardUrl, runnerLabel, piModel, piBase, dry }) {
  s.log.step('Agentic workflow (AW)');
  const host = gatewayHost(piBase);
  const body = renderFactory({ projectUrl: boardUrl, runnerLabel, piModel, gatewayHost: host });
  if (dry) return { branch, host };
  const dir = mkdtempSync(join(tmpdir(), 'wtfactory-'));
  try {
    let r = spawnSync('gh', ['repo', 'clone', repo, dir, '--', '--depth', '1'], { stdio: 'pipe', encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`clone failed: ${(r.stderr || '').slice(0, 500)}`);
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'factory.md'), body);
    r = spawnSync('gh', ['aw', 'compile', '--approve'], { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`gh aw compile failed:\n${(r.stderr || r.stdout || '').slice(0, 3000)}`);
    const base = defaultBranch(repo);
    spawnSync('git', ['-C', dir, 'checkout', '-b', branch], { stdio: 'ignore' });
    spawnSync('git', ['-C', dir, 'add', '.github/workflows/factory.md', '.github/workflows/factory.lock.yml'], { stdio: 'ignore' });
    spawnSync('git', ['-C', dir, '-c', 'user.name=wtfactory', '-c', 'user.email=wtfactory@localhost', 'commit', '-m', 'chore: install factory worker'], { stdio: 'ignore' });
    r = spawnSync('git', ['-C', dir, 'push', '-u', 'origin', branch], { stdio: 'pipe', encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`push failed: ${(r.stderr || '').slice(0, 500)}`);
    const pr = ghJson(['pr', 'create', '--repo', repo, '--head', branch, '--base', base,
      '--title', 'Install factory worker', '--body', `Board: ${boardUrl}\nMerge, then drag an issue TODO→Analytics.`]);
    s.log.success(`Setup PR: ${pr.url}`);
    return { branch, pr: pr.url, host };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function stepVarsSecrets({ repo, boardUrl, piBase, piModel, dry }) {
  s.log.step('Vars + secrets');
  const run = (args, input) => {
    if (dry) { note(`(dry) gh ${args.join(' ')}`); return; }
    const r = gh(args, input !== undefined ? { input } : {});
    if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || '').slice(0, 500)}`);
  };
  run(['variable', 'set', 'PI_PROVIDER_BASE_URL', '--repo', repo, '--body', piBase]);
  run(['variable', 'set', 'PI_MODEL', '--repo', repo, '--body', piModel]);
  run(['variable', 'set', 'PROJECT_URL', '--repo', repo, '--body', boardUrl]);
  if (dry) { note('(dry) secrets skipped'); return; }
  const piKey = await s.password({ message: 'PI gateway API key (hidden, goes straight to repo secret OPENAI_API_KEY)' });
  if (String(piKey || '').length) {
    run(['secret', 'set', 'OPENAI_API_KEY', '--repo', repo], String(piKey));
    s.log.success('OPENAI_API_KEY set');
  } else s.log.warn('Skipped OPENAI_API_KEY — set it later or Pi runs will fail');
  const appKey = await s.password({ message: 'App private key PEM (optional, Enter to skip — enables App-token Projects access)' });
  if (String(appKey || '').length) {
    const appId = await s.text({ message: 'App client ID (for APP_ID var)' });
    if (String(appId || '').length) {
      run(['variable', 'set', 'APP_ID', '--repo', repo, '--body', String(appId)]);
      run(['secret', 'set', 'APP_PRIVATE_KEY', '--repo', repo], String(appKey));
    }
  }
}

export async function stepRunner({ org, outDir, dry }) {
  s.log.step('ARC runner');
  const url = `https://github.com/${org}`;
  if (!dry) writeScaleSet(outDir || process.cwd(), { githubConfigUrl: url });
  note(helmInstructions('arc-factory'));
  if (dry) return;
  const set = await s.text({ message: 'Runner scale-set label in target repo (must match ARC)', initialValue: 'arc-factory' });
  return String(set || 'arc-factory');
}
