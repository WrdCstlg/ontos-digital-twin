import { useState } from 'react';
import {
  Radio,
  Server,
  Cloud,
  Terminal,
  Send,
  Plus,
  Trash2,
  Power,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface IotConnectorsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTelemetryIngested?: () => void;
}

const TEMPLATES = {
  fleet: {
    label: 'Logistics Fleet / Truck',
    payload: JSON.stringify(
      {
        deviceId: 'SHP-1004',
        telemetry: {
          temperature: 4.1,
          humidity: 46.5,
          etaMinutes: 120,
          lat: 41.8781,
          lng: -87.6298,
          status: 'in_transit',
        },
      },
      null,
      2,
    ),
  },
  coldchain: {
    label: 'Cold-Chain Storage Zone (Breach Test)',
    payload: JSON.stringify(
      {
        deviceId: 'dtwin:Zone_WH1_Cold1',
        telemetry: {
          temperature: 7.8, // Excursion above 6°C threshold to trigger insights!
          humidity: 58.0,
          utilization: 82.5,
          zoneType: 'cold-chain',
        },
      },
      null,
      2,
    ),
  },
  equipment: {
    label: 'Warehouse Equipment / Sensor',
    payload: JSON.stringify(
      {
        deviceId: 'dtwin:Equip_WH1_Sensor1',
        telemetry: {
          batteryLevel: 8.5, // Low battery warning threshold (<10%)
          status: 'warning',
        },
      },
      null,
      2,
    ),
  },
};

