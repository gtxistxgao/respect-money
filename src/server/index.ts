import { buildApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const app = await buildApp(config);
try { await app.listen({ port: config.port, host: '127.0.0.1' }); }
catch (error) { await app.close(); throw error; }
console.log(`Respect Money: http://127.0.0.1:${config.port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
