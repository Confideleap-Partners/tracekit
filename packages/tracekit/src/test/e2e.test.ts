import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

import { core } from '../native';
import { createMemoryLogger } from '../testing';
import { errorHandler, requestContext } from '../express';
import { httpLogger } from '../logger';
import { tracedFetch } from '../fetch';
import { captureJobContext, runWithJobContext } from '../bullmq';
import { markFailure } from '../failure';
import { getResponseFailure } from '../fetch';
import { initTelemetry, shutdownTelemetry } from '../otel';
import type { ExpressRequest } from '../express';

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

function listen(app: express.Express): Promise<TestServer> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function contextOf(req: unknown) {
  return (req as ExpressRequest).tracekit;
}

const exporter = new InMemorySpanExporter();
const bLogs = createMemoryLogger({ service: 'central-backend' });
const aLogs = createMemoryLogger({ service: 'irm-backend' });
const workerLogs = createMemoryLogger({ service: 'worker' });

let bServer!: TestServer;
let aServer!: TestServer;

async function start(): Promise<void> {
  await initTelemetry({
    service: 'tracekit-e2e',
    sampleRatio: 1,
    spanProcessor: new SimpleSpanProcessor(exporter),
    instrumentations: [],
  });

  const b = express();
  b.use(requestContext());
  b.use(httpLogger({ logger: bLogs.logger }));
  b.get('/ok', (req, res) => {
    res.json({
      ok: true,
      requestId: contextOf(req)?.requestId,
      workflowId: contextOf(req)?.workflowId,
    });
  });
  b.get('/fail', (_req, _res, next) => {
    const err = Object.assign(new Error('db exploded'), { status: 503 });
    next(
      markFailure(err, {
        stage: 'database',
        service: 'central-backend',
        operation: 'investor.create',
        status: 503,
      }),
    );
  });
  b.use(
    errorHandler({
      service: 'central-backend',
      logger: bLogs.logger,
    }) as unknown as express.ErrorRequestHandler,
  );
  bServer = await listen(b);

  const a = express();
  a.use(requestContext());
  a.use(httpLogger({ logger: aLogs.logger }));
  a.get('/work', async (req, res, next) => {
    try {
      const response = await tracedFetch(
        `${bServer.url}/ok`,
        { method: 'GET' },
        { serviceName: 'central-backend' },
      );
      const body = (await response.json()) as { requestId: string; workflowId?: string };
      const job = captureJobContext({ kind: 'reconcile' });
      await runWithJobContext(job, async () => {
        workerLogs.logger.info('job processed');
      });
      const context = contextOf(req);
      res.json({
        ok: true,
        requestId: context?.requestId,
        traceId: context?.traceId,
        workflowId: context?.workflowId,
        downstreamRequestId: body.requestId,
        downstreamWorkflowId: body.workflowId,
      });
    } catch (err) {
      next(err);
    }
  });
  a.get('/downstream-fail', async (_req, _res, next) => {
    try {
      const response = await tracedFetch(
        `${bServer.url}/fail`,
        { method: 'GET' },
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
  a.use(
    errorHandler({
      service: 'irm-backend',
      logger: aLogs.logger,
    }) as unknown as express.ErrorRequestHandler,
  );
  aServer = await listen(a);
}

before(async () => {
  await start();
});

after(async () => {
  await shutdownTelemetry();
  await Promise.all([aServer?.close(), bServer?.close()]);
});

test('a request keeps request, trace, and workflow IDs across services and async work', async () => {
  const workflowId = core().newWorkflowId();
  const response = await fetch(`${aServer.url}/work`, {
    headers: { 'x-workflow-id': workflowId },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    requestId: string;
    traceId: string;
    workflowId: string;
    downstreamRequestId: string;
    downstreamWorkflowId: string;
  };

  const requestId = response.headers.get('x-request-id') ?? '';
  const traceId = response.headers.get('x-trace-id') ?? '';
  assert.ok(core().isValidRequestId(requestId));
  assert.equal(response.headers.get('x-workflow-id'), workflowId);
  assert.equal(body.requestId, requestId);
  assert.equal(body.traceId, traceId);
  assert.equal(body.downstreamRequestId, requestId);
  assert.equal(body.workflowId, workflowId);
  assert.equal(body.downstreamWorkflowId, workflowId, 'workflow id propagates downstream');
  assert.ok(/^[0-9a-f]{32}$/.test(traceId));

  const aLog = aLogs.lines.find((line) => line.msg === 'request completed');
  const bLog = bLogs.lines.find((line) => line.msg === 'request completed');
  const workerLog = workerLogs.lines.find((line) => line.msg === 'job processed');
  assert.ok(aLog, 'upstream logs a completed request');
  assert.ok(bLog, 'downstream logs a completed request');
  assert.ok(workerLog, 'worker logs processed job');
  assert.equal(aLog?.request_id, requestId);
  assert.equal(bLog?.request_id, requestId);
  assert.equal(workerLog?.request_id, requestId);
  assert.equal(aLog?.trace_id, traceId);
  assert.equal(bLog?.trace_id, traceId);
  assert.equal(workerLog?.trace_id, traceId);
  assert.equal(aLog?.workflow_id, workflowId);
  assert.equal(bLog?.workflow_id, workflowId);
  assert.equal(workerLog?.workflow_id, workflowId);
});

test('a valid inbound request ID is preserved', async () => {
  const inbound = core().newRequestId();
  const response = await fetch(`${aServer.url}/work`, {
    headers: { 'x-request-id': inbound },
  });
  assert.equal(response.headers.get('x-request-id'), inbound);
  const body = (await response.json()) as { requestId: string };
  assert.equal(body.requestId, inbound);
});

test('downstream failures record where the request got stuck', async () => {
  const response = await fetch(`${aServer.url}/downstream-fail`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('x-failure-stage'), 'database');
  assert.equal(response.headers.get('x-failure-service'), 'central-backend');

  const reference = response.headers.get('x-request-id') ?? '';
  assert.ok(core().isValidRequestId(reference));

  const failureLog = aLogs.lines.find((line) => {
    const meta = line.meta as { failure?: { stage?: string } } | undefined;
    return meta?.failure?.stage === 'database';
  });
  assert.ok(failureLog, 'upstream logs the downstream failure');
  assert.equal(failureLog?.request_id, reference);
});

test('OpenTelemetry receives a client span for the downstream call', () => {
  const spans = exporter.getFinishedSpans();
  const clientSpan = spans.find(
    (span) => span.attributes['http.request.method'] === 'GET' && span.name.includes('GET'),
  );
  assert.ok(clientSpan, 'client span exported');
  assert.equal(clientSpan?.attributes['http.request.method'], 'GET');
});
