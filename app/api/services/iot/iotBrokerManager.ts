import { eq } from "drizzle-orm";
import { getDb } from "../../queries/connection";
import { iotConnectors, workspaces, type IotConnector } from "@db/schema";
import { readSecret, secretContext } from "../../lib/secretBox";
import { MqttBrokerAdapter } from "./mqttAdapter";
import type { BrokerAuthType, BrokerType, IotBrokerConfig } from "./types";

/** What to tell someone whose broker connector's stored credentials this server cannot open. */
export function unreadableBrokerSecretMessage(err: Error): string {
  return `The connector's stored password or client key cannot be read: ${err.message}. Save the connector again with them.`;
}

/**
 * A stored broker connector as the adapter connects with it: its password and
 * client key opened (lib/secretBox.ts). Throws SecretUnreadableError if either
 * cannot be opened.
 */
export function brokerConfigFrom(row: IotConnector): IotBrokerConfig {
  const config = (row.configJson ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    brokerType: row.brokerType,
    endpointUrl: row.endpointUrl,
    topicPattern: row.topicPattern ?? undefined,
    clientId: row.clientId ?? undefined,
    authType: row.authType,
    username: text(config.username),
    password: readSecret(config.password, secretContext.iotConnector(row.workspaceId, "password")),
    caCert: text(config.caCert),
    clientCert: text(config.clientCert),
    clientKey: readSecret(config.clientKey, secretContext.iotConnector(row.workspaceId, "clientKey")),
  };
}

/**
 * Singleton IoT Broker Manager managing active broker adapter instances.
 */
class IotBrokerManager {
  private adapters = new Map<number | string, MqttBrokerAdapter>();
  private initialized = false;

  /**
   * Initialize and auto-connect active brokers from the database and environment variables.
   */
  async init() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const db = getDb();

      // 1. Load active connectors from database across all workspaces
      const rows = await db
        .select()
        .from(iotConnectors)
        .where(eq(iotConnectors.status, "connected"));

      for (const row of rows) {
        if (row.brokerType === "mqtt" || row.brokerType === "aws_iot" || row.brokerType === "azure_iot") {
          // One connector whose credentials cannot be opened stops only itself.
          let brokerConfig: IotBrokerConfig;
          try {
            brokerConfig = brokerConfigFrom(row);
          } catch (err) {
            const message = unreadableBrokerSecretMessage(err instanceof Error ? err : new Error(String(err)));
            console.warn(`[iot-manager] connector ${row.id} not started: ${message}`);
            await db
              .update(iotConnectors)
              .set({ status: "error", lastError: message })
              .where(eq(iotConnectors.id, row.id))
              .catch(() => undefined);
            continue;
          }
          await this.startBroker(brokerConfig);
        }
      }

      // 2. Load from 12-factor environment variables if configured
      if (process.env.IOT_BROKER_URL) {
        console.log(`[iot-manager] Booting default environment broker at ${process.env.IOT_BROKER_URL}`);
        const defaultWsRow = (await db.select({ id: workspaces.id }).from(workspaces).limit(1))[0];
        const defaultWsId = Number(process.env.IOT_WORKSPACE_ID) || defaultWsRow?.id || 1;
        const envConfig: IotBrokerConfig = {
          workspaceId: defaultWsId,
          name: "Environment IoT Broker",
          brokerType: (process.env.IOT_BROKER_TYPE as BrokerType) || "mqtt",
          endpointUrl: process.env.IOT_BROKER_URL,
          topicPattern: process.env.IOT_BROKER_TOPIC || "ontos/twins/+/telemetry",
          clientId: process.env.IOT_CLIENT_ID || "ontos_env_client",
          authType: (process.env.IOT_AUTH_TYPE as BrokerAuthType) || "none",
          username: process.env.IOT_USERNAME,
          password: process.env.IOT_PASSWORD,
        };
        await this.startBroker(envConfig, "env_default");
      }
    } catch (err) {
      console.warn("[iot-manager] Non-fatal startup error loading IoT connectors:", err);
    }
  }

  /**
   * Start a broker connection and track it.
   */
  async startBroker(config: IotBrokerConfig, customKey?: string): Promise<boolean> {
    const key = customKey ?? (config.id ? config.id : `temp_${config.name}`);
    await this.stopBroker(key);

    const adapter = new MqttBrokerAdapter(config);
    this.adapters.set(key, adapter);
    const connected = await adapter.connect();

    // Update database status if it's a persistent connector
    if (config.id) {
      try {
        const db = getDb();
        await db
          .update(iotConnectors)
          .set({
            status: connected ? "connected" : "error",
            lastConnectedAt: connected ? new Date() : undefined,
            lastError: connected ? null : adapter.stats.lastError,
          })
          .where(eq(iotConnectors.id, config.id));
      } catch {
        // non-fatal
      }
    }

    return connected;
  }

  /**
   * Stop an active broker adapter.
   */
  async stopBroker(key: number | string): Promise<void> {
    const existing = this.adapters.get(key);
    if (existing) {
      await existing.disconnect();
      this.adapters.delete(key);
    }
  }

  /**
   * Get all active broker adapter stats.
   */
  getAllStats() {
    const stats: Record<string, MqttBrokerAdapter["stats"]> = {};
    for (const [key, adapter] of this.adapters.entries()) {
      stats[String(key)] = adapter.stats;
    }
    return stats;
  }

  /**
   * Disconnect all on shutdown.
   */
  async shutdownAll() {
    for (const adapter of this.adapters.values()) {
      await adapter.disconnect();
    }
    this.adapters.clear();
  }
}

export const iotBrokerManager = new IotBrokerManager();
