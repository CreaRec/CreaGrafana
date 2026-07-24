"use strict";

const { SeverityNumber } = require("@opentelemetry/api-logs");
const { initTelemetry } = require("@crearec/otel");

async function main() {
  const tel = initTelemetry({
    kind: "bot",
    serviceName: process.env.OTEL_SERVICE_NAME || "crea-grafana-bot-example",
    serviceNamespace: process.env.OTEL_SERVICE_NAMESPACE || "bots",
    deploymentEnvironment: process.env.DEPLOY_ENV || "local",
    endpoint:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://127.0.0.1:4318",
  });

  if (!tel.bot) {
    throw new Error("expected kind: bot helpers");
  }

  console.log(
    `Sending bot metrics to ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://127.0.0.1:4318"}`,
  );
  console.log(
    `service.name=${tel.serviceName} service.namespace=${tel.serviceNamespace}`,
  );

  tel.bot.setUp(true);

  async function handleOnce(result) {
    return tel.tracer.startActiveSpan("bot.handle_update", async (span) => {
      const started = process.hrtime.bigint();
      await new Promise((r) => setTimeout(r, 15));
      const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;

      if (result === "error") {
        tel.bot.recordError({ errorType: "unknown", handler: "demo" });
      }

      tel.bot.recordHandledUpdate({
        result,
        durationSeconds,
        handler: "demo",
      });

      const traceId = span.spanContext().traceId;
      tel.logger.emit({
        severityNumber:
          result === "error" ? SeverityNumber.ERROR : SeverityNumber.INFO,
        severityText: result === "error" ? "ERROR" : "INFO",
        body: `bot handle_update result=${result} trace_id=${traceId}`,
        attributes: {
          handler: "demo",
          result,
          trace_id: traceId,
        },
      });

      span.setAttribute("result", result);
      if (result === "error") {
        span.setStatus({ code: 2, message: "demo error" });
      }
      span.end();
    });
  }

  await handleOnce("success");
  await handleOnce("success");
  await handleOnce("error");
  await handleOnce("skipped");

  await new Promise((r) => setTimeout(r, 8000));
  await tel.shutdown();
  console.log(
    "Done. Check Mimir for bot_updates_total / bot_handler_duration_seconds / bot_up.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
