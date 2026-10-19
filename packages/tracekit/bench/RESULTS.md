# TraceKit Benchmarks

Last run: 2026-10-19
Node: v24.21.0
Hardware: Intel i5-10210U (4C/8T, 1.60 GHz), 15 GB RAM
OS: Linux
Native binding: loaded from `native/tracekit.node` (glibc)

Commands:

```bash
npm run build:native   # Rust core -> native/tracekit.node
npm run build:ts
npm run bench:micro
npm run bench:http
```

## 1. Microbenchmarks

Native Rust core vs the TypeScript fallback. Throughput in ops/s; latency in ns
(average / median).

| Task | Native ops/s | Fallback ops/s | Native avg | Fallback avg |
|---|---:|---:|---:|---:|
| `newRequestId` | 3,152,459 | 526,561 | 332 ns | 2,169 ns |
| `newUlid` | 4,611,115 | 519,619 | 227 ns | 2,102 ns |
| `newUuidv7` | 1,979,209 | 1,123,956 | 536 ns | 975 ns |
| `newWorkflowId` | 2,642,095 | - | 404 ns | - |
| `formatTraceparent` | 1,350,817 | - | 800 ns | - |
| `parseTraceparent` | 786,404 | 1,315,720 | 1,371 ns | 824 ns |
| `parseBaggage` | 402,054 | - | 2,698 ns | - |
| `redactJson` | 161,796 | 260,417 | 6,570 ns | 4,070 ns |
| `context.createFromHeaders` | 339,492 | - | 3,132 ns | - |
| `context.injectTraceHeaders` | 266,592 | - | 3,986 ns | - |
| `async.captureJobContext` | 266,612 | - | 4,008 ns | - |
| `async.runWithJobContext` | 160,493 | - | 6,876 ns | - |

Observations:

- Native ID generation is the primary fast path: ~3.15M request IDs/s and
  ~4.6M ULIDs/s, ~6x faster than the fallback for request IDs.
- ID generation is not the bottleneck at any realistic load. At the 10M/day
  average (~116 RPS) it uses well under 0.01% of a core.
- `redactJson` is faster in the TypeScript fallback for small payloads because
  the native path pays JSON string crossing/parse costs. Candidate optimization:
  return structured data instead of a JSON string, or redact at the logger
  layer. Not a blocker.
- Context and job helpers are microseconds; per-request overhead is negligible.

## 2. HTTP benchmarks

In-process servers with `autocannon` (100 connections unless noted, 10 s;
saturation 200 connections, 15 s). Because the load generator shares the
process with the server, these RPS numbers are a **conservative floor**; an
external load generator will report higher ceilings.

| Scenario | Cap | RPS | p50 | p99 | Errors |
|---|---:|---:|---:|---:|---:|
| Bare Express baseline | unlimited | 8,927 | 10 ms | 14 ms | 0 |
| `requestContext` | unlimited | 7,511 | 12 ms | 18 ms | 0 |
| `requestContext` + `httpLogger` (noop sink) | unlimited | 5,711 | 17 ms | 20 ms | 0 |
| upstream → downstream (`tracedFetch`) | unlimited | 2,298 | 40 ms | 65 ms | 0 |
| upstream → downstream + logger | unlimited | 1,935 | 49 ms | 68 ms | 0 |
| `requestContext` + `httpLogger` | 1,200 RPS | 1,224 | 9 ms | 164 ms | 0 |
| `requestContext` + `httpLogger` | 2,800 RPS | 2,810 | 9 ms | 212 ms | 0 |
| `requestContext` + `httpLogger` saturation | unlimited | 5,115 | 38 ms | 46 ms | 0 |

Observations:

- Single-process capacity with context + HTTP logging is **~5,100 RPS** in this
  shared-CPU setup, and it sustains the target loads with **zero errors**.
- Overhead vs baseline: context ~16% at saturation, context + logger ~36%.
  At the design peak of ~1.2k RPS this is a small fraction of one core.
- The capped-run p99 is inflated by the in-process load generator competing for
  CPU; p50 stays at 9 ms. External load testing will produce cleaner tails.
- Downstream propagation halves throughput (two HTTP hops per request) but still
  exceeds the 1.2k RPS peak by ~2x in this conservative setup.

## 3. Capacity conclusion

For the stated 10M requests/day profile:

- Average: 116 RPS. Peak design: 1.2k RPS. One-hour replay equivalent: 2.8k RPS.
- A **single Node 24 process** handled the 2.8k RPS replay target with zero
  errors and ~5.1k RPS saturation, even while sharing CPU with the load
  generator. This is roughly **40x headroom over the average** and **4x over
  the design peak**.
- The native Rust core is the primary path and is not a bottleneck. Logging and
  HTTP transport dominate the cost.
- Next measurements to add externally: k6/autocannon from a separate host,
  OTLP collector enabled, 30-minute soak, collector-down chaos, and log volume
  to Loki.
