import mqtt, { type IClientOptions, type IConnackPacket, type IPublishPacket, type MqttClient } from "mqtt";
import { displayUrl, withoutUserinfo } from "../connectorView";
import { within } from "../../lib/within";
import type { AdapterSnapshot, AdapterStatus, BrokerAdapter, IotBrokerConfig, MessageOutcome } from "./types";

/** The topic a connector subscribes to when it names none. */
export const DEFAULT_TOPIC_PATTERN = "ontos/twins/+/telemetry";

/**
 * How long an MQTT 5.0 broker keeps a session while no consumer is connected:
 * a day, well inside the week over which a message is recognised again
 * (iot_message_seen). MQTT 3.1.1 has no such setting: the broker's own applies.
 */
export const SESSION_EXPIRY_SECONDS = 24 * 60 * 60;

/** How long one message may take to record before its connection is restarted. */
export const HANDLE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** Waits between connection attempts: from 1 s, doubling, to at most 30 s. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * The client id a connector connects as: the one it names, or
 * `ontos-<connector id>`. Stable, so that a process taking over from another
 * resumes the same session at the broker, and the broker delivers to it what
 * the other left unacknowledged.
 */
export function brokerClientId(config: IotBrokerConfig, connectorId: number): string {
  return config.clientId || `ontos-${connectorId}`;
}

/** The filter subscribed for a topic pattern: a {placeholder} level matches any, as + does. */
export function subscriptionFilter(pattern: string): string {
  return pattern
    .split("/")
    .map((level) => (/^\{[^/]*\}$/.test(level) ? "+" : level))
    .join("/");
}

