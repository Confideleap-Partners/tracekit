import { test } from 'node:test';
import assert from 'node:assert/strict';
import { core, isNativeAvailable, jsFallback, type NativeApi } from '../native';
import { createContextFromHeaders, injectTraceHeaders, runWithContext, currentContext } from '../context';

const implementations: Array<{ name: string; api: NativeApi }> = [
  { name: 'typescript', api: jsFallback },
];
if (isNativeAvailable()) {
  implementations.push({ name: 'native', api: core() });
}

test('core implementations agree on IDs, trace headers, baggage, and redaction', () => {
  assert.ok(implementations.length >= 1);
  for (const { name, api } of implementations) {
    const ulid = api.newUlid();
    assert.equal(ulid.length, 26, `${name}: ulid length`);
    assert.ok(api.isValidUlid(ulid), `${name}: ulid validity`);

    const uuid = api.newUuidv7();
    assert.equal(uuid.length, 36, `${name}: uuidv7 length`);
    assert.ok(api.isValidUuidv7(uuid), `${name}: uuidv7 validity`);
    assert.equal(uuid[14], '7', `${name}: uuidv7 version`);
    assert.ok(/[89ab]/.test(uuid[19]), `${name}: uuidv7 variant`);

    const requestId = api.newRequestId();
    assert.ok(requestId.startsWith('cp_'), `${name}: request prefix`);
    assert.ok(api.isValidUlid(requestId.slice(3)), `${name}: request body is a ulid`);
    assert.ok(api.isValidRequestId(requestId), `${name}: request validity`);
    assert.equal(api.normalizeRequestId(requestId), requestId, `${name}: request normalization`);
    assert.equal(api.normalizeRequestId('cp_not-a-uuid'), null, `${name}: rejects junk`);

    const uuidRequestId = `cp_${api.newUuidv7()}`;
    assert.equal(
      api.normalizeRequestId(uuidRequestId),
      uuidRequestId,
      `${name}: uuidv7 request id preserved`,
    );
    assert.ok(api.isValidRequestId(uuidRequestId), `${name}: uuidv7 request accepted`);

    const legacy = `req_${api.newUlid()}`;
    assert.equal(api.normalizeRequestId(legacy), legacy, `${name}: legacy ulid preserved`);
    assert.ok(api.isValidRequestId(legacy), `${name}: legacy ulid accepted`);

    const actionId = api.newActionId();
    assert.ok(actionId.startsWith('act_'), `${name}: action prefix`);
    assert.ok(api.isValidUlid(actionId.slice(4)), `${name}: action body is a ulid`);

    const jobId = api.newJobId();
    assert.ok(jobId.startsWith('job_'), `${name}: job prefix`);

    const workflowId = api.newWorkflowId();
    assert.ok(workflowId.startsWith('workflow_'), `${name}: workflow prefix`);
    assert.ok(api.isValidUlid(workflowId.slice(9)), `${name}: workflow body is a ulid`);
    assert.equal(
      api.normalizeWorkflowId(workflowId),
      workflowId,
      `${name}: workflow normalization`,
    );

    const traceId = api.newTraceId();
    const spanId = api.newSpanId();
    const traceparent = api.formatTraceparent(traceId, spanId, 1);
    assert.ok(traceparent, `${name}: formats traceparent`);
    const parsed = api.parseTraceparent(traceparent as string);
    assert.deepEqual(
      parsed,
      { traceId, spanId, flags: 1 },
      `${name}: traceparent round trip`,
    );
    assert.equal(
      api.parseTraceparent('00-00000000000000000000000000000000-0000000000000000-01'),
      null,
      `${name}: rejects zero trace id`,
    );
    assert.equal(
      api.parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'),
      null,
      `${name}: rejects version ff`,
    );
    assert.equal(
      api.parseTraceparent('00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01'),
      null,
      `${name}: rejects uppercase trace id`,
    );

    const baggage = api.formatBaggage([
      { key: 'tenant', value: 'ten_123' },
      { key: 'note', value: 'hello world' },
    ]);
    assert.ok(baggage, `${name}: formats baggage`);
    const decoded = api.parseBaggage(baggage as string);
    assert.equal(decoded.length, 2, `${name}: baggage length`);
    assert.equal(decoded[1]?.value, 'hello world', `${name}: baggage value`);

    const redacted = api.redactJson(
      JSON.stringify({ authorization: 'Bearer x', password: 'y', note: 'ok' }),
      [],
    );
    assert.ok(redacted, `${name}: redacts json`);
    const parsedRedacted = JSON.parse(redacted as string);
    assert.equal(parsedRedacted.authorization, '[REDACTED]', `${name}: authorization redacted`);
    assert.equal(parsedRedacted.password, '[REDACTED]', `${name}: password redacted`);
    assert.equal(parsedRedacted.note, 'ok', `${name}: note preserved`);

    assert.equal(api.shouldSample(traceId, 1), true, `${name}: sample ratio 1`);
    assert.equal(api.shouldSample(traceId, 0), false, `${name}: sample ratio 0`);
    assert.equal(
      api.shouldSample(traceId, 0.5),
      api.shouldSample(traceId, 0.5),
      `${name}: sampling is deterministic`,
    );
  }
});

test('request context preserves valid inbound IDs and regenerates invalid ones', () => {
  const inbound = core().newRequestId();
  const inboundTrace = core().formatTraceparent(core().newTraceId(), core().newSpanId(), 1) as string;
  const actionId = core().newActionId();
  const workflowId = core().newWorkflowId();

  const preserved = createContextFromHeaders({
    'x-request-id': inbound,
    traceparent: inboundTrace,
    'x-action-id': actionId,
    'x-workflow-id': workflowId,
  });
  assert.equal(preserved.requestId, inbound);
  assert.equal(preserved.traceId, inboundTrace.split('-')[1]);
  assert.equal(preserved.traceparent, inboundTrace);
  assert.equal(preserved.actionId, actionId);
  assert.equal(preserved.workflowId, workflowId);

  const regenerated = createContextFromHeaders({ 'x-request-id': 'req_bogus' });
  assert.notEqual(regenerated.requestId, 'req_bogus');
  assert.ok(core().isValidRequestId(regenerated.requestId));
  assert.ok(/^[0-9a-f]{32}$/.test(regenerated.traceId));
});

test('injectTraceHeaders carries request, trace, action, and workflow IDs', () => {
  const context = createContextFromHeaders({
    'x-action-id': core().newActionId(),
    'x-workflow-id': core().newWorkflowId(),
  });
  runWithContext(context, () => {
    const headers = injectTraceHeaders({ 'content-type': 'application/json' });
    assert.equal(headers['x-request-id'], context.requestId);
    assert.equal(headers['x-action-id'], context.actionId);
    assert.equal(headers['x-workflow-id'], context.workflowId);
    assert.equal(headers.traceparent, context.traceparent);
    assert.ok(currentContext());
  });
  assert.equal(currentContext(), undefined, 'context does not leak');
});
