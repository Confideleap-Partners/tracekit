#!/usr/bin/env node
/**
 * Emits one real log line per failure stage for documentation.
 * Run: node examples/failure-stages.cjs
 */

process.env.NODE_ENV = 'production';
process.env.TRACEKIT_ID_FORMAT = 'ulid';

const express = require('express');
const tracekit = require('../dist/index.js');
const { requestContext, errorHandler } = require('../dist/express.js');
const { httpLogger } = require('../dist/logger.js');
const { markFailure } = require('../dist/failure.js');
const { runWithOrCreateJobContext } = require('../dist/bullmq.js');

const STAGES = [
  ['auth.session', 401, 'session.expired'],
  ['auth.authorization', 403, 'pdp.denied'],
  ['validation.input', 400, 'input.invalid'],
  ['rate_limit', 429, 'rate.limit'],
  ['service.handler', 500, 'handler.crash'],
  ['database', 503, 'prisma.query'],
  ['downstream', 502, 'central.pdp'],
  ['queue.enqueue', 500, 'bullmq.add'],
  ['provider.external', 502, 'razorpay.charge'],
  ['unknown', 500, 'unexpected'],
];

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

async function main() {
  const logs = [];
  const logger = tracekit.createLogger({
    service: 'irm-backend',
    sink: (_line, record) => logs.push(record),
  });

  const app = express();
  app.use(requestContext());
  app.use(httpLogger({ logger }));
  app.get('/ok', (req, res) => res.json({ requestId: req.tracekit.requestId }));
  app.get('/fail', (req, res, next) => {
    const stage = String(req.query.stage);
    const entry = STAGES.find(([name]) => name === stage);
    if (!entry) return res.status(404).json({ error: 'unknown stage' });
    const [, status, operation] = entry;
    next(
      markFailure(Object.assign(new Error(`${stage} failure`), { status }), {
        stage,
        service: 'irm-backend',
        operation,
        status,
      }),
    );
  });
  app.use(errorHandler({ service: 'irm-backend', logger }));

  const server = await listen(app);

  const ok = await fetch(`${server.url}/ok`);
  const okId = ok.headers.get('x-request-id');
  const okLog = logs.find((record) => record.request_id === okId && record.msg === 'request completed');
  console.log(`STAGE success status=${ok.status}\n${JSON.stringify(okLog)}`);

  for (const [stage] of STAGES) {
    const response = await fetch(`${server.url}/fail?stage=${encodeURIComponent(stage)}`);
    const requestId = response.headers.get('x-request-id');
    const record = logs.find(
      (entry) =>
        entry.request_id === requestId &&
        (entry.msg === 'request failed' || entry.msg === 'request rejected'),
    );
    console.log(
      `STAGE ${stage} status=${response.status} header=${response.headers.get('x-failure-stage')} service=${response.headers.get('x-failure-service')} operation=${response.headers.get('x-failure-operation')}\n${JSON.stringify(record)}`,
    );
  }

  await server.close();

  await runWithOrCreateJobContext(undefined, 'renewal-scan', async (ctx) => {
    logger.error('job failed', {
      failure: { stage: 'queue.worker', service: 'worker', operation: 'renewal.scan' },
    });
    void ctx;
  });
  const jobLog = logs.find((record) => record.msg === 'job failed');
  console.log(`STAGE queue.worker (async)\n${JSON.stringify(jobLog)}`);

  const { recordWebReference, resetWebTrackingForTests, initWebTracking } = require('../dist/web.js');
  resetWebTrackingForTests();
  initWebTracking({ app: 'irm-frontend', install: false });
  recordWebReference({ route: '/investors', failureStage: 'client.network' });
  const { getLastReference } = require('../dist/web.js');
  console.log(`STAGE client.network (browser)\n${JSON.stringify(getLastReference())}`);
}

main().catch((err) => {
  console.error('stage sample failed:', err);
  process.exit(1);
});
