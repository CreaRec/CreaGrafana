import type { ResolvedTelemetryConfig, TelemetryConfig } from "./types";

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Merge explicit config over env. Requires serviceName + serviceNamespace.
 */
export function resolveConfig(
  input: TelemetryConfig = {},
): ResolvedTelemetryConfig {
  const serviceName = input.serviceName ?? readEnv("OTEL_SERVICE_NAME");
  const serviceNamespace =
    input.serviceNamespace ?? readEnv("OTEL_SERVICE_NAMESPACE");

  if (!serviceName) {
    throw new Error(
      "@crearec/otel: serviceName is required (pass config.serviceName or set OTEL_SERVICE_NAME)",
    );
  }
  if (!serviceNamespace) {
    throw new Error(
      "@crearec/otel: serviceNamespace is required (pass config.serviceNamespace or set OTEL_SERVICE_NAMESPACE)",
    );
  }

  const endpoint = trimSlash(
    input.endpoint ??
      readEnv("OTEL_EXPORTER_OTLP_ENDPOINT") ??
      "http://127.0.0.1:4318",
  );

  const deploymentEnvironment =
    input.deploymentEnvironment ?? readEnv("DEPLOY_ENV") ?? "local";

  const serviceVersion =
    input.serviceVersion ?? readEnv("OTEL_SERVICE_VERSION");

  return {
    kind: input.kind ?? "app",
    serviceName,
    serviceNamespace,
    deploymentEnvironment,
    serviceVersion,
    endpoint,
    metricExportIntervalMillis: input.metricExportIntervalMillis ?? 5000,
  };
}
