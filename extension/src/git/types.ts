/**
 * Minimal type declarations for VS Code's built-in Git extension API.
 * These mirror the actual types exported by the 'vscode.git' extension.
 */
import * as vscode from 'vscode';

export interface GitExtension {
  getAPI(version: 1): GitAPI;
}

export interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
}

export interface Repository {
  state: RepositoryState;
  rootUri: vscode.Uri;
  log(options?: LogOptions): Promise<Commit[]>;
}

export interface RepositoryState {
  HEAD: Branch | undefined;
  onDidChange: vscode.Event<void>;
}

export interface Branch {
  name?: string;
  commit?: string;
  type: number; // 0 = Head, 1 = Tag
}

export interface Commit {
  hash: string;
  message: string;
  parents: string[];
  authorDate?: Date;
  authorName?: string;
  authorEmail?: string;
}

export interface LogOptions {
  maxEntries?: number;
  path?: string;
}
