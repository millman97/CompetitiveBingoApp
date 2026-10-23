import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import Ajv from 'ajv';
import { pbkdf2Sync } from 'node:crypto';
import { hashPassword } from '../hash-password.mjs';
import {
  buildEnvironment,
  cloudflareClient,
  deploy,
  deploymentConfig,
  deploymentSettings,
} from '../lib/deployment.mjs';

const template = JSON.parse(
  await readFile(new URL('../../wrangler.json', import.meta.url), 'utf8')
);
const env = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_API_TOKEN: 'test-token-never-sent',
  ADMIN_PASSWORD: 'a private test password',
  WORKER_NAME: 'test-clan',
  npm_execpath: '/mock/npm-cli.js',
};
const database = {
  name: 'test-clan',
  uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

test('deployment hashes support symbols and stay within the production Worker iteration limit', async () => {
  const password = 'A password with $! "quotes" and 雪';
  const stored = await hashPassword(password);
  const [algorithm, iterationCount, salt, digest] = stored.split('$');
  const iterations = Number(iterationCount);
  assert.equal(algorithm, 'pbkdf2');
  assert.ok(iterations > 0 && iterations <= 100_000);
  assert.equal(
    pbkdf2Sync(
      password,
      Buffer.from(salt, 'base64'),
      iterations,
      32,
      'sha256'
    ).toString('base64'),
    digest
  );
});

function fixture({ existing = false, failCommand, failApi } = {}) {
  const calls = [];
  const writes = new Map();
  const logs = [];
  const files = {
    readFile: async () => JSON.stringify(template),
    mkdir: async (...args) => calls.push(['mkdir', ...args]),
    mkdtemp: async (prefix) => `${prefix}mock`,
    writeFile: async (path, contents, options) => {
      writes.set(path, { contents, options });
      calls.push(['write', path]);
    },
    rm: async (...args) => calls.push(['rm', ...args]),
  };
  const api = async (path, options) => {
    calls.push(['api', path, options]);
    if (failApi) throw new Error('Mock Cloudflare failure');
    if (path.endsWith('/secrets')) {
      return existing
        ? { result: [{ name: 'SIGNING_KEY' }, { name: 'ADMIN_PASSWORD_HASH' }] }
        : null;
    }
    if (path.startsWith('/d1/database?'))
      return {
        result: existing ? [database] : [],
        result_info: { total_pages: 1 },
      };
    if (path === '/d1/database') return { result: database };
    if (path.startsWith('/r2/buckets/'))
      return existing ? { result: { name: 'test-clan-screenshots' } } : null;
    if (path === '/r2/buckets') return { result: { name: options.body.name } };
    throw new Error(`Unexpected mock request: ${path}`);
  };
  const run = async (args, options) => {
    calls.push(['run', args, options]);
    if (args.includes(failCommand)) throw new Error('Mock command failed');
  };
  return {
    calls,
    writes,
    logs,
    dependencies: {
      root: resolve('.'),
      files,
      api,
      run,
      hash: async () => 'hashed-password',
      signingKey: () => 'random-signing-key',
      log: (message) => logs.push(message),
    },
  };
}

test('first deployment builds, provisions, migrates and publishes with secrets, then removes the secret file', async () => {
  const mock = fixture();
  const result = await deploy(env, mock.dependencies);
  assert.equal(result.workerName, 'test-clan');
  const operations = mock.calls.filter(([type]) =>
    ['api', 'run', 'rm'].includes(type)
  );
  assert.deepEqual(
    operations.map(([type, arg]) =>
      type === 'run' ? arg[1] : type === 'api' ? arg.split('?')[0] : type
    ),
    [
      '/workers/scripts/test-clan/secrets',
      'run',
      '/d1/database',
      '/d1/database',
      '/r2/buckets/test-clan-screenshots',
      '/r2/buckets',
      'd1',
      'deploy',
      'rm',
    ]
  );
  const commands = operations.filter(([type]) => type === 'run');
  assert.deepEqual(commands[1][1].slice(1, 6), [
    'd1',
    'migrations',
    'apply',
    'DB',
    '--remote',
  ]);
  assert.ok(commands[2][1].includes('--secrets-file'));
  for (const [, , options] of commands) {
    assert.equal(options.env.ADMIN_PASSWORD, undefined);
    assert.equal(options.env.CI, 'true');
  }
  assert.equal(commands[0][2].env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(
    commands[1][2].env.CLOUDFLARE_API_TOKEN,
    env.CLOUDFLARE_API_TOKEN
  );
  const [, secretFile] = [...mock.writes].find(([path]) =>
    path.endsWith('secrets.json')
  );
  assert.deepEqual(JSON.parse(secretFile.contents), {
    ADMIN_PASSWORD_HASH: 'hashed-password',
    SIGNING_KEY: 'random-signing-key',
  });
  assert.equal(secretFile.options.mode, 0o600);
  assert.equal(
    JSON.stringify([...mock.writes]).includes(env.ADMIN_PASSWORD),
    false
  );
  assert.equal(mock.logs.join().includes('random-signing-key'), false);
  const config = JSON.parse(
    [...mock.writes].find(([path]) => path.endsWith('wrangler.json'))[1]
      .contents
  );
  assert.equal(config.d1_databases[0].database_id, database.uuid);
  assert.equal(config.d1_databases[0].migrations_dir, resolve('migrations'));
  assert.equal(config.assets.directory, resolve('dist/client'));
  assert.equal(config.main, resolve('src/worker/index.ts'));
  assert.deepEqual(config.migrations, template.migrations);
  assert.equal(config.workers_dev, true);
  assert.equal(JSON.stringify(config).includes('hashed-password'), false);
});

test('redeployment reuses storage and preserves the signing key and password', async () => {
  const mock = fixture({ existing: true });
  mock.dependencies.signingKey = () => {
    throw new Error('Must not rotate the signing key');
  };
  mock.dependencies.hash = () => {
    throw new Error('Must not change the password');
  };
  await deploy({ ...env, ADMIN_PASSWORD: '' }, mock.dependencies);
  assert.equal(
    mock.calls.some(
      ([type, , options]) => type === 'api' && options?.method === 'POST'
    ),
    false
  );
  const [, secretFile] = [...mock.writes].find(([path]) =>
    path.endsWith('secrets.json')
  );
  assert.deepEqual(JSON.parse(secretFile.contents), {});
});

test('an explicit password change does not rotate the signing key', async () => {
  const mock = fixture({ existing: true });
  await deploy(env, mock.dependencies);
  const [, secretFile] = [...mock.writes].find(([path]) =>
    path.endsWith('secrets.json')
  );
  assert.deepEqual(JSON.parse(secretFile.contents), {
    ADMIN_PASSWORD_HASH: 'hashed-password',
  });
});

test('a missing first-run password stops before building or provisioning', async () => {
  const mock = fixture();
  await assert.rejects(
    deploy({ ...env, ADMIN_PASSWORD: '' }, mock.dependencies),
    /First deployment requires/
  );
  assert.equal(mock.calls.length, 1);
});

test('a previously deployed Worker with a missing key cannot silently invalidate player tokens', async () => {
  const mock = fixture();
  mock.dependencies.api = async () => ({
    result: [{ name: 'ADMIN_PASSWORD_HASH' }],
  });
  await assert.rejects(
    deploy(env, mock.dependencies),
    /Restore its original secret/
  );
  assert.equal(mock.calls.length, 0);
});

test('an API permission failure stops without creating resources or publishing', async () => {
  const mock = fixture({ failApi: true });
  await assert.rejects(
    deploy(env, mock.dependencies),
    /Mock Cloudflare failure/
  );
  assert.equal(mock.calls.length, 1);
});

test('a failed build makes no cloud mutations', async () => {
  const mock = fixture({ failCommand: 'build' });
  await assert.rejects(deploy(env, mock.dependencies), /Mock command failed/);
  assert.equal(mock.calls.filter(([type]) => type === 'api').length, 1);
  assert.equal(mock.writes.size, 0);
});

for (const command of ['d1', 'deploy']) {
  test(`a failed ${command} command still removes temporary secrets`, async () => {
    const mock = fixture({ failCommand: command });
    await assert.rejects(deploy(env, mock.dependencies), /Mock command failed/);
    assert.equal(mock.calls.at(-1)[0], 'rm');
    if (command === 'd1') {
      assert.equal(
        mock.calls.some(
          ([type, args]) => type === 'run' && args.includes('deploy')
        ),
        false
      );
    }
  });
}

test('ambiguous database names stop deployment rather than attaching arbitrary data', async () => {
  const mock = fixture({ existing: true });
  const original = mock.dependencies.api;
  mock.dependencies.api = async (path, options) =>
    path.startsWith('/d1/database?')
      ? {
          result: [
            database,
            { ...database, uuid: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' },
          ],
        }
      : original(path, options);
  await assert.rejects(
    deploy(env, mock.dependencies),
    /More than one D1 database/
  );
  assert.equal(mock.calls.filter(([type]) => type === 'run').length, 1);
});

test('database lookup checks later pages and exact names', async () => {
  const mock = fixture({ existing: true });
  const original = mock.dependencies.api;
  const pages = [];
  mock.dependencies.api = async (path, options) => {
    if (!path.startsWith('/d1/database?')) return original(path, options);
    pages.push(path);
    return path.endsWith('page=1')
      ? {
          result: [{ ...database, name: 'test-clan-other' }],
          result_info: { total_pages: 2 },
        }
      : { result: [database], result_info: { total_pages: 2 } };
  };
  await deploy(env, mock.dependencies);
  assert.equal(pages.length, 2);
  assert.equal(
    mock.calls.some(
      ([type, path, options]) =>
        type === 'api' && path === '/d1/database' && options?.method === 'POST'
    ),
    false
  );
});

test('input validation prevents unsafe names and incomplete credentials', () => {
  for (const name of [
    '../bad',
    '-clan',
    'clan-',
    'Uppercase',
    'a'.repeat(52),
    'ab',
  ]) {
    assert.throws(
      () => deploymentSettings({ ...env, WORKER_NAME: name }),
      /WORKER_NAME/
    );
  }
  assert.throws(
    () => deploymentSettings({ ...env, CLOUDFLARE_ACCOUNT_ID: 'bad' }),
    /ACCOUNT_ID/
  );
  assert.throws(
    () => deploymentSettings({ ...env, CLOUDFLARE_API_TOKEN: '' }),
    /API_TOKEN/
  );
  assert.throws(
    () => deploymentSettings({ ...env, ADMIN_PASSWORD: 'short' }),
    /ADMIN_PASSWORD/
  );
  assert.equal(
    deploymentSettings({ ...env, WORKER_NAME: '' }).workerName,
    'competitive-bingo'
  );
});

test('the build environment excludes production secrets', () => {
  assert.deepEqual(
    buildEnvironment({
      PATH: 'bin',
      CLOUDFLARE_API_TOKEN: 'secret',
      ADMIN_PASSWORD_HASH: 'hash',
      ADMIN_PASSWORD: 'password',
      SIGNING_KEY: 'key',
    }),
    { PATH: 'bin' }
  );
});

test('a second instance receives separate storage names and account configuration', () => {
  const settings = deploymentSettings({
    ...env,
    WORKER_NAME: 'second-clan',
    CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32),
  });
  const config = deploymentConfig(
    template,
    settings,
    {
      databaseId: database.uuid,
      databaseName: 'second-clan',
      bucketName: 'second-clan-screenshots',
    },
    resolve('.')
  );
  assert.equal(config.account_id, 'b'.repeat(32));
  assert.equal(config.name, 'second-clan');
  assert.equal(config.d1_databases[0].database_name, 'second-clan');
  assert.equal(config.r2_buckets[0].bucket_name, 'second-clan-screenshots');
  assert.equal(template.name, 'competitive-bingo');
});

test('template and generated deployment config conform to the installed Wrangler schema', async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        '../../node_modules/wrangler/config-schema.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
  assert.equal(validate(template), true, JSON.stringify(validate.errors));
  const config = deploymentConfig(
    template,
    deploymentSettings(env),
    {
      databaseId: database.uuid,
      databaseName: database.name,
      bucketName: 'test-clan-screenshots',
    },
    resolve('.')
  );
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
});

test('API client distinguishes absent resources from forbidden access and sends scoped authorization', async () => {
  const requests = [];
  const api = cloudflareClient(
    deploymentSettings(env),
    async (url, options) => {
      requests.push([url, options]);
      return { status: 404 };
    }
  );
  assert.equal(await api('/r2/buckets/missing', { allowMissing: true }), null);
  assert.equal(
    requests[0][0],
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/missing`
  );
  assert.equal(
    requests[0][1].headers.Authorization,
    `Bearer ${env.CLOUDFLARE_API_TOKEN}`
  );
  const forbidden = cloudflareClient(deploymentSettings(env), async () => ({
    status: 403,
    ok: false,
    json: async () => ({ success: false, errors: [{ code: 10000 }] }),
  }));
  await assert.rejects(
    forbidden('/r2/buckets/missing', { allowMissing: true }),
    /HTTP 403, code 10000/
  );
});

test('API errors fail closed without printing response bodies or secrets', async () => {
  const api = cloudflareClient(deploymentSettings(env), async () => ({
    status: 200,
    ok: true,
    json: async () => ({
      success: false,
      errors: [{ code: 42, message: env.CLOUDFLARE_API_TOKEN }],
    }),
  }));
  await assert.rejects(
    api('/d1/database'),
    (error) =>
      error.message.includes('code 42') &&
      !error.message.includes(env.CLOUDFLARE_API_TOKEN)
  );
  const disconnected = cloudflareClient(deploymentSettings(env), async () => {
    throw new Error(env.CLOUDFLARE_API_TOKEN);
  });
  await assert.rejects(
    disconnected('/d1/database'),
    (error) => !error.message.includes(env.CLOUDFLARE_API_TOKEN)
  );
});
