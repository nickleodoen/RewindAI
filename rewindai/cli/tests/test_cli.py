"""CLI smoke tests."""

from __future__ import annotations

import sys
from pathlib import Path

from typer.testing import CliRunner

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "cli") not in sys.path:
    sys.path.insert(0, str(ROOT / "cli"))

from rewindai_cli.api import ApiError, RewindApi
from rewindai_cli.main import app


runner = CliRunner()


def test_status_command(monkeypatch):
    monkeypatch.setattr(
        RewindApi,
        "status",
        lambda self: {
            "user_id": "default",
            "mode": "attached",
            "branch_name": "main",
            "head_commit_id": "commit-12345678",
            "session_id": "session-12345678",
            "origin_branch": "main",
            "origin_commit_id": "commit-12345678",
            "reconstructed_at": None,
            "active_memory_count": 4,
            "memory_breakdown": {"decision": 2, "fact": 2},
            "summary": "Attached to branch 'main' at commit-12",
        },
    )

    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0
    assert "RewindAI Workspace" in result.stdout
    assert "main" in result.stdout


def test_branch_list_json(monkeypatch):
    monkeypatch.setattr(
        RewindApi,
        "branches",
        lambda self: [
            {
                "name": "main",
                "head_commit_id": "commit-main",
                "head_message": "Main tip",
                "branched_from_commit_id": None,
            }
        ],
    )
    monkeypatch.setattr(
        RewindApi,
        "status",
        lambda self: {
            "mode": "attached",
            "branch_name": "main",
            "head_commit_id": "commit-main",
            "session_id": "session-main",
            "origin_branch": "main",
            "origin_commit_id": "commit-main",
            "reconstructed_at": None,
            "active_memory_count": 0,
            "memory_breakdown": {},
            "summary": "Attached to main",
            "user_id": "default",
        },
    )

    result = runner.invoke(app, ["branch", "list", "--json"])
    assert result.exit_code == 0
    assert '"branches"' in result.stdout
    assert '"main"' in result.stdout


def test_checkout_command(monkeypatch):
    monkeypatch.setattr(
        RewindApi,
        "checkout",
        lambda self, ref, reuse_session=False: {
            "mode": "detached",
            "branch_name": "main",
            "commit_id": "commit-old",
            "session_id": "session-old",
            "status": {"origin_branch": "main"},
        },
    )

    result = runner.invoke(app, ["checkout", "commit-old"])
    assert result.exit_code == 0
    assert "Checkout Complete" in result.stdout
    assert "detached" in result.stdout


def test_commit_error(monkeypatch):
    def _raise(self, message):
        raise ApiError("Detached HEAD. Create or checkout a branch before committing.")

    monkeypatch.setattr(RewindApi, "commit", _raise)
    result = runner.invoke(app, ["commit", "-m", "test"])
    assert result.exit_code == 1
    assert "Detached HEAD" in result.stdout


def test_merge_fast_forward(monkeypatch):
    monkeypatch.setattr(
        RewindApi,
        "merge_preview",
        lambda self, source_branch, target_branch=None: {
            "target_branch": "main",
            "source_branch": source_branch,
            "target_head_commit_id": "commit-main",
            "source_head_commit_id": "commit-feature",
            "merge_base_commit_id": "commit-main",
            "mode": "fast_forward",
            "conflicts": [],
            "auto_merged": [{"id": "m-1", "type": "fact", "content": "Realtime note", "tags": [], "branch_name": "feature"}],
            "stats": {"conflict_count": 0, "auto_merged_count": 1},
        },
    )
    monkeypatch.setattr(
        RewindApi,
        "merge",
        lambda self, source_branch, target_branch=None, strategy="auto", resolutions=None: {
            "target_branch": "main",
            "source_branch": source_branch,
            "mode": "fast_forward",
            "conflicts": [],
            "auto_merged": [],
            "stats": {},
            "applied": True,
            "fast_forward_to_commit_id": "commit-feature",
            "merge_commit": None,
            "commit_id": "commit-feature",
            "session_id": "session-2",
            "applied_resolution_count": 0,
            "status": {
                "user_id": "default",
                "mode": "attached",
                "branch_name": "main",
                "head_commit_id": "commit-feature",
                "session_id": "session-2",
                "origin_branch": "main",
                "origin_commit_id": "commit-feature",
                "reconstructed_at": None,
                "active_memory_count": 3,
                "memory_breakdown": {"fact": 3},
                "summary": "Attached to branch 'main' at commit-fe",
            },
        },
    )

    result = runner.invoke(app, ["merge", "feature-x"])
    assert result.exit_code == 0
    assert "Fast Forward Complete" in result.stdout


