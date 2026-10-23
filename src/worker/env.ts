// Worker bindings and configuration.
//
// Required configuration is never defaulted. A missing secret throws on first use with a message
// naming the thing to fix, because a server that silently invents a signing key is a server that
// issues tokens nobody can verify after the next deploy.

/**
 * Worker bindings.
 *
 * Generated from wrangler.json by `wrangler types`, with the secrets merged in by
 * src/worker/bindings.d.ts. Nothing here is hand-maintained, so a binding added to wrangler.json
 * cannot drift out of step with the code that reads it.
 */
export type Env = Cloudflare.Env;

/** The schema version this server speaks. A mismatch is answered with 409 and the plugin stops. */
export const SCHEMA_VERSION = 1;

const required = (value: string | undefined, name: string, fix: string): string => {
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. ${fix}`);
  }
  return value;
};

export const signingKey = (env: Env): string =>
  required(
    env.SIGNING_KEY,
    'SIGNING_KEY',
    'Re-run the deploy workflow, which generates and stores it.',
  );

export const adminPasswordHash = (env: Env): string =>
  required(
    env.ADMIN_PASSWORD_HASH,
    'ADMIN_PASSWORD_HASH',
    'Set the ADMIN_PASSWORD repository secret and re-run the deploy workflow.',
  );

export const minPluginVersion = (env: Env): string =>
  required(env.MIN_PLUGIN_VERSION, 'MIN_PLUGIN_VERSION', 'Set it in wrangler.json vars.');
