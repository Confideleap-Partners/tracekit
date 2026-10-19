#!/usr/bin/env node
/**
 * Sample output: environment variables, HTTP response headers, emitted logs,
 * telemetry init, and headless Faro. Run: npm run sample
 */

process.env.NODE_ENV = 'production';
process.env.TRACEKIT_ID_FORMAT = 'ulid';
process.env.OTEL_SERVICE_NAME = 'irm-backend';
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://alloy.observability.svc:4318';
process.env.TELEMETRY_SAMPLE_RATIO = '0.2';

const express = require('express');
const tracekit = require('../dist/index.js');
const { requestContext, errorHandler } = require('../dist/express.js');
const { httpLogger } = require('../dist/logger.js');
const { markFailure } = require('../dist/failure.js');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

function printResponse(label, response, body) {
  console.log(`\n=== ${label} ===`);
  console.log(`HTTP ${response.status}`);
  for (const name of [
    'x-request-id',
    'x-trace-id',
    'x-action-id',
    'x-workflow-id',
    'x-failure-stage',
    'x-failure-service',
    'x-failure-operation',
  ]) {
    const value = response.headers.get(name);
    if (value) console.log(`${name}: ${value}`);
  }
  console.log('body:', JSON.stringify(body));
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
  app.get('/api/investors/:id', (req, res) => {
    res.json({
      ok: true,
      requestId: req.tracekit.requestId,
      traceId: req.tracekit.traceId,
      actionId: req.tracekit.actionId ?? null,
      workflowId: req.tracekit.workflowId ?? null,
    });
  });
  app.get('/api/reports/:id', (_req, _res, next) => {
    next(
      markFailure(Object.assign(new Error('database unavailable'), { status: 503 }), {
        stage: 'database',
        service: 'irm-backend',
        operation: 'reports.export',
        status: 503,
      }),
    );
  });
  app.use(errorHandler({ service: 'irm-backend', logger }));

  const server = await listen(app);
  const workflowId = tracekit.generateWorkflowId();
  const actionId = tracekit.generateActionId();

  const ok = await fetch(`${server.url}/api/investors/inv_123`, {
    headers: { 'x-action-id': actionId, 'x-workflow-id': workflowId },
  });
  printResponse('success', ok, await ok.json());

  const fail = await fetch(`${server.url}/api/reports/rep_9`);
  printResponse('downstream failure', fail, await fail.json());

  await server.close();

  console.log('\n=== emitted logs (one JSON line per request) ===');
  for (const record of logs) console.log(JSON.stringify(record));

  console.log('\n=== runtime ===');
  console.log(
    JSON.stringify(
      {
        idFormat: tracekit.getIdFormat(),
        native: tracekit.getNativeStatus(),
        openTelemetryApi: tracekit.hasOpenTelemetry(),
      },
      null,
      2,
    ),
  );

  const spanProcessor = {
    onStart() {},
    onEnd() {},
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  };
  const telemetry = await tracekit.initTelemetry({
    service: process.env.OTEL_SERVICE_NAME,
    environment: process.env.NODE_ENV,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    sampleRatio: Number(process.env.TELEMETRY_SAMPLE_RATIO),
    spanProcessor,
    instrumentations: [],
  });
  console.log('initTelemetry:', telemetry);
  await tracekit.shutdownTelemetry();

  const { initFaro, getFaroInstance } = require('../dist/web.js');
  const faroOk = initFaro({
    collectorUrl: 'https://faro.confideleap.com/collect',
    appName: 'irm-frontend',
    environment: 'production',
    sdk: { initializeFaro: (options) => ({ options }) },
  });
  console.log('initFaro:', faroOk, 'instance url:', getFaroInstance()?.options?.url);

  console.log('\n=== env used ===');
  for (const key of [
    'NODE_ENV',
    'TRACEKIT_ID_FORMAT',
    'OTEL_SERVICE_NAME',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'TELEMETRY_SAMPLE_RATIO',
  ]) {
    console.log(`${key}=${process.env[key]}`);
  }
}

main().catch((err) => {
  console.error('sample failed:', err);
  process.exit(1);
});
