import open from 'open';

export const DEFAULT_APP_SLUG = 'wtfactory';

export function installUrl(appSlug) {
  return `https://github.com/apps/${appSlug}/installations/new`;
}

export async function openInstallPage(appSlug) {
  const url = installUrl(appSlug);
  await open(url);
  return url;
}

export function manifestInstallHint() {
  return [
    'No App yet? Create it once from this repo:',
    '  1. Open .github/agent-factory/create-app.html in your browser (logged in as the App owner)',
    '  2. Click "Create GitHub App from manifest"',
    '  3. Note the App slug, then re-run: npx wtfactory init OWNER/REPO --app <slug>',
  ].join('\n');
}
