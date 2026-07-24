export { resolveConfig } from "./config";
export {
  createBotTelemetry,
  BOT_DURATION_BOUNDARIES_SECONDS,
  type BotTelemetry,
} from "./bot";
export {
  initTelemetry,
  isBotHandle,
  type TelemetryHandle,
  type BotTelemetryHandle,
} from "./init";
export type {
  TelemetryKind,
  BotResult,
  TelemetryConfig,
  ResolvedTelemetryConfig,
  RecordHandledUpdateInput,
  RecordErrorInput,
} from "./types";
