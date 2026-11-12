// Explicit launcher preference, including Node 22 releases without --use-env-proxy.
// Resolve the installation's existing dependency when loaded from the launcher cache.
const { createRequire } = require('node:module');
const { join } = require('node:path');
const mode = process.env.SP_DOWNLOAD_PROXY_MODE;
if (['system', 'manual', 'direct'].includes(mode)) {
  const load = createRequire(join(process.cwd(), 'package.json'));
  let transport;
  // Setup can install dependencies before its first request on a fresh source checkout.
  globalThis.fetch = (input, options) => {
    if (!transport) {
      const { fetch, Agent, EnvHttpProxyAgent } = load('undici');
      transport = { fetch, dispatcher: mode === 'direct' ? new Agent() : new EnvHttpProxyAgent() };
    }
    return transport.fetch(input, { ...options, dispatcher: transport.dispatcher });
  };
  // This marks our installed fetch, not Node's native startup proxy switch.
  globalThis[Symbol.for('stronghold.launcherDownloadProxy')] = true;
}
