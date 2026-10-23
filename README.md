# Competitive Bingo

A self-hosted Old School RuneScape bingo app for clan events. Create your board,
organise teams and share a live public scoreboard. The
[RuneLite plugin](https://github.com/millman97/CompetitiveBingo) tracks players'
progress and sends it to your clan's own instance.

## Features

- **Three game modes:** Classic, Control and Rush.
- **Custom boards:** kills, completions, drops, collection log slots, fastest
  times, drops above a chosen value and most valuable drop.
- **Live public boards:** team standings, activity, player contributions and
  screenshot evidence.
- **Organiser tools:** event scheduling, board editing, team allocation and
  player readiness checks.
- **Manual scoring and review:** screenshot-backed submissions, flagged events
  and admin adjustments with recorded reasons.

## Deploy your own instance

The website and API run together on Cloudflare. Before deploying:

1. Create a Cloudflare account, enable Workers and activate R2 storage. R2 may
   require billing details even within its free allowance.
2. Get your Cloudflare account ID and create an API token with access to Workers,
   D1 and R2. The [account setup guide](docs/deployment.md#before-you-start) covers
   the required permissions.
3. Choose an instance name and an admin password of at least 12 characters.

### From a GitHub fork

1. Fork this repository and enable GitHub Actions.
2. Under **Settings → Secrets and variables → Actions**, add these repository
   secrets:

   | Secret                  | Value                      |
   | ----------------------- | -------------------------- |
   | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
   | `CLOUDFLARE_API_TOKEN`  | Your Cloudflare API token  |
   | `ADMIN_PASSWORD`        | Your chosen admin password |

3. Optionally add a repository variable, `WORKER_NAME`, for your instance name.
   It defaults to `competitive-bingo`.
4. Open **Actions → Deploy → Run workflow** on your default branch. The deployment
   log prints your instance's HTTPS URL.

### Start an event

1. Open `/admin` on your deployed site and sign in with your admin password.
2. Create an event, configure its schedule, teams and board, and share the public
   board link with your clan.
3. Players configure the RuneLite plugin with your site's HTTPS base URL and the
   event join code. Use the base URL without an `/admin`, `/g/...` or `/api` suffix.
4. Assign joined players to teams in the admin roster and check their readiness
   before the event starts.

### Updates

For GitHub deployments, update your fork and rerun the Deploy workflow. Event data
and player credentials are preserved.

See the [deployment guide](docs/deployment.md) for troubleshooting, credential
management and a first-event trial checklist.

## Development

See [local setup and development](docs/development.md) for running the app locally,
tests and the plugin simulator, and [architecture](docs/architecture.md) for the
server and scoring model.

## Licence

[BSD 2-Clause](LICENSE).
