import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { deploy, deploymentSettings } from './lib/deployment.mjs';

if (!process.stdin.isTTY) {
  console.error(
    'Interactive setup needs a terminal. For CI, set the deployment secrets and use npm run deploy.'
  );
  process.exitCode = 1;
} else {
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!hidden) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  const abort = new AbortController();
  prompt.on('SIGINT', () => abort.abort());
  const ask = async (label, secret = false) => {
    hidden = secret;
    process.stdout.write(label);
    try {
      return await prompt.question('', { signal: abort.signal });
    } finally {
      if (secret) process.stdout.write('\n');
      hidden = false;
    }
  };
  try {
    console.log(
      'This builds and deploys a real Cloudflare instance. Activate R2 and create an API token first (docs/deployment.md).'
    );
    const env = { ...process.env };
    env.WORKER_NAME =
      (
        await ask(`Instance name [${env.WORKER_NAME || 'competitive-bingo'}]: `)
      ).trim() ||
      env.WORKER_NAME ||
      'competitive-bingo';
    env.CLOUDFLARE_ACCOUNT_ID ||= (await ask('Cloudflare account ID: ')).trim();
    env.CLOUDFLARE_API_TOKEN ||= (
      await ask('Cloudflare API token (hidden): ', true)
    ).trim();
    env.ADMIN_PASSWORD ||= await ask(
      'Admin password, 12+ characters (hidden; blank keeps an existing password): ',
      true
    );
    if (env.ADMIN_PASSWORD) {
      const repeated = await ask('Confirm admin password (hidden): ', true);
      if (env.ADMIN_PASSWORD !== repeated)
        throw new Error('Passwords did not match. Nothing was deployed.');
    }
    deploymentSettings(env);
    prompt.close();
    await deploy(env);
  } catch (error) {
    console.error(
      error.name === 'AbortError' ? 'Setup cancelled.' : error.message
    );
    process.exitCode = 1;
  } finally {
    prompt.close();
  }
}