export function IotConnectorsModal({
  open,
  onOpenChange,
  onTelemetryIngested,
}: IotConnectorsModalProps) {
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<'brokers' | 'webhook' | 'simulator'>('brokers');
  const [showAddForm, setShowAddForm] = useState(false);
  const [copied, setCopied] = useState(false);

  // Queries & Mutations
  const connectors = trpc.iot.listConnectors.useQuery(undefined, { enabled: open });
  const webhookConfig = trpc.iot.getWebhookConfig.useQuery(undefined, { enabled: open });
  const upsertConnector = trpc.iot.upsertConnector.useMutation({
    onSuccess: () => {
      toast.success('IoT Broker connection saved');
      setShowAddForm(false);
      utils.iot.listConnectors.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const toggleConnector = trpc.iot.toggleConnector.useMutation({
    onSuccess: (data) => {
      toast.success(`Broker ${data.status === 'connected' ? 'connected' : 'disconnected'}`);
      utils.iot.listConnectors.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteConnector = trpc.iot.deleteConnector.useMutation({
    onSuccess: () => {
      toast.success('Broker connector removed');
      utils.iot.listConnectors.invalidate();
    },
  });
  const ingestMutation = trpc.iot.ingestTelemetry.useMutation({
    onSuccess: (res) => {
      if (res.updatedTwins.length > 0) {
        toast.success(`Successfully ingested telemetry for ${res.updatedTwins.length} twin(s)`);
        utils.twin.listTwins.invalidate();
        onTelemetryIngested?.();
      } else if (res.errors.length > 0) {
        toast.error(res.errors[0]);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Add form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'mqtt' | 'aws_iot' | 'azure_iot'>('mqtt');
  const [formUrl, setFormUrl] = useState('');
  const [formTopic, setFormTopic] = useState('ontos/twins/+/telemetry');
  const [formAuthType, setFormAuthType] = useState<'none' | 'basic' | 'tls_cert'>('none');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formCert, setFormCert] = useState('');
  const [formKey, setFormKey] = useState('');

  // Simulator state
  const [selectedTemplate, setSelectedTemplate] = useState<keyof typeof TEMPLATES>('fleet');
  const [customPayload, setCustomPayload] = useState(TEMPLATES.fleet.payload);

  const handleCopyCurl = () => {
    if (webhookConfig.data?.sampleCurl) {
      navigator.clipboard.writeText(webhookConfig.data.sampleCurl);
      setCopied(true);
      toast.success('Curl command copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formUrl.trim()) {
      toast.error('Please fill in required fields');
      return;
    }
    upsertConnector.mutate({
      name: formName,
      brokerType: formType,
      endpointUrl: formUrl,
      topicPattern: formTopic,
      authType: formAuthType,
      username: formUsername || undefined,
      password: formPassword || undefined,
      clientCert: formCert || undefined,
      clientKey: formKey || undefined,
      connectNow: true,
    });
  };

  const handleSendSimulator = () => {
    try {
      const parsed = JSON.parse(customPayload);
      const points = Array.isArray(parsed) ? parsed : [parsed];
      ingestMutation.mutate({ points });
    } catch {
      toast.error('Invalid JSON payload');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-emerald-500 animate-pulse" />
            <DialogTitle>IoT Telemetry Brokers & Ingestion</DialogTitle>
          </div>
          <DialogDescription>
            Connect live physical asset telemetry from MQTT, AWS IoT Core, Azure IoT Hub, or
            via the REST Webhook API.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'brokers' | 'webhook' | 'simulator')} className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="brokers" className="gap-2">
              <Server className="w-4 h-4" /> Brokers ({connectors.data?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="webhook" className="gap-2">
              <Cloud className="w-4 h-4" /> HTTP Webhook
            </TabsTrigger>
            <TabsTrigger value="simulator" className="gap-2">
              <Terminal className="w-4 h-4" /> Test Sandbox
            </TabsTrigger>
          </TabsList>

          {/* ── TAB 1: BROKERS ── */}
          <TabsContent value="brokers" className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Persistent MQTT 3.1.1/5.0 connections subscribing to live device telemetry.
              </div>
              <Button
                size="sm"
                variant={showAddForm ? 'outline' : 'default'}
                onClick={() => setShowAddForm(!showAddForm)}
                className="gap-1.5"
              >
                {showAddForm ? 'Cancel' : <><Plus className="w-3.5 h-3.5" /> Add Broker</>}
              </Button>
            </div>

            {showAddForm && (
              <form onSubmit={handleAddSubmit} className="border border-border/80 rounded-lg p-4 bg-muted/30 space-y-3">
                <div className="font-medium text-sm">Configure External IoT Broker</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Broker Name</Label>
                    <Input
                      placeholder="e.g. AWS Fleet Broker"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Broker Protocol</Label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={formType}
                      onChange={(e) => {
                        const val = e.target.value as 'mqtt' | 'aws_iot' | 'azure_iot';
                        setFormType(val);
                        if (val === 'aws_iot') {
                          setFormAuthType('tls_cert');
                          setFormUrl('mqtts://your-ats.iot.region.amazonaws.com:8883');
                        } else if (val === 'azure_iot') {
                          setFormUrl('mqtts://your-hub.azure-devices.net:8883');
                        } else {
                          setFormUrl('mqtt://localhost:1883');
                        }
                      }}
                    >
                      <option value="mqtt">Universal MQTT (Mosquitto / EMQX / HiveMQ)</option>
                      <option value="aws_iot">AWS IoT Core (MQTT over mTLS)</option>
                      <option value="azure_iot">Azure IoT Hub (MQTT)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Endpoint URL</Label>
                  <Input
                    placeholder="mqtts://... or mqtt://..."
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Topic Subscription Pattern</Label>
                    <Input
                      placeholder="ontos/twins/+/telemetry"
                      value={formTopic}
                      onChange={(e) => setFormTopic(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Authentication Type</Label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={formAuthType}
                      onChange={(e) => setFormAuthType(e.target.value as 'none' | 'basic' | 'tls_cert')}
                    >
                      <option value="none">Anonymous / Open</option>
                      <option value="basic">Basic (Username & Password)</option>
                      <option value="tls_cert">Mutual TLS (X.509 Certificate & Key)</option>
                    </select>
                  </div>
                </div>

                {formAuthType === 'basic' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Username</Label>
                      <Input value={formUsername} onChange={(e) => setFormUsername(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Password</Label>
                      <Input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} />
                    </div>
                  </div>
                )}

                {formAuthType === 'tls_cert' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Client Certificate (PEM)</Label>
                      <Textarea
                        placeholder="-----BEGIN CERTIFICATE-----..."
                        rows={3}
                        value={formCert}
                        onChange={(e) => setFormCert(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Client Private Key (PEM)</Label>
                      <Textarea
                        placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                        rows={3}
                        value={formKey}
                        onChange={(e) => setFormKey(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowAddForm(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={upsertConnector.isPending}>
                    {upsertConnector.isPending ? 'Connecting...' : 'Save & Connect'}
                  </Button>
                </div>
              </form>
            )}

            {connectors.data?.length === 0 && !showAddForm ? (
              <div className="text-center py-8 border border-dashed rounded-lg text-muted-foreground text-sm space-y-2">
                <Server className="w-8 h-8 mx-auto text-muted-foreground/60" />
                <p>No active IoT brokers configured yet.</p>
                <p className="text-xs">
                  Click <strong>Add Broker</strong> above or send data via the <strong>HTTP Webhook</strong> tab.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {connectors.data?.map((c) => (
                  <Card key={c.id} className="border border-border/80">
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{c.name}</span>
                          <Badge variant="outline" className="text-[10px] uppercase font-mono">
                            {c.brokerType}
                          </Badge>
                          {c.status === 'connected' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                            </span>
                          ) : c.status === 'error' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-red-500 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" /> Error
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-medium">
                              Disconnected
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono flex items-center gap-3">
                          <span>{c.endpointUrl}</span>
                          <span>•</span>
                          <span>Topic: {c.topicPattern || 'default'}</span>
                          <span>•</span>
                          <span>{c.messageCount} msg(s)</span>
                        </div>
                        {c.lastError && (
                          <div className="text-xs text-red-400 font-mono mt-0.5">{c.lastError}</div>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title={c.status === 'connected' ? 'Disconnect' : 'Connect'}
                          onClick={() => toggleConnector.mutate({ id: c.id, enable: c.status !== 'connected' })}
                        >
                          <Power className={`w-4 h-4 ${c.status === 'connected' ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Delete"
                          onClick={() => deleteConnector.mutate({ id: c.id })}
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── TAB 2: HTTP WEBHOOK ── */}
          <TabsContent value="webhook" className="space-y-4 pt-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Direct Ingestion API & Edge Webhook</div>
              <p className="text-xs text-muted-foreground">
                POST telemetry directly from cellular IoT gateways, edge collectors, AWS IoT Rules (HTTP Action),
                or Azure Event Grid webhooks.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Endpoint URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookConfig.data?.fullEndpointUrl || '/api/iot/telemetry'} className="font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={handleCopyCurl}>
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Workspace API Key</Label>
              <Input readOnly value={webhookConfig.data?.apiKey || ''} className="font-mono text-xs" />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Sample Ingestion Request</Label>
              <pre className="p-3 bg-muted rounded-md text-xs font-mono overflow-x-auto border border-border">
                {webhookConfig.data?.sampleCurl}
              </pre>
            </div>
          </TabsContent>

          {/* ── TAB 3: SANDBOX / SIMULATOR ── */}
          <TabsContent value="simulator" className="space-y-4 pt-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Device Payload Simulator</div>
              <p className="text-xs text-muted-foreground">
                Test physical device mappings and telemetry processing instantly without hardware.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Label className="text-xs">Preset Template:</Label>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 py-0.5 text-xs shadow-sm"
                value={selectedTemplate}
                onChange={(e) => {
                  const key = e.target.value as keyof typeof TEMPLATES;
                  setSelectedTemplate(key);
                  setCustomPayload(TEMPLATES[key].payload);
                }}
              >
                {Object.entries(TEMPLATES).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Telemetry JSON Payload</Label>
              <Textarea
                rows={9}
                value={customPayload}
                onChange={(e) => setCustomPayload(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex justify-between items-center pt-1">
              <span className="text-[11px] text-muted-foreground">
                Payload resolves device ID to twin, updates state, logs time-series, and checks insights.
              </span>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSendSimulator}
                disabled={ingestMutation.isPending}
              >
                {ingestMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send Test Ingest
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
