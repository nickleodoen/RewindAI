import * as vscode from 'vscode';
import { GitExtension, Repository } from './git/types';
import { RewindChatParticipant } from './chat/participant';
import { GitWatcher } from './git/watcher';
import { ContextManager } from './context/manager';
import { BackendClient } from './backend/client';

let rewindInstance: RewindInstance | null = null;

class RewindInstance {
  private chatParticipant: RewindChatParticipant;
  private gitWatcher: GitWatcher;
  private contextManager: ContextManager;

  constructor(
    context: vscode.ExtensionContext,
    repo: Repository,
    workspaceRoot: string,
  ) {
    const backend = new BackendClient();
    this.contextManager = new ContextManager(workspaceRoot, backend);
    this.chatParticipant = new RewindChatParticipant(context, this.contextManager, workspaceRoot);
    this.gitWatcher = new GitWatcher(repo, this.contextManager);

    context.subscriptions.push(this.chatParticipant, this.gitWatcher);

    // Load context for the current HEAD
    this.loadContextForCurrentHead();
  }

  private async loadContextForCurrentHead(): Promise<void> {
    const commit = this.gitWatcher.getCurrentCommit();
    if (commit) {
      const loaded = await this.contextManager.loadSnapshotForCommit(commit);
      const branch = this.gitWatcher.getCurrentBranch();
      if (loaded) {
        vscode.window.showInformationMessage(
          `RewindAI: Context loaded for ${branch} @ ${commit.slice(0, 7)}`
        );
      } else {
        vscode.window.showInformationMessage(
          `RewindAI: Active on ${branch} — no prior context`
        );
      }
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
    vscode.window.showInformationMessage('RewindAI: Waiting for git repository...');
  } else {
    // Git extension not yet active — activate it and retry
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
