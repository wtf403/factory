# wtfactory

One-command installer: GitHub App + Projects board + Agentic Workflows + ARC runner, for any repo.

```sh
npx wtfactory init OWNER/REPO
```

Excalidrop-style: no local server, GitHub is the backend, `gh` CLI does the auth.

## Flow

1. **App** — opens `github.com/apps/<slug>/installations/new`; install on the repo, come back.
2. **Board** — creates the Project V2 (`TODO|Analytics|InProgress|Test|Review|Completed` + fields) via API. Needs `project` scope once: `gh auth refresh -s project`.
3. **AW** — renders `templates/factory.md` (Pi harness, your gateway), compiles with `gh aw`, opens a `factory/setup` PR.
4. **Vars/secrets** — `PI_PROVIDER_BASE_URL`, `PI_MODEL`, `PROJECT_URL` as vars; provider key via hidden prompt straight into the repo secret.
5. **Runner** — writes `arc-scaleset.yaml`, prints the Helm install for your cluster.

## Commands

```sh
npx wtfactory init OWNER/REPO [--app slug] [--runner label] [--board-url URL] [--dry-run]
npx wtfactory board --owner LOGIN
npx wtfactory arc --org ORG
npx wtfactory doctor
```

Requires: `gh`, `gh extension install github/gh-aw`, `git`, node 18+.
