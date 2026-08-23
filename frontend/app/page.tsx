"use client";

import { useEffect, useState, Fragment } from "react";

const stats = [
  ["ACTIVE EXECUTIONS", "04", "RUNNING", "success"],
  ["PENDING APPROVALS", "02", "REVIEW", "warning"],
  ["TASKS COMPLETED", "128", "TODAY", "info"],
  ["FAILED TASKS", "03", "LAST 24H", "error"],
] as const;

type Execution = {
  id: string;
  name: string;
  owner: string;
  status: string;
  progress: string;
  tone: string;
  result?: string;
  error?: string;
};

type AuditEvent = {
  type: string;
  message: string;
  created_at?: number;
  actor?: { type?: string; name?: string; email?: string };
};

type ToolPolicy = {
  name: string;
  description: string;
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requires_approval: boolean;
  enabled: boolean;
  allowed_roles: string[];
  rate_limit_per_minute: number;
  burst_limit: number;
};

type GatewayMetrics = {
  total_requests: number;
  allowed_requests: number;
  blocked_by_policy: number;
  blocked_by_rate_limit: number;
  tool_call_counts: Record<string, number>;
  recent_invocations: Array<{
    tool_name: string;
    caller: string;
    execution_id: string | null;
    duration_ms: number;
    success: boolean;
    timestamp: string;
  }>;
};

type ToolExecutionResponse = {
  status: "ALLOWED" | "DENIED_DISABLED" | "DENIED_UNAUTHORIZED_ROLE" | "DENIED_RATE_LIMITED" | "ERROR";
  tool_name: string;
  result?: any;
  error?: string;
  duration_ms: number;
  rate_limit_info: {
    remaining: number;
    limit: number;
    reset_in_seconds: number;
  };
};

type MCPServer = {
  name: string;
  server_name?: string;
  description: string;
  version: string;
  protocol_version?: string;
  transport?: string;
  status?: string;
  tools_count: number;
  tools?: string[];
};

type MCPTool = {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string; enum?: string[]; default?: any }>;
    required?: string[];
  };
  input_schema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string; enum?: string[]; default?: any }>;
    required?: string[];
  };
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requires_approval: boolean;
  rate_limit_per_minute?: number;
  allowed_roles: string[];
  server_name?: string;
  server?: string;
  tool_name?: string;
};

const fallbackExecutions: Execution[] = [
  {id: "#EXE-8F21", name: "Generate customer quotation", owner: "Gemini Agent", status: "RUNNING", progress: "42%", tone: "success"},
  {id: "#EXE-8F20", name: "Sync inventory availability", owner: "Inventory Tool", status: "WAITING", progress: "78%", tone: "warning"},
  {id: "#EXE-8F1C", name: "Qualify inbound lead", owner: "CRM Agent", status: "RUNNING", progress: "64%", tone: "success"},
  {id: "#EXE-8F19", name: "Send quotation email", owner: "Gmail Tool", status: "FAILED", progress: "100%", tone: "error"},
];

function Status({ label, tone }: { label: string; tone: string }) { return <span className={`badge badge-${tone}`}><i />{label}</span>; }

type GoogleUser = { name: string; email: string };

function readGoogleUser(token: string): GoogleUser {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { name?: string; email?: string };
    return { name: payload.name ?? "Google account", email: payload.email ?? "Signed in" };
  } catch {
    return { name: "Google account", email: "Signed in" };
  }
}

