import type { Counter, Histogram, Meter, ObservableGauge } from "@opentelemetry/api";
import type { RecordMcpErrorInput, RecordToolCallInput } from "./types";

/** Seconds buckets for mcp_tool_duration_seconds (contract: not ms integers). */
export const MCP_DURATION_BOUNDARIES_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

export type McpTelemetry = {
  recordToolCall(input: RecordToolCallInput): void;
  recordError(input: RecordMcpErrorInput): void;
  setUp(up: boolean): void;
};

type McpInstruments = {
  toolCalls: Counter;
  duration: Histogram;
  errors: Counter;
  up: ObservableGauge;
};

function createInstruments(meter: Meter, upValue: { current: number }): McpInstruments {
  const toolCalls = meter.createCounter("mcp_tool_calls_total", {
    description: "Tool invocations handled",
  });
  const duration = meter.createHistogram("mcp_tool_duration_seconds", {
    description: "Tool latency in seconds",
    unit: "s",
    advice: {
      explicitBucketBoundaries: [...MCP_DURATION_BOUNDARIES_SECONDS],
    },
  });
  const errors = meter.createCounter("mcp_errors_total", {
    description: "Explicit application errors",
  });
  const up = meter.createObservableGauge("mcp_up", {
    description: "1 while the server is healthy",
  });
  up.addCallback((result) => {
    result.observe(upValue.current);
  });
  return { toolCalls, duration, errors, up };
}

/**
 * Fleet-contract helpers for MCP servers. Always emit counter + histogram together on tool call.
 */
export function createMcpTelemetry(meter: Meter): McpTelemetry {
  const upValue = { current: 1 };
  const instruments = createInstruments(meter, upValue);

  return {
    recordToolCall(input: RecordToolCallInput): void {
      const attrs: Record<string, string> = { result: input.result };
      if (input.tool) {
        attrs.tool = input.tool;
      }
      instruments.duration.record(input.durationSeconds, attrs);
      instruments.toolCalls.add(1, attrs);
    },

    recordError(input: RecordMcpErrorInput): void {
      const attrs: Record<string, string> = {
        error_type: input.errorType,
      };
      if (input.tool) {
        attrs.tool = input.tool;
      }
      instruments.errors.add(1, attrs);
    },

    setUp(up: boolean): void {
      upValue.current = up ? 1 : 0;
    },
  };
}
