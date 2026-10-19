/**
 * OpenTelemetry initialization.
 *
 * The SDK packages are optional. When they are missing, `initTelemetry`
 * returns `enabled: false` and TraceKit continues with pure context
 * propagation and logs.
 */

import { core } from './native';

export interface TelemetryOptions {
  service: string;
  environment?: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
  sampleRatio?: number;
  enabled?: boolean;
  /** Injection points for tests. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spanProcessor?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instrumentations?: any[];
  resourceAttributes?: Record<string, string>;
}

export interface TelemetryInitResult {
  enabled: boolean;
  reason?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdk: any = null;

function otlpTraceUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

/**
 * Start the Node SDK. Must be called before instrumented libraries are
 * imported by the application.
 */
export async function initTelemetry(options: TelemetryOptions): Promise<TelemetryInitResult> {
  if (options.enabled === false) return { enabled: false, reason: 'disabled by options' };
  if (process.env.TELEMETRY_ENABLED === 'false') {
    return { enabled: false, reason: 'TELEMETRY_ENABLED=false' };
  }
  if (sdk) return { enabled: true, reason: 'already initialized' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let NodeSdk: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let OTLPTraceExporter: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resourceFromAttributes: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let BatchSpanProcessor: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SamplingDecision: any = { NOT_RECORD: 0, RECORD_AND_SAMPLED: 2 };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ NodeSDK: NodeSdk } = require('@opentelemetry/sdk-node'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ resourceFromAttributes } = require('@opentelemetry/resources'));
  } catch {
    return {
      enabled: false,
      reason: '@opentelemetry/sdk-node and exporter packages are not installed',
    };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const traceBase = require('@opentelemetry/sdk-trace-base');
    BatchSpanProcessor = traceBase.BatchSpanProcessor;
    if (traceBase.SamplingDecision) SamplingDecision = traceBase.SamplingDecision;
  } catch {
    BatchSpanProcessor = undefined;
  }

  const endpoint = options.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const environment = options.environment ?? process.env.NODE_ENV ?? 'development';
  const attributes: Record<string, string> = {
    'service.name': options.service,
    'service.namespace': 'confideleap',
    'deployment.environment.name': environment,
    ...(options.serviceVersion ? { 'service.version': options.serviceVersion } : {}),
    ...(options.resourceAttributes ?? {}),
  };

  const sampleRatio = options.sampleRatio ?? Number(process.env.TELEMETRY_SAMPLE_RATIO ?? 0.2);
  const sampler = {
    shouldSample: (parentContext: any, traceId: string) => {
      const parentSpanContext = parentContext?.spanContext?.();
      if (parentSpanContext?.isRemote && typeof parentSpanContext.traceFlags === 'number') {
        return {
          decision:
            (parentSpanContext.traceFlags & 1) === 1
              ? SamplingDecision.RECORD_AND_SAMPLED
              : SamplingDecision.NOT_RECORD,
        };
      }
      const sampled = core().shouldSample(String(traceId), sampleRatio);
      return {
        decision: sampled ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD,
      };
    },
    toString: () => `TraceKitSampler{${sampleRatio}}`,
  };

  const config: Record<string, unknown> = {
    resource: resourceFromAttributes(attributes),
    sampler,
  };

  if (options.spanProcessor) {
    config.spanProcessors = [options.spanProcessor];
  } else if (endpoint && BatchSpanProcessor) {
    config.spanProcessors = [new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpTraceUrl(endpoint) }))];
  } else if (endpoint) {
    config.traceExporter = new OTLPTraceExporter({ url: otlpTraceUrl(endpoint) });
  }

  if (options.instrumentations) {
    config.instrumentations = options.instrumentations;
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
      config.instrumentations = [getNodeAutoInstrumentations()];
    } catch {
      config.instrumentations = [];
    }
  }

  try {
    const instance = new NodeSdk(config);
    await instance.start();
    sdk = instance;
    return { enabled: true };
  } catch (err) {
    return {
      enabled: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  const instance = sdk;
  sdk = null;
  await instance.shutdown?.();
}

export function isTelemetryInitialized(): boolean {
  return sdk !== null;
}
