import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { iotConnectors } from "@db/schema";
import { createRouter, workspaceAdminMutation, workspaceOntologistMutation, workspaceQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { brokerConfigFrom, iotBrokerManager, unreadableBrokerSecretMessage } from "./services/iot/iotBrokerManager";
import { credentialInputProblem, sealSecret, secretContext, SecretUnreadableError } from "./lib/secretBox";
import { ingestTelemetry, sampleDeviceId, webhookWorkspaceId } from "./services/iot/iotIngestion";
import { hasWorkspaceRole } from "./services/workspaceGuard";
import type { IotBrokerConfig, RawTelemetryPoint } from "./services/iot/types";

/**
 * The workspace's own broker connector, or NOT_FOUND. The broker manager keys
 * live connections by connector id alone, so every procedure that starts or
 * stops one checks the id is this workspace's first.
 */
async function ownConnector(id: number, workspaceId: number) {
  const [row] = await getDb()
    .select({ id: iotConnectors.id, workspaceId: iotConnectors.workspaceId })
    .from(iotConnectors)
    .where(and(eq(iotConnectors.id, id), eq(iotConnectors.workspaceId, workspaceId)))
    .limit(1);
  if (!row || row.workspaceId !== workspaceId) throw new TRPCError({ code: "NOT_FOUND", message: "IoT connector not found" });
  return row;
}

export const iotRouter = createRouter({  /** List all configured IoT connectors with live runtime status and stats. */
  listConnectors: workspaceQuery.query(async ({ ctx }) => {
    const ws = ctx.workspace;
    const db = getDb();
    const rows = await db
      .select()
      .from(iotConnectors)
      .where(eq(iotConnectors.workspaceId, ws.id))
      .orderBy(desc(iotConnectors.createdAt));

    const liveStats = iotBrokerManager.getAllStats();

    return rows.map((r) => {
      const live = liveStats[String(r.id)];
      const config = (r.configJson ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        name: r.name,
        brokerType: r.brokerType,
        endpointUrl: r.endpointUrl,
        topicPattern: r.topicPattern,
        clientId: r.clientId,
        authType: r.authType,
        // Meant to be connected, but not running, with a reason: in error. The
        // stored status stays, so the next start tries again (iotBrokerManager).
        status: live ? live.status : r.status === "connected" && r.lastError ? "error" : r.status,
        lastConnectedAt: live?.lastConnectedAt ?? r.lastConnectedAt,
        messageCount: live ? live.messageCount : r.messageCount,
        errorCount: live ? live.errorCount : r.errorCount,
        lastError: live?.lastError ?? r.lastError,
        hasCert: Boolean(config.clientCert),
        createdAt: r.createdAt,
      };
    });
  }),

  /** Create or update an IoT broker connector: a workspace admin's, as other connectors are. */
  upsertConnector: workspaceAdminMutation
    .input(
      z.object({
        id: z.number().optional(),
        name: z.string().min(1).max(255),
        brokerType: z.enum(["mqtt", "aws_iot", "azure_iot", "webhook"]),
        endpointUrl: z.string().min(1).max(512),
        topicPattern: z.string().max(512).optional(),
        clientId: z.string().max(255).optional(),
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

      let connectorId = input.id;

      if (connectorId) {
        // Only this workspace's connector: the running broker is found by id, so
        // an id from elsewhere must be refused before anything starts or stops.
        await ownConnector(connectorId, ws.id);
        await db
          .update(iotConnectors)
          .set({
            name: input.name,
            brokerType: input.brokerType,
            endpointUrl: input.endpointUrl,
            topicPattern: input.topicPattern ?? null,
            clientId: input.clientId ?? null,
            authType: input.authType,
            configJson,
            status: input.connectNow ? "connected" : "disconnected",
          })
          .where(and(eq(iotConnectors.id, connectorId), eq(iotConnectors.workspaceId, ws.id)));
      } else {
        const [inserted] = await db.insert(iotConnectors).values({
          workspaceId: ws.id,
          name: input.name,
          brokerType: input.brokerType,
          endpointUrl: input.endpointUrl,
          topicPattern: input.topicPattern ?? null,
          clientId: input.clientId ?? null,
          authType: input.authType,
          configJson,
          status: input.connectNow ? "connected" : "disconnected",
        });
        connectorId = inserted.insertId;
      }

      const brokerConfig: IotBrokerConfig = {
        id: connectorId,
        workspaceId: ws.id,
        name: input.name,
        brokerType: input.brokerType,
        endpointUrl: input.endpointUrl,
        topicPattern: input.topicPattern,
        clientId: input.clientId,
        authType: input.authType,
        username: input.username,
        password: input.password,
        caCert: input.caCert,
        clientCert: input.clientCert,
        clientKey: input.clientKey,
      };

      if (input.connectNow && (input.brokerType === "mqtt" || input.brokerType === "aws_iot" || input.brokerType === "azure_iot")) {
        await iotBrokerManager.startBroker(brokerConfig);
      } else if (!input.connectNow && connectorId) {
        await iotBrokerManager.stopBroker(connectorId);
      }

      return { success: true, id: connectorId };
    }),

  /** Connect or disconnect a specific broker connector. */
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

      if (input.enable) {
        let brokerConfig: IotBrokerConfig;
        try {
          brokerConfig = brokerConfigFrom(connector);
        } catch (err) {
          if (!(err instanceof SecretUnreadableError)) throw err;
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: unreadableBrokerSecretMessage(err) });
        }
        const connected = await iotBrokerManager.startBroker(brokerConfig);
        await db
          .update(iotConnectors)
          .set({ status: connected ? "connected" : "error" })
          .where(and(eq(iotConnectors.id, input.id), eq(iotConnectors.workspaceId, ws.id)));
        return { success: true, status: connected ? "connected" : "error" };
      } else {
        await iotBrokerManager.stopBroker(input.id);
        await db
          .update(iotConnectors)
          .set({ status: "disconnected" })
          .where(and(eq(iotConnectors.id, input.id), eq(iotConnectors.workspaceId, ws.id)));
        return { success: true, status: "disconnected" };
      }
    }),

  /** Delete an IoT connector. */
  deleteConnector: workspaceAdminMutation
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      await ownConnector(input.id, ws.id);
      await iotBrokerManager.stopBroker(input.id);
      await db
        .delete(iotConnectors)
        .where(and(eq(iotConnectors.id, input.id), eq(iotConnectors.workspaceId, ws.id)));
      return { success: true };
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
