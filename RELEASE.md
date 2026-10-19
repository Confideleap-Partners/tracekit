# Release Guide

## Versioning

- `@confideleap/tracekit` follows semantic versioning.
- The first public release is `0.1.0`, published under the `next` dist-tag.
- Promote to `1.0.0` after service integration, benchmarks, and UAT.
- Keep the npm version and the Cargo workspace version in sync.

## Preflight checklist

- [ ] `npm login` and confirm membership in the `@confideleap` npm org.
- [ ] CI green on Node 24 and Alpine.
- [ ] `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`.
- [ ] `npm test`, `npm run test:native`, `npm run test:coverage`.
- [ ] `npm run check:browser` (no Node built-ins, size budget).
- [ ] `npm run verify:pack` and inspect the file list.
- [ ] Install the packed tarball into a clean temp project and run a smoke request.
- [ ] `npm run bench` reviewed and `bench/RESULTS.md` updated.
- [ ] UAT: central-backend + irm-backend + login produce one correlated
      request/trace/workflow, and Grafana Request Lookup resolves the reference.
- [ ] Rollback verified with `TELEMETRY_ENABLED=false` and the TypeScript fallback.

## Publish

Platform native packages are built in CI with `napi-rs` for linux gnu/musl
x64/arm64 and macOS. The release workflow:

1. Builds `*.node` artifacts per target.
2. Creates platform packages (`@confideleap/tracekit-<platform-tag>`).
3. Publishes platform packages first.
4. Publishes the main package with provenance and the `next` tag.

Required repository secret: `NODE_AUTH_TOKEN` (an npm automation token with
publish rights for the `@confideleap` scope). Enable npm trusted publishing
(OIDC) when the org supports it.

## Manual publish (no CI)

```bash
cargo build -p tracekit-node --release
cp target/release/libtracekit_node.so packages/tracekit/native/tracekit.node
cd packages/tracekit
npm run build:ts
npm pack --dry-run
npm publish --provenance --access public --tag next
```

## Rollback

- Set `TELEMETRY_ENABLED=false` in the affected services.
- The native loader falls back to the TypeScript implementation when the addon
  is unavailable, so a bad native binary is not a hard outage.
- Revert the dependency version or use `npm deprecate` for a bad release.
- Avoid unpublishing after 24 hours; publish a patch instead.
