import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../hash-password.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = 'https://api.cloudflare.com/client/v4';

export function deploymentSettings(env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const workerName = env.WORKER_NAME?.trim() || 'competitive-bingo';
  const password = env.ADMIN_PASSWORD || undefined;
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '')) {
    throw new Error(
      'Set CLOUDFLARE_ACCOUNT_ID to the 32-character account ID from Cloudflare.'
    );
  }
  if (!apiToken)
    throw new Error('Set CLOUDFLARE_API_TOKEN to an account-scoped API token.');
  if (!/^[a-z0-9][a-z0-9-]{1,49}[a-z0-9]$/.test(workerName)) {
    throw new Error(
      'WORKER_NAME must be 3–51 lowercase letters, numbers or hyphens, starting and ending with a letter or number.'
    );
  }
  if (password !== undefined && password.length < 12) {
    throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
  }
  return { accountId, apiToken, workerName, password };
}

export function cloudflareClient(settings, fetchImpl = globalThis.fetch) {
  return async (path, { method = 'GET', body, allowMissing = false } = {}) => {
    let response;
    try {
      response = await fetchImpl(
        `${apiRoot}/accounts/${settings.accountId}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${settings.apiToken}`,
            'Content-Type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(30_000),
        }
      );
    } catch {
      throw new Error(
        `Cloudflare ${method} ${path} failed. Check your connection and retry.`
      );
    }
    if (allowMissing && response.status === 404) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success !== true) {
      const codes = data?.errors?.map((error) => error.code).join(', ');
      throw new Error(
        `Cloudflare ${method} ${path} failed (HTTP ${response.status}${codes ? `, code ${codes}` : ''}). Check the account ID, token permissions and R2 activation.`
      );
    }
    return data;
  };
}

export async function ensureResources(api, workerName, log) {
  let database;
  // D1 names need not be unique. Refuse ambiguity rather than bind another event's data.
  for (let page = 1; ; page += 1) {
    const listing = await api(
      `/d1/database?name=${encodeURIComponent(workerName)}&per_page=100&page=${page}`
    );
    for (const candidate of listing.result) {
      if (candidate.name !== workerName) continue;
      if (database)
        throw new Error(
          `More than one D1 database is named ${workerName}. Rename the duplicate before deploying.`
        );
      database = candidate;
    }
    const totalPages =
      listing.result_info?.total_pages ??
      (listing.result_info?.total_count === undefined
        ? undefined
        : Math.ceil(listing.result_info.total_count / 100));
    if (
      totalPages === undefined
        ? listing.result.length < 100
        : page >= totalPages
    )
      break;
  }
  if (!database) {
    database = (
      await api('/d1/database', { method: 'POST', body: { name: workerName } })
    ).result;
    log(`Created D1 database: ${workerName}`);
  } else {
    log(`Reusing D1 database: ${workerName}`);
  }
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(database.uuid ?? '')
  ) {
    throw new Error(
      'Cloudflare did not return a valid D1 database ID. Deployment stopped.'
    );
  }

  const bucketName = `${workerName}-screenshots`;
  const bucket = await api(`/r2/buckets/${bucketName}`, { allowMissing: true });
  if (bucket === null) {
    await api('/r2/buckets', { method: 'POST', body: { name: bucketName } });
    log(`Created private screenshot bucket: ${bucketName}`);
  } else {
    log(`Reusing screenshot bucket: ${bucketName}`);
  }
  return { databaseId: database.uuid, databaseName: workerName, bucketName };
}

export function deploymentConfig(template, settings, resources, root) {
  return {
    ...template,
    // Resolve paths against the repo because the generated config is nested.
    $schema: resolve(root, 'node_modules/wrangler/config-schema.json'),
    name: settings.workerName,
    account_id: settings.accountId,
    main: resolve(root, template.main),
    assets: {
      ...template.assets,
      directory: resolve(root, template.assets.directory),
    },
    d1_databases: template.d1_databases.map((binding) => ({
      ...binding,
      database_name: resources.databaseName,
      database_id: resources.databaseId,
      migrations_dir: resolve(root, binding.migrations_dir),
    })),
    r2_buckets: template.r2_buckets.map((binding) => ({
      ...binding,
      bucket_name: resources.bucketName,
    })),
  };
}

// Do not pass production credentials to Vite or contract generation.
export function buildEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => !/^(CLOUDFLARE_|ADMIN_PASSWORD|SIGNING_KEY)/i.test(name)
    )
  );
}

