export type TelemetryKind = "app" | "bot";

export type BotResult = "success" | "error" | "skipped";

export type TelemetryConfig = {
  /** Defaults to `app`. Use `bot` to enable fleet-contract helpers. */
  kind?: TelemetryKind;
  /** Overrides `OTEL_SERVICE_NAME`. Required (arg or env). */
  serviceName?: string;
  /** Overrides `OTEL_SERVICE_NAMESPACE`. Required (arg or env). */
  serviceNamespace?: string;
  /** Overrides `DEPLOY_ENV`. Default `local`. */
  deploymentEnvironment?: string;
  /** Overrides `OTEL_SERVICE_VERSION`. */
  serviceVersion?: string;
  /** Overrides `OTEL_EXPORTER_OTLP_ENDPOINT`. Default `http://127.0.0.1:4318`. */
  endpoint?: string;
  /** Metric export interval in ms. Default `5000`. */
  metricExportIntervalMillis?: number;
};

export type ResolvedTelemetryConfig = {
  kind: TelemetryKind;
  serviceName: string;
  serviceNamespace: string;
  deploymentEnvironment: string;
  serviceVersion?: string;
  endpoint: string;
  metricExportIntervalMillis: number;
};

export type RecordHandledUpdateInput = {
  result: BotResult;
  /** Handler latency in seconds (not milliseconds). */
  durationSeconds: number;
  /** Low-cardinality handler id, e.g. `download`. */
  handler?: string;
};

export type RecordErrorInput = {
  errorType: string;
  handler?: string;
};
