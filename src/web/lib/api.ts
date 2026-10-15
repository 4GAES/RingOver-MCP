import {
  keepPreviousData,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AgentDetail,
  AgentOption,
  CallsPage,
  LeadItem,
  LiveTeam,
  McpCallItem,
  McpInfo,
  McpTokenItem,
  McpUsage,
  NumberHistory,
  Overview,
  SessionUser,
  UserItem,
} from "../../shared/api";
import { forgetSelection } from "./selection";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch {
    throw new HttpError(0, "Sin conexión con el servidor");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, (body as { error?: string }).error ?? `Error ${res.status}`);
  return body as T;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) =>
        !(err instanceof HttpError && [400, 401, 403, 404].includes(err.status)) && count < 3,
      retryDelay: (n) => Math.min(8000, 600 * 2 ** n) * (0.5 + Math.random() / 2),
    },
  },
});

const qs = (o: Record<string, string | number | undefined | null>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => request<{ user: SessionUser } | null>("/api/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useAuthOptions() {
  return useQuery({
    queryKey: ["auth-options"],
    queryFn: () =>
      request<{ sso: boolean; google: boolean; domain: string | null; centerUrl: string }>(
        "/api/auth/options",
      ),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { email: string; password: string }) =>
      request<{ user: SessionUser; next?: string | null }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(b),
      }),
    onSuccess: (data) => {
      if (data.next) {
        location.href = data.next;
        return;
      }
      // Se reemplaza el "no autenticado" en caché por el usuario y se descarta lo demás.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      qc.setQueryData(["me"], data);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request("/api/auth/logout", { method: "POST", body: "{}" }),
    onSettled: () => {
      forgetSelection();
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      qc.setQueryData(["me"], null);
    },
  });
}

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request("/api/sync", { method: "POST", body: "{}" }),
    onSettled: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" }),
  });
}

/** Si el periodo incluye hoy, se refresca solo cada minuto. */
const live = (to: string, today: string) => (to >= today ? 60_000 : false);

export function useOverview(from: string, to: string, today: string, comerciales = "") {
  return useQuery({
    queryKey: ["overview", from, to, comerciales],
    queryFn: () => request<Overview>(`/api/overview${qs({ from, to, comerciales })}`),
    placeholderData: keepPreviousData,
    refetchInterval: live(to, today),
  });
}

export function useAgent(id: number, from: string, to: string, today: string) {
  return useQuery({
    queryKey: ["agent", id, from, to],
    queryFn: () => request<AgentDetail>(`/api/agents/${id}${qs({ from, to })}`),
    placeholderData: keepPreviousData,
    refetchInterval: live(to, today),
  });
}

export interface CallsQuery {
  from: string;
  to: string;
  /** Un comercial (su ficha) o una selección "1,2,3" (Resumen y Llamadas). */
  agent?: string | null;
  comerciales?: string | null;
  tipo?: string | null;
  resultado?: string | null;
  duracion?: string | null;
  numero?: string | null;
}

export function useCalls(q: CallsQuery) {
  return useInfiniteQuery({
    queryKey: ["calls", q],
    queryFn: ({ pageParam }) => request<CallsPage>(`/api/calls${qs({ ...q, cursor: pageParam, limit: 50 })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    placeholderData: keepPreviousData,
  });
}

/** Todos los comerciales, para el selector. */
export function useAgentOptions() {
  return useQuery({
    queryKey: ["agent-options"],
    queryFn: () => request<{ agents: AgentOption[] }>("/api/agents"),
    staleTime: 5 * 60_000,
  });
}

export function useLive() {
  return useQuery({
    queryKey: ["live"],
    queryFn: () => request<LiveTeam>("/api/live"),
    refetchInterval: 30_000,
  });
}

export function useNumber(number: string | null) {
  return useQuery({
    queryKey: ["number", number],
    queryFn: () => request<NumberHistory>(`/api/numbers/${encodeURIComponent(number ?? "")}`),
    enabled: !!number,
  });
}

export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => request<{ users: UserItem[]; domain: string | null }>("/api/users"),
    enabled,
  });
}

/** Alta, cambio de rol y baja de usuarios: la respuesta trae la lista ya actualizada. */
export function useUserMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { kind: "add" | "role" | "remove"; email: string; role?: "admin" | "viewer" }) => {
      const path = a.kind === "add" ? "/api/users" : `/api/users/${encodeURIComponent(a.email)}`;
      const method = a.kind === "add" ? "POST" : a.kind === "role" ? "PATCH" : "DELETE";
      const body =
        a.kind === "remove"
          ? "{}"
          : JSON.stringify(a.kind === "add" ? { email: a.email, role: a.role } : { role: a.role });
      return request<{ users: UserItem[] }>(path, { method, body });
    },
    onSuccess: (data) =>
      qc.setQueryData(["users"], (old: { domain: string | null } | undefined) => ({ ...old, ...data })),
  });
}

// ── MCP ──────────────────────────────────────────────────────────────────────

const scope = (all: boolean) => (all ? "?todo=1" : "");

export function useMcpInfo() {
  return useQuery({
    queryKey: ["mcp-info"],
    queryFn: () => request<McpInfo>("/api/mcp/info"),
    staleTime: 5 * 60_000,
  });
}

export function useMcpTokens(all: boolean) {
  return useQuery({
    queryKey: ["mcp-tokens", all],
    queryFn: () => request<{ tokens: McpTokenItem[] }>(`/api/mcp/tokens${scope(all)}`),
  });
}

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name: string; expiresDays: 30 | 90 | 365 | null }) =>
      request<{ token: string; id: string }>("/api/mcp/tokens", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp-tokens"] }),
  });
}

export function useRevokeToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request(`/api/mcp/tokens/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp-tokens"] }),
  });
}

export function useMcpLog(f: { all: boolean; tool?: string; status?: string }) {
  return useInfiniteQuery({
    queryKey: ["mcp-log", f],
    queryFn: ({ pageParam }) =>
      request<{ items: McpCallItem[]; next: string | null }>(
        `/api/mcp/log${qs({ todo: f.all ? 1 : undefined, tool: f.tool, status: f.status, cursor: pageParam })}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useMcpUsage(days: number, all: boolean) {
  return useQuery({
    queryKey: ["mcp-usage", days, all],
    queryFn: () => {
      const to = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
      const from = new Date(Date.now() - (days - 1) * 86_400_000).toLocaleDateString("en-CA", {
        timeZone: "Europe/Madrid",
      });
      return request<McpUsage>(`/api/mcp/usage${qs({ from, to, todo: all ? 1 : undefined })}`);
    },
    placeholderData: keepPreviousData,
  });
}

export function useCreateLead() {
  return useMutation({
    mutationFn: (b: Record<string, string | boolean>) =>
      request<{ ok: boolean }>("/api/leads", { method: "POST", body: JSON.stringify(b) }),
  });
}

export function useLeads(enabled: boolean) {
  return useQuery({
    queryKey: ["leads"],
    queryFn: () => request<{ leads: LeadItem[]; notifyTo: string | null }>("/api/admin/leads"),
    enabled,
    refetchInterval: 60_000,
  });
}
