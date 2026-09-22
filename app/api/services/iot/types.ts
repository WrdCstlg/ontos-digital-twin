/**
 * IoT Broker and Telemetry Types for Ontos Digital Twin System.
 */

export type BrokerType = "mqtt" | "aws_iot" | "azure_iot" | "webhook";
export type BrokerAuthType = "none" | "basic" | "tls_cert" | "sas_token" | "api_key";
export type BrokerStatus = "connected" | "disconnected" | "error" | "disabled";

export interface IotBrokerConfig {
  id?: number;
  workspaceId: number;
  name: string;
  brokerType: BrokerType;
  endpointUrl: string;
  topicPattern?: string; // e.g. "ontos/twins/+/telemetry" or "sensors/{deviceId}/data"
  clientId?: string;
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
