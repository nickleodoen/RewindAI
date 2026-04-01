import * as vscode from 'vscode';
import { Repository } from './types';
import { ContextManager } from '../context/manager';
import { RewindPanelProvider } from '../chat/panelProvider';

/**
 * Watches git state for commits and checkouts.
 * Auto-snapshots on commit, auto-restores on checkout.
 * Notifies the RewindAI panel on state changes.
 */
export class GitWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private lastKnownCommit: string | undefined;
  private lastKnownBranch: string | undefined;

  constructor(
    private repo: Repository,
    private contextManager: ContextManager,
    private panelProvider?: RewindPanelProvider,
  ) {
    this.lastKnownCommit = repo.state.HEAD?.commit;
    this.lastKnownBranch = repo.state.HEAD?.name;

    const sub = repo.state.onDidChange(() => this.onGitStateChanged());
    this.disposables.push(sub);

    console.log(
      `RewindAI GitWatcher: Watching ${this.lastKnownBranch ?? 'detached'} @ ${this.lastKnownCommit?.slice(0, 7) ?? 'unknown'}`
    );
  }

  private async onGitStateChanged(): Promise<void> {
    const currentCommit = this.repo.state.HEAD?.commit;
    const currentBranch = this.repo.state.HEAD?.name;

    if (!currentCommit) { return; }

    console.log(`RewindAI GitWatcher: HEAD changed from ${this.lastKnownCommit?.slice(0, 7)} to ${currentCommit?.slice(0, 7)} (branch: ${currentBranch})`);

    // New commit on the same branch
    if (currentCommit !== this.lastKnownCommit && currentBranch === this.lastKnownBranch) {
      await this.onNewCommit(currentCommit, currentBranch ?? 'main');
    }
    // Checkout: different commit, possibly different branch
    else if (currentCommit !== this.lastKnownCommit) {
      await this.onCheckout(currentCommit, currentBranch ?? 'detached');
    }

    this.lastKnownCommit = currentCommit;
    this.lastKnownBranch = currentBranch;
  }

  private async onNewCommit(commitSha: string, branch: string): Promise<void> {
    let commitMessage = 'No message';
    try {
      const log = await this.repo.log({ maxEntries: 1 });
      if (log.length > 0) {
        commitMessage = log[0].message;
      }
    } catch {
      // log() may not be available on all git extension versions
    }

    await this.contextManager.saveSnapshot(commitSha, branch, commitMessage);

    // Notify the panel
    this.panelProvider?.notifySnapshotSaved(commitSha, commitMessage);

    vscode.window.showInformationMessage(
      `RewindAI: Context saved for ${commitSha.slice(0, 7)} — "${commitMessage.slice(0, 50)}"`
    );
  }

  private async onCheckout(commitSha: string, branch: string): Promise<void> {
    console.log(`RewindAI GitWatcher: Checkout detected → ${commitSha.slice(0, 7)} on ${branch}`);
    const hasContext = await this.contextManager.loadSnapshotForCommit(commitSha);

    // Notify the panel
    this.panelProvider?.notifyContextChanged(commitSha, branch, hasContext);

    if (hasContext) {
      vscode.window.showInformationMessage(
        `RewindAI: Context restored to ${commitSha.slice(0, 7)} (${branch})`
      );
    } else {
      vscode.window.showInformationMessage(
        `RewindAI: No saved context for ${commitSha.slice(0, 7)} — starting fresh`
      );
    }
  }

  getCurrentCommit(): string | undefined {
    return this.repo.state.HEAD?.commit;
  }

  getCurrentBranch(): string {
    return this.repo.state.HEAD?.name ?? 'HEAD';
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}
