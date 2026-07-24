"use strict";

const { SeverityNumber } = require("@opentelemetry/api-logs");
const { initTelemetry } = require("@crearec/otel");

async function main() {
  const tel = initTelemetry({
    kind: "app",
    serviceName: process.env.OTEL_SERVICE_NAME || "crea-grafana-example",
    serviceNamespace: process.env.OTEL_SERVICE_NAMESPACE || "examples",
    deploymentEnvironment: process.env.DEPLOY_ENV || "local",
    endpoint:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://127.0.0.1:4318",
  });

  console.log(
    `Sending OTLP to ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://127.0.0.1:4318"}`,
  );
  console.log(
    `service.name=${tel.serviceName} service.namespace=${tel.serviceNamespace}`,
  );

  const requestCounter = tel.meter.createCounter("example_requests_total", {
    description: "Sample counter from the CreaGrafana node-otel example",
  });

  async function runOnce() {
    return tel.tracer.startActiveSpan("example.work", async (span) => {
      const traceId = span.spanContext().traceId;
      requestCounter.add(1, { route: "/demo" });

      tel.logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: `example work completed trace_id=${traceId}`,
        attributes: {
          route: "/demo",
          trace_id: traceId,
        },
      });

      span.setAttribute("example.route", "/demo");
      span.end();
    });
  }

  await runOnce();
  await runOnce();
  await runOnce();

  await new Promise((r) => setTimeout(r, 8000));
  await tel.shutdown();
  console.log("Done. Check Grafana Explore for logs, traces, and metrics.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
