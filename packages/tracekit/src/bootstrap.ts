/**
 * Single bootstrap entrypoint.
 *
 * Call `initTraceKit` once at process start — before instrumented libraries are
 * imported — to configure the generated ID format and start OpenTelemetry.
 * Both settings are process-global, so this is the one place a service needs to
 * configure TraceKit.
 */

import { configureTraceKit, type TraceKitConfig } from './ids';
import { initTelemetry, type TelemetryInitResult, type TelemetryOptions } from './otel';

export interface InitTraceKitOptions extends TelemetryOptions, TraceKitConfig {}

/**
 * Configure TraceKit and start telemetry.
 *
 * ```ts
 * await initTraceKit({
 *   service: 'irm-backend',
 *   idFormat: 'ulid',            // or 'uuidv7' (default)
 *   otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
 * });
 * ```
 */
export async function initTraceKit(options: InitTraceKitOptions): Promise<TelemetryInitResult> {
  configureTraceKit({ idFormat: options.idFormat });
  return initTelemetry(options);
}
