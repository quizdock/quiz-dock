import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type {
  AuditEntry,
  OperationDescriptor,
  OperationNote,
  OperationResult,
} from '@quiz-dock/contracts';
import {
  adminOperationsControllerCatalogue,
  adminOperationsControllerRun,
} from '../../api/generated/admin/admin';

/** What a command printed, as data (the backend's `OutputEntry`). */
export type OutputEntry =
  | { level: 'line' | 'ok' | 'warn' | 'fail'; text: string }
  | { level: 'table'; rows: Record<string, unknown>[] };

export type Answer =
  | { kind: 'result'; result: OperationResult }
  | { kind: 'confirm'; token: string; summary: string };

export type { AuditEntry, OperationDescriptor, OperationNote, OperationResult };

// ── The local mode's administration token ───────────────────────────────────

const TOKEN_KEY = 'qd-admin-token';
const listeners = new Set<() => void>();

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Kept for this tab only (sessionStorage): closing it forgets the token. */
export function setAdminToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: the token lasts until the next reload
    memoryToken = token;
  }
  listeners.forEach((l) => l());
}

let memoryToken = '';
const currentToken = () => readToken() || memoryToken;

export function useAdminToken(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    currentToken,
    () => '',
  );
}

const tokenHeaders = (): Record<string, string> => {
  const token = currentToken();
  return token ? { 'X-Admin-Token': token } : {};
};

// ── Calls ────────────────────────────────────────────────────────────────────

/** Runs an operation: its result, or a confirmation to ask for. A refusal throws (`ApiError`, `admin.<code>`). */
export async function runOperation(
  id: string,
  params: Record<string, unknown> = {},
  options: { dryRun?: boolean; confirmation?: string } = {},
): Promise<Answer> {
  const { data } = await adminOperationsControllerRun(
    id,
    { params, ...options },
    { headers: tokenHeaders() },
  );
  return data as Answer;
}

/**
 * How the pages reach the operations: the admin API, or the setup wizard's
 * session (§3.8) — the same components on either.
 */
export interface OperationChannel {
  name: 'admin' | 'setup';
  run: typeof runOperation;
}

export const adminChannel: OperationChannel = { name: 'admin', run: runOperation };

export const OperationChannelContext = createContext<OperationChannel>(adminChannel);

/** Runs an operation through the page's channel. */
export function useRunOperation(): typeof runOperation {
  return useContext(OperationChannelContext).run;
}

export const operationKey = (
  id: string,
  params: Record<string, unknown> = {},
  channel = 'admin',
) => ['admin-operation', id, params, channel];

/** A reading operation, as a query: run on mount, again on demand. */
export function useReadOperation<T>(
  id: string,
  params: Record<string, unknown> = {},
  enabled = true,
) {
  const channel = useContext(OperationChannelContext);
  return useQuery({
    queryKey: operationKey(id, params, channel.name),
    enabled,
    retry: false,
    queryFn: async () => {
      const answer = await channel.run(id, params);
      if (answer.kind !== 'result') throw new Error('A reading operation asked to confirm');
      return answer.result as OperationResult<T>;
    },
  });
}

export function useCatalogue() {
  return useQuery({
    queryKey: ['admin-catalogue'],
    staleTime: 30_000,
    queryFn: async () =>
      (await adminOperationsControllerCatalogue()).data.operations as OperationDescriptor[],
  });
}

/** After a change: everything the administration reads, read again. */
export function useRefreshAdmin() {
  const client = useQueryClient();
  return useCallback(
    () =>
      client.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === 'admin-operation' || q.queryKey[0] === 'admin-catalogue',
      }),
    [client],
  );
}
