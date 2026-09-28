/**
 * IoT Broker and Telemetry Types for Ontos Digital Twin System.
 */

export type BrokerType = "mqtt" | "aws_iot" | "azure_iot" | "webhook";
export type BrokerAuthType = "none" | "basic" | "tls_cert" | "sas_token" | "api_key";
export type BrokerStatus = "connected" | "disconnected" | "error" | "disabled";

/** The broker types a consumer connects to; a webhook connector receives, it does not connect. */
export const CONNECTED_BROKER_TYPES: readonly BrokerType[] = ["mqtt", "aws_iot", "azure_iot"];

export interface IotBrokerConfig {
  id?: number;
  workspaceId: number;
  name: string;
  brokerType: BrokerType;
  endpointUrl: string;
  topicPattern?: string; // e.g. "ontos/twins/+/telemetry" or "sensors/{deviceId}/data"
  clientId?: string;
  /** MQTT 3.1.1 (4, the default) or 5.0 (5). */
  protocolVersion?: 4 | 5;
  authType: BrokerAuthType;
  username?: string;
  password?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  apiKey?: string;
  azureSharedAccessKey?: string;
  azurePolicyName?: string;
  deviceMappings?: Record<string, string>; // deviceId -> twinIri mapping overrides
}

export interface RawTelemetryPoint {
  /** Explicit twin IRI if known, e.g. "dtwin:ShipmentTwin_4" */
  twinIri?: string;
  /** Physical device ID, serial number, or MAC address, e.g. "TRK-9004" */
  deviceId?: string;
  /** Telemetry timestamp (ISO string or epoch milliseconds) */
  timestamp?: string | number;
  /** Key-value telemetry dictionary */
  telemetry: Record<string, number | string | boolean | null | undefined>;
}

export interface IngestResult {
  success: boolean;
  receivedCount: number;
  updatedTwins: Array<{
    twinIri: string;
    label: string;
    classIri: string;
    updatedKeys: string[];
  }>;
  errors: string[];
}

/**
 * What became of one broker message, which decides whether the broker is told
 * it was received (acknowledged) or delivers it again.
 * - recorded: its effect committed, now or on an earlier delivery. Acknowledge.
 * - rejected: it can never be recorded (it is not JSON, or failed too often).
 *   Acknowledge, and count an error, so that it cannot block the messages after it.
 * - retry: it could not be recorded just now (the database). Withhold the
 *   acknowledgement; the broker delivers it again once the client reconnects.
 * - fenced: this process no longer holds the IoT lease. Withhold the
 *   acknowledgement and stop: the holder receives it from the broker.
 */
export type MessageOutcome =
  | { kind: "recorded" }
  | { kind: "rejected"; error: string }
  | { kind: "retry"; error: string }
  | { kind: "fenced" };

/** A connection's state as its consumer observes it. */
export type AdapterStatus = "connecting" | "connected" | "disconnected" | "error";

/** What an adapter has seen since it started. Counters only grow. */
export type AdapterSnapshot = {
  status: AdapterStatus;
  /** Messages settled: recorded or rejected. */
  messages: number;
  /** Messages rejected or not recorded, and connection failures. */
  errors: number;
  lastError: string | null;
  /** Connections made. */
  connections: number;
};

/** One broker connection run by the IoT consumer (mqttAdapter.ts). */
export interface BrokerAdapter {
  /** Starts connecting, and returns at once. */
  start(): void;
  /** Closes the connection, and no longer reconnects. */
  stop(): Promise<void>;
  snapshot(): AdapterSnapshot;
}
