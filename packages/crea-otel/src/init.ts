import { metrics, trace, type Meter, type Tracer } from "@opentelemetry/api";
import { logs, type Logger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { createBotTelemetry, type BotTelemetry } from "./bot";
import { resolveConfig } from "./config";
import type { TelemetryConfig } from "./types";

const ATTR_SERVICE_NAMESPACE = "service.namespace";
const ATTR_DEPLOYMENT_ENVIRONMENT = "deployment.environment";

export type TelemetryHandle = {
  kind: "app" | "bot";
  serviceName: string;
  serviceNamespace: string;
  tracer: Tracer;
  meter: Meter;
  logger: Logger;
  /** Present when `kind: "bot"`. */
  bot?: BotTelemetry;
  shutdown(): Promise<void>;
};

export type BotTelemetryHandle = TelemetryHandle & {
  kind: "bot";
  bot: BotTelemetry;
};

function isBotHandle(tel: TelemetryHandle): tel is BotTelemetryHandle {
  return tel.kind === "bot" && tel.bot !== undefined;
}

/**
 * Bootstrap OTLP exporters to Alloy and return tracer/meter/logger.
 * Pass `kind: "bot"` for fleet-contract helpers on `tel.bot`.
 */
export function initTelemetry(config: TelemetryConfig = {}): TelemetryHandle {
  const resolved = resolveConfig(config);

  const resourceAttrs: Record<string, string> = {
    [ATTR_SERVICE_NAME]: resolved.serviceName,
    [ATTR_SERVICE_NAMESPACE]: resolved.serviceNamespace,
    [ATTR_DEPLOYMENT_ENVIRONMENT]: resolved.deploymentEnvironment,
  };
  if (resolved.serviceVersion) {
    resourceAttrs[ATTR_SERVICE_VERSION] = resolved.serviceVersion;
  }

  const resource = new Resource(resourceAttrs);
  const base = resolved.endpoint;

  const traceExporter = new OTLPTraceExporter({
    url: `${base}/v1/traces`,
  });
  const metricExporter = new OTLPMetricExporter({
    url: `${base}/v1/metrics`,
  });
  const logExporter = new OTLPLogExporter({
    url: `${base}/v1/logs`,
  });

  const sdk = new NodeSDK({
    resource,
    spanProcessors: [new SimpleSpanProcessor(traceExporter)],
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: resolved.metricExportIntervalMillis,
    }),
  });

  sdk.start();

  const loggerProvider = new LoggerProvider({ resource });
  loggerProvider.addLogRecordProcessor(
    new BatchLogRecordProcessor(logExporter),
  );
  logs.setGlobalLoggerProvider(loggerProvider);

  const tracer = trace.getTracer(resolved.serviceName);
  const meter = metrics.getMeter(resolved.serviceName);
  const logger = logs.getLogger(resolved.serviceName);

  const handle: TelemetryHandle = {
    kind: resolved.kind,
    serviceName: resolved.serviceName,
    serviceNamespace: resolved.serviceNamespace,
    tracer,
    meter,
    logger,
    async shutdown(): Promise<void> {
      try {
        await sdk.shutdown();
      } catch (err) {
        console.warn("@crearec/otel: sdk shutdown warning", err);
      }
      try {
        await loggerProvider.shutdown();
      } catch (err) {
        console.warn("@crearec/otel: logger shutdown warning", err);
      }
    },
  };

  if (resolved.kind === "bot") {
    handle.bot = createBotTelemetry(meter);
  }

  return handle;
}

export { isBotHandle };
