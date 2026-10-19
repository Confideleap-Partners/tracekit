#!/usr/bin/env node
/**
 * Microbenchmarks: native Rust core vs TypeScript fallback and context helpers.
 * Run: npm run bench:micro
 */

import { createRequire } from 'node:module';
import { Bench } from 'tinybench';

const require = createRequire(import.meta.url);
const { createLogger } = require('../dist/index.js');
const { core, jsFallback, isNativeAvailable, getNativeStatus } = require('../dist/native.js');
const {
  createContextFromHeaders,
  injectTraceHeaders,
  runWithContext,
} = require('../dist/context.js');
const { captureJobContext, runWithJobContext } = require('../dist/bullmq.js');

const native = core();
const status = getNativeStatus();
void createLogger;

const traceId = native.newTraceId();
const spanId = native.newSpanId();
const traceparent = native.formatTraceparent(traceId, spanId, 1);
const redactPayload = JSON.stringify({
  authorization: 'Bearer secret',
  meta: { note: 'ok', nested: { password: 'secret', token: 'secret', visible: true } },
});
const baggage = 'tenant=ten_123,note=hello%20world';

const bench = new Bench({ time: 1000, warmupTime: 200 });

bench.add('native.newRequestId', () => native.newRequestId());
bench.add('fallback.newRequestId', () => jsFallback.newRequestId());
bench.add('native.newUlid', () => native.newUlid());
bench.add('fallback.newUlid', () => jsFallback.newUlid());
bench.add('native.newUuidv7', () => native.newUuidv7());
bench.add('fallback.newUuidv7', () => jsFallback.newUuidv7());
bench.add('native.newWorkflowId', () => native.newWorkflowId());
bench.add('native.formatTraceparent', () => native.formatTraceparent(traceId, spanId, 1));
bench.add('native.parseTraceparent', () => native.parseTraceparent(traceparent));
bench.add('fallback.parseTraceparent', () => jsFallback.parseTraceparent(traceparent));
bench.add('native.parseBaggage', () => native.parseBaggage(baggage));
bench.add('native.redactJson', () => native.redactJson(redactPayload, []));
bench.add('fallback.redactJson', () => jsFallback.redactJson(redactPayload, []));
bench.add('context.createFromHeaders', () => createContextFromHeaders({}));
bench.add('context.injectTraceHeaders', () => {
  const context = createContextFromHeaders({});
  runWithContext(context, () => injectTraceHeaders({}));
});
bench.add('async.captureJobContext', () => {
  const context = createContextFromHeaders({});
  runWithContext(context, () => captureJobContext({ kind: 'bench' }));
});
bench.add('async.runWithJobContext', async () => {
  const context = createContextFromHeaders({});
  const job = runWithContext(context, () => captureJobContext({ kind: 'bench' }));
  await runWithJobContext(job, async () => undefined);
});

await bench.run();

console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      nativeAvailable: isNativeAvailable(),
      nativeStatus: status,
    },
    null,
    2,
  ),
);
console.table(
  bench.table().map((row) => ({
    task: row['Task name'],
    'throughput avg (ops/s)': row['Throughput avg (ops/s)'],
    'throughput med (ops/s)': row['Throughput med (ops/s)'],
    'latency avg (ns)': row['Latency avg (ns)'],
    'latency med (ns)': row['Latency med (ns)'],
  })),
);
