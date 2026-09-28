import type { IotConnector } from "@db/schema";
import { readSecret, secretContext } from "../../lib/secretBox";
import type { BrokerAuthType, BrokerType, IotBrokerConfig } from "./types";

/** What to tell someone whose broker connector's stored credentials this server cannot open. */
export function unreadableBrokerSecretMessage(err: Error): string {
  return `The connector's stored password or client key cannot be read: ${err.message}. Delete the connector and add it again with them, or restore the key.`;
}

/**
 * A stored broker connector as the adapter connects with it: its password and
 * client key opened (lib/secretBox.ts), each bound to the broker's endpoint, so
 * a row whose endpoint was changed opens nothing. Throws SecretUnreadableError
 * if either cannot be opened.
 */
export function brokerConfigFrom(row: IotConnector): IotBrokerConfig {
  const config = (row.configJson ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const context = (field: string) => secretContext.iotConnector(row.workspaceId, field, row.endpointUrl);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    brokerType: row.brokerType,
    endpointUrl: row.endpointUrl,
    topicPattern: row.topicPattern ?? undefined,
    clientId: row.clientId ?? undefined,
    protocolVersion: config.protocolVersion === 5 ? 5 : undefined,
    authType: row.authType,
    username: text(config.username),
    password: readSecret(config.password, context("password")),
    caCert: text(config.caCert),
    clientCert: text(config.clientCert),
    clientKey: readSecret(config.clientKey, context("clientKey")),
  };
}

/**
 * The broker IOT_BROKER_URL names, when it is set: settings from the
 * environment, for the one workspace given. Its client id is stable too,
 * IOT_CLIENT_ID or `ontos_env_client`, so a new consumer resumes its session.
 */
export function envBrokerConfig(env: NodeJS.ProcessEnv, workspaceId: number): IotBrokerConfig | null {
  if (!env.IOT_BROKER_URL) return null;
  return {
    workspaceId,
    name: "Environment IoT Broker",
    brokerType: (env.IOT_BROKER_TYPE as BrokerType) || "mqtt",
    endpointUrl: env.IOT_BROKER_URL,
    topicPattern: env.IOT_BROKER_TOPIC || undefined,
    clientId: env.IOT_CLIENT_ID || "ontos_env_client",
    protocolVersion: env.IOT_MQTT_VERSION === "5" ? 5 : undefined,
    authType: (env.IOT_AUTH_TYPE as BrokerAuthType) || "none",
    username: env.IOT_USERNAME,
    password: env.IOT_PASSWORD,
  };
}
