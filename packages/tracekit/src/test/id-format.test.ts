import { test } from 'node:test';
import assert from 'node:assert/strict';
import { core } from '../native';
import { createContextFromHeaders } from '../context';
import {
  configureTraceKit,
  generateActionId,
  generateJobId,
  generateRequestId,
  generateWorkflowId,
  getIdFormat,
  resetTraceKitConfig,
} from '../ids';
import { createJobContext } from '../bullmq';
import { initTraceKit } from '../bootstrap';
import { resetWebTrackingForTests, startWebAction } from '../web';

test('defaults to cp_<ULID>', () => {
  resetTraceKitConfig();
  assert.equal(getIdFormat(), 'ulid');
  const id = generateRequestId();
  assert.ok(id.startsWith('cp_'));
  assert.ok(core().isValidUlid(id.slice(3)));

  assert.ok(generateActionId().startsWith('act_'));
  assert.ok(core().isValidUlid(generateActionId().slice(4)));
  assert.ok(generateJobId().startsWith('job_'));
  assert.ok(generateWorkflowId().startsWith('workflow_'));
  assert.ok(core().isValidUlid(generateWorkflowId().slice(9)));
});

test('generation can switch to cp_<UUIDv7> and back', () => {
  resetTraceKitConfig();
  configureTraceKit({ idFormat: 'uuidv7' });
  assert.equal(getIdFormat(), 'uuidv7');

  const requestId = generateRequestId();
  assert.ok(requestId.startsWith('cp_'));
  assert.ok(core().isValidUuidv7(requestId.slice(3)));

  assert.ok(core().isValidUuidv7(generateActionId().slice(4)));
  assert.ok(core().isValidUuidv7(generateJobId().slice(4)));
  assert.ok(core().isValidUuidv7(generateWorkflowId().slice(9)));

  const context = createContextFromHeaders({});
  assert.ok(core().isValidUuidv7(context.requestId.slice(3)));

  const jobContext = createJobContext('renewal-scan');
  assert.equal(jobContext.actionName, 'renewal-scan');
  assert.ok(jobContext.jobId?.startsWith('job_'));
  assert.ok(jobContext.workflowId?.startsWith('workflow_'));

  resetWebTrackingForTests();
  const actionId = startWebAction('contact-support', 'uuidv7');
  assert.ok(actionId.startsWith('act_'));
  assert.ok(core().isValidUuidv7(actionId.slice(4)));

  configureTraceKit({ idFormat: 'ulid' });
  assert.ok(core().isValidUlid(generateRequestId().slice(3)));
});

test('per-call idFormat overrides the global configuration', () => {
  resetTraceKitConfig();
  const ulidContext = createContextFromHeaders({}, { idFormat: 'ulid' });
  assert.ok(core().isValidUlid(ulidContext.requestId.slice(3)));

  const uuidContext = createContextFromHeaders({}, { idFormat: 'uuidv7' });
  assert.ok(core().isValidUuidv7(uuidContext.requestId.slice(3)));
});

test('inbound IDs are accepted in every supported format', () => {
  resetTraceKitConfig();

  const legacy = `req_${core().newUlid()}`;
  assert.equal(createContextFromHeaders({ 'x-request-id': legacy }).requestId, legacy);

  const ulid = `cp_${core().newUlid()}`;
  assert.equal(createContextFromHeaders({ 'x-request-id': ulid }).requestId, ulid);

  const uuid = `cp_${core().newUuidv7()}`;
  assert.equal(createContextFromHeaders({ 'x-request-id': uuid }).requestId, uuid);

  const bareUlid = core().newUlid();
  assert.equal(createContextFromHeaders({ 'x-request-id': bareUlid }).requestId, `cp_${bareUlid}`);

  configureTraceKit({ idFormat: 'uuidv7' });
  assert.equal(createContextFromHeaders({ 'x-request-id': ulid }).requestId, ulid);
  resetTraceKitConfig();
});

test('TRACEKIT_ID_FORMAT is applied on first read', () => {
  process.env.TRACEKIT_ID_FORMAT = 'uuidv7';
  try {
    resetTraceKitConfig();
    assert.equal(getIdFormat(), 'uuidv7');
  } finally {
    delete process.env.TRACEKIT_ID_FORMAT;
    resetTraceKitConfig();
  }
  assert.equal(getIdFormat(), 'ulid');
});

test('initTraceKit configures the ID format at the single bootstrap point', async () => {
  resetTraceKitConfig();
  const result = await initTraceKit({
    service: 'bootstrap-test',
    enabled: false,
    idFormat: 'uuidv7',
  });
  assert.equal(result.enabled, false);
  assert.equal(getIdFormat(), 'uuidv7');
  resetTraceKitConfig();
});
