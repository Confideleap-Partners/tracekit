import { test } from 'node:test';
import assert from 'node:assert/strict';
import { core } from '../native';
import { createContextFromHeaders, runWithContext } from '../context';
import { tracekitApolloPlugin } from '../apollo';
import { forwardedRequestHeaders, withNextRequestContext } from '../next';
import { createMemoryLogger, findLog } from '../testing';

test('apollo plugin attaches request/trace/failure IDs to errors without clobbering extensions', async () => {
  const context = createContextFromHeaders();
  context.failureStage = 'auth.authorization';
  context.failureService = 'central-backend';

  const plugin = tracekitApolloPlugin();
  const requestListener = await plugin.requestDidStart();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: any = {
    errors: [{ extensions: { code: 'FORBIDDEN' } }, {}],
  };

  await runWithContext(context, () =>
    requestListener.willSendResponse({ response }),
  );

  assert.equal(response.errors[0]?.extensions?.requestId, context.requestId);
  assert.equal(response.errors[0]?.extensions?.traceId, context.traceId);
  assert.equal(response.errors[0]?.extensions?.failureStage, 'auth.authorization');
  assert.equal(response.errors[0]?.extensions?.code, 'FORBIDDEN');
  assert.equal(response.errors[1]?.extensions?.requestId, context.requestId);
  assert.equal(response.extensions?.requestId, context.requestId);
});

test('next helpers derive context from headers and forward propagation headers', async () => {
  const inbound = core().newRequestId();
  const headers = new Headers({ 'x-request-id': inbound });

  const seen = await withNextRequestContext(headers, (context) => context.requestId);
  assert.equal(seen, inbound);

  const forwarded = forwardedRequestHeaders(headers);
  assert.equal(forwarded['x-request-id'], inbound);
  assert.ok(forwarded.traceparent.startsWith('00-'));
});

test('memory logger captures redacted records', () => {
  const sink = createMemoryLogger({ service: 'test-service' });
  sink.logger.info('hello', { token: 'secret', note: 'ok' });
  const record = findLog(sink, (line) => line.msg === 'hello');
  assert.ok(record);
  const meta = record?.meta as { token: string; note: string };
  assert.equal(meta.token, '[REDACTED]');
  assert.equal(meta.note, 'ok');
  assert.equal(record?.service, 'test-service');
});
