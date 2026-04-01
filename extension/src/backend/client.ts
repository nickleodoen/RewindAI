import * as vscode from 'vscode';
import {
  CreateSnapshotRequest,
  HealthResponse,
  RestoreResponse,
  SnapshotListItem,
  DecisionChainEntry,
} from './types';

/**
 * HTTP client for the RewindAI backend service.
 */
export class BackendClient {
  private baseUrl: string;

  constructor() {
    const config = vscode.workspace.getConfiguration('rewindai');
    this.baseUrl = config.get<string>('backendUrl', 'http://localhost:8000');
  }

  private async request<T>(path: string, options?: RequestInit, timeoutMs: number = 30000): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Backend error ${response.status}: ${text}`);
      }
      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  async createSnapshot(req: CreateSnapshotRequest): Promise<{ sha: string; summary: string }> {
    return this.request('/api/v1/snapshots', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  async getSnapshot(sha: string): Promise<RestoreResponse> {
    return this.request<RestoreResponse>(`/api/v1/snapshots/${sha}`);
  }

  async listSnapshots(branch: string, limit: number = 10): Promise<SnapshotListItem[]> {
    return this.request<SnapshotListItem[]>(
      `/api/v1/snapshots?branch=${encodeURIComponent(branch)}&limit=${limit}`
    );
  }

  async getDecisions(branch?: string): Promise<DecisionChainEntry[]> {
    const query = branch ? `?branch=${encodeURIComponent(branch)}` : '';
    return this.request<DecisionChainEntry[]>(`/api/v1/decisions${query}`);
  }

  async getFileHistory(filePath: string): Promise<DecisionChainEntry[]> {
    return this.request<DecisionChainEntry[]>(
      `/api/v1/files/${encodeURIComponent(filePath)}/history`
    );
  }

  async chat(
    message: string,
    systemPrompt: string,
    conversationHistory: Array<{ role: string; content: string }>
  ): Promise<{ response: string; messages: Array<{ role: string; content: string }> }> {
    // Limit to last 20 messages to keep payloads manageable
    const recentMessages = conversationHistory.slice(-20);
    return this.request('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        system_prompt: systemPrompt,
        conversation_history: recentMessages,
      }),
    }, 60000); // 60s timeout for chat (LLM calls are slow)
  }
}
