import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { iotConnectors } from "@db/schema";
import { createRouter, workspaceQuery, workspaceMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { iotBrokerManager } from "./services/iot/iotBrokerManager";
import { ingestTelemetry } from "./services/iot/iotIngestion";
import type { IotBrokerConfig, RawTelemetryPoint } from "./services/iot/types";

export const iotRouter = createRouter({
  /** List all configured IoT connectors with live runtime status and stats. */
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
        status: live ? live.status : r.status,
        lastConnectedAt: live?.lastConnectedAt ?? r.lastConnectedAt,
        messageCount: live ? live.messageCount : r.messageCount,
        errorCount: live ? live.errorCount : r.errorCount,
        lastError: live?.lastError ?? r.lastError,
        hasCert: Boolean(config.clientCert),
        createdAt: r.createdAt,
      };
    });
  }),

  /** Create or update an IoT broker connector. */
  upsertConnector: workspaceMutation
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

      const configJson: Record<string, unknown> = {};
      if (input.username) configJson.username = input.username;
      if (input.password) configJson.password = input.password;
      if (input.caCert) configJson.caCert = input.caCert;
      if (input.clientCert) configJson.clientCert = input.clientCert;
      if (input.clientKey) configJson.clientKey = input.clientKey;

      let connectorId = input.id;

      if (connectorId) {
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
  toggleConnector: workspaceMutation
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
        const config = (connector.configJson ?? {}) as Record<string, unknown>;
        const brokerConfig: IotBrokerConfig = {
          id: connector.id,
          workspaceId: connector.workspaceId,
          name: connector.name,
          brokerType: connector.brokerType,
          endpointUrl: connector.endpointUrl,
          topicPattern: connector.topicPattern ?? undefined,
          clientId: connector.clientId ?? undefined,
          authType: connector.authType,
          username: config.username as string | undefined,
          password: config.password as string | undefined,
          caCert: config.caCert as string | undefined,
          clientCert: config.clientCert as string | undefined,
          clientKey: config.clientKey as string | undefined,
        };
        const connected = await iotBrokerManager.startBroker(brokerConfig);
        await db
          .update(iotConnectors)
          .set({ status: connected ? "connected" : "error" })
          .where(eq(iotConnectors.id, input.id));
        return { success: true, status: connected ? "connected" : "error" };
      } else {
        await iotBrokerManager.stopBroker(input.id);
        await db
          .update(iotConnectors)
          .set({ status: "disconnected" })
          .where(eq(iotConnectors.id, input.id));
        return { success: true, status: "disconnected" };
      }
    }),

  /** Delete an IoT connector. */
  deleteConnector: workspaceMutation
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      await iotBrokerManager.stopBroker(input.id);
      await db
        .delete(iotConnectors)
        .where(and(eq(iotConnectors.id, input.id), eq(iotConnectors.workspaceId, ws.id)));
      return { success: true };
    }),

  /** Directly ingest telemetry payload via tRPC. */
  ingestTelemetry: workspaceMutation
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
    const configured = !!apiKey;
    return {
      endpointUrl: "/api/iot/telemetry",
      fullEndpointUrl: `http://localhost:${process.env.PORT || 3000}/api/iot/telemetry`,
      apiKey: configured ? apiKey : "(not configured — set IOT_WEBHOOK_API_KEY)",
      configured,
      workspaceSlug: ws.slug,
      sampleCurl: configured
        ? `curl -X POST http://localhost:3000/api/iot/telemetry \\
  -H "Content-Type: application/json" \\
  -H "x-iot-api-key: ${apiKey}" \\
  -H "x-workspace-id: ${ws.id}" \\
  -d '{"deviceId":"SHP-1004","telemetry":{"temperature":3.8,"etaMinutes":145,"status":"in_transit"}}'`
        : "# Set IOT_WEBHOOK_API_KEY in your environment first",
    };
  }),
});
