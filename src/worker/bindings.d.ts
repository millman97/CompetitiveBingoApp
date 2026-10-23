// Secrets, declared as part of the binding types.
//
// `wrangler types` generates Cloudflare.Env from wrangler.json, which lists vars and bindings but
// cannot know about secrets — those are pushed with `wrangler secret put` at deploy time. This
// augmentation merges them in so the Worker and the tests agree on one env shape.
//
// Both are optional at the type level and required at runtime: src/worker/env.ts throws a
// message naming the fix rather than letting an unset secret become an empty string.
declare namespace Cloudflare {
  interface Env {
    /** PBKDF2 hash of the admin password. Never the password itself. */
    ADMIN_PASSWORD_HASH?: string;
    /** HMAC key for player tokens, admin sessions and screenshot upload URLs. */
    SIGNING_KEY?: string;
  }
}
