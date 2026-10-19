import { test } from 'node:test';
import assert from 'node:assert/strict';
import { core } from '../native';
import { createContextFromHeaders, currentContext, runWithContext } from '../context';
import {
  captureJobContext,
  createJobContext,
  runWithJobContext,
  runWithOrCreateJobContext,
} from '../bullmq';

test('job payloads carry request, action, job, and workflow context', async () => {
  const context = createContextFromHeaders({
    'x-action-id': core().newActionId(),
    'x-workflow-id': core().newWorkflowId(),
  });
  await runWithContext(context, async () => {
    const job = captureJobContext({ kind: 'reconcile' });
    assert.ok(job.tracekit);
    assert.equal(job.tracekit?.requestId, context.requestId);
    assert.equal(job.tracekit?.traceId, context.traceId);
    assert.equal(job.tracekit?.actionId, context.actionId);
    assert.equal(job.tracekit?.workflowId, context.workflowId);

    await runWithJobContext(job, async () => {
      const restored = currentContext();
      assert.equal(restored?.requestId, context.requestId);
      assert.equal(restored?.traceId, context.traceId);
      assert.equal(restored?.actionId, context.actionId);
      assert.equal(restored?.workflowId, context.workflowId);
    });
  });
  assert.equal(currentContext(), undefined);
});

test('createJobContext produces request, action, job, and workflow IDs for crons', async () => {
  const context = createJobContext('renewal-scan');
  assert.ok(core().isValidRequestId(context.requestId));
  assert.equal(context.jobId?.startsWith('job_'), true);
  assert.equal(context.actionId?.startsWith('act_'), true);
  assert.equal(context.workflowId?.startsWith('workflow_'), true);
  assert.equal(context.actionName, 'renewal-scan');
  assert.ok(/^[0-9a-f]{32}$/.test(context.traceId));

  await runWithOrCreateJobContext(undefined, 'engagement-score', async (ctx) => {
    assert.equal(currentContext()?.requestId, ctx.requestId);
    assert.equal(ctx.actionName, 'engagement-score');
    assert.ok(ctx.workflowId?.startsWith('workflow_'));
  });
});

test('runWithJobContext without a payload still runs the function', async () => {
  const result = await runWithJobContext(undefined, async () => 'ok');
  assert.equal(result, 'ok');
});
