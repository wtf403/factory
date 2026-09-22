#!/usr/bin/env node
// npx wtfactory — install the factory (App + board + AW + runner) into any repo.
import * as clack from '@clack/prompts';
import { preflight, stepApp, stepBoard, stepWorkflows, stepVarsSecrets, stepRunner } from '../lib/setup.js';
import { DEFAULT_APP_SLUG, manifestInstallHint } from '../lib/app.js';
import { ghAwExtOk, ghAuthOk, repoExists, have } from '../lib/gh.js';

const VERSION = '0.1.0';
const s = clack;

function help() {
  console.log(`wtfactory v${VERSION} — factory installer for any GitHub repo

Usage:
  npx wtfactory init OWNER/REPO [options]   full setup: App → board → AW → vars/secrets → runner
  npx wtfactory board --owner LOGIN          create Projects board only
  npx wtfactory arc --org ORG                print ARC install + write arc-scaleset.yaml
  npx wtfactory doctor                       check toolchain (gh, gh aw, git, auth)

init options:
  --app <slug>          GitHub App slug (default: ${DEFAULT_APP_SLUG})
  --runner <label>      ARC scale-set label (default: arc-factory)
  --board-title <t>     (default: Agent Factory)
  --pi-base <url>       Pi gateway base URL
  --pi-model <name>     Pi model id
  --board-url <url>     reuse existing board, skip creation
  --no-app              skip opening the App install page
  --dry-run             print the plan, change nothing
  --yes                 skip confirmations where safe
`);
}

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { help(); process.exit(0); }
if (cmd === '--version' || cmd === '-v') { console.log(VERSION); process.exit(0); }

const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  if (i === -1) return d;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) return true;
  return v;
};

async function doctor() {
  s.intro('wtfactory doctor');
  const rows = [
    ['node', process.version],
    ['gh', have('gh') ? 'ok' : 'MISSING'],
    ['gh auth', ghAuthOk() ? 'ok' : 'run: gh auth login'],
    ['gh aw', ghAwExtOk() ? 'ok' : 'run: gh extension install github/gh-aw'],
    ['git', have('git') ? 'ok' : 'MISSING'],
  ];
  for (const [k, v] of rows) console.log(`  ${k}: ${v}`);
  const bad = preflight();
  if (bad.length) { s.log.error(`Missing: ${bad.join(', ')}`); process.exit(1); }
  s.outro('All good');
}

async function cmdBoard() {
  const owner = flag('owner');
  if (!owner) { console.error('Usage: npx wtfactory board --owner LOGIN'); process.exit(1); }
  s.intro('wtfactory board');
  const missing = preflight();
  if (missing.length) { s.log.error(`Missing: ${missing.join(', ')}`); process.exit(1); }
  try {
    const proj = await stepBoard({ owner, title: flag('board-title', 'Agent Factory'), dry: flag('dry-run', false) });
    s.outro(`Board: ${proj.url}`);
  } catch (e) {
    s.log.error(e.message);
    if (e.message === 'NEED_PROJECT_SCOPE') console.log('\n' + 'Fix: gh auth refresh -s project');
    process.exit(1);
  }
}

async function cmdArc() {
  const org = flag('org');
  if (!org) { console.error('Usage: npx wtfactory arc --org ORG'); process.exit(1); }
  s.intro('wtfactory arc');
  const { writeScaleSet, helmInstructions } = await import('../lib/arc.js');
  const p = writeScaleSet(process.cwd(), { githubConfigUrl: `https://github.com/${org}` });
  s.log.success(`Wrote ${p}`);
  console.log('\n' + helmInstructions('arc-factory'));
  s.outro('Done');
}

async function cmdInit() {
  const repo = args[1];
  if (!repo || !repo.includes('/')) { console.error('Usage: npx wtfactory init OWNER/REPO [options]'); process.exit(1); }
  const dry = Boolean(flag('dry-run', false));
  const opts = {
    appSlug: flag('app', DEFAULT_APP_SLUG),
    runnerLabel: flag('runner', 'arc-factory'),
    boardTitle: flag('board-title', 'Agent Factory'),
    piBase: flag('pi-base', process.env.PI_PROVIDER_BASE_URL || 'http://77.110.124.102:8081'),
    piModel: flag('pi-model', process.env.PI_MODEL || 'claude-sonnet-4.5'),
    boardUrl: flag('board-url', null),
  };
  s.intro(`wtfactory init ${repo}${dry ? ' (dry run)' : ''}`);
  const missing = preflight();
  if (missing.length) { s.log.error(`Missing: ${missing.join(', ')}`); process.exit(1); }
  if (!repoExists(repo)) {
    s.log.error(`Repo not found: ${repo}`);
    console.log(manifestInstallHint());
    process.exit(1);
  }
  const owner = repo.split('/')[0];

  await stepApp({ appSlug: opts.appSlug, dry, skip: Boolean(flag('no-app', false)) });
  let boardUrl = opts.boardUrl;
  if (!boardUrl) {
    try {
      const proj = await stepBoard({ owner, title: opts.boardTitle, dry });
      boardUrl = proj.url;
    } catch (e) {
      s.log.error(e.message);
      if (e.message === 'NEED_PROJECT_SCOPE') console.log('\nFix: gh auth refresh -s project');
      process.exit(1);
    }
  } else s.log.message(`Reusing board: ${boardUrl}`);

  await stepWorkflows({ repo, branch: 'factory/setup', boardUrl, runnerLabel: opts.runnerLabel, piModel: opts.piModel, piBase: opts.piBase, dry });
  await stepVarsSecrets({ repo, boardUrl, piBase: opts.piBase, piModel: opts.piModel, dry });
  const label = await stepRunner({ org: owner, dry });
  if (!dry && label && label !== opts.runnerLabel) s.log.warn(`Runner label differs (${label}); update runs-on in a follow-up or re-run with --runner ${label}`);

  s.outro(dry ? 'Dry run complete — nothing changed' : 'Done. Merge the setup PR, add an issue to the board, drag TODO→Analytics.');
}

try {
  if (cmd === 'doctor') await doctor();
  else if (cmd === 'board') await cmdBoard();
  else if (cmd === 'arc') await cmdArc();
  else if (cmd === 'init') await cmdInit();
  else { console.error(`unknown command: ${cmd}`); help(); process.exit(1); }
} catch (e) {
  s.log.error(e.message || String(e));
  process.exit(1);
}
