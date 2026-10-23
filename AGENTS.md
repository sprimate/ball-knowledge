# Ball Knowledge

Static Vite + TypeScript site (NBA draft/matchup/bracket simulator). Game UI is `src/main.ts`.

## Building and checking changes
- The host has **no Node/npm/npx**. Use Docker images that are already pulled: `node:22-alpine`, or
  `mcr.microsoft.com/playwright:v1.56.0-noble` (Node + browsers) for headless checks and screenshots.
- Mount the repo read-only and copy it inside the container, so `node_modules`/`dist` don't end up in the repo as
  root-owned files: `cp -r /src /app && cd /app && npm ci && npx tsc && npx vite build --base=/`.
- `vite.config.ts` sets base `/ball-knowledge/` (GitHub Pages). `vite preview` serves under that path; to serve at `/`,
  build with `--base=/` and serve `dist/` statically (e.g. `python3 -m http.server`).

## Deploy
- The Ball Knowledge tile on https://apps.sprimate.com is discovered from `homepage.*` Docker labels in
  `~/ball-knowledge/compose.yaml`, not from the game's HTML metadata. Its description is `homepage.description`.
  After changing labels, apply them with `docker compose -f ~/ball-knowledge/compose.yaml up -d --no-build`.
- Live at https://ball-knowledge.sprimate.com: the `ball-knowledge` container (127.0.0.1:3070), stack in
  `~/ball-knowledge/` (compose.yaml + Dockerfile + nginx.conf). It builds from this folder's working tree.
- **Editing source does not change the live site.** Rebuild: `cd ~/ball-knowledge && docker compose up -d --build`.
  That ships everything in the working tree, including uncommitted changes from other tickets.

## Release (central pipeline)
Built and deployed by the Conductor repo's pipeline from `.conductor/project.json`: one web target
(`deploy/ball-knowledge/Dockerfile`, nginx config and compose file in `deploy/ball-knowledge/`, stack
`~/ball-knowledge`, port 3070, ball-knowledge.sprimate.com). Review runs `ci-release`; `stage` (as the agent user)
puts a commit on staging-ball-knowledge.sprimate.com. The GitHub Pages workflow still works independently.

## ML data (`ml/`)
- `ml/` is the play-type win-probability network (data, dataset builder, training grid, report, `predict.py`); how to
  run each step is in `ml/README.md`, results in `ml/reports/REPORT.md` and on Docs. It isn't part of the site build.
  `ml/cache/` (dataset, trained models) is gitignored and rebuilt by the scripts.
- Docker here is rootless: run containers that write into the repo with `-u 0` (root in the container is `agent` on
  the host). `-u 1000:1000` maps to a subordinate uid and can't write to the worktree.
