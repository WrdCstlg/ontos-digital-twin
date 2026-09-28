import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { iotConnectors, type IotConnector } from "@db/schema";
import { createRouter, EDITOR_ROLES, workspaceAdminMutation, workspaceOntologistMutation, workspaceQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { displayUrl, withoutUserinfo } from "./services/connectorView";
import { brokerConfigFrom, unreadableBrokerSecretMessage } from "./services/iot/brokerConfig";
import { nudgeIotConsumer } from "./services/iot/iotConsumer";
import { credentialInputProblem, sealSecret, secretContext, SecretUnreadableError } from "./lib/secretBox";
import { ingestTelemetry, sampleDeviceId, webhookWorkspaceId } from "./services/iot/iotIngestion";
import { hasWorkspaceRole } from "./services/workspaceGuard";
import { CONNECTED_BROKER_TYPES, type BrokerType, type RawTelemetryPoint } from "./services/iot/types";

/**
 * The workspace's own broker connector, or NOT_FOUND. Connectors are found by
 * id, so every procedure that changes one checks the id is this workspace's first.
 */
async function ownConnector(id: number, workspaceId: number) {
  const [row] = await getDb()
    .select({ id: iotConnectors.id, workspaceId: iotConnectors.workspaceId, brokerType: iotConnectors.brokerType })
    .from(iotConnectors)
    .where(and(eq(iotConnectors.id, id), eq(iotConnectors.workspaceId, workspaceId)))
    .limit(1);
  if (!row || row.workspaceId !== workspaceId) throw new TRPCError({ code: "NOT_FOUND", message: "IoT connector not found" });
  return row;
}

/** A connector the IoT consumer connects to; a webhook connector receives instead. */
const connects = (brokerType: BrokerType) => CONNECTED_BROKER_TYPES.includes(brokerType);

type ShownStatus = IotConnector["status"] | "connecting" | "disconnecting";

/**
 * What a connector's row says to show. The IoT consumer holding the lease, in
 * whichever process, writes what it observed and the settings version it
 * observed. Until that version is the current one, a change is pending, and
 * shown as connecting or disconnecting. A webhook connector has nothing to
 * observe: it is as its admins set it.
 */
function shownStatus(r: IotConnector): ShownStatus {
  if (!connects(r.brokerType)) return r.enabled ? "connected" : "disconnected";
  if (r.observedVersion !== r.configVersion) return r.enabled ? "connecting" : "disconnecting";
  return r.status;
}

export const iotRouter = createRouter({
  /** What the caller may do with brokers and telemetry: the client is not told its workspace role. */
  capabilities: workspaceQuery.query(({ ctx }) => ({
    canManageBrokers: hasWorkspaceRole(ctx.membership, ctx.user, ["admin"]),
    canIngest: hasWorkspaceRole(ctx.membership, ctx.user, EDITOR_ROLES),
  })),

  /** The workspace's connectors: what their admins set, and what the IoT consumer last observed. */
  listConnectors: workspaceQuery.query(async ({ ctx }) => {
    const ws = ctx.workspace;
    const db = getDb();
    const rows = await db
      .select()
      .from(iotConnectors)
      .where(eq(iotConnectors.workspaceId, ws.id))
      .orderBy(desc(iotConnectors.createdAt));

    // A broker URL can carry its login (mqtt.js reads user:password@ from it):
    // in full to the admins who manage brokers, to everyone else where it points.
    const admin = hasWorkspaceRole(ctx.membership, ctx.user, ["admin"]);
    const shownError = (e: string | null) => (e === null || admin ? e : withoutUserinfo(e));

    return rows.map((r) => {
      const config = (r.configJson ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        name: r.name,
        brokerType: r.brokerType,
        endpointUrl: admin ? r.endpointUrl : displayUrl(r.endpointUrl),
        topicPattern: r.topicPattern,
        clientId: r.clientId,
        authType: r.authType,
        enabled: r.enabled,
        status: shownStatus(r),
        pending: connects(r.brokerType) && r.observedVersion !== r.configVersion,
        lastConnectedAt: r.lastConnectedAt,
        messageCount: r.messageCount,
        errorCount: r.errorCount,
        lastError: shownError(r.lastError),
        observedAt: r.observedAt,
        // The process that observed it: like a worker's, its name is for admins.
        consumerOwner: admin ? r.consumerOwner : null,
        hasCert: Boolean(config.clientCert),
        createdAt: r.createdAt,
      };
    });
  }),

  /**
   * Create or update an IoT broker connector: a workspace admin's, as other
   * connectors are. It records what the connector should be; the IoT consumer
   * connects it (or not) and reports back, so the answer is pending.
   */
  upsertConnector: workspaceAdminMutation
    .input(
      z.object({
        id: z.number().optional(),
        name: z.string().min(1).max(255),
        brokerType: z.enum(["mqtt", "aws_iot", "azure_iot", "webhook"]),
        endpointUrl: z.string().min(1).max(512),
        topicPattern: z.string().max(512).optional(),
        clientId: z.string().max(255).optional(),
        protocolVersion: z.union([z.literal(4), z.literal(5)]).optional(),
        authType: z.enum(["none", "basic", "tls_cert", "sas_token", "api_key"]).default("none"),
        username: z.string().optional(),
        password: z.string().optional(),
        caCert: z.string().optional(),
        clientCert: z.string().optional(),
        clientKey: z.string().optional(),
        connectNow: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const problem = credentialInputProblem({ password: input.password, clientKey: input.clientKey });
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });

      // The password and client key are sealed, for this workspace and broker
      // endpoint, before they are stored (lib/secretBox.ts); the certificates are public.
      const context = (field: string) => secretContext.iotConnector(ws.id, field, input.endpointUrl);
      const configJson: Record<string, unknown> = {};
      if (input.username) configJson.username = input.username;
      if (input.password) configJson.password = sealSecret(input.password, context("password"));
      if (input.caCert) configJson.caCert = input.caCert;
      if (input.clientCert) configJson.clientCert = input.clientCert;
      if (input.clientKey) configJson.clientKey = sealSecret(input.clientKey, context("clientKey"));
      if (input.protocolVersion === 5) configJson.protocolVersion = 5;

      let connectorId = input.id;
      const settings = {
        name: input.name,
        brokerType: input.brokerType,
        endpointUrl: input.endpointUrl,
        topicPattern: input.topicPattern ?? null,
        clientId: input.clientId ?? null,
        authType: input.authType,
        configJson,
        enabled: input.connectNow,
      };

      if (connectorId) {
        // Only this workspace's connector: it is found by id.
        await ownConnector(connectorId, ws.id);
        await db
          .update(iotConnectors)
          // A new settings version: the consumer restarts the connection with them.
          .set({ ...settings, configVersion: sql`${iotConnectors.configVersion} + 1` })
          .where(and(eq(iotConnectors.id, connectorId), eq(iotConnectors.workspaceId, ws.id)));
      } else {
        const [inserted] = await db.insert(iotConnectors).values({
          workspaceId: ws.id,
          ...settings,
          configVersion: 1,
          status: "disconnected",
        });
        connectorId = inserted.insertId;
      }

      nudgeIotConsumer();
      return { success: true, id: connectorId, pending: connects(input.brokerType) };
    }),

  /** Connect or disconnect a broker connector: it records which, and the consumer acts on it. */
  toggleConnector: workspaceAdminMutation
    .input(z.object({ id: z.number(), enable: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const [connector] = await db
        .select()
        .from(iotConnectors)
        .where(and(eq(iotConnectors.id, input.id), eq(iotConnectors.workspaceId, ws.id)))
        .limit(1);

      if (!connector) {
        throw new TRPCError({ code: "NOT_FOUND", message: "IoT connector not found" });
      }

      // The consumer, in whatever process, opens the stored credentials to
      // connect. One it could not open is refused here, with the reason, rather
      // than left to fail out of sight.
      if (input.enable) {
        try {
          brokerConfigFrom(connector);
        } catch (err) {
          if (!(err instanceof SecretUnreadableError)) throw err;
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: unreadableBrokerSecretMessage(err) });
        }
      }
      // A new version even when switching on one that is on: "connect" then
      // starts it again, as it always did.
      await db
        .update(iotConnectors)
        .set({ enabled: input.enable, configVersion: sql`${iotConnectors.configVersion} + 1` })
        .where(and(eq(iotConnectors.id, input.id), eq(iotConnectors.workspaceId, ws.id)));
      nudgeIotConsumer();
      return { success: true, enabled: input.enable, pending: connects(connector.brokerType) };
    }),

  /** Delete an IoT connector. The consumer closes its connection. */
  deleteConnector: workspaceAdminMutation
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const connector = await ownConnector(input.id, ws.id);
      await db
        .delete(iotConnectors)
        .where(and(eq(iotConnectors.id, input.id), eq(iotConnectors.workspaceId, ws.id)));
      nudgeIotConsumer();
      return { success: true, pending: connects(connector.brokerType) };
    }),

  /** Directly ingest telemetry payload via tRPC: writing data, so an editor's at least. */
  ingestTelemetry: workspaceOntologistMutation
    .input(
      z.object({
        points: z.array(
          z.object({
            twinIri: z.string().optional(),
            deviceId: z.string().optional(),
            timestamp: z.union([z.string(), z.number()]).optional(),
            telemetry: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      return ingestTelemetry(input.points as unknown as RawTelemetryPoint[], {
        workspaceId: ws.id,
        source: "trpc_api",
      });
    }),

  /** Get workspace webhook ingestion configuration details. */
  getWebhookConfig: workspaceQuery.query(async ({ ctx }) => {
    const ws = ctx.workspace;
    const apiKey = process.env.IOT_WEBHOOK_API_KEY;
    const boundWorkspaceId = await webhookWorkspaceId();
    // The webhook writes to one workspace only; elsewhere it is not configured.
    const configured = !!apiKey && boundWorkspaceId === ws.id;
    // The key is a shared secret, so only this workspace's admins see it.
    const revealKey = configured && hasWorkspaceRole(ctx.membership, ctx.user, ["admin"]);

    // A twin that exists here, so the copyable example actually succeeds.
    const device = (configured && (await sampleDeviceId(ws.id))) || "<twin IRI>";

    const shownKey = !apiKey
      ? "(not configured — set IOT_WEBHOOK_API_KEY)"
      : !configured
        ? "(the webhook is bound to another workspace)"
        : revealKey
          ? apiKey
          : "(hidden — visible to workspace admins)";

    return {
      endpointUrl: "/api/iot/telemetry",
      fullEndpointUrl: `http://localhost:${process.env.PORT || 3000}/api/iot/telemetry`,
      apiKey: shownKey,
      configured,
      workspaceSlug: ws.slug,
      sampleCurl: configured
        ? `curl -X POST http://localhost:3000/api/iot/telemetry \\
  -H "Content-Type: application/json" \\
  -H "x-iot-api-key: ${revealKey ? apiKey : "<IOT_WEBHOOK_API_KEY>"}" \\
  -d '{"deviceId":"${device}","telemetry":{"temperature":4.1,"etaMinutes":145,"status":"in_transit"}}'`
        : "# Set IOT_WEBHOOK_API_KEY (and IOT_WORKSPACE_ID for this workspace) first",
    };
  }),
});