const formatTimestamp = (sec?: number) => {
  if (!sec) return "-";
  const date = new Date(sec * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
};

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "gateway" | "mcp" | "trace" | "event-sources" | "settings">("overview");

  // Event Sources State
  interface EventSourceItem {
    id: string;
    name: string;
    type: "EMAIL" | "WEBHOOK";
    url: string;
    target: string;
    status: "ACTIVE" | "PAUSED";
    lastTriggered: string;
  }
  const [eventSources, setEventSources] = useState<EventSourceItem[]>([
    {
      id: "src-1",
      name: "sales-inbox@perusahaan.com",
      type: "EMAIL",
      url: "/api/webhooks/inbound-email",
      target: "Send quotation to PT Nusantara",
      status: "ACTIVE",
      lastTriggered: "3 min ago",
    },
    {
      id: "src-2",
      name: "HubSpot CRM Integration",
      type: "WEBHOOK",
      url: "/api/webhooks/hubspot",
      target: "Update CRM customer record",
      status: "ACTIVE",
      lastTriggered: "8 min ago",
    }
  ]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSrcName, setNewSrcName] = useState("");
  const [newSrcType, setNewSrcType] = useState<"EMAIL" | "WEBHOOK">("EMAIL");
  const [newSrcTarget, setNewSrcTarget] = useState("");

  // Integrations Configuration States
  const [imapServer, setImapServer] = useState("imap.example.com");
  const [imapPort, setImapPort] = useState(993);
  const [imapSecurity, setImapSecurity] = useState("SSL_TLS");
  const [imapFreq, setImapFreq] = useState("5");
  const [imapUser, setImapUsername] = useState("sales-inbox@perusahaan.com");
  const [imapPass, setImapPassword] = useState("••••••••");
  const [workerActive, setWorkerActive] = useState(false);
  const [testingImap, setTestingImap] = useState(false);

  // SMTP Outgoing Setup (Demo/Visual Placeholder)
  const [smtpServer, setSmtpServer] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("587 (Demo: DISPATCHED_SMTP_TLS)");
  const [smtpSecurity, setSmtpSecurity] = useState("STARTTLS");

  // Settings Sub-tab Selection
  const [settingsSubTab, setSettingsSubTab] = useState<"general" | "telemetry" | "integrations">("general");

  const [crmUrl, setCrmUrl] = useState("https://api.hubapi.com/v1");
  const [crmToken, setCrmToken] = useState("••••••••");
  const [crmEnabled, setCrmEnabled] = useState(true);

  const loadIntegrationsConfig = async () => {
    try {
      const res = await fetch(`${apiBase}/api/integrations/config`);
      if (res.ok) {
        const data = await res.json();
        if (data.email) {
          setImapServer(data.email.server || "");
          setImapPort(data.email.port || 993);
          setImapSecurity(data.email.security || "SSL_TLS");
          setImapFreq(data.email.sync_frequency || "5");
          setImapUsername(data.email.username || "");
          setImapPassword(data.email.password || "");
          setWorkerActive(data.email.worker_active || false);
        }
        if (data.crm) {
          setCrmUrl(data.crm.url || "");
          setCrmToken(data.crm.token || "");
          setCrmEnabled(data.crm.enabled !== false);
        }
      }
    } catch (err) {
      console.error("Failed to load integrations config", err);
    }
  };

  const saveIntegrationsConfig = async (updatedWorkerActive?: boolean) => {
    try {
      const payload = {
        email: {
          server: imapServer,
          port: Number(imapPort),
          security: imapSecurity,
          username: imapUser,
          password: imapPass,
          sync_frequency: imapFreq,
          worker_active: updatedWorkerActive !== undefined ? updatedWorkerActive : workerActive,
        },
        crm: {
          url: crmUrl,
          token: crmToken,
          enabled: crmEnabled,
        }
      };
      const res = await fetch(`${apiBase}/api/integrations/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        if (updatedWorkerActive !== undefined) {
          setWorkerActive(updatedWorkerActive);
        }
        alert("Integrations configuration saved successfully!");
      } else {
        throw new Error("Failed to save configuration");
      }
    } catch (err: any) {
      alert(`Error saving integrations: ${err.message}`);
    }
  };

  const testImapConnection = async () => {
    setTestingImap(true);
    try {
      const payload = {
        server: imapServer,
        port: Number(imapPort),
        security: imapSecurity,
        username: imapUser,
        password: imapPass,
        sync_frequency: imapFreq,
        worker_active: workerActive,
      };
      const res = await fetch(`${apiBase}/api/integrations/test-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Success!\n\n${data.message}`);
      } else {
        throw new Error(data.detail || "Failed to connect to IMAP server");
      }
    } catch (err: any) {
      alert(`IMAP Connection Failed:\n\n${err.message}`);
    } finally {
      setTestingImap(false);
    }
  };

  // Overview State
  const [executions, setExecutions] = useState<Execution[]>(fallbackExecutions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [idToken, setIdToken] = useState("");
  const [googleUser, setGoogleUser] = useState<GoogleUser>({ name: "", email: "" });
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [auditExecution, setAuditExecution] = useState("");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Server-side Pagination & Filter State
  const [counts, setCounts] = useState({ active: 0, waiting: 0, completed: 0, failed: 0, total: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [ownerFilter, setOwnerFilter] = useState<string>("ALL");
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);

  const statusOptions = ["ALL", "RUNNING", "WAITING_APPROVAL", "COMPLETED", "FAILED"];

  // Gateway State
  const [tools, setTools] = useState<ToolPolicy[]>([]);
  const [metrics, setMetrics] = useState<GatewayMetrics | null>(null);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string>("check_inventory");
  const [toolParams, setToolParams] = useState<string>('{\n  "sku": "SKU-PRO-01"\n}');
  const [toolRole, setToolRole] = useState<string>("agent");
  const [invokeResponse, setInvokeResponse] = useState<ToolExecutionResponse | null>(null);
  const [invoking, setInvoking] = useState(false);
  const [editingLimit, setEditingLimit] = useState<{ [tool: string]: number }>({});

  // MCP State
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [selectedMcpTool, setSelectedMcpTool] = useState<string>("inventory_check_stock");
  const [mcpParams, setMcpParams] = useState<string>('{\n  "sku": "SKU-PRO-01"\n}');
  const [mcpRole, setMcpRole] = useState<string>("agent");
  const [mcpResponse, setMcpResponse] = useState<ToolExecutionResponse | null>(null);
  const [mcpCalling, setMcpCalling] = useState(false);

  const safeExecutions = Array.isArray(executions) ? executions : [];
  const visibleExecutions = safeExecutions;
  const activeCount = counts.active.toString().padStart(2, "0");
  const approvalCount = counts.waiting.toString().padStart(2, "0");

  const dynamicStats = [
    ["ACTIVE EXECUTIONS", counts.active.toString().padStart(2, "0"), "RUNNING", "success"],
    ["PENDING APPROVALS", counts.waiting.toString().padStart(2, "0"), "REVIEW", "warning"],
    ["TASKS COMPLETED", counts.completed.toString().padStart(2, "0"), "TOTAL", "info"],
    ["FAILED TASKS", counts.failed.toString().padStart(2, "0"), "TOTAL", "error"],
  ] as const;

  const recentActivities = safeExecutions.slice(0, 3).map((exec) => {
    let title = "Execution created";
    let dotClass = "info";
    if (exec.status === "WAITING_APPROVAL") {
      title = "Approval requested";
      dotClass = "warning";
    } else if (exec.status === "RUNNING") {
      title = "Execution running";
      dotClass = "info";
    } else if (exec.status === "COMPLETED") {
      title = "Execution completed";
      dotClass = "success";
    } else if (exec.status === "FAILED") {
      title = "Execution failed";
      dotClass = "error";
    } else if (exec.status === "QUEUED") {
      title = "Execution queued";
      dotClass = "info";
    } else if (exec.status === "CANCELLED") {
      title = "Execution cancelled";
      dotClass = "error";
    }
    return {
      id: exec.id,
      title,
      name: exec.name,
      dotClass,
    };
  });

  const pendingApprovals = safeExecutions.filter((exec) => exec.status === "WAITING_APPROVAL");

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

  const authHeaders = (withJson = false): Record<string, string> => ({
    ...(withJson ? { "Content-Type": "application/json" } : {}),
    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
  });

  const loadCounts = async () => {
    try {
      const response = await fetch(`${apiBase}/api/executions/counts`);
      if (response.ok) {
        setCounts(await response.json());
      }
    } catch {
      // ignore
    }
  };

  const loadExecutions = async (showLoading = false, useCursor: string | null = currentCursor) => {
    if (showLoading) setLoading(true);
    try {
      let url = `${apiBase}/api/executions?limit=${pageSize}`;
      if (useCursor) {
        url += `&cursor=${encodeURIComponent(useCursor)}`;
      }
      if (statusFilter !== "ALL") {
        url += `&status=${encodeURIComponent(statusFilter)}`;
      }
      if (ownerFilter !== "ALL") {
        url += `&owner=${encodeURIComponent(ownerFilter)}`;
      }
      if (search.trim()) {
        url += `&search=${encodeURIComponent(search.trim())}`;
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error("Backend unavailable");
      const rawData = await response.json();
      const items = Array.isArray(rawData) ? rawData : (Array.isArray(rawData?.items) ? rawData.items : []);
      setExecutions(items);
      
      if (rawData && typeof rawData === "object" && "next_cursor" in rawData) {
        setNextCursor(rawData.next_cursor);
        setHasMore(rawData.has_more ?? false);
      } else {
        setNextCursor(null);
        setHasMore(false);
      }
      setError("");
      void loadCounts();
    } catch {
      setError("LIVE API OFFLINE / SHOWING LAST KNOWN DATA");
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const loadGatewayData = async () => {
    setGatewayLoading(true);
    try {
      const [toolsRes, metricsRes] = await Promise.all([
        fetch(`${apiBase}/api/gateway/tools`),
        fetch(`${apiBase}/api/gateway/metrics`),
      ]);
      if (toolsRes.ok) {
        const toolsData = (await toolsRes.json()) as ToolPolicy[];
        setTools(toolsData);
        if (toolsData.length && !selectedTool) {
          setSelectedTool(toolsData[0].name);
        }
      }
      if (metricsRes.ok) {
        const metricsData = (await metricsRes.json()) as GatewayMetrics;
        setMetrics(metricsData);
      }
    } catch {
      // Gateway offline fallback
    } finally {
      setGatewayLoading(false);
    }
  };

  const loadMcpData = async () => {
    setMcpLoading(true);
    try {
      const [serversRes, toolsRes] = await Promise.all([
        fetch(`${apiBase}/api/mcp/servers`),
        fetch(`${apiBase}/api/mcp/tools`),
      ]);
      if (serversRes.ok) {
        setMcpServers((await serversRes.json()) as MCPServer[]);
      }
      if (toolsRes.ok) {
        const tData = (await toolsRes.json()) as MCPTool[];
        setMcpTools(tData);
        if (tData.length && !selectedMcpTool) {
          setSelectedMcpTool(tData[0].name);
        }
      }
    } catch {
      // MCP offline fallback
    } finally {
      setMcpLoading(false);
    }
  };

  const handleNextPage = () => {
    if (hasMore && nextCursor) {
      const nextIndex = currentPageIndex + 1;
      const newHistory = [...cursorHistory];
      newHistory[nextIndex] = nextCursor;
      setCursorHistory(newHistory);
      setCurrentPageIndex(nextIndex);
      setCurrentCursor(nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (currentPageIndex > 0) {
      const prevIndex = currentPageIndex - 1;
      setCurrentPageIndex(prevIndex);
      setCurrentCursor(cursorHistory[prevIndex]);
    }
  };

  const resetExecutionPage = () => {
    setCursorHistory([null]);
    setCurrentPageIndex(0);
    setCurrentCursor(null);
  };

  useEffect(() => {
    resetExecutionPage();
  }, [statusFilter, ownerFilter, search, pageSize]);

  useEffect(() => {
    const token = sessionStorage.getItem("acp_google_id_token") ?? "";
    if (token) {
      setGoogleUser(readGoogleUser(token));
      setIdToken(token);
    }
  }, []);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return;
    const timer = window.setInterval(() => {
      const google = (window as any).google;
      const target = document.getElementById("google-signin");
      if (!google || !target) return;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential: string }) => {
          sessionStorage.setItem("acp_google_id_token", response.credential);
          setGoogleUser(readGoogleUser(response.credential));
          setIdToken(response.credential);
        },
      });
      google.accounts.id.renderButton(target, { theme: "outline", size: "small" });
      window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [idToken]);

  useEffect(() => {
    void loadExecutions(true);
    void loadGatewayData();
    void loadMcpData();
    const timer = window.setInterval(() => {
      void loadExecutions();
      void loadGatewayData();
      void loadMcpData();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [currentCursor, statusFilter, ownerFilter, search, pageSize]);

  useEffect(() => {
    if (activeTab === "settings") {
      void loadIntegrationsConfig();
    }
  }, [activeTab]);

  const createExecution = async () => {
    setCreating(true);
    try {
      const response = await fetch(`${apiBase}/api/executions`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ name: "New quotation workflow", owner: "Gemini Agent", requires_approval: true }),
      });
      if (!response.ok) throw new Error("Create execution failed");
      const created = (await response.json()) as Execution;
      // Reload the first server page so the cursor and total page remain valid.
      resetExecutionPage();
      setExecutions((current) => [created, ...current].slice(0, pageSize));
      void loadExecutions(true, null);
      setError("");
    } catch {
      setError("CREATE FAILED / CHECK FASTAPI");
    } finally {
      setCreating(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem("acp_google_id_token");
    setIdToken("");
    setGoogleUser({ name: "", email: "" });
  };

  const loadAudit = async (id: string) => {
    setAuditExecution(id);
    setAuditLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/executions/${encodeURIComponent(id)}/events`);
      if (!response.ok) throw new Error("Audit unavailable");
      setAuditEvents((await response.json()) as AuditEvent[]);
    } catch {
      setAuditEvents([]);
    } finally {
      setAuditLoading(false);
    }
  };

  const toggleAudit = (id: string) => {
    if (auditExecution === id) {
      setAuditExecution("");
      setAuditEvents([]);
    } else {
      void loadAudit(id);
    }
  };

  const decideApproval = async (id: string, decision: "APPROVED" | "REJECTED") => {
    try {
      const response = await fetch(`${apiBase}/api/executions/${encodeURIComponent(id)}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error("Approval failed");
      const updated = (await response.json()) as Execution;
      setExecutions((current) => current.map((item) => (item.id === id ? { ...item, ...updated } : item)));
      setError("");
    } catch {
      setError("APPROVAL FAILED / CHECK FASTAPI");
    }
  };

  const toggleToolEnabled = async (tool: ToolPolicy) => {
    try {
      const response = await fetch(`${apiBase}/api/gateway/policies/${encodeURIComponent(tool.name)}`, {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ enabled: !tool.enabled }),
      });
      if (response.ok) {
        const updated = (await response.json()) as ToolPolicy;
        setTools((current) => current.map((t) => (t.name === tool.name ? updated : t)));
      }
    } catch (err) {
      console.error("Failed to toggle tool policy", err);
    }
  };

  const saveRateLimit = async (toolName: string) => {
    const limit = editingLimit[toolName];
    if (limit === undefined) return;
    try {
      const response = await fetch(`${apiBase}/api/gateway/policies/${encodeURIComponent(toolName)}`, {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ rate_limit_per_minute: Number(limit) }),
      });
      if (response.ok) {
        const updated = (await response.json()) as ToolPolicy;
        setTools((current) => current.map((t) => (t.name === toolName ? updated : t)));
        setEditingLimit((prev) => {
          const next = { ...prev };
          delete next[toolName];
          return next;
        });
      }
    } catch (err) {
      console.error("Failed to update rate limit", err);
    }
  };

  const handleToolSelectChange = (name: string) => {
    setSelectedTool(name);
    if (name === "check_inventory") {
      setToolParams('{\n  "sku": "SKU-PRO-01"\n}');
    } else if (name === "get_customer_details") {
      setToolParams('{\n  "customer_id": "CUST-901"\n}');
    } else if (name === "update_customer_crm") {
      setToolParams('{\n  "customer_id": "CUST-901",\n  "status": "VIP_PROSPECT"\n}');
    } else if (name === "generate_quotation") {
      setToolParams('{\n  "customer_id": "CUST-901",\n  "sku": "SKU-PRO-01",\n  "quantity": 5\n}');
    } else if (name === "send_quotation_email") {
      setToolParams('{\n  "recipient": "finance@client.id",\n  "quotation_id": "QUO-2026-001"\n}');
    } else if (name === "query_system_metrics") {
      setToolParams('{\n  "timeframe": "1h"\n}');
    }
  };

  const handleMcpToolSelectChange = (name: string) => {
    setSelectedMcpTool(name);
    if (name === "inventory_check_stock") {
      setMcpParams('{\n  "sku": "SKU-PRO-01"\n}');
    } else if (name === "inventory_reserve_stock") {
      setMcpParams('{\n  "sku": "SKU-PRO-01",\n  "quantity": 2\n}');
    } else if (name === "crm_lookup_customer") {
      setMcpParams('{\n  "customer_id": "CUST-901"\n}');
    } else if (name === "crm_update_lead") {
      setMcpParams('{\n  "customer_id": "CUST-901",\n  "status": "QUALIFIED_LEAD",\n  "deal_value": 75000000\n}');
    } else if (name === "email_send_quote") {
      setMcpParams('{\n  "recipient": "director@pt-nusantara.id",\n  "quote_id": "QUO-2026-001",\n  "total_amount": 24500000\n}');
    } else if (name === "gcp_metrics_query") {
      setMcpParams('{\n  "metric_name": "compute.googleapis.com/instance/cpu/utilization",\n  "minutes": 60\n}');
    }
  };

  const runMcpCall = async () => {
    setMcpCalling(true);
    setMcpResponse(null);
    try {
      let parsedParams = {};
      try {
        parsedParams = JSON.parse(mcpParams);
      } catch {
        // invalid JSON fallback
      }
      const selectedToolObj = mcpTools.find((t) => t.name === selectedMcpTool);
      const serverName = selectedToolObj?.server_name || selectedToolObj?.server || "inventory";
      const response = await fetch(`${apiBase}/api/mcp/call`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          server: serverName,
          tool: selectedMcpTool,
          tool_name: selectedMcpTool,
          arguments: parsedParams,
          caller: "dashboard-mcp-tester",
          role: mcpRole,
        }),
      });
      const data = (await response.json()) as ToolExecutionResponse;
      setMcpResponse(data);
      void loadGatewayData();
    } catch {
      setMcpResponse({
        status: "ERROR",
        tool_name: selectedMcpTool,
        error: "Failed to connect to MCP Protocol endpoint",
        duration_ms: 0,
        rate_limit_info: { remaining: 0, limit: 0, reset_in_seconds: 0 },
      });
    } finally {
      setMcpCalling(false);
    }
  };

  const runToolExecution = async () => {
    setInvoking(true);
    setInvokeResponse(null);
    try {
      let parsedParams = {};
      try {
        parsedParams = JSON.parse(toolParams);
      } catch {
        // invalid JSON fallback
      }
      const response = await fetch(`${apiBase}/api/gateway/execute`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          tool_name: selectedTool,
          params: parsedParams,
          caller: "dashboard-tester",
          role: toolRole,
        }),
      });
      const data = (await response.json()) as ToolExecutionResponse;
      setInvokeResponse(data);
      void loadGatewayData();
    } catch {
      setInvokeResponse({
        status: "ERROR",
        tool_name: selectedTool,
        error: "Failed to connect to Tool Gateway endpoint",
        duration_ms: 0,
        rate_limit_info: { remaining: 0, limit: 0, reset_in_seconds: 0 },
      });
    } finally {
      setInvoking(false);
    }
  };

  const getRiskTone = (level: string) => {
    switch (level) {
      case "LOW":
        return "success";
      case "MEDIUM":
        return "warning";
      case "HIGH":
      case "CRITICAL":
        return "error";
      default:
        return "info";
    }
  };

  const renderExecutionQueue = (isTraceOnly = false) => {
    return (
      <article className="panel executions" id="execution-queue" style={isTraceOnly ? { gridColumn: "1 / -1" } : undefined}>
        <div className="panel-head">
          <div>
            <div className="label">LIVE WORKFLOWS</div>
            <h2>Execution Queue</h2>
          </div>
          <div className="execution-filters">
            <label className="filter-control">
              <span className="label">STATUS</span>
              <select
                aria-label="Filter executions by status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
            <span className="table-search-wrap">
              <svg className="table-search-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4.5 4.5" />
              </svg>
              <input
                className="table-search"
                aria-label="Search executions"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search queue..."
              />
            </span>
          </div>
        </div>
        <div className="api-state">{loading ? "CONNECTING TO FASTAPI..." : error || "LIVE DATA / FASTAPI"}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>EXECUTION</th>
                <th>WORKFLOW</th>
                <th>OWNER</th>
                <th>STATUS</th>
                <th>PROGRESS</th>
              </tr>
            </thead>
            <tbody>
              {visibleExecutions.length ? (
                visibleExecutions.map(({ id, name, owner, status, progress, tone }) => (
                  <Fragment key={id}>
                    <tr
                      onClick={() => toggleAudit(id)}
                      style={{ cursor: "pointer", background: auditExecution === id ? "#161b22" : undefined }}
                    >
                      <td className="mono accent">{id}</td>
                      <td>{name}</td>
                      <td className="muted">{owner}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }} onClick={(e) => e.stopPropagation()}>
                          <Status label={status} tone={tone} />
                          {status === "WAITING_APPROVAL" && (
                            <div style={{ display: "flex", gap: "4px" }}>
                              <button
                                className="btn primary compact"
                                onClick={() => void decideApproval(id, "APPROVED")}
                                style={{ padding: "2px 6px", fontSize: "10px" }}
                              >
                                Approve
                              </button>
                              <button
                                className="btn danger compact"
                                onClick={() => void decideApproval(id, "REJECTED")}
                                style={{ padding: "2px 6px", fontSize: "10px" }}
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                          <div className="progress" style={{ flex: 1, margin: 0 }}>
                            <span className={`fill ${tone}`} style={{ width: progress }} />
                          </div>
                          <span className="mono progress-label" style={{ minWidth: "35px", textAlign: "right" }}>{progress}</span>
                        </div>
                      </td>
                    </tr>
                    {auditExecution === id && (
                      <tr key={`${id}-audit`} style={{ background: "#0d1117" }}>
                        <td colSpan={5} style={{ padding: "8px 12px", borderBottom: "1px solid #30363d" }}>
                          <div style={{ padding: "0" }}>
                            <div className="label" style={{ marginBottom: "6px", fontSize: "9px", fontWeight: "bold", color: "var(--color-accent)" }}>
                              AUDIT TRACE / {id}
                            </div>
                            {auditLoading ? (
                              <div className="muted" style={{ padding: "6px 0", fontSize: "11px" }}>Loading trace...</div>
                            ) : (
                              <div className="table-wrap" style={{ border: "1px solid #30363d", borderRadius: "6px", background: "#0d1117", overflowX: "hidden" }}>
                                <table style={{ margin: 0, width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                                  <thead>
                                    <tr style={{ borderBottom: "1px solid #30363d", background: "#161b22" }}>
                                      <th style={{ width: "18%", padding: "4px 8px", textAlign: "left", fontSize: "9px", color: "var(--color-muted)" }}>STATUS / EVENT</th>
                                      <th style={{ width: "44%", padding: "4px 8px", textAlign: "left", fontSize: "9px", color: "var(--color-muted)" }}>DESCRIPTION</th>
                                      <th style={{ width: "14%", padding: "4px 8px", textAlign: "left", fontSize: "9px", color: "var(--color-muted)" }}>BY</th>
                                      <th style={{ width: "24%", padding: "4px 8px", textAlign: "left", fontSize: "9px", color: "var(--color-muted)" }}>DATE / TIME</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {auditEvents.map((event, index) => (
                                      <tr key={`${event.type}-${index}`} style={{ borderBottom: index < auditEvents.length - 1 ? "1px solid #21262d" : "none" }}>
                                        <td className="mono accent" style={{ padding: "6px 8px", fontWeight: "bold", fontSize: "9px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.type}</td>
                                        <td style={{ padding: "6px 8px", fontSize: "10px", color: "#c9d1d9", wordBreak: "break-word" }}>{event.message}</td>
                                        <td className="muted mono" style={{ padding: "6px 8px", fontSize: "9px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.actor?.name || event.actor?.email || "system"}</td>
                                        <td className="muted mono" style={{ padding: "6px 8px", fontSize: "9px", whiteSpace: "nowrap" }}>
                                          {formatTimestamp(event.created_at)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="muted">
                    No matching executions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-pagination" aria-label="Execution pagination">
          <span className="pagination-summary">
            PAGE {currentPageIndex + 1} · {safeExecutions.length} OF {hasMore ? `${pageSize}+` : safeExecutions.length}
          </span>
          <div className="pagination-actions">
            <label className="page-limit">
              <span>ROWS</span>
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <button className="btn" onClick={handlePrevPage} disabled={currentPageIndex === 0 || loading}>
              ← Prev Page
            </button>
            <button className="btn" onClick={handleNextPage} disabled={!hasMore || loading}>
              Next Page →
            </button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">ACP</span>
          <span className="brand-subtitle">AGENT CONTROL PLANE</span>
        </div>
        <div className="topbar-meta">
          <span className="mono">PROJECT / ACP-HACKATHON-2026</span>
          <span className="live-dot" />
          GCP CONNECTED
          <details className="notification-menu">
            <summary className="notification-trigger">
              <svg viewBox="0 0 24 24" aria-label="Notifications">
                <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
              </svg>
              <i>{activeCount}</i>
              <i className="approval-count">{approvalCount}</i>
            </summary>
            <div className="notification-dropdown">
              <div>
                <span>Executions</span>
                <b>{activeCount}</b>
              </div>
              <div>
                <span>Approvals</span>
                <b className="orange-count">{approvalCount}</b>
              </div>
            </div>
          </details>
          {idToken ? (
            <details className="account-menu">
              <summary className="avatar account-summary">{googleUser.name || googleUser.email} v</summary>
              <div className="account-dropdown">
                <span>{googleUser.email}</span>
                <button className="btn ghost" onClick={logout}>
                  Logout
                </button>
              </div>
            </details>
          ) : (
            <span id="google-signin" />
          )}
        </div>
      </header>

      <aside className="sidebar">
        <div className="nav-label">CONTROL CENTER</div>
        <nav>
          <a
            className={`nav-item ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
            style={{ cursor: "pointer" }}
          >
            <span>▦</span>Overview
          </a>
          <a
            className={`nav-item ${activeTab === "gateway" ? "active" : ""}`}
            onClick={() => setActiveTab("gateway")}
            style={{ cursor: "pointer" }}
          >
            <span>⌘</span>Tool Gateway
          </a>
          <a
            className={`nav-item ${activeTab === "mcp" ? "active" : ""}`}
            onClick={() => setActiveTab("mcp")}
            style={{ cursor: "pointer" }}
          >
            <span>⚡</span>MCP Protocol
          </a>
          <a
            className={`nav-item ${activeTab === "event-sources" ? "active" : ""}`}
            onClick={() => setActiveTab("event-sources")}
            style={{ cursor: "pointer" }}
          >
            <span>≋</span>Event Sources
          </a>
        </nav>
        <div className="nav-label lower">OBSERVABILITY</div>
        <nav>
          <a
            className={`nav-item ${activeTab === "trace" ? "active" : ""}`}
            onClick={() => setActiveTab("trace")}
            style={{ cursor: "pointer" }}
          >
            <span>▤</span>Trace Explorer
          </a>
          <a
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
            style={{ cursor: "pointer" }}
          >
            <span>⚙</span>Settings
          </a>
        </nav>
        <div className="sidebar-footer">
          <span className="live-dot" /> RUNTIME ONLINE
          <div className="mono">v0.1.0 · us</div>
        </div>
      </aside>

      <main className="main">
        {activeTab === "overview" ? (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">TASKMASTER / OVERVIEW</div>
                <h1>Agent Operations</h1>
                <p>Monitor autonomous workflows, approvals, and tool activity.</p>
              </div>
              <div className="toolbar">
                <button className="btn secondary" onClick={() => void loadExecutions(true)}>
                  ↻ Refresh
                </button>
                <button className="btn primary" onClick={createExecution} disabled={creating}>
                  {creating ? "Creating..." : "＋ New Execution"}
                </button>
              </div>
            </div>

            <section className="stats-grid">
              {dynamicStats.map(([label, value, note, tone]) => (
                <article className={`stat-card top-${tone}`} key={label}>
                  <div className="label">{label}</div>
                  <div className="stat-value mono">{value}</div>
                  <Status label={note} tone={tone} />
                </article>
              ))}
            </section>

            <section className="content-grid">
              {renderExecutionQueue()}

              <article className="panel approvals">
                <div className="panel-head">
                  <div>
                    <div className="label">HUMAN-IN-THE-LOOP</div>
                    <h2>Approvals</h2>
                  </div>
                  <span className="count">{approvalCount}</span>
                </div>
                <div className="approval-list" style={{ maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
                  {pendingApprovals.length > 0 ? (
                    pendingApprovals.map((exec) => (
                      <div className="approval-item" key={exec.id} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div className="approval-icon">!</div>
                        <div style={{ flex: 1 }}>
                          <strong>{exec.name}</strong>
                          <p className="muted" style={{ margin: "2px 0 0 0" }}>Owner: {exec.owner}</p>
                          <div className="approval-meta mono" style={{ fontSize: "10px", marginTop: "4px" }}>{exec.id}</div>
                        </div>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button
                            className="btn primary compact"
                            onClick={() => void decideApproval(exec.id, "APPROVED")}
                            style={{ padding: "4px 8px" }}
                          >
                            Approve
                          </button>
                          <button
                            className="btn danger compact"
                            onClick={() => void decideApproval(exec.id, "REJECTED")}
                            style={{ padding: "4px 8px" }}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="muted" style={{ textAlign: "center", padding: "20px 0", fontSize: "12px" }}>
                      No executions pending approval.
                    </div>
                  )}
                </div>
              </article>
            </section>

            <section className="bottom-grid">
              <article className="panel" style={{ gridColumn: "1 / -1" }}>
                <div className="panel-head">
                  <div>
                    <div className="label">AUDIT TRAIL</div>
                    <h2>Recent Activity</h2>
                  </div>
                  <button className="btn ghost" onClick={() => setActiveTab("gateway")}>
                    Gateway metrics →
                  </button>
                </div>
                <div className="activity-list">
                  {recentActivities.length > 0 ? (
                    recentActivities.map((act, idx) => (
                      <div key={act.id + idx}>
                        <span className={`activity-dot ${act.dotClass}`} />
                        <span>
                          <b>{act.title}</b> <span className="muted">{act.name}</span>
                        </span>
                        <span className="mono" style={{ fontSize: "11px", marginLeft: "auto", color: "var(--color-muted)" }}>{act.id}</span>
                      </div>
                    ))
                  ) : (
                    <div>
                      <span className="activity-dot success" />
                      <span>
                        <b>System ready</b> <span className="muted">No executions recorded</span>
                      </span>
                    </div>
                  )}
                </div>
              </article>
            </section>
          </>
        ) : activeTab === "trace" ? (
          /* TRACE EXPLORER VIEW (LIVE WORKFLOWS ONLY) */
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">OBSERVABILITY / TRACE EXPLORER</div>
                <h1>Trace Explorer</h1>
                <p>Real-time execution streams and detailed event auditing log.</p>
              </div>
              <div className="toolbar">
                <button className="btn secondary" onClick={() => void loadExecutions(true)}>
                  ↻ Refresh
                </button>
              </div>
            </div>

            <section className="content-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
              {renderExecutionQueue(true)}
            </section>
          </>
        ) : activeTab === "event-sources" ? (
          /* EVENT SOURCES VIEW */
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">INTEGRATION / EVENT SOURCES</div>
                <h1>Event Sources</h1>
                <p>Configure incoming webhooks, email triggers, and monitor events driving autonomous agent workflows.</p>
              </div>
            </div>

            <section className="stats-grid">
              <article className="stat-card">
                <div className="label">ACTIVE SOURCES</div>
                <div className="value">2</div>
                <div className="sub">Email Inbox & Webhook Integration</div>
              </article>
              <article className="stat-card">
                <div className="label">EVENTS INGESTED</div>
                <div className="value accent">4,102</div>
                <div className="sub">Total processed event messages</div>
              </article>
              <article className="stat-card">
                <div className="label">PROCESSING TIME</div>
                <div className="value">142ms</div>
                <div className="sub">Average ingestion and routing latency</div>
              </article>
              <article className="stat-card">
                <div className="label">STATUS</div>
                <div className="value" style={{ color: "var(--color-success)" }}>● ACTIVE</div>
                <div className="sub">Live ingestion engine online</div>
              </article>
            </section>

            <div className="content-grid" style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "20px" }}>
              {/* Event Sources List */}
              <article className="panel">
                <div className="panel-head">
                  <div>
                    <div className="label">INGESTION ENDPOINTS</div>
                    <h2>Registered Event Sources</h2>
                  </div>
                  <button 
                    className="btn primary" 
                    style={{ fontSize: "11px", padding: "4px 10px", height: "fit-content" }}
                    onClick={() => setShowAddForm(!showAddForm)}
                  >
                    {showAddForm ? "✕ Cancel" : "＋ Add Source"}
                  </button>
                </div>

                {showAddForm && (
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newSrcName || !newSrcTarget) return;
                      const newSrc: EventSourceItem = {
                        id: `src-${Date.now()}`,
                        name: newSrcName,
                        type: newSrcType,
                        url: newSrcType === "EMAIL" ? "/api/webhooks/inbound-email" : "/api/webhooks/hubspot",
                        target: newSrcTarget,
                        status: "ACTIVE",
                        lastTriggered: "Never",
                      };
                      setEventSources([...eventSources, newSrc]);
                      setNewSrcName("");
                      setNewSrcTarget("");
                      setShowAddForm(false);
                    }} 
                    style={{ 
                      background: "#161b22", 
                      border: "1px solid #30363d", 
                      padding: "16px", 
                      borderRadius: "6px", 
                      marginTop: "16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px"
                    }}
                  >
                    <h3 style={{ fontSize: "13px", color: "white", margin: 0 }}>Register New Event Source</h3>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <label style={{ fontSize: "11px", color: "var(--color-muted)" }}>SOURCE TYPE</label>
                      <select 
                        className="mono"
                        value={newSrcType} 
                        onChange={(e) => setNewSrcType(e.target.value as "EMAIL" | "WEBHOOK")}
                        style={{ background: "#0d1117", border: "1px solid #30363d", color: "white", padding: "8px", borderRadius: "4px" }}
                      >
                        <option value="EMAIL">EMAIL INBOX (IMAP / Inbound Forwarder)</option>
                        <option value="WEBHOOK">CRM / WEBHOOK ENDPOINT (HubSpot, CRM, etc.)</option>
                      </select>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <label style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                        {newSrcType === "EMAIL" ? "EMAIL ACCOUNT / INBOX" : "INTEGRATION NAME"}
                      </label>
                      <input 
                        type="text" 
                        placeholder={newSrcType === "EMAIL" ? "support@perusahaan.com" : "Salesforce CRM Trigger"}
                        className="mono"
                        value={newSrcName}
                        onChange={(e) => setNewSrcName(e.target.value)}
                        required
                        style={{ background: "#0d1117", border: "1px solid #30363d", color: "white", padding: "8px", borderRadius: "4px" }}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <label style={{ fontSize: "11px", color: "var(--color-muted)" }}>TARGET WORKFLOW / PROMPT TARGET</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Handle customer complaints" 
                        className="mono"
                        value={newSrcTarget}
                        onChange={(e) => setNewSrcTarget(e.target.value)}
                        required
                        style={{ background: "#0d1117", border: "1px solid #30363d", color: "white", padding: "8px", borderRadius: "4px" }}
                      />
                    </div>

                    <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" }}>
                      <button 
                        type="button" 
                        className="btn ghost" 
                        onClick={() => setShowAddForm(false)}
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        className="btn primary"
                      >
                        ✔ Register Source
                      </button>
                    </div>
                  </form>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
                  {eventSources.map((src) => (
                    <div key={src.id} style={{ background: "#0d1117", border: "1px solid #30363d", padding: "14px", borderRadius: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span className="mono accent" style={{ fontSize: "9px", background: "#161b22", padding: "2px 6px", borderRadius: "4px" }}>{src.type}</span>
                          <strong className="mono" style={{ color: "white", fontSize: "12px" }}>{src.name}</strong>
                        </div>
                        <Status label={src.status} tone="success" />
                      </div>
                      <div style={{ fontSize: "12px", margin: "6px 0", color: "#8b949e" }}>
                        Target Workflow: <span style={{ color: "#c9d1d9", fontWeight: "bold" }}>{src.target}</span>
                      </div>
                      <div className="muted mono" style={{ fontSize: "10px", marginTop: "8px", background: "#161b22", padding: "8px", borderRadius: "4px", wordBreak: "break-all" }}>
                        <span className="accent" style={{ fontWeight: "bold" }}>POST</span> {apiBase}{src.url}
                      </div>
                      <div className="muted mono" style={{ fontSize: "10px", marginTop: "6px", textAlign: "right" }}>
                        Last triggered: {src.lastTriggered}
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              {/* Event Simulator */}
              <article className="panel">
                <div className="panel-head">
                  <div>
                    <div className="label">DEMO PLAYGROUND</div>
                    <h2>Event Simulator</h2>
                  </div>
                  <span className="mono accent" style={{ fontSize: "10px" }}>INTERACTIVE</span>
                </div>

                <p className="muted" style={{ margin: "10px 0 20px 0", fontSize: "12px", lineHeight: "1.5" }}>
                  Simulate incoming customer emails or external CRM webhook triggers. Triggers will execute HTTP POST requests directly to our public webhook ingestion endpoints!
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {eventSources.map((src) => (
                    <button
                      key={src.id}
                      className="btn primary"
                      style={{ padding: "10px", textAlign: "left", justifyContent: "flex-start", gap: "12px" }}
                      onClick={async () => {
                        try {
                          const isEmail = src.type === "EMAIL";
                          const payload = isEmail 
                            ? {
                                sender: src.name.includes("@") ? src.name : "customer@nusantara-group.co.id",
                                subject: src.target,
                                body: `Automatic trigger matching rule from source: ${src.name}`
                              }
                            : {
                                event: "contact.created",
                                contact_email: "rina.wulandari@gmail.com",
                                contact_name: "Rina Wulandari",
                                associated_company: src.name
                              };
                          const res = await fetch(`${apiBase}${src.url}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                          });
                          if (!res.ok) throw new Error("Simulation failed to trigger");
                          
                          // Update last triggered in state
                          setEventSources(prev => 
                            prev.map(item => item.id === src.id ? { ...item, lastTriggered: "Just now" } : item)
                          );

                          alert(`Success!\nInbound ${src.type} event received and parsed by FastAPI endpoint!\n\nNew execution for "${src.target}" has been generated in the main queue.`);
                        } catch (err: any) {
                          alert(`Error: ${err.message}`);
                        }
                      }}
                    >
                      {src.type === "EMAIL" ? "📥" : "🔌"} Simulate Inbound {src.type === "EMAIL" ? "Email" : "Webhook"} ({src.name})
                    </button>
                  ))}

                  <button
                    className="btn secondary"
                    style={{ padding: "10px", textAlign: "left", justifyContent: "flex-start", gap: "12px" }}
                    onClick={async () => {
                      const token = sessionStorage.getItem("google_id_token");
                      if (!token) {
                        alert("Authentication Error: Please sign in via Google to trigger simulation.");
                        return;
                      }
                      try {
                        const res = await fetch(`${apiBase}/api/executions`, {
                          method: 'POST',
                          headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                          },
                          body: JSON.stringify({
                            name: "Analyze competitor prices on Tokopedia",
                            owner: "Scraper CronTrigger",
                            requires_approval: false
                          })
                        });
                        if (!res.ok) throw new Error("Simulation failed to trigger");
                        alert("Success!\nScheduled cron-scraper triggered via authenticated session.\n\nNew auto-executing task has been queued.");
                      } catch (err: any) {
                        alert(`Error: ${err.message}`);
                      }
                    }}
                  >
                    ⏰ Simulate Scheduled Competitor Scraping
                  </button>
                </div>
              </article>
            </div>
          </>
        ) : activeTab === "gateway" ? (
          /* TOOL GATEWAY VIEW */
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">SECURITY BOUNDARY / TOOL GATEWAY</div>
                <h1>Policy & Rate Limiting Engine</h1>
                <p>Enforce RBAC permissions, sliding window quotas, and audit trails on all ADK tool calls.</p>
              </div>
              <div className="toolbar">
                <button className="btn secondary" onClick={() => void loadGatewayData()}>
                  ↻ Refresh Policies
                </button>
              </div>
            </div>

            {/* Gateway Metric Cards */}
            <section className="stats-grid">
              <article className="stat-card top-info">
                <div className="label">TOTAL INVOCATIONS</div>
                <div className="stat-value mono">{(metrics?.total_requests ?? 0).toString().padStart(2, "0")}</div>
                <Status label="GATEWAY CALLS" tone="info" />
              </article>
              <article className="stat-card top-success">
                <div className="label">ALLOWED REQUESTS</div>
                <div className="stat-value mono">{(metrics?.allowed_requests ?? 0).toString().padStart(2, "0")}</div>
                <Status label="ENFORCED" tone="success" />
              </article>
              <article className="stat-card top-warning">
                <div className="label">POLICY BLOCKED</div>
                <div className="stat-value mono">{(metrics?.blocked_by_policy ?? 0).toString().padStart(2, "0")}</div>
                <Status label="RBAC / DISABLED" tone="warning" />
              </article>
              <article className="stat-card top-error">
                <div className="label">RATE LIMIT BLOCKED</div>
                <div className="stat-value mono">{(metrics?.blocked_by_rate_limit ?? 0).toString().padStart(2, "0")}</div>
                <Status label="SLIDING WINDOW" tone="error" />
              </article>
            </section>

            {/* Main Policy & Testing Grid */}
            <section className="content-grid">
              {/* Policies Table */}
              <article className="panel executions">
                <div className="panel-head">
                  <div>
                    <div className="label">SECURITY POLICIES</div>
                    <h2>Registered Tools & Enforcement</h2>
                  </div>
                  <span className="mono muted">{tools.length} TOOLS ACTIVE</span>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>TOOL</th>
                        <th>RISK LEVEL</th>
                        <th>ROLES</th>
                        <th>RATE LIMIT</th>
                        <th>APPROVAL</th>
                        <th>STATUS</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tools.map((tool) => {
                        const isEditing = editingLimit[tool.name] !== undefined;
                        return (
                          <tr key={tool.name}>
                            <td>
                              <strong className="accent mono">{tool.name}</strong>
                              <div className="muted" style={{ fontSize: "11px", marginTop: "2px" }}>
                                {tool.description}
                              </div>
                            </td>
                            <td>
                              <Status label={tool.risk_level} tone={getRiskTone(tool.risk_level)} />
                            </td>
                            <td>
                              <span className="mono" style={{ fontSize: "11px" }}>
                                {tool.allowed_roles.join(", ")}
                              </span>
                            </td>
                            <td>
                              {isEditing ? (
                                <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                                  <input
                                    type="number"
                                    value={editingLimit[tool.name]}
                                    onChange={(e) =>
                                      setEditingLimit({
                                        ...editingLimit,
                                        [tool.name]: Number(e.target.value),
                                      })
                                    }
                                    style={{
                                      width: "55px",
                                      background: "#161b22",
                                      border: "1px solid #30363d",
                                      color: "#fff",
                                      padding: "2px 4px",
                                      borderRadius: "4px",
                                    }}
                                  />
                                  <button className="btn primary compact" onClick={() => void saveRateLimit(tool.name)}>
                                    Save
                                  </button>
                                </div>
                              ) : (
                                <span
                                  className="mono"
                                  style={{ cursor: "pointer", textDecoration: "underline" }}
                                  onClick={() =>
                                    setEditingLimit({
                                      ...editingLimit,
                                      [tool.name]: tool.rate_limit_per_minute,
                                    })
                                  }
                                >
                                  {tool.rate_limit_per_minute}/min
                                </span>
                              )}
                            </td>
                            <td>
                              {tool.requires_approval ? (
                                <Status label="REQUIRED" tone="warning" />
                              ) : (
                                <span className="muted mono">AUTO</span>
                              )}
                            </td>
                            <td>
                              <button
                                className={`btn compact ${tool.enabled ? "secondary" : "danger"}`}
                                onClick={() => void toggleToolEnabled(tool)}
                              >
                                {tool.enabled ? "ENABLED" : "DISABLED"}
                              </button>
                            </td>
                            <td>
                              <button
                                className="btn ghost compact"
                                onClick={() => handleToolSelectChange(tool.name)}
                              >
                                Test ↗
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>

              {/* Interactive Tool Runner Console */}
              <article className="panel approvals">
                <div className="panel-head">
                  <div>
                    <div className="label">INTERACTIVE GATEWAY CONSOLE</div>
                    <h2>Test Tool Invocation</h2>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
                  <div>
                    <label className="label" style={{ display: "block", marginBottom: "4px" }}>
                      SELECT TOOL
                    </label>
                    <select
                      value={selectedTool}
                      onChange={(e) => handleToolSelectChange(e.target.value)}
                      style={{
                        width: "100%",
                        background: "#161b22",
                        color: "#fff",
                        border: "1px solid #30363d",
                        padding: "8px",
                        borderRadius: "6px",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      {tools.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name} ({t.risk_level})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label" style={{ display: "block", marginBottom: "4px" }}>
                      CALLER ROLE (FOR RBAC TEST)
                    </label>
                    <select
                      value={toolRole}
                      onChange={(e) => setToolRole(e.target.value)}
                      style={{
                        width: "100%",
                        background: "#161b22",
                        color: "#fff",
                        border: "1px solid #30363d",
                        padding: "8px",
                        borderRadius: "6px",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      <option value="agent">agent (Authorized)</option>
                      <option value="admin">admin (Authorized)</option>
                      <option value="unauthorized_guest">unauthorized_guest (Blocked)</option>
                    </select>
                  </div>

                  <div>
                    <label className="label" style={{ display: "block", marginBottom: "4px" }}>
                      PAYLOAD PARAMETERS (JSON)
                    </label>
                    <textarea
                      rows={4}
                      value={toolParams}
                      onChange={(e) => setToolParams(e.target.value)}
                      style={{
                        width: "100%",
                        background: "#0d1117",
                        color: "#58a6ff",
                        border: "1px solid #30363d",
                        padding: "8px",
                        borderRadius: "6px",
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "12px",
                      }}
                    />
                  </div>

                  <button
                    className="btn primary"
                    onClick={() => void runToolExecution()}
                    disabled={invoking}
                    style={{ width: "100%" }}
                  >
                    {invoking ? "Routing via Gateway..." : "⚡ Execute via Gateway"}
                  </button>

                  {/* Invocation Result Display */}
                  {invokeResponse && (
                    <div
                      style={{
                        marginTop: "10px",
                        padding: "12px",
                        background: "#0d1117",
                        border: "1px solid #30363d",
                        borderRadius: "6px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "8px",
                        }}
                      >
                        <span className="label">GATEWAY DECISION</span>
                        <Status
                          label={invokeResponse.status}
                          tone={
                            invokeResponse.status === "ALLOWED"
                              ? "success"
                              : invokeResponse.status === "DENIED_RATE_LIMITED"
                              ? "error"
                              : "warning"
                          }
                        />
                      </div>

                      <div className="mono muted" style={{ fontSize: "11px", marginBottom: "6px" }}>
                        Latency: {invokeResponse.duration_ms}ms · Remaining Quota:{" "}
                        {invokeResponse.rate_limit_info?.remaining} / {invokeResponse.rate_limit_info?.limit}
                      </div>

                      <pre
                        style={{
                          background: "#161b22",
                          padding: "8px",
                          borderRadius: "4px",
                          overflowX: "auto",
                          fontSize: "11px",
                          color: invokeResponse.status === "ALLOWED" ? "#7ee787" : "#ff7b72",
                        }}
                      >
                        {JSON.stringify(invokeResponse.result ?? { error: invokeResponse.error }, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </article>
            </section>

            {/* Live Invocations Stream */}
            <section className="bottom-grid">
              <article className="panel" style={{ gridColumn: "1 / -1" }}>
                <div className="panel-head">
                  <div>
                    <div className="label">AUDIT & TELEMETRY</div>
                    <h2>Recent Gateway Invocations (Sliding Window Log)</h2>
                  </div>
                  <span className="mono muted">LIVE STREAM</span>
                </div>

                <div className="activity-list">
                  {metrics?.recent_invocations?.length ? (
                    metrics.recent_invocations.slice(-6).reverse().map((item, idx) => (
                      <div key={idx}>
                        <span className={`activity-dot ${item.success ? "success" : "error"}`} />
                        <span>
                          <b className="mono accent">{item.tool_name}</b>{" "}
                          <span className="muted">
                            by {item.caller} ({item.duration_ms}ms)
                          </span>
                        </span>
                        <time className="mono">{item.timestamp.split("T")[1]?.slice(0, 8) || "recent"}</time>
                      </div>
                    ))
                  ) : (
                    <div className="muted" style={{ padding: "12px 0" }}>
                      No tool invocations recorded yet. Use the test console above to execute tools.
                    </div>
                  )}
                </div>
              </article>
            </section>
          </>
        ) : activeTab === "mcp" ? (
          /* MCP Protocol Tab Content */
          <>
            {/* Header / Stats */}
            <section className="stats-grid">
              <article className="stat-card">
                <div className="label">MCP SERVERS</div>
                <div className="value">{mcpServers.length}</div>
                <div className="sub">Inventory, CRM, Email, GCP</div>
              </article>
              <article className="stat-card">
                <div className="label">STANDARDIZED TOOLS</div>
                <div className="value">{mcpTools.length}</div>
                <div className="sub">Model Context Protocol 2024-11-05</div>
              </article>
              <article className="stat-card">
                <div className="label">SECURITY INTEGRATION</div>
                <div className="value accent">ACTIVE</div>
                <div className="sub">Gateway & Sliding-Window Enforced</div>
              </article>
              <article className="stat-card">
                <div className="label">SCHEMA FORMAT</div>
                <div className="value">JSON Schema</div>
                <div className="sub">Strict Typing & Validation</div>
              </article>
            </section>

            {/* MCP Servers Grid */}
            <section style={{ marginBottom: "20px" }}>
              <div className="label" style={{ marginBottom: "8px" }}>
                REGISTERED MCP PROTOCOL SERVERS
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
                {mcpServers.map((srv, idx) => {
                  const srvName = srv.name || srv.server_name || `server-${idx}`;
                  const srvStatus = srv.status || "CONNECTED";
                  const srvProto = srv.protocol_version ? `MCP ${srv.protocol_version}` : (srv.transport || "JSON-RPC").toUpperCase();
                  const count = srv.tools_count ?? (srv.tools ? srv.tools.length : 0);
                  return (
                    <div
                      key={srvName}
                      style={{
                        background: "#0d1117",
                        border: "1px solid #30363d",
                        borderRadius: "8px",
                        padding: "16px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <span className="mono accent" style={{ fontWeight: 600, fontSize: "14px" }}>
                            ⚡ {srvName.toUpperCase()} SERVER
                          </span>
                          <Status label={srvStatus} tone="success" />
                        </div>
                        <p className="muted" style={{ fontSize: "12px", margin: "4px 0 12px 0", lineHeight: "1.4" }}>
                          {srv.description}
                        </p>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          borderTop: "1px solid #21262d",
                          paddingTop: "10px",
                          fontSize: "11px",
                        }}
                      >
                        <span className="mono muted">v{srv.version} • {srvProto}</span>
                        <span className="mono accent" style={{ background: "#161b22", padding: "2px 8px", borderRadius: "10px" }}>
                          {count} MCP Tools
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* MCP Tools & Interactive Test Invocator */}
            <section className="main-grid" style={{ gridTemplateColumns: "1.5fr 1fr", gap: "20px" }}>
              {/* MCP Tool Definitions & Schemas */}
              <article className="panel">
                <div className="panel-head">
                  <div>
                    <div className="label">STANDARDIZED PROTOCOL INTERFACE</div>
                    <h2>MCP Tool Catalog & JSON Schema Explorer</h2>
                  </div>
                  <span className="mono muted">{mcpTools.length} REGISTERED</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "650px", overflowY: "auto", paddingRight: "4px" }}>
                  {mcpTools.map((tool) => {
                    const schema = tool.inputSchema || tool.input_schema || { type: "object", properties: {}, required: [] };
                    const serverLabel = tool.server_name || tool.server || "mcp";
                    return (
                      <div
                        key={tool.name}
                        style={{
                          background: "#161b22",
                          border: "1px solid #30363d",
                          borderRadius: "6px",
                          padding: "14px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                          <div>
                            <span className="mono accent" style={{ fontWeight: 600, fontSize: "13px" }}>
                              {tool.name}
                            </span>
                            <span className="mono muted" style={{ fontSize: "11px", marginLeft: "8px" }}>
                              [{serverLabel}]
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <Status label={tool.risk_level} tone={getRiskTone(tool.risk_level)} />
                            {tool.requires_approval && <Status label="APPROVAL REQ" tone="warning" />}
                          </div>
                        </div>

                        <p className="muted" style={{ fontSize: "12px", margin: "4px 0 10px 0" }}>
                          {tool.description}
                        </p>

                        <div style={{ background: "#0d1117", padding: "10px", borderRadius: "4px", border: "1px solid #21262d" }}>
                          <div className="mono" style={{ fontSize: "11px", color: "#8b949e", marginBottom: "6px" }}>
                            INPUT SCHEMA ({schema.type || "object"}):
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            {Object.entries(schema.properties || {}).map(([propName, propDef]: [string, any]) => {
                              const isReq = schema.required?.includes(propName);
                              return (
                                <div key={propName} className="mono" style={{ fontSize: "11px", display: "flex", gap: "6px" }}>
                                  <span style={{ color: isReq ? "#f0883e" : "#58a6ff" }}>{propName}</span>
                                  <span className="muted">({propDef?.type || "any"})</span>
                                  <span className="muted">: {propDef?.description || ""}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>

              {/* Interactive MCP JSON-RPC Console */}
              <article className="panel">
                <div className="panel-head">
                  <div>
                    <div className="label">JSON-RPC 2.0 PROTOCOL TESTER</div>
                    <h2>Invoke MCP Tool via Gateway</h2>
                  </div>
                  <span className="live-dot" />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label className="label" style={{ display: "block", marginBottom: "4px" }}>
                      SELECT MCP TOOL
                    </label>
                    <select
                      value={selectedMcpTool}
                      onChange={(e) => handleMcpToolSelectChange(e.target.value)}
                      style={{
                        width: "100%",
                        background: "#161b22",
                        color: "#fff",
                        border: "1px solid #30363d",
                        padding: "8px",
                        borderRadius: "6px",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      {mcpTools.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name} ({t.server_name || t.server || "mcp"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label" style={{ display: "block", marginBottom: "4px" }}>
                      CALLER ROLE (RBAC VERIFICATION)
                    </label>
                    <select
                      value={mcpRole}
                      onChange={(e) => setMcpRole(e.target.value)}
                      style={{
                        width: "100%",
                        background: "#161b22",
                        color: "#fff",
                        border: "1px solid #30363d",
                        padding: "8px",
                        borderRadius: "6px",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      <option value="agent">agent (Authorized)</option>
                      <option value="admin">admin (Authorized)</option>
                      <option value="unauthorized_guest">unauthorized_guest (Blocked by Gateway)</option>
                    </select>
                  </div>

                  <div>
                    <label className="label" style={{ display: "block", marginBottom: "4px" }}>
                      ARGUMENTS (JSON SCHEMA STRICT)
                    </label>
                    <textarea
                      rows={5}
                      value={mcpParams}
                      onChange={(e) => setMcpParams(e.target.value)}
                      style={{
                        width: "100%",
                        background: "#0d1117",
                        color: "#79c0ff",
                        border: "1px solid #30363d",
                        padding: "8px",
                        borderRadius: "6px",
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "12px",
                      }}
                    />
                  </div>

                  <button
                    className="btn primary"
                    onClick={() => void runMcpCall()}
                    disabled={mcpCalling}
                    style={{ width: "100%" }}
                  >
                    {mcpCalling ? "Executing MCP Protocol..." : "⚡ Execute MCP Tool"}
                  </button>

                  {/* MCP Response Display */}
                  {mcpResponse && (
                    <div
                      style={{
                        marginTop: "10px",
                        padding: "12px",
                        background: "#0d1117",
                        border: "1px solid #30363d",
                        borderRadius: "6px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "8px",
                        }}
                      >
                        <span className="label">MCP PROTOCOL VERDICT</span>
                        <Status
                          label={mcpResponse.status}
                          tone={
                            mcpResponse.status === "ALLOWED"
                              ? "success"
                              : mcpResponse.status === "DENIED_RATE_LIMITED"
                              ? "error"
                              : "warning"
                          }
                        />
                      </div>

                      <div className="mono muted" style={{ fontSize: "11px", marginBottom: "6px" }}>
                        Latency: {mcpResponse.duration_ms}ms · Quota Left:{" "}
                        {mcpResponse.rate_limit_info?.remaining} / {mcpResponse.rate_limit_info?.limit}
                      </div>

                      <pre
                        style={{
                          background: "#161b22",
                          padding: "8px",
                          borderRadius: "4px",
                          overflowX: "auto",
                          fontSize: "11px",
                          color: mcpResponse.status === "ALLOWED" ? "#7ee787" : "#ff7b72",
                        }}
                      >
                        {JSON.stringify(mcpResponse.result ?? { error: mcpResponse.error }, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </article>
            </section>
          </>
        ) : (
          /* Settings Tab Content */
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">SYSTEM / SETTINGS</div>
                <h1>System Settings & GCP Hub</h1>
                <p>Manage control plane policies, Google OAuth credentials, and monitor live Google Cloud Platform telemetry.</p>
              </div>
            </div>

            {/* Sub-tab Navigation */}
            <div style={{ display: "flex", gap: "12px", borderBottom: "1px solid #21262d", paddingBottom: "12px", marginBottom: "24px" }}>
              <button
                className={`btn ${settingsSubTab === "general" ? "primary" : "secondary"}`}
                style={{ fontSize: "12px", padding: "8px 16px", borderRadius: "6px", display: "flex", alignItems: "center", gap: "6px" }}
                onClick={() => setSettingsSubTab("general")}
              >
                <span>⚙</span> General Configurations
              </button>
              <button
                className={`btn ${settingsSubTab === "telemetry" ? "primary" : "secondary"}`}
                style={{ fontSize: "12px", padding: "8px 16px", borderRadius: "6px", display: "flex", alignItems: "center", gap: "6px" }}
                onClick={() => setSettingsSubTab("telemetry")}
              >
                <span>📡</span> GCP Telemetry & Health
              </button>
              <button
                className={`btn ${settingsSubTab === "integrations" ? "primary" : "secondary"}`}
                style={{ fontSize: "12px", padding: "8px 16px", borderRadius: "6px", display: "flex", alignItems: "center", gap: "6px" }}
                onClick={() => setSettingsSubTab("integrations")}
              >
                <span>🔌</span> Integrations Hub (Mail & CRM)
              </button>
            </div>

            {settingsSubTab === "general" && (
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "20px", alignItems: "start" }}>
                {/* Left: General Configurations */}
                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="label">CONFIGURATIONS</div>
                      <h2>General Configurations</h2>
                    </div>
                  </div>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "16px" }}>
                    <div>
                      <label className="label" style={{ display: "block", marginBottom: "4px" }}>Google OAuth Client ID</label>
                      <input 
                        type="text" 
                        readOnly 
                        value={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "acp-hackathon-2026-505906"} 
                        style={{
                          width: "100%",
                          background: "#0d1117",
                          border: "1px solid #30363d",
                          padding: "10px",
                          color: "#8b949e",
                          borderRadius: "6px",
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "12px"
                        }}
                      />
                    </div>

                    <div>
                      <label className="label" style={{ display: "block", marginBottom: "4px" }}>Backend API Endpoint</label>
                      <input 
                        type="text" 
                        readOnly 
                        value={apiBase} 
                        style={{
                          width: "100%",
                          background: "#0d1117",
                          border: "1px solid #30363d",
                          padding: "10px",
                          color: "#8b949e",
                          borderRadius: "6px",
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "12px"
                        }}
                      />
                    </div>

                    <div>
                      <label className="label" style={{ display: "block", marginBottom: "4px" }}>Auto Polling Interval</label>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span className="mono accent" style={{ background: "#0d1117", border: "1px solid #30363d", padding: "6px 12px", borderRadius: "6px" }}>3 Seconds</span>
                        <span className="muted" style={{ fontSize: "11px" }}>(Optimized for live updates)</span>
                      </div>
                    </div>
                  </div>
                </article>

                {/* Right: GCP OAuth Setup Quick Guide */}
                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="label">DOCUMENTATION</div>
                      <h2>Google OAuth Setup Guide</h2>
                    </div>
                  </div>

                  <div style={{ marginTop: "16px", fontSize: "12px", lineHeight: "1.5", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <p className="muted" style={{ margin: 0 }}>
                      Getting a verified Google OAuth Client ID requires setting up an OAuth Consent Screen and credentials in Google Cloud Console. Follow these steps:
                    </p>

                    <div style={{ background: "#0d1117", border: "1px solid #30363d", padding: "12px", borderRadius: "6px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "start" }}>
                          <span style={{ background: "#21262d", border: "1px solid #30363d", width: "18px", height: "18px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "bold", flexShrink: 0, marginTop: "2px" }}>1</span>
                          <div>
                            <strong style={{ color: "white" }}>Configure OAuth Consent Screen</strong>
                            <p className="muted" style={{ margin: "2px 0 0 0", fontSize: "11px" }}>
                              Go to <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-success)", textDecoration: "underline" }}>GCP OAuth Consent</a>, choose <em>External</em>, fill in app details, and set scopes to <code style={{ color: "white" }}>openid, email, profile</code>.
                            </p>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "8px", alignItems: "start" }}>
                          <span style={{ background: "#21262d", border: "1px solid #30363d", width: "18px", height: "18px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "bold", flexShrink: 0, marginTop: "2px" }}>2</span>
                          <div>
                            <strong style={{ color: "white" }}>Create OAuth 2.0 Credentials</strong>
                            <p className="muted" style={{ margin: "2px 0 0 0", fontSize: "11px" }}>
                              Navigate to <em>Credentials</em> &gt; <em>Create Credentials</em> &gt; <em>OAuth client ID</em>. Choose <strong>Web application</strong> as Application Type.
                            </p>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "8px", alignItems: "start" }}>
                          <span style={{ background: "#21262d", border: "1px solid #30363d", width: "18px", height: "18px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "bold", flexShrink: 0, marginTop: "2px" }}>3</span>
                          <div>
                            <strong style={{ color: "white" }}>Set Authorized Domains</strong>
                            <p className="muted" style={{ margin: "2px 0 0 0", fontSize: "11px" }}>
                              Add <code style={{ color: "white" }}>http://localhost:3000</code> to <em>Authorized JavaScript origins</em>. For production, add your domain/Cloud Run URL.
                            </p>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "8px", alignItems: "start" }}>
                          <span style={{ background: "#21262d", border: "1px solid #30363d", width: "18px", height: "18px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "bold", flexShrink: 0, marginTop: "2px" }}>4</span>
                          <div>
                            <strong style={{ color: "white" }}>Inject Client ID to Env</strong>
                            <div className="muted" style={{ margin: "2px 0 0 0", fontSize: "11px" }}>
                              Copy the generated Client ID and save it in your project's local variables:
                              <pre className="mono" style={{ background: "#161b22", padding: "6px", borderRadius: "4px", margin: "4px 0 0 0", fontSize: "10px", color: "var(--color-success)", overflowX: "auto" }}>
                                # frontend/.env<br/>
                                NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com<br/><br/>
                                # backend/.env<br/>
                                GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
                              </pre>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <p className="muted" style={{ margin: 0, fontSize: "11px", fontStyle: "italic" }}>
                      💡 <strong>Note:</strong> Saving client ID to frontend `.env` is secure, but never commit or expose your client secret.
                    </p>
                  </div>
                </article>
              </div>
            )}

            {settingsSubTab === "telemetry" && (
              <div className="content-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", alignItems: "start" }}>
                {/* Column 1: System Health */}
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  {/* System Health */}
                  <article className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="label">INFRASTRUCTURE</div>
                      <h2>System Health</h2>
                    </div>
                  </div>
                  <div className="health-list" style={{ marginTop: "16px" }}>
                    <div>
                      <span>VERTEX AI / GEMINI</span>
                      <strong className="mono">42ms</strong>
                      <Status label="HEALTHY" tone="success" />
                    </div>
                    <div>
                      <span>FIRESTORE</span>
                      <strong className="mono">18ms</strong>
                      <Status label="HEALTHY" tone="success" />
                    </div>
                    <div>
                      <span>TOOL GATEWAY</span>
                      <strong className="mono">04ms</strong>
                      <Status label="HEALTHY" tone="success" />
                    </div>
                  </div>
                </article>
              </div>

              {/* Column 2: GCP Hub Telemetry */}
              <article className="panel">
                <div className="panel-head">
                  <div>
                    <div className="label">TELEMETRY</div>
                    <h2>GCP Hub Integration</h2>
                  </div>
                  <span className="mono accent" style={{ fontSize: "10px", background: "#0d1117", padding: "4px 8px", borderRadius: "4px" }}>ACTIVE PROJECT</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", background: "#0d1117", padding: "12px", borderRadius: "6px", border: "1px solid #30363d", marginTop: "16px" }}>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: "4px", fontSize: "9px" }}>Project ID</span>
                    <span className="mono" style={{ color: "white", fontSize: "11px" }}>acp-hackathon-2026-505906</span>
                  </div>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: "4px", fontSize: "9px" }}>Region</span>
                    <span className="mono" style={{ color: "white", fontSize: "11px" }}>us</span>
                  </div>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: "4px", fontSize: "9px" }}>Gemini Model</span>
                    <span className="mono accent" style={{ fontSize: "11px" }}>gemini-3.5-flash</span>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "20px" }}>
                  <span className="label" style={{ fontWeight: "bold" }}>Cloud Infrastructure Diagnostics</span>
                  
                  <div>
                    <button 
                      onClick={async () => {
                        const token = sessionStorage.getItem("google_id_token");
                        if (!token) {
                          alert("Authentication Error: Please sign in via Google to run diagnostics.");
                          return;
                        }
                        try {
                          const res = await fetch(`${apiBase}/api/gcp/diagnostics`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}` }
                          });
                          if (!res.ok) throw new Error("Unauthorized or server offline");
                          const data = await res.json();
                          alert(`Diagnostics Complete!\n\nOverall Status: ${data.overall_status}\nFirestore: ${data.firestore.status} (${data.firestore.latency_ms}ms)\nVertex AI: ${data.vertex_ai.status} (${data.vertex_ai.latency_ms}ms)`);
                        } catch (err: any) {
                          alert(`Diagnostics Failed: ${err.message}`);
                        }
                      }}
                      className="btn primary"
                      style={{ padding: "8px 16px" }}
                    >
                      ⚡ Run Connectivity Test
                    </button>
                  </div>

                  <div style={{ background: "#0d1117", border: "1px solid #30363d", padding: "12px", borderRadius: "6px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                      <span className="muted">Google Firestore Integration:</span>
                      <span className="mono" style={{ color: "var(--color-success)", fontWeight: "bold" }}>● ACTIVE (nam5)</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                      <span className="muted">Vertex AI Orchestrator API:</span>
                      <span className="mono" style={{ color: "var(--color-success)", fontWeight: "bold" }}>● READY</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                      <span className="muted">Distributed Rate Limiter Backend:</span>
                      <span className="mono accent" style={{ fontWeight: "bold" }}>Firestore Mode</span>
                    </div>
                  </div>
                </div>
              </article>
            </div>
            )}

            {settingsSubTab === "integrations" && (
              /* Email & CRM Integrations Control Panel */
              <article className="panel" style={{ marginTop: "0px" }}>
              <div className="panel-head" style={{ borderBottom: "1px solid #30363d", paddingBottom: "12px", marginBottom: "20px" }}>
                <div>
                  <div className="label">INTEGRATIONS HUB</div>
                  <h2>Email & CRM Connection Portal</h2>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span className="mono" style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                    BACKGROUND POLLER DAEMON:
                  </span>
                  <button
                    className={`btn ${workerActive ? "success" : "secondary"}`}
                    style={{ fontSize: "11px", padding: "6px 12px", background: workerActive ? "var(--color-success)" : "#21262d", color: workerActive ? "black" : "white", fontWeight: "bold" }}
                    onClick={async () => {
                      const newStatus = !workerActive;
                      await saveIntegrationsConfig(newStatus);
                    }}
                  >
                    {workerActive ? "🟢 ON / RUNNING" : "🔴 OFF / STOPPED"}
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "30px" }}>
                {/* Left Side: Unified Mail Server Configuration */}
                <div>
                  <h3 style={{ fontSize: "14px", color: "white", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                    📧 Mail Server Setup (Incoming & Outgoing Demo)
                  </h3>

                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div>
                      <label className="label" style={{ display: "block", marginBottom: "4px" }}>Mail Server Address (Host)</label>
                      <input
                        type="text"
                        className="mono"
                        value={imapServer}
                        onChange={(e) => setImapServer(e.target.value)}
                        placeholder="e.g. imap.gmail.com / smtp.gmail.com"
                        style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", padding: "8px", color: "white", borderRadius: "6px", fontSize: "12px" }}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div>
                        <label className="label" style={{ display: "block", marginBottom: "4px" }}>Incoming Port (IMAP)</label>
                        <input
                          type="number"
                          className="mono"
                          value={imapPort}
                          onChange={(e) => setImapPort(Number(e.target.value))}
                          placeholder="993"
                          style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", padding: "8px", color: "white", borderRadius: "6px", fontSize: "12px" }}
                        />
                      </div>
                      <div>
                        <label className="label" style={{ display: "block", marginBottom: "4px", color: "var(--color-muted)" }}>Outgoing Port (SMTP - Demo)</label>
                        <input
                          type="text"
                          className="mono"
                          value="587 (Demo: DISPATCHED_SMTP_TLS)"
                          disabled
                          style={{ width: "100%", background: "#0d1117", border: "1px solid #21262d", padding: "8px", color: "var(--color-muted)", borderRadius: "6px", fontSize: "11px", cursor: "not-allowed" }}
                        />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div>
                        <label className="label" style={{ display: "block", marginBottom: "4px" }}>Security & Encryption (Shared)</label>
                        <select
                          className="mono"
                          value={imapSecurity}
                          onChange={(e) => setImapSecurity(e.target.value)}
                          style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", padding: "8px", color: "white", borderRadius: "6px", fontSize: "12px" }}
                        >
                          <option value="SSL_TLS">SSL / TLS Enforce</option>
                          <option value="STARTTLS">STARTTLS Handshake</option>
                          <option value="NONE">Unencrypted (None)</option>
                        </select>
                      </div>
                      <div>
                        <label className="label" style={{ display: "block", marginBottom: "4px" }}>Sync Frequency (Incoming)</label>
                        <select
                          className="mono"
                          value={imapFreq}
                          onChange={(e) => setImapFreq(e.target.value)}
                          style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", padding: "8px", color: "white", borderRadius: "6px", fontSize: "12px" }}
                        >
                          <option value="20">Every 20 Seconds (Demo)</option>
                          <option value="1">Every 1 Minute</option>
                          <option value="5">Every 5 Minutes</option>
                          <option value="60">Every 1 Hour</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: "10px" }}>
                      <div>
                        <label className="label" style={{ display: "block", marginBottom: "4px", color: "var(--color-muted)" }}>Outgoing SMTP Driver</label>
                        <div style={{ display: "flex", alignItems: "center", height: "35px", background: "#0d1117", border: "1px solid #21262d", padding: "8px", borderRadius: "6px", fontSize: "11px", color: "red" }}>
                          <span style={{ marginRight: "6px" }}>●</span> DEMO SIMULATION
                        </div>
                      </div>
                      <div>
                        <label className="label" style={{ display: "block", marginBottom: "4px" }}>Account Username (Shared)</label>
                        <input
                          type="text"
                          className="mono"
                          value={imapUser}
                          onChange={(e) => setImapUsername(e.target.value)}
                          placeholder="sales@company.com"
                          style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", padding: "8px", color: "white", borderRadius: "6px", fontSize: "12px" }}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="label" style={{ display: "block", marginBottom: "4px" }}>Password / App Token (Shared)</label>
                      <input
                        type="password"
                        className="mono"
                        value={imapPass}
                        onChange={(e) => setImapPassword(e.target.value)}
                        placeholder="••••••••"
                        style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", padding: "8px", color: "white", borderRadius: "6px", fontSize: "12px" }}
                      />
                    </div>

                    <p className="muted" style={{ fontSize: "11px", lineHeight: "1.4", margin: "4px 0 10px 0" }}>
                      💡 <strong style={{ color: "white" }}>SMTP Transport Note:</strong> Outgoing SMTP uses secure mockup delivery driver (<code style={{ color: "var(--color-success)" }}>DISPATCHED_SMTP_TLS</code>). In production, toggling outbound driver to active will automatically share these credentials for commercial quotation delivery.
                    </p>

                    <div style={{ display: "flex", gap: "10px" }}>
                      <button
                        className="btn secondary"
                        style={{ flex: 1, padding: "8px" }}
                        onClick={() => void testImapConnection()}
                        disabled={testingImap}
                      >
                        {testingImap ? "Testing Connection..." : "⚡ Test Mail Connection"}
                      </button>
                      <button
                        className="btn primary"
                        style={{ flex: 1, padding: "8px" }}
                        onClick={() => void saveIntegrationsConfig()}
                      >
                        ✔ Save Connection Config
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Side: CRM & General Webhook Parameters */}
                <div>
                  <h3 style={{ fontSize: "14px", color: "white", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                    🔌 CRM Webhook & API Handshake Setup
                  </h3>

                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div>
                      <label className="label" style={{ display: "block", marginBottom: "4px" }}>CRM Base API/Webhook Endpoint</label>
                      <input
                        type="text"
                        className="mono"
                        value={crmUrl}
                        onChange={(e) => setCrmUrl(e.target.value)}
                        placeholder="https://api.hubapi.com/v1"
                        style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", padding: "8px", color: "white", borderRadius: "6px", fontSize: "12px" }}
                      />
                    </div>

                    <div>
                      <label className="label" style={{ display: "block", marginBottom: "4px" }}>Authorization Token / Secure Secret</label>
                      <input
                        type="password"
                        className="mono"
                        value={crmToken}
                        onChange={(e) => setCrmToken(e.target.value)}
                        placeholder="pat-na1-xxxxx-xxxxx-xxxxx"
                        style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", padding: "8px", color: "white", borderRadius: "6px", fontSize: "12px" }}
                      />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "8px 0" }}>
                      <span className="mono" style={{ fontSize: "12px", color: "var(--color-muted)" }}>INTEGRATION STATUS:</span>
                      <button
                        className="btn ghost"
                        style={{ fontSize: "11px", padding: "4px 8px", background: crmEnabled ? "rgba(40, 167, 69, 0.15)" : "rgba(220, 53, 69, 0.15)", color: crmEnabled ? "var(--color-success)" : "red" }}
                        onClick={() => setCrmEnabled(!crmEnabled)}
                      >
                        {crmEnabled ? "● WEBHOOK INGESTION ACTIVE" : "○ WEBHOOK INGESTION INACTIVE"}
                      </button>
                    </div>

                    <p className="muted" style={{ fontSize: "11px", lineHeight: "1.4", margin: "4px 0" }}>
                      Ensure you set the HubSpot Webhook url to point directly to: <strong className="mono" style={{ color: "white" }}>{apiBase}/api/webhooks/hubspot</strong> to automatically trigger sync execution flows.
                    </p>

                    <button
                      className="btn primary"
                      style={{ padding: "8px", width: "100%", marginTop: "12px" }}
                      onClick={() => void saveIntegrationsConfig()}
                    >
                      ✔ Save CRM Config
                    </button>
                  </div>
                </div>
              </div>
            </article>
            )}
          </>
        )}
      </main>
    </div>
  );
}
