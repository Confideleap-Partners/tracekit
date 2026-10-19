#!/usr/bin/env node
/**
 * Local end-to-end demo.
 *
 * Starts a central-like service and an irm-like service, then walks through a
 * successful request, a downstream failure, and async job context.
 * Run with: node packages/tracekit/examples/local-e2e.js
 */

const express = require('express');

const tracekit = require('../dist/index.js');
const { requestContext, errorHandler } = require('../dist/express.js');
const { httpLogger } = require('../dist/logger.js');
const { tracedFetch, getResponseFailure } = require('../dist/fetch.js');
const {
  captureJobContext,
  runWithJobContext,
  runWithOrCreateJobContext,
} = require('../dist/bullmq.js');
const { markFailure } = require('../dist/failure.js');
const { core } = require('../dist/native.js');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function main() {
  const logger = tracekit.createLogger({ service: 'demo' });

  const central = express();
  central.use(requestContext());
  central.use(httpLogger({ logger: tracekit.createLogger({ service: 'central-backend' }) }));
  central.get('/ok', (req, res) =>
    res.json({
      requestId: req.tracekit.requestId,
      workflowId: req.tracekit.workflowId,
    }),
  );
  central.get('/fail', (_req, _res, next) =>
    next(
      markFailure(Object.assign(new Error('database exploded'), { status: 503 }), {
        stage: 'database',
        service: 'central-backend',
        operation: 'investor.create',
        status: 503,
      }),
    ),
  );
  central.use(
    errorHandler({
      service: 'central-backend',
      logger: tracekit.createLogger({ service: 'central-backend' }),
    }),
  );
  const centralServer = await listen(central);

  const irm = express();
  irm.use(requestContext());
  irm.use(httpLogger({ logger: tracekit.createLogger({ service: 'irm-backend' }) }));
  irm.get('/work', async (req, res, next) => {
    try {
      const response = await tracedFetch(
        `${centralServer.url}/ok`,
        {},
        { serviceName: 'central-backend' },
      );
      const body = await response.json();
      const job = captureJobContext({ kind: 'reconcile' });
      await runWithJobContext(job, async () => {
        logger.info('worker processed job');
      });
      res.json({
        requestId: req.tracekit.requestId,
        traceId: req.tracekit.traceId,
        actionId: req.tracekit.actionId,
        workflowId: req.tracekit.workflowId,
        downstreamRequestId: body.requestId,
        downstreamWorkflowId: body.workflowId,
      });
    } catch (err) {
      next(err);
    }
  });
  irm.get('/downstream-fail', async (_req, _res, next) => {
    try {
      const response = await tracedFetch(
        `${centralServer.url}/fail`,
        {},
        { serviceName: 'central-backend' },
      );
      const failure = getResponseFailure(response);
      const err = new Error('downstream failed');
      if (failure) markFailure(err, failure);
      throw err;
    } catch (err) {
      next(err);
    }
  });
  irm.use(
    errorHandler({
      service: 'irm-backend',
      logger: tracekit.createLogger({ service: 'irm-backend' }),
    }),
  );
  const irmServer = await listen(irm);

  const workflowId = tracekit.generateWorkflowId();
  const actionId = tracekit.generateActionId();

  console.log('\n--- 1. happy path ---');
  const happy = await fetch(`${irmServer.url}/work`, {
    headers: { 'x-action-id': actionId, 'x-workflow-id': workflowId },
  });
  console.log('status:', happy.status);
  console.log('x-request-id:', happy.headers.get('x-request-id'));
  console.log('x-trace-id:', happy.headers.get('x-trace-id'));
  console.log('body:', await happy.json());

  console.log('\n--- 2. downstream failure ---');
  const failure = await fetch(`${irmServer.url}/downstream-fail`);
  console.log('status:', failure.status);
  console.log('x-request-id:', failure.headers.get('x-request-id'));
  console.log('x-failure-stage:', failure.headers.get('x-failure-stage'));
  console.log('x-failure-service:', failure.headers.get('x-failure-service'));

  console.log('\n--- 3. async context ---');
  await runWithOrCreateJobContext(undefined, 'reconcile-cron', async (ctx) => {
    console.log('worker request_id:', ctx.requestId);
    console.log('worker trace_id:', ctx.traceId);
    console.log('worker job_id:', ctx.jobId);
    console.log('worker action_id:', ctx.actionId);
    console.log('worker workflow_id:', ctx.workflowId);
  });

  console.log('\n--- 4. configured ID format ---');
  console.log('default request id:', core().newRequestId());
  console.log('workflow id:', tracekit.generateWorkflowId('uuidv7'));

  await Promise.all([irmServer.close(), centralServer.close()]);
  console.log('\ndemo complete');
}

main().catch((err) => {
  console.error('demo failed:', err);
  process.exit(1);
});