def test_merge_conflicted_auto_fails(monkeypatch):
    monkeypatch.setattr(
        RewindApi,
        "merge_preview",
        lambda self, source_branch, target_branch=None: {
            "target_branch": "main",
            "source_branch": source_branch,
            "target_head_commit_id": "commit-main",
            "source_head_commit_id": "commit-feature",
            "merge_base_commit_id": "commit-base",
            "mode": "merge_required",
            "conflicts": [
                {
                    "memory_a": {"id": "a", "type": "decision", "content": "Use REST", "tags": ["api"], "branch_name": "main"},
                    "memory_b": {"id": "b", "type": "decision", "content": "Use GraphQL", "tags": ["api"], "branch_name": "feature"},
                    "reason": "shared tags: api",
                }
            ],
            "auto_merged": [],
            "stats": {"conflict_count": 1, "auto_merged_count": 0},
        },
    )

    result = runner.invoke(app, ["merge", "feature-x"])
    assert result.exit_code == 1
    assert "Conflicts detected" in result.stdout


def test_merge_manual_collects_custom_resolution(monkeypatch):
    captured: dict = {}

    monkeypatch.setattr(
        RewindApi,
        "merge_preview",
        lambda self, source_branch, target_branch=None: {
            "target_branch": "main",
            "source_branch": source_branch,
            "target_head_commit_id": "commit-main",
            "source_head_commit_id": "commit-feature",
            "merge_base_commit_id": "commit-base",
            "mode": "merge_required",
            "conflicts": [
                {
                    "memory_a": {"id": "a", "type": "decision", "content": "Use REST", "tags": ["api"], "branch_name": "main"},
                    "memory_b": {"id": "b", "type": "decision", "content": "Use GraphQL", "tags": ["api"], "branch_name": "feature"},
                    "reason": "shared tags: api",
                }
            ],
            "auto_merged": [],
            "stats": {"conflict_count": 1, "auto_merged_count": 0},
        },
    )

    def _merge(self, source_branch, target_branch=None, strategy="auto", resolutions=None):
        captured["strategy"] = strategy
        captured["resolutions"] = resolutions
        return {
            "target_branch": "main",
            "source_branch": source_branch,
            "mode": "merge_required",
            "conflicts": [],
            "auto_merged": [],
            "stats": {},
            "applied": True,
            "fast_forward_to_commit_id": None,
            "merge_commit": {
                "id": "commit-merge",
                "message": "Merge branch 'feature-x' into main",
                "summary": "Merged feature-x into main",
                "memory_delta_count": 1,
                "branch_name": "main",
                "user_id": "default",
                "created_at": None,
                "parent_id": "commit-main",
                "parent_ids": ["commit-main", "commit-feature"],
                "is_merge": True,
                "merge_strategy": "manual",
                "merged_from_branch": "feature-x",
                "merge_base_commit_id": "commit-base",
                "conflicts_resolved": 1,
            },
            "commit_id": "commit-merge",
            "session_id": "session-merge",
            "applied_resolution_count": 1,
            "status": {
                "user_id": "default",
                "mode": "attached",
                "branch_name": "main",
                "head_commit_id": "commit-merge",
                "session_id": "session-merge",
                "origin_branch": "main",
                "origin_commit_id": "commit-merge",
                "reconstructed_at": None,
                "active_memory_count": 3,
                "memory_breakdown": {"decision": 2, "fact": 1},
                "summary": "Attached to branch 'main' at commit-me",
            },
        }

    monkeypatch.setattr(RewindApi, "merge", _merge)

    result = runner.invoke(
        app,
        ["merge", "feature-x", "--strategy", "manual"],
        input="custom\nUse REST externally and GraphQL internally\n",
    )
    assert result.exit_code == 0
    assert captured["strategy"] == "manual"
    assert captured["resolutions"][0]["choice"] == "custom"
    assert "GraphQL internally" in captured["resolutions"][0]["content"]
    assert "Merge Complete" in result.stdout
