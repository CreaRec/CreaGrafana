import { metrics, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, "") ||
  "http://127.0.0.1:4318";

const serviceName = process.env.OTEL_SERVICE_NAME || "crea-grafana-example";
const serviceNamespace =
  process.env.OTEL_SERVICE_NAMESPACE || "examples";

const resource = resourceFromAttributes({
  "service.name": serviceName,
  "service.namespace": serviceNamespace,
  "deployment.environment": process.env.DEPLOY_ENV || "local",
});

const traceExporter = new OTLPTraceExporter({
  url: `${endpoint}/v1/traces`,
});
const metricExporter = new OTLPMetricExporter({
  url: `${endpoint}/v1/metrics`,
});
const logExporter = new OTLPLogExporter({
  url: `${endpoint}/v1/logs`,
});

const sdk = new NodeSDK({
  resource,
  spanProcessors: [new SimpleSpanProcessor(traceExporter)],
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 5000,
  }),
});

sdk.start();

const loggerProvider = new LoggerProvider({ resource });
loggerProvider.addLogRecordProcessor(
  new BatchLogRecordProcessor(logExporter),
);
logs.setGlobalLoggerProvider(loggerProvider);

const tracer = trace.getTracer(serviceName);
const meter = metrics.getMeter(serviceName);
const logger = logs.getLogger(serviceName);
const requestCounter = meter.createCounter("example_requests_total", {
  description: "Sample counter from the CreaGrafana node-otel example",
});

async function runOnce() {
  return tracer.startActiveSpan("example.work", async (span) => {
    const traceId = span.spanContext().traceId;
    requestCounter.add(1, { route: "/demo" });

    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: `example work completed trace_id=${traceId}`,
      attributes: {
        route: "/demo",
        "trace_id": traceId,
      },
    });

    span.setAttribute("example.route", "/demo");
    span.end();
  });
}

console.log(`Sending OTLP to ${endpoint}`);
console.log(`service.name=${serviceName} service.namespace=${serviceNamespace}`);

await runOnce();
await runOnce();
await runOnce();

// Give exporters time to flush before exit.
await new Promise((r) => setTimeout(r, 8000));
await sdk.shutdown();
await loggerProvider.shutdown();
console.log("Done. Check Grafana Explore for logs, traces, and metrics.");
