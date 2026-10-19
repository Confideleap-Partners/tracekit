#!/usr/bin/env node
/**
 * Verifies the browser entry bundles without Node built-ins.
 * Run: node scripts/check-browser-bundle.mjs
 */

import { build } from 'esbuild';
import path from 'node:path';

const result = await build({
  entryPoints: [path.resolve('dist/web.js')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  target: ['es2022'],
  metafile: true,
  logLevel: 'silent',
});

const inputs = Object.keys(result.metafile.inputs);
const nodeRequires = Object.entries(result.metafile.inputs).flatMap(([input, meta]) =>
  (meta.imports ?? [])
    .filter((entry) => entry.path.startsWith('node:'))
    .map((entry) => `${input} -> ${entry.path}`),
);
const nodeBuiltins = inputs.filter((input) => input.startsWith('node:'));

if (nodeBuiltins.length || nodeRequires.length) {
  console.error('browser bundle must not import Node built-ins:');
  console.error([...nodeBuiltins, ...nodeRequires].join('\n'));
  process.exit(1);
}

const outputSize = result.outputFiles.reduce((total, file) => total + file.contents.byteLength, 0);
console.log(`browser bundle ok: ${(outputSize / 1024).toFixed(1)} KB (unminified)`);
