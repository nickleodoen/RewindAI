import * as vscode from 'vscode';
import { GitExtension, Repository } from './git/types';
import { RewindChatParticipant } from './chat/participant';
import { RewindPanelProvider } from './chat/panelProvider';
import { GitWatcher } from './git/watcher';
import { ContextManager } from './context/manager';
import { BackendClient } from './backend/client';
import { Neo4jGraphClient } from './graph/neo4jClient';

let rewindInstance: RewindInstance | null = null;

class RewindInstance {
  private chatParticipant: RewindChatParticipant;
  private gitWatcher: GitWatcher;
  private contextManager: ContextManager;
  private panelProvider: RewindPanelProvider;
  private neo4j: Neo4jGraphClient;

  constructor(
    context: vscode.ExtensionContext,
    repo: Repository,
    workspaceRoot: string,
  ) {
    const backend = new BackendClient();
    this.contextManager = new ContextManager(workspaceRoot, backend);

    // Connect to Neo4j (non-blocking — extension works without it)
    this.neo4j = new Neo4jGraphClient();
    const neo4jUri = vscode.workspace.getConfiguration('rewindai').get<string>('neo4jUri') || 'bolt://localhost:7687';
    const neo4jUser = vscode.workspace.getConfiguration('rewindai').get<string>('neo4jUser') || 'neo4j';
    const neo4jPassword = vscode.workspace.getConfiguration('rewindai').get<string>('neo4jPassword') || 'password';
    this.neo4j.connect(neo4jUri, neo4jUser, neo4jPassword);

    // Register the RewindAI panel (shows as its own tab next to Terminal)
    this.panelProvider = new RewindPanelProvider(
      context.extensionUri,
      this.contextManager,
      workspaceRoot,
      this.neo4j,
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        RewindPanelProvider.viewType,
        this.panelProvider,
      ),
    );

    // Also register the @rewind chat participant (works in Copilot Chat too)
    this.chatParticipant = new RewindChatParticipant(context, this.contextManager, workspaceRoot);

    // Git watcher with panel notifications
    this.gitWatcher = new GitWatcher(repo, this.contextManager, this.panelProvider);

    context.subscriptions.push(this.chatParticipant, this.gitWatcher);

    // Load context for the current HEAD
    this.loadContextForCurrentHead();
  }

  private async loadContextForCurrentHead(): Promise<void> {
    const commit = this.gitWatcher.getCurrentCommit();
    if (commit) {
      const loaded = await this.contextManager.loadSnapshotForCommit(commit);
      const branch = this.gitWatcher.getCurrentBranch();
      this.panelProvider.notifyContextChanged(commit, branch, loaded);
    }
  }

  dispose(): void {
    // Handled by subscriptions
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showInformationMessage(
      'RewindAI: Open a folder with a git repository to get started.'
    );
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExt) {
    vscode.window.showErrorMessage('RewindAI requires the built-in Git extension.');
    return;
  }

  const git = gitExt.isActive ? gitExt.exports.getAPI(1) : undefined;

  function initWithRepo(repo: Repository): void {
    if (rewindInstance) { return; }
    rewindInstance = new RewindInstance(context, repo, workspaceRoot);
    console.log('RewindAI: Initialized for', workspaceRoot);
  }

  if (git && git.repositories.length > 0) {
    initWithRepo(git.repositories[0]);
  } else if (git) {
    const disposable = git.onDidOpenRepository((repo: Repository) => {
      initWithRepo(repo);
      disposable.dispose();
    });
    context.subscriptions.push(disposable);
  } else {
    gitExt.activate().then((exports) => {
      const api = exports.getAPI(1);
      if (api.repositories.length > 0) {
        initWithRepo(api.repositories[0]);
      } else {
        const disposable = api.onDidOpenRepository((repo: Repository) => {
          initWithRepo(repo);
          disposable.dispose();
        });
        context.subscriptions.push(disposable);
      }
    });
  }
}

export function deactivate(): void {
  rewindInstance?.dispose();
  rewindInstance = null;
}