export type MqttAdapterOptions = {
  config: IotBrokerConfig;
  /** 0 for the broker IOT_BROKER_URL names. */
  connectorId: number;
  /** Records one message. The broker is acknowledged only when this says so. */
  handle: (message: { topic: string; payload: Buffer }) => Promise<MessageOutcome>;
  /** Whether this process may connect: it surely holds the lease this adapter runs under. */
  canConnect: () => boolean;
  /** A message found the lease gone. This adapter has stopped; so should every other. */
  onFenced?: () => void;
  log?: (line: string) => void;
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One broker connection of the IoT consumer: generic MQTT (Mosquitto, EMQX,
 * HiveMQ), AWS IoT Core (mTLS) and Azure IoT Hub (MQTT over TLS). Made so that
 * one consumer can hand over to another without losing or doubling a message:
 *
 * - It connects under a stable client id with a persistent session (clean
 *   session off in 3.1.1, a session expiry in 5.0) and subscribes at QoS 1, so
 *   the broker keeps what arrives while no consumer is connected and delivers
 *   again what was not acknowledged.
 * - It takes messages one at a time, and acknowledges each only once it has
 *   been recorded, its transaction committed. mqtt.js's handleMessage hook holds
 *   the PUBACK back until then, in 3.1.1 and 5.0 alike, and hands over no other
 *   message meanwhile. (customHandleAcks will not do: mqtt.js honours it in 5.0
 *   only, and it acknowledges even a message it refuses with a reason code,
 *   which the broker then never delivers again.)
 * - A message that could not be recorded is not acknowledged, and nor is any
 *   after it on that connection: the connection is restarted, and the broker
 *   delivers them again, in order, on the new one.
 * - It reconnects by itself, but only while its consumer surely holds the lease.
 */
export class MqttBrokerAdapter implements BrokerAdapter {
  readonly clientId: string;
  private readonly config: IotBrokerConfig;
  private readonly handle: MqttAdapterOptions["handle"];
  private readonly canConnect: () => boolean;
  private readonly onFenced: () => void;
  private readonly log: (line: string) => void;

  private client: MqttClient | null = null;
  private stopped = false;
  /** A message on this connection was not recorded: none after it is acknowledged either. */
  private holdingBack = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private backoffMs = RECONNECT_MIN_MS;
  /** Messages are recorded one after another, in the order they came. */
  private queue: Promise<void> = Promise.resolve();

  private status: AdapterStatus = "disconnected";
  private messages = 0;
  private errors = 0;
  private connections = 0;
  private lastError: string | null = null;

  constructor(opts: MqttAdapterOptions) {
    this.config = opts.config;
    this.clientId = brokerClientId(opts.config, opts.connectorId);
    this.handle = opts.handle;
    this.canConnect = opts.canConnect;
    this.onFenced = opts.onFenced ?? (() => undefined);
    const name = opts.connectorId ? `connector ${opts.connectorId}` : "IOT_BROKER_URL";
    this.log = opts.log ?? ((line) => console.log(`[iot ${name}] ${line}`));
  }

  snapshot(): AdapterSnapshot {
    return {
      status: this.status,
      messages: this.messages,
      errors: this.errors,
      lastError: this.lastError,
      connections: this.connections,
    };
  }

  start(): void {
    if (this.stopped || this.client || this.reconnectTimer) return;
    if (!this.canConnect()) {
      this.reconnectLater();
      return;
    }
    this.connect();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.status = "disconnected";
    const client = this.client;
    this.client = null;
    if (client) await this.close(client);
  }

  private options(): IClientOptions {
    const config = this.config;
    const v5 = config.protocolVersion === 5;
    const options: IClientOptions = {
      clientId: this.clientId,
      clean: false,
      protocolVersion: v5 ? 5 : 4,
      ...(v5 ? { properties: { sessionExpiryInterval: SESSION_EXPIRY_SECONDS } } : {}),
      connectTimeout: CONNECT_TIMEOUT_MS,
      // This adapter reconnects, so that it does so only while the lease is held.
      reconnectPeriod: 0,
      // It subscribes on every connection itself, below.
      resubscribe: false,
    };
    if (config.username) options.username = config.username;
    if (config.password) options.password = config.password;
    // Mutual TLS (AWS IoT Core, secure on-premises MQTT)
    if (config.authType === "tls_cert" || config.clientCert) {
      if (config.caCert) options.ca = config.caCert;
      if (config.clientCert) options.cert = config.clientCert;
      if (config.clientKey) options.key = config.clientKey;
      options.rejectUnauthorized = true;
    }
    return options;
  }

  private connect(): void {
    this.status = "connecting";
    let client: MqttClient;
    try {
      client = mqtt.connect(this.config.endpointUrl, this.options());
    } catch (err) {
      this.failed(`Failed to initialize connection: ${message(err)}`);
      this.reconnectLater();
      return;
    }
    this.client = client;
    // Set before any packet can arrive: they are read on later ticks.
    client.handleMessage = (packet, done) => {
      this.queue = this.queue.then(() => this.settle(client, packet, done));
    };
    client.on("connect", (connack) => this.connected(client, connack));
    client.on("error", (err) => {
      if (client === this.client) this.failed(message(err));
    });
    client.on("close", () => {
      if (client !== this.client) return;
      this.client = null;
      if (this.status !== "error") this.status = "disconnected";
      this.log("connection closed");
      void this.close(client);
      this.reconnectLater();
    });
  }

  private connected(client: MqttClient, connack: IConnackPacket): void {
    if (client !== this.client || this.stopped) return;
    this.status = "connected";
    this.connections++;
    this.lastError = null;
    this.backoffMs = RECONNECT_MIN_MS;
    this.log(
      `connected to ${displayUrl(this.config.endpointUrl)} as ${this.clientId}` +
        (connack.sessionPresent ? ", resuming its session" : ", in a new session"),
    );
    const filter = subscriptionFilter(this.config.topicPattern || DEFAULT_TOPIC_PATTERN);
    // Retained messages only for a new subscription (5.0); in 3.1.1 the broker
    // sends them again, and they are recognised as already recorded.
    const opts = this.config.protocolVersion === 5 ? { qos: 1 as const, rh: 1 } : { qos: 1 as const };
    client.subscribe(filter, opts, (err, granted) => {
      if (client !== this.client) return;
      if (err) this.failed(`Subscribe failed: ${err.message}`);
      else if (granted?.some((g) => g.qos === 128)) this.failed(`The broker refused the subscription to '${filter}'`);
      else if (granted?.some((g) => g.qos === 0)) this.log(`subscribed to '${filter}' at QoS 0 only: a message lost in a handover is not delivered again`);
      else this.log(`subscribed to '${filter}'`);
    });
  }

  private failed(error: string): void {
    this.errors++;
    this.lastError = withoutUserinfo(error);
    if (this.status !== "connected") this.status = "error";
    this.log(this.lastError);
  }

  /** Records one message, then acknowledges it, or leaves it for the broker to deliver again. */
  private async settle(client: MqttClient, packet: IPublishPacket, done: (err?: Error) => void): Promise<void> {
    if (client !== this.client || this.stopped || this.holdingBack) {
      done(new Error("not acknowledged: the connection is being restarted"));
      return;
    }
    const payload = Buffer.isBuffer(packet.payload) ? packet.payload : Buffer.from(packet.payload);
    let outcome: MessageOutcome;
    try {
      outcome = await within(this.handle({ topic: packet.topic, payload }), HANDLE_TIMEOUT_MS, "recording the message");
    } catch (err) {
      outcome = { kind: "retry", error: message(err) };
    }
    switch (outcome.kind) {
      case "recorded":
        this.messages++;
        done();
        return;
      case "rejected":
        this.messages++;
        this.errors++;
        this.lastError = `Message processing error: ${outcome.error}`;
        this.log(`message on '${packet.topic}' dropped: ${outcome.error}`);
        done();
        return;
      case "retry":
        this.errors++;
        this.lastError = `Message not recorded, to be delivered again: ${outcome.error}`;
        this.log(`message on '${packet.topic}' not recorded (${outcome.error}); restarting the connection so the broker delivers it again`);
        done(new Error(outcome.error));
        this.restart();
        return;
      case "fenced":
        this.log(`message on '${packet.topic}' left to the broker: this process no longer holds the IoT lease`);
        done(new Error("the IoT lease is gone"));
        await this.stop();
        this.onFenced();
        return;
    }
  }

  /** Drops this connection and makes a new one: the broker delivers again whatever is unacknowledged. */
  private restart(): void {
    this.holdingBack = true;
    const client = this.client;
    this.client = null;
    this.status = "disconnected";
    if (client) void this.close(client);
    this.reconnectLater();
  }

  private reconnectLater(): void {
    if (this.stopped || this.reconnectTimer) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(RECONNECT_MAX_MS, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.stopped || this.client) return;
      if (!this.canConnect()) {
        this.reconnectLater();
        return;
      }
      this.holdingBack = false;
      this.connect();
    }, wait);
  }

  /** Ends a client for good, without waiting more than 2 s for it. */
  private close(client: MqttClient): Promise<void> {
    return within(new Promise<void>((resolve) => client.end(true, {}, () => resolve())), 2000, "closing the connection").catch(() => undefined);
  }
}
