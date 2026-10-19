#!/usr/bin/env node
/**
 * HTTP benchmarks: middleware overhead, downstream propagation, and saturation.
 * Run: npm run bench:http
 *
 * Note: autocannon runs in the same process as the servers, so absolute CPU is
 * shared between client and server. RPS and latency deltas are the meaningful
 * signal; the saturation run reports a conservative floor for single-process
 * capacity.
 */

import { createRequire } from 'node:module';
import express from 'express';
import autocannon from 'autocannon';

const require = createRequire(import.meta.url);
const { createLogger } = require('../dist/index.js');
const { requestContext, errorHandler } = require('../dist/express.js');
const { httpLogger } = require('../dist/logger.js');
const { tracedFetch, getResponseFailure } = require('../dist/fetch.js');
const { markFailure } = require('../dist/failure.js');
const { getNativeStatus } = require('../dist/native.js');

const nullLogger = createLogger({ service: 'bench', sink: () => {} });

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

function buildDownstream() {
  const app = express();
  app.use(requestContext());
  app.get('/ok', (req, res) => res.json({ requestId: req.tracekit.requestId }));
  app.get('/fail', (_req, _res, next) =>
    next(
      markFailure(Object.assign(new Error('db exploded'), { status: 503 }), {
        stage: 'database',
        service: 'downstream',
        status: 503,
      }),
    ),
  );
  app.use(errorHandler({ service: 'downstream', logger: nullLogger }));
  return app;
}

function buildUpstream(downstreamUrl, options = {}) {
  const app = express();
  app.use(requestContext());
  if (options.logger) app.use(httpLogger({ logger: options.logger }));
  app.get('/ok', async (req, res, next) => {
    try {
      const response = await tracedFetch(`${downstreamUrl}/ok`, {}, { serviceName: 'downstream' });
      const body = await response.json();
      res.json({ requestId: req.tracekit.requestId, downstreamRequestId: body.requestId });
    } catch (err) {
      next(err);
    }
  });
  app.get('/fail', async (_req, _res, next) => {
    try {
      const response = await tracedFetch(
        `${downstreamUrl}/fail`,
        {},
        { serviceName: 'downstream' },
      );
      const failure = getResponseFailure(response);
      const err = new Error('downstream failed');
      if (failure) markFailure(err, failure);
      throw err;
    } catch (err) {
      next(err);
    }
  });
  app.use(errorHandler({ service: 'upstream', logger: nullLogger }));
  return app;
}

async function run(name, urlPath, options = {}) {
  const server = await listen(options.app);
  const rssBefore = process.memoryUsage().rss;
  const result = await autocannon({
    url: `${server.url}${urlPath}`,
    connections: options.connections ?? 100,
    duration: options.duration ?? 10,
    pipelining: 1,
    ...(options.rate ? { overallRate: options.rate } : {}),
  });
  const rssAfter = process.memoryUsage().rss;
  await server.close();

  const row = {
    scenario: name,
    rateCap: options.rate ?? 'unlimited',
    rps: Math.round(result.requests.average),
    p50ms: result.latency.p50,
    p99ms: result.latency.p99,
    maxMs: result.latency.max,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    rssDeltaMB: Math.round((rssAfter - rssBefore) / 1024 / 1024),
  };
  console.log(JSON.stringify(row));
  return row;
}

const downstream = buildDownstream();
const downstreamServer = await listen(downstream);

const baseline = express();
baseline.get('/ok', (_req, res) => res.json({ ok: true }));

const contextOnly = express();
contextOnly.use(requestContext());
contextOnly.get('/ok', (req, res) => res.json({ requestId: req.tracekit.requestId }));

const contextLogger = express();
contextLogger.use(requestContext());
contextLogger.use(httpLogger({ logger: nullLogger }));
contextLogger.get('/ok', (req, res) => res.json({ requestId: req.tracekit.requestId }));

const rows = [];

rows.push(await run('baseline', '/ok', { app: baseline }));
rows.push(await run('context', '/ok', { app: contextOnly }));
rows.push(await run('context+httpLogger(noop sink)', '/ok', { app: contextLogger }));
rows.push(
  await run('upstream->downstream (tracedFetch)', '/ok', {
    app: buildUpstream(downstreamServer.url),
  }),
);
rows.push(
  await run('upstream->downstream+logger', '/ok', {
    app: buildUpstream(downstreamServer.url, { logger: nullLogger }),
  }),
);

// Target-load checks: 10M/day average and design peak.
for (const rate of [1200, 2800]) {
  rows.push(await run(`context+logger @ ${rate} rps`, '/ok', { app: contextLogger, rate }));
}

// Saturation: uncapped, more connections.
rows.push(
  await run('context+logger saturation', '/ok', {
    app: contextLogger,
    connections: 200,
    duration: 15,
  }),
);

await downstreamServer.close();

console.log(
  JSON.stringify(
    {
      node: process.version,
      cpus: (await import('node:os')).cpus().length,
      native: getNativeStatus(),
      results: rows,
    },
    null,
    2,
  ),
);
