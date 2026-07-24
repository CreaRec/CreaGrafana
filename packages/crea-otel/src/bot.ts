import type { Counter, Histogram, Meter, ObservableGauge } from "@opentelemetry/api";
import type { RecordErrorInput, RecordHandledUpdateInput } from "./types";

/** Seconds buckets for bot_handler_duration_seconds (contract: not ms integers). */
export const BOT_DURATION_BOUNDARIES_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

export type BotTelemetry = {
  recordHandledUpdate(input: RecordHandledUpdateInput): void;
  recordError(input: RecordErrorInput): void;
  setUp(up: boolean): void;
};

type BotInstruments = {
  updates: Counter;
  duration: Histogram;
  errors: Counter;
  up: ObservableGauge;
};

function createInstruments(meter: Meter, upValue: { current: number }): BotInstruments {
  const updates = meter.createCounter("bot_updates_total", {
    description: "Inbound Telegram updates handled",
  });
  const duration = meter.createHistogram("bot_handler_duration_seconds", {
    description: "Handler latency in seconds",
    unit: "s",
    advice: {
      explicitBucketBoundaries: [...BOT_DURATION_BOUNDARIES_SECONDS],
    },
  });
  const errors = meter.createCounter("bot_errors_total", {
    description: "Explicit application errors",
  });
  const up = meter.createObservableGauge("bot_up", {
    description: "1 while the process is healthy",
  });
  up.addCallback((result) => {
    result.observe(upValue.current);
  });
  return { updates, duration, errors, up };
}

/**
 * Fleet-contract helpers. Always emit counter + histogram together on handle.
 */
export function createBotTelemetry(meter: Meter): BotTelemetry {
  const upValue = { current: 1 };
  const instruments = createInstruments(meter, upValue);

  return {
    recordHandledUpdate(input: RecordHandledUpdateInput): void {
      const attrs: Record<string, string> = { result: input.result };
      if (input.handler) {
        attrs.handler = input.handler;
      }
      instruments.duration.record(input.durationSeconds, attrs);
      instruments.updates.add(1, attrs);
    },

    recordError(input: RecordErrorInput): void {
      const attrs: Record<string, string> = {
        error_type: input.errorType,
      };
      if (input.handler) {
        attrs.handler = input.handler;
      }
      instruments.errors.add(1, attrs);
    },

    setUp(up: boolean): void {
      upValue.current = up ? 1 : 0;
    },
  };
}
