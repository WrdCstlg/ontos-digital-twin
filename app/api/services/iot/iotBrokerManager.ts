import { and, eq } from "drizzle-orm";
import { getDb } from "../../queries/connection";
import { iotConnectors } from "@db/schema";
import { getDemoWorkspace } from "../audit";
import { MqttBrokerAdapter } from "./mqttAdapter";
import type { BrokerAuthType, BrokerType, IotBrokerConfig } from "./types";

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
      const ws = await getDemoWorkspace();

      // 1. Load active connectors from database
      const rows = await db
        .select()
        .from(iotConnectors)
        .where(
          and(
            eq(iotConnectors.workspaceId, ws.id),
            eq(iotConnectors.status, "connected"),
          ),
        );

      for (const row of rows) {
        if (row.brokerType === "mqtt" || row.brokerType === "aws_iot" || row.brokerType === "azure_iot") {
          const config = (row.configJson ?? {}) as Record<string, unknown>;
          const brokerConfig: IotBrokerConfig = {
            id: row.id,
            workspaceId: row.workspaceId,
            name: row.name,
            brokerType: row.brokerType,
            endpointUrl: row.endpointUrl,
            topicPattern: row.topicPattern ?? undefined,
            clientId: row.clientId ?? undefined,
            authType: row.authType,
            username: config.username as string | undefined,
            password: config.password as string | undefined,
            caCert: config.caCert as string | undefined,
            clientCert: config.clientCert as string | undefined,
            clientKey: config.clientKey as string | undefined,
          };

          await this.startBroker(brokerConfig);
        }
      }

      // 2. Load from 12-factor environment variables if configured
      if (process.env.IOT_BROKER_URL) {
        console.log(`[iot-manager] Booting default environment broker at ${process.env.IOT_BROKER_URL}`);
        const envConfig: IotBrokerConfig = {
          workspaceId: ws.id,
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
