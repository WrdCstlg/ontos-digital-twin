import mqtt, { type MqttClient, type IClientOptions } from "mqtt";
import { ingestTelemetry } from "./iotIngestion";
import type { IotBrokerConfig, RawTelemetryPoint } from "./types";

/**
 * Universal MQTT Broker Adapter for Ontos Digital Twins.
 * Connects to Generic MQTT (Mosquitto, EMQX, HiveMQ), AWS IoT Core (mTLS),
 * and Azure IoT Hub (MQTT over TLS).
 */
export class MqttBrokerAdapter {
  private client: MqttClient | null = null;
  private config: IotBrokerConfig;
  private isConnecting = false;
  private messageCount = 0;
  private errorCount = 0;
  private lastError: string | null = null;
  private lastConnectedAt: Date | null = null;

  constructor(config: IotBrokerConfig) {
    this.config = config;
  }

  get status(): "connected" | "disconnected" | "error" {
    if (this.client?.connected) return "connected";
    if (this.lastError) return "error";
    return "disconnected";
  }

  get stats() {
    return {
      name: this.config.name,
      brokerType: this.config.brokerType,
      endpointUrl: this.config.endpointUrl,
      topicPattern: this.config.topicPattern,
      status: this.status,
      messageCount: this.messageCount,
      errorCount: this.errorCount,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt?.toISOString() ?? null,
    };
  }

  /**
   * Connect to the external MQTT / IoT broker.
   */
  async connect(): Promise<boolean> {
    if (this.client?.connected || this.isConnecting) {
      return true;
    }

    this.isConnecting = true;
    this.lastError = null;

    try {
      const options: IClientOptions = {
        clientId: this.config.clientId || `ontos_${Math.random().toString(16).slice(2, 10)}`,
        clean: true,
        connectTimeout: 10_000,
        reconnectPeriod: 5_000,
      };

      // Basic Authentication (Username / Password)
      if (this.config.username) {
        options.username = this.config.username;
      }
      if (this.config.password) {
        options.password = this.config.password;
      }

      // Mutual TLS (mTLS) configuration (AWS IoT Core, Secure On-Prem MQTT)
      if (this.config.authType === "tls_cert" || this.config.clientCert) {
        if (this.config.caCert) {
          options.ca = this.config.caCert;
        }
        if (this.config.clientCert) {
          options.cert = this.config.clientCert;
        }
        if (this.config.clientKey) {
          options.key = this.config.clientKey;
        }
        options.rejectUnauthorized = true;
      }

      // Connect using the mqtt library
      const client = mqtt.connect(this.config.endpointUrl, options);
      this.client = client;

      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          this.isConnecting = false;
          if (!client.connected) {
            this.lastError = "Connection timeout after 10s";
            this.errorCount++;
            resolve(false);
          }
        }, 10_000);

        client.on("connect", () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.lastConnectedAt = new Date();
          console.log(`[iot-mqtt] Connected to ${this.config.brokerType} broker at ${this.config.endpointUrl}`);

          // Subscribe to topic pattern
          const topic = this.config.topicPattern || "ontos/twins/+/telemetry";
          client.subscribe(topic, (err) => {
            if (err) {
              console.error(`[iot-mqtt] Failed to subscribe to topic ${topic}:`, err);
              this.lastError = `Subscribe failed: ${err.message}`;
              this.errorCount++;
            } else {
              console.log(`[iot-mqtt] Subscribed to topic pattern '${topic}'`);
            }
          });

          resolve(true);
        });

        client.on("message", (topic, message) => {
          this.handleIncomingMessage(topic, message);
        });

        client.on("error", (err) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.errorCount++;
          this.lastError = err.message;
          console.error(`[iot-mqtt] Error from ${this.config.endpointUrl}:`, err.message);
        });

        client.on("close", () => {
          console.warn(`[iot-mqtt] Connection closed for ${this.config.endpointUrl}`);
        });
      });
    } catch (err) {
      this.isConnecting = false;
      this.errorCount++;
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[iot-mqtt] Failed to initialize connection:`, err);
      return false;
    }
  }

  /**
   * Handle and route an incoming MQTT message.
   */
  private async handleIncomingMessage(topic: string, message: Buffer) {
    try {
      this.messageCount++;
      const payloadStr = message.toString("utf-8");
      const parsed = JSON.parse(payloadStr);

      // Extract device ID from topic if topic contains dynamic wildcard
      // e.g. "ontos/twins/WarehouseTwin_1/telemetry" matches "ontos/twins/+/telemetry"
      let topicDeviceId: string | undefined;
      const topicParts = topic.split("/");
      const patternParts = (this.config.topicPattern || "ontos/twins/+/telemetry").split("/");
      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i] === "+" || patternParts[i].startsWith("{")) {
          topicDeviceId = topicParts[i];
          break;
        }
      }

      // Normalize into RawTelemetryPoint array
      let points: RawTelemetryPoint[] = [];
      if (Array.isArray(parsed)) {
        points = parsed.map((item) => ({
          twinIri: item.twinIri,
          deviceId: item.deviceId ?? topicDeviceId,
          timestamp: item.timestamp,
          telemetry: item.telemetry ?? item,
        }));
      } else if (parsed && typeof parsed === "object") {
        points = [
          {
            twinIri: parsed.twinIri,
            deviceId: parsed.deviceId ?? topicDeviceId,
            timestamp: parsed.timestamp,
            telemetry: parsed.telemetry ?? parsed,
          },
        ];
      }

      if (points.length > 0) {
        await ingestTelemetry(points, {
          workspaceId: this.config.workspaceId,
          source: `mqtt:${this.config.name}`,
          deviceMappings: this.config.deviceMappings,
        });
      }
    } catch (err) {
      this.errorCount++;
      this.lastError = `Message processing error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[iot-mqtt] Error handling payload on topic '${topic}':`, err);
    }
  }

  /**
   * Disconnect the client cleanly.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      return new Promise((resolve) => {
        this.client!.end(false, () => {
          this.client = null;
          resolve();
        });
      });
    }
  }
}
