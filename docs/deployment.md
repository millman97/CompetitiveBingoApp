# Deployment reference

The [README](../README.md) covers GitHub deployment and starting an event. This
guide adds account setup, deployment from a clone and operational details.

## Before you start

1. Create a [Cloudflare account](https://dash.cloudflare.com/sign-up). In
   **Workers & Pages**, choose a `workers.dev` subdomain if prompted.
2. Activate **Storage & databases → R2 → Overview**. Cloudflare may require billing
   details even within the free allowance; check [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
   and [Workers usage limits](https://developers.cloudflare.com/workers/platform/pricing/).
3. Copy your 32-character **Account ID** from the dashboard.
4. Create an [API token](https://dash.cloudflare.com/?to=/:account/api-tokens) using
   **Edit Cloudflare Workers** as a starting template. Scope it to your account
   and include Account permissions **Workers Scripts: Edit**, **D1: Edit** and
   **Workers R2 Storage: Write**.

Choose a `WORKER_NAME`: 3–51 lowercase letters, numbers or hyphens, beginning and
ending with a letter or number. It defaults to `competitive-bingo`. Using the
same account and name reuses an instance; use a distinct name for another clan
or a disposable trial.

## Deploy from a clone

Install Node.js 24 LTS and Git, then run:

```sh
git clone https://github.com/millman97/CompetitiveBingoApp.git
cd CompetitiveBingoApp
npm ci
npm run setup
```

Use your fork's URL if appropriate. Setup prompts for the instance name, account
ID, API token and an admin password of at least 12 characters. Token/password
input is hidden and credentials are not saved for later runs.

Setup builds, creates or reuses storage, applies migrations and deploys. Open the
HTTPS URL printed by Wrangler. Sign in at `/admin`; players use that site's base
URL and the event join code in the RuneLite plugin.

## Deploy from a GitHub fork

Follow the [README's workflow steps](../README.md#from-a-github-fork). Deployment
is manual by default. Set the repository variable `AUTO_DEPLOY=true` to also deploy
pushes to the default branch. Pull requests and other branches do not deploy.
Avoid running local and GitHub deployments to the same instance simultaneously.

For other CI systems, set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
`WORKER_NAME` and, on first deployment, `ADMIN_PASSWORD`; run `npm ci` followed
by `npm run deploy`.

## Resources and updates

| Resource                     | Name                            |
| ---------------------------- | ------------------------------- |
| Worker and D1 database       | `WORKER_NAME`                   |
| Private R2 screenshot bucket | `WORKER_NAME-screenshots`       |
| Durable Objects              | Created by the Worker per event |

The tracked `wrangler.json` is a development template. Setup writes real resource
IDs to ignored `.cache/deploy/wrangler.json`; do not edit the template with
production IDs.

For local updates, update your checkout, run `npm ci` and rerun setup with the
same account/name. Leave the password blank to keep it. For GitHub, update the
fork and rerun Deploy; change `ADMIN_PASSWORD` in repository secrets to change
the password. After first deployment, omitting that secret retains the password.

The Worker receives a PBKDF2 password hash and a random signing key, generated
on first deployment. Updates preserve the key so player tokens and evidence
links remain valid. [Wrangler preserves secrets omitted from the uploaded file](https://developers.cloudflare.com/workers/configuration/secrets/#secrets-on-deployed-workers).
Temporary secret files are removed after success or failure; never share
`.cache/` or deployment credentials.

If a deployed Worker's `SIGNING_KEY` is missing, restore its original value in
Cloudflare settings. A replacement invalidates existing tokens and sessions.

Migrations are forward-only. Export D1 before schema-changing updates; reverting
code does not revert data. Failed deployments leave created resources available
for a retry. Removing a trial requires deleting its Worker, database and bucket.

## Your first trial

1. Open the site and `/api/health`; expect `{"ok":true,"schemaVersion":1}`.
2. Sign in, create a short event, connect the plugin and assign yourself to a team.
3. Check live scoring, screenshot evidence, a manual submission and an admin
   adjustment on the public board.
4. Redeploy with the same name. Confirm the event/evidence remain and the plugin
   still syncs without joining again.

## Troubleshooting

If login reports a PBKDF2 iteration error, keep `ADMIN_PASSWORD` set and redeploy.
The workflow regenerates its hash within Cloudflare's production limit.

| Problem                           | Check                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| Authentication / HTTP 403         | Account ID, token scope, expiry and Workers/D1/R2 permissions                         |
| R2 error                          | Complete R2 activation in the dashboard, then retry                                   |
| No site URL                       | Configure the account's `workers.dev` subdomain; find the URL in the Worker dashboard |
| First deployment needs a password | Supply `ADMIN_PASSWORD` or enter it in setup                                          |
| Unexpected existing data          | Choose a distinct `WORKER_NAME` for a new instance                                    |
| No Run workflow button            | Enable Actions and commit the workflow on the default branch                          |
| App error after deployment        | Inspect Worker logs; keep credentials out of shared diagnostics                       |
