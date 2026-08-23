import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  Attributes,
  Counter,
  Histogram,
  Meter,
  ObservableGauge,
  ObservableResult,
} from "@opentelemetry/api";
import { createMcpTelemetry } from "./mcp";

type CounterCall = { value: number; attrs?: Attributes };
type HistogramCall = { value: number; attrs?: Attributes };

function mockMeter(): {
  meter: Meter;
  toolCalls: CounterCall[];
  duration: HistogramCall[];
  errors: CounterCall[];
  upCallbacks: Array<(result: ObservableResult) => void>;
} {
  const toolCalls: CounterCall[] = [];
  const duration: HistogramCall[] = [];
  const errors: CounterCall[] = [];
  const upCallbacks: Array<(result: ObservableResult) => void> = [];

  const meter = {
    createCounter(name: string): Counter {
      const store =
        name === "mcp_tool_calls_total"
          ? toolCalls
          : name === "mcp_errors_total"
            ? errors
            : toolCalls;
      return {
        add(value: number, attrs?: Attributes) {
          store.push({ value, attrs });
        },
      } as Counter;
    },
    createHistogram(): Histogram {
      return {
        record(value: number, attrs?: Attributes) {
          duration.push({ value, attrs });
        },
      } as Histogram;
    },
    createObservableGauge(): ObservableGauge {
      return {
        addCallback(cb: (result: ObservableResult) => void) {
          upCallbacks.push(cb);
        },
      } as ObservableGauge;
    },
  } as unknown as Meter;

  return { meter, toolCalls, duration, errors, upCallbacks };
}

describe("createMcpTelemetry", () => {
  it("records histogram and counter together on recordToolCall", () => {
    const { meter, toolCalls, duration, errors } = mockMeter();
    const mcp = createMcpTelemetry(meter);

    mcp.recordToolCall({
      result: "success",
      durationSeconds: 0.12,
      tool: "calendar_list",
    });

    assert.equal(duration.length, 1);
    assert.equal(duration[0]?.value, 0.12);
    assert.deepEqual(duration[0]?.attrs, {
      result: "success",
      tool: "calendar_list",
    });

    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0]?.value, 1);
    assert.deepEqual(toolCalls[0]?.attrs, {
      result: "success",
      tool: "calendar_list",
    });

    assert.equal(errors.length, 0);
  });

  it("records without tool label when not provided", () => {
    const { meter, toolCalls, duration } = mockMeter();
    const mcp = createMcpTelemetry(meter);

    mcp.recordToolCall({
      result: "error",
      durationSeconds: 0.5,
    });

    assert.equal(duration.length, 1);
    assert.deepEqual(duration[0]?.attrs, { result: "error" });

    assert.equal(toolCalls.length, 1);
    assert.deepEqual(toolCalls[0]?.attrs, { result: "error" });
  });

  it("recordError increments mcp_errors_total", () => {
    const { meter, errors } = mockMeter();
    const mcp = createMcpTelemetry(meter);

    mcp.recordError({ errorType: "timeout", tool: "calendar_create_event" });
    assert.equal(errors.length, 1);
    assert.deepEqual(errors[0]?.attrs, {
      error_type: "timeout",
      tool: "calendar_create_event",
    });
  });

  it("recordError works without tool label", () => {
    const { meter, errors } = mockMeter();
    const mcp = createMcpTelemetry(meter);

    mcp.recordError({ errorType: "auth" });
    assert.equal(errors.length, 1);
    assert.deepEqual(errors[0]?.attrs, { error_type: "auth" });
  });

  it("setUp changes observable mcp_up value", () => {
    const { meter, upCallbacks } = mockMeter();
    const mcp = createMcpTelemetry(meter);
    assert.equal(upCallbacks.length, 1);

    const observed: number[] = [];
    const result = {
      observe(value: number) {
        observed.push(value);
      },
    } as ObservableResult;

    upCallbacks[0]?.(result);
    assert.deepEqual(observed, [1]);

    mcp.setUp(false);
    observed.length = 0;
    upCallbacks[0]?.(result);
    assert.deepEqual(observed, [0]);
  });
});
