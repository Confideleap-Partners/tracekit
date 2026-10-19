import { test } from 'node:test';
import assert from 'node:assert/strict';
import { core } from '../native';
import {
  endWebAction,
  getFaroInstance,
  getLastReference,
  getWebFetch,
  initFaro,
  initWebTracking,
  recordWebReference,
  resetWebTrackingForTests,
  startWebAction,
} from '../web';

interface CapturedCall {
  url: string;
  actionId: string | null;
}

function makeFetch(calls: CapturedCall[], options: { boom?: boolean } = {}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      actionId: new Headers(init?.headers as HeadersInit | undefined).get('x-action-id'),
    });
    if (url.endsWith('/boom')) {
      throw new Error('network down');
    }
    if (url.endsWith('/fail')) {
      return new Response('nope', {
        status: 503,
        headers: {
          'x-request-id': core().newRequestId(),
          'x-trace-id': core().newTraceId(),
          'x-workflow-id': core().newWorkflowId(),
          'x-failure-stage': 'database',
          'x-failure-service': 'central-backend',
        },
      });
    }
    return new Response('ok', {
      status: 200,
      headers: {
        'x-request-id': core().newRequestId(),
        'x-trace-id': core().newTraceId(),
        'x-workflow-id': core().newWorkflowId(),
      },
    });
  }) as typeof fetch;
}

test('web tracking captures the request, trace, and workflow references', async () => {
  resetWebTrackingForTests();
  const calls: CapturedCall[] = [];
  initWebTracking({
    app: 'irm-frontend',
    fetchImpl: makeFetch(calls),
    install: false,
  });

  const actionId = startWebAction('contact-support');
  assert.ok(actionId.startsWith('act_'));
  assert.ok(core().isValidUlid(actionId.slice(4)));

  const webFetch = getWebFetch();
  await webFetch('https://api.example/ok');
  let reference = getLastReference();
  assert.equal(reference?.actionId, actionId);
  assert.equal(reference?.actionName, 'contact-support');
  assert.ok(reference?.requestId?.startsWith('cp_'));
  assert.ok(reference?.traceId);
  assert.ok(reference?.workflowId?.startsWith('workflow_'));
  assert.equal(calls[0]?.actionId, actionId);

  await webFetch('https://api.example/fail');
  reference = getLastReference();
  assert.equal(reference?.failureStage, 'database');
  assert.equal(reference?.failureService, 'central-backend');
  assert.equal(reference?.httpStatus, 503);

  endWebAction();
});

test('web tracking records client.network when the request never reaches the server', async () => {
  resetWebTrackingForTests();
  initWebTracking({
    app: 'irm-frontend',
    fetchImpl: makeFetch([], { boom: true }),
    install: false,
  });

  const webFetch = getWebFetch();
  await assert.rejects(() => webFetch('https://api.example/boom'), /network down/);
  const reference = getLastReference();
  assert.equal(reference?.failureStage, 'client.network');
  assert.equal(reference?.requestId, undefined);
});

test('recordWebReference lets custom transports feed the reference', () => {
  resetWebTrackingForTests();
  initWebTracking({ app: 'frontend', install: false });
  recordWebReference({
    requestId: `cp_${core().newUlid()}`,
    actionId: core().newActionId(),
    route: '/investors',
  });
  const reference = getLastReference();
  assert.equal(reference?.app, 'frontend');
  assert.equal(reference?.route, '/investors');
  assert.ok(reference?.requestId?.startsWith('cp_'));
});

test('initFaro uses the injected SDK and runtime collector URL', () => {
  resetWebTrackingForTests();
  const calls: unknown[] = [];
  const instances: unknown[] = [];
  const sdk = {
    initializeFaro(options: unknown) {
      calls.push(options);
      const instance = { options };
      instances.push(instance);
      return instance;
    },
  };
  const initialized = initFaro({
    collectorUrl: 'https://faro.example/collect',
    appName: 'irm-frontend',
    environment: 'production',
    sdk,
  });
  assert.equal(initialized, true);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { url: string }).url, 'https://faro.example/collect');
  assert.equal((calls[0] as { app: { name: string } }).app.name, 'irm-frontend');
  assert.equal(getFaroInstance(), instances[0]);

  resetWebTrackingForTests();
  assert.equal(initFaro({ collectorUrl: '', appName: 'x' }), false);
});