function runNode(args, { root, env }) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      timeout: 10 * 60_000,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) accept();
      else
        reject(
          new Error(
            `Deployment command failed (${signal ?? `exit ${code}`}). See the output above.`
          )
        );
    });
  });
}

/** All external effects are injectable so deployment tests never build or contact Cloudflare. */
export async function deploy(env, dependencies = {}) {
  const settings = deploymentSettings(env);
  const {
    root = projectRoot,
    api = cloudflareClient(settings),
    run = runNode,
    files = { mkdir, mkdtemp, readFile, rm, writeFile },
    hash = hashPassword,
    signingKey = () => randomBytes(32).toString('hex'),
    log = console.log,
  } = dependencies;
  const template = JSON.parse(
    await files.readFile(join(root, 'wrangler.json'), 'utf8')
  );
  const existing = await api(
    `/workers/scripts/${settings.workerName}/secrets`,
    { allowMissing: true }
  );
  const secretNames = new Set(
    existing?.result.map((secret) => secret.name) ?? []
  );
  if (!settings.password && !secretNames.has('ADMIN_PASSWORD_HASH')) {
    throw new Error(
      'First deployment requires ADMIN_PASSWORD (at least 12 characters). No cloud resources have been created.'
    );
  }
  // Losing this key would invalidate every player token, session and evidence link.
  // Never silently repair a previously deployed instance by rotating it.
  if (existing !== null && !secretNames.has('SIGNING_KEY')) {
    throw new Error(
      'The existing Worker has no SIGNING_KEY. Restore its original secret before redeploying, or use a new WORKER_NAME for a fresh instance.'
    );
  }
  if (!env.npm_execpath)
    throw new Error(
      'Run this command through npm: npm run setup or npm run deploy.'
    );

  log(
    `Building ${settings.workerName} before creating or changing cloud resources…`
  );
  await run([env.npm_execpath, 'run', 'build'], {
    root,
    env: {
      ...buildEnvironment(env),
      CI: 'true',
      WRANGLER_SEND_METRICS: 'false',
    },
  });
  const resources = await ensureResources(api, settings.workerName, log);
  const config = deploymentConfig(template, settings, resources, root);
  const deployDirectory = join(root, '.cache/deploy');
  const configPath = join(deployDirectory, 'wrangler.json');
  await files.mkdir(deployDirectory, { recursive: true });
  await files.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const secrets = {};
  if (settings.password)
    secrets.ADMIN_PASSWORD_HASH = await hash(settings.password);
  if (existing === null) secrets.SIGNING_KEY = signingKey();
  const secretDirectory = await files.mkdtemp(
    join(deployDirectory, 'secrets-')
  );
  try {
    const secretsPath = join(secretDirectory, 'secrets.json');
    await files.writeFile(secretsPath, JSON.stringify(secrets), {
      mode: 0o600,
    });
    const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
    const commandEnv = {
      ...buildEnvironment(env),
      CLOUDFLARE_ACCOUNT_ID: settings.accountId,
      CLOUDFLARE_API_TOKEN: settings.apiToken,
      CI: 'true',
      WRANGLER_SEND_METRICS: 'false',
    };
    // Pending forward-only migrations run before code that depends on them.
    await run(
      [
        wrangler,
        'd1',
        'migrations',
        'apply',
        'DB',
        '--remote',
        '--config',
        configPath,
      ],
      { root, env: commandEnv }
    );
    await run(
      [
        wrangler,
        'deploy',
        '--config',
        configPath,
        '--secrets-file',
        secretsPath,
      ],
      { root, env: commandEnv }
    );
  } finally {
    await files.rm(secretDirectory, { recursive: true, force: true });
  }
  log(
    'Deployment published. Open the workers.dev URL printed above, then /admin, to create your first event.'
  );
  log(
    'Use that same HTTPS base URL in the RuneLite plugin. See docs/deployment.md for the trial checklist.'
  );
  if (env.GITHUB_STEP_SUMMARY) {
    await files.writeFile(
      env.GITHUB_STEP_SUMMARY,
      [
        '## Competitive Bingo deployed',
        '',
        `Worker and D1 database: \`${settings.workerName}\``,
        `Screenshot bucket: \`${resources.bucketName}\``,
        '',
        'Open the HTTPS workers.dev URL in the deployment log. Sign in at `/admin` with your ADMIN_PASSWORD.',
        'Use the same base URL in the RuneLite plugin, then enter the event join code.',
        'Follow the trial checklist in docs/deployment.md. No live verification was run by the workflow.',
        '',
      ].join('\n'),
      { flag: 'a' }
    );
  }
  return { workerName: settings.workerName, ...resources };
}
