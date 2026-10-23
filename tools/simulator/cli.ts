// Drives a whole event against a running server.
//
// The same scenario the tests run in-process, pointed at a URL instead. Use it against
// `wrangler dev` while checking the plugin's own dry run, or against a fresh deployment to prove
// the thing actually answers before an event starts.
//
// Usage: npm run simulate -- http://localhost:8787 SWAMP-TOAD-42

import { runFullEvent } from './scenario';

const [baseUrl, joinCode] = process.argv.slice(2);

if (baseUrl === undefined || joinCode === undefined) {
  console.error('Usage: npm run simulate -- <base-url> <join-code>');
  process.exit(1);
}

const transport = { fetch: (request: Request) => fetch(request) };

console.log(`Driving a full event against ${baseUrl} with join code ${joinCode}\n`);

const report = await runFullEvent({
  transport,
  baseUrl: baseUrl.replace(/\/$/, ''),
  joinCode,
  withScreenshots: true,
});

console.log(`players            ${report.players.join(', ')}`);
console.log(`submitted          ${report.submitted}`);
console.log(`accepted           ${report.accepted}`);
console.log(`  of which repeats ${report.duplicates}`);
console.log(`rejected           ${JSON.stringify(report.rejected)}`);
console.log(`screenshots        ${report.screenshotsSent} sent inside envelopes`);
console.log(`typed by hand      ${report.manualEntries}`);

// One deliberately untracked kill is expected. Anything else rejected means the server and the
// contract have parted company.
const unexpected = Object.entries(report.rejected).filter(
  ([reason, count]) => !(reason === 'NOT_TRACKED' && count === 1),
);

if (unexpected.length > 0) {
  console.error(`\nUnexpected rejections: ${JSON.stringify(Object.fromEntries(unexpected))}`);
  process.exit(1);
}

console.log('\nAll good.');
