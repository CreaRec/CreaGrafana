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
import { createBotTelemetry } from "./bot";

type CounterCall = { value: number; attrs?: Attributes };
type HistogramCall = { value: number; attrs?: Attributes };

function mockMeter(): {
  meter: Meter;
  updates: CounterCall[];
  duration: HistogramCall[];
  errors: CounterCall[];
  upCallbacks: Array<(result: ObservableResult) => void>;
} {
  const updates: CounterCall[] = [];
  const duration: HistogramCall[] = [];
  const errors: CounterCall[] = [];
  const upCallbacks: Array<(result: ObservableResult) => void> = [];

  const meter = {
    createCounter(name: string): Counter {
      const store =
        name === "bot_updates_total"
          ? updates
          : name === "bot_errors_total"
            ? errors
            : updates;
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

  return { meter, updates, duration, errors, upCallbacks };
}

describe("createBotTelemetry", () => {
  it("records histogram and counter together on recordHandledUpdate", () => {
    const { meter, updates, duration, errors } = mockMeter();
    const bot = createBotTelemetry(meter);

    bot.recordHandledUpdate({
      result: "success",
      durationSeconds: 0.12,
      handler: "download",
    });

    assert.equal(duration.length, 1);
    assert.equal(duration[0]?.value, 0.12);
    assert.deepEqual(duration[0]?.attrs, {
      result: "success",
      handler: "download",
    });

    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.value, 1);
    assert.deepEqual(updates[0]?.attrs, {
      result: "success",
      handler: "download",
    });

    assert.equal(errors.length, 0);
  });

  it("recordError increments bot_errors_total", () => {
    const { meter, errors } = mockMeter();
    const bot = createBotTelemetry(meter);

    bot.recordError({ errorType: "timeout", handler: "download" });
    assert.equal(errors.length, 1);
    assert.deepEqual(errors[0]?.attrs, {
      error_type: "timeout",
      handler: "download",
    });
  });

  it("setUp changes observable bot_up value", () => {
    const { meter, upCallbacks } = mockMeter();
    const bot = createBotTelemetry(meter);
    assert.equal(upCallbacks.length, 1);

    const observed: number[] = [];
    const result = {
      observe(value: number) {
        observed.push(value);
      },
    } as ObservableResult;

    upCallbacks[0]?.(result);
    assert.deepEqual(observed, [1]);

    bot.setUp(false);
    observed.length = 0;
    upCallbacks[0]?.(result);
    assert.deepEqual(observed, [0]);
  });
});
