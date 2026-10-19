import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWebCryptoAvailable,
  isValidBrowserUlid,
  isValidBrowserUuidV7,
  newBrowserUlid,
  newBrowserUuidV7,
  normalizeBrowserActionId,
  normalizeBrowserRequestId,
} from '../browser-core';

test('browser core is available and generates unique IDs', () => {
  assert.equal(isWebCryptoAvailable(), true);
  const ulids = new Set<string>();
  for (let i = 0; i < 1000; i += 1) {
    const id = newBrowserUlid();
    assert.ok(isValidBrowserUlid(id));
    ulids.add(id);
  }
  assert.equal(ulids.size, 1000);

  const uuid = newBrowserUuidV7();
  assert.ok(isValidBrowserUuidV7(uuid));
  assert.equal(uuid[14], '7');
});

test('browser core normalizes request and action IDs', () => {
  const ulid = newBrowserUlid();
  assert.equal(normalizeBrowserRequestId(`cp_${ulid}`), `cp_${ulid}`);
  assert.equal(normalizeBrowserRequestId(`req_${ulid}`), `req_${ulid}`);
  assert.equal(normalizeBrowserRequestId(ulid), `cp_${ulid}`);

  const uuid = newBrowserUuidV7();
  assert.equal(normalizeBrowserRequestId(`cp_${uuid}`), `cp_${uuid}`);
  assert.equal(normalizeBrowserRequestId(uuid), `cp_${uuid}`);

  assert.equal(normalizeBrowserActionId(`act_${ulid}`), `act_${ulid}`);
  assert.equal(normalizeBrowserActionId(ulid), `act_${ulid}`);
  assert.equal(normalizeBrowserRequestId('not-an-id'), null);
});
