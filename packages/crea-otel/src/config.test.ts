import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { resolveConfig } from "./config";

describe("resolveConfig", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "OTEL_SERVICE_NAME",
      "OTEL_SERVICE_NAMESPACE",
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "OTEL_SERVICE_VERSION",
      "DEPLOY_ENV",
    ]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("throws without serviceName", () => {
    assert.throws(
      () => resolveConfig({ serviceNamespace: "bots" }),
      /serviceName is required/,
    );
  });

  it("throws without serviceNamespace", () => {
    assert.throws(
      () => resolveConfig({ serviceName: "crea-demo" }),
      /serviceNamespace is required/,
    );
  });

  it("uses explicit config over env", () => {
    process.env.OTEL_SERVICE_NAME = "from-env";
    process.env.OTEL_SERVICE_NAMESPACE = "env-ns";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://env:4318/";
    process.env.DEPLOY_ENV = "staging";

    const resolved = resolveConfig({
      serviceName: "crea-demo",
      serviceNamespace: "bots",
      endpoint: "http://alloy:4318/",
      deploymentEnvironment: "production",
      kind: "bot",
      serviceVersion: "sha-abc",
    });

    assert.equal(resolved.serviceName, "crea-demo");
    assert.equal(resolved.serviceNamespace, "bots");
    assert.equal(resolved.endpoint, "http://alloy:4318");
    assert.equal(resolved.deploymentEnvironment, "production");
    assert.equal(resolved.kind, "bot");
    assert.equal(resolved.serviceVersion, "sha-abc");
  });

  it("falls back to env and defaults", () => {
    process.env.OTEL_SERVICE_NAME = "crea-from-env";
    process.env.OTEL_SERVICE_NAMESPACE = "examples";

    const resolved = resolveConfig({});
    assert.equal(resolved.serviceName, "crea-from-env");
    assert.equal(resolved.serviceNamespace, "examples");
    assert.equal(resolved.kind, "app");
    assert.equal(resolved.deploymentEnvironment, "local");
    assert.equal(resolved.endpoint, "http://127.0.0.1:4318");
    assert.equal(resolved.metricExportIntervalMillis, 5000);
  });
});
