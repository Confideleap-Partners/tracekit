import { test } from 'node:test';
import assert from 'node:assert/strict';
import { core, getNativeStatus, isNativeAvailable } from '../native';

test('native binding is primary and loads when required', () => {
  if (process.env.TRACEKIT_EXPECT_NATIVE !== 'true') {
    // Regular unit runs allow the TypeScript fallback. `npm run test:native`
    // sets TRACEKIT_EXPECT_NATIVE=true and builds the native addon first.
    return;
  }
  const status = getNativeStatus();
  assert.equal(status.available, true, `native unavailable: ${status.fallbackReason}`);
  assert.equal(isNativeAvailable(), true);
  assert.ok(status.loadedFrom, 'native load path is reported');

  const binding = core();
  const requestId = binding.newRequestId();
  assert.ok(requestId.startsWith('cp_'));
  assert.ok(binding.isValidUlid(requestId.slice(3)));

  const workflowId = binding.newWorkflowId();
  assert.ok(workflowId.startsWith('workflow_'));
  assert.ok(binding.isValidUlid(workflowId.slice(9)));
});
