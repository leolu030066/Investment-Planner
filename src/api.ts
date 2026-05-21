import { AppState, OperationFormValues, SettingsState } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed");
  }

  return payload as T;
}

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
}

function operationPayload(values: OperationFormValues) {
  return {
    type: values.type,
    stockName: values.stockName,
    currency: values.currency,
    amount: Number(values.amount),
    price: Number(values.price),
    quantity: Number(values.quantity),
    date: values.date,
    note: values.note
  };
}

export function fetchState() {
  return request<AppState>("/api/state");
}

export function fetchAuthStatus() {
  return request<AuthStatus>("/api/auth/status");
}

export function loginWithPassword(password: string) {
  return request<AuthStatus>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export function logout() {
  return request<AuthStatus>("/api/auth/logout", {
    method: "POST"
  });
}

export function saveSettings(settings: SettingsState) {
  return request<AppState>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export function createOperation(values: OperationFormValues) {
  return request<AppState>("/api/operations", {
    method: "POST",
    body: JSON.stringify(operationPayload(values))
  });
}

export function updateOperation(id: string, values: OperationFormValues) {
  return request<AppState>(`/api/operations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(operationPayload(values))
  });
}

export function deleteOperation(id: string) {
  return request<AppState>(`/api/operations/${id}`, {
    method: "DELETE"
  });
}

export function undoOperation(id: string) {
  return request<AppState>(`/api/operations/${id}/undo`, {
    method: "POST"
  });
}
