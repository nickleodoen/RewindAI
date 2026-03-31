"""Typer-powered CLI for RewindAI."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import typer
from rich.columns import Columns
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from rewindai_cli.api import ApiError, RewindApi

console = Console()
app = typer.Typer(help="RewindAI CLI — Git for AI memory", no_args_is_help=True)
branch_app = typer.Typer(help="Manage memory branches", no_args_is_help=True)
app.add_typer(branch_app, name="branch")


def _api_from_ctx(ctx: typer.Context) -> RewindApi:
    return RewindApi(base_url=ctx.obj["api_url"], user_id=ctx.obj["user"])


def _emit_json(payload: Any) -> None:
    console.print_json(json.dumps(payload, indent=2, default=str))


def _short_id(value: str | None) -> str:
    if not value:
        return "none"
    return value[:8]


def _format_timestamp(value: str | None) -> str:
    if not value:
        return "unknown"
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return value


def _memory_breakdown_text(breakdown: dict[str, int]) -> str:
    if not breakdown:
        return "0 memories"
    ordered = []
    for key in ("decision", "fact", "context", "action_item", "question"):
        count = breakdown.get(key)
        if count:
            ordered.append(f"{count} {key}")
    return ", ".join(ordered)


def _fail(message: str) -> None:
    console.print(f"[red]{message}[/red]")
    raise typer.Exit(code=1)


def _print_status(status: dict[str, Any], verbose: bool = False) -> None:
    if status["mode"] == "uninitialized":
        console.print(
            Panel(
                f"[bold]RewindAI Workspace[/bold]\n\n{status['summary']}",
                border_style="yellow",
            )
        )
        return

    lines = [
        f"[bold]Mode:[/bold] {status['mode']}",
        f"[bold]Branch:[/bold] {status.get('branch_name') or 'detached'}",
        f"[bold]HEAD:[/bold] {_short_id(status.get('head_commit_id'))}",
        f"[bold]HEAD message:[/bold] {status.get('head_message') or 'n/a'}",
        f"[bold]Session:[/bold] {_short_id(status.get('session_id'))}",
        f"[bold]Context:[/bold] {status.get('active_memory_count', 0)} active memories",
        f"[bold]Breakdown:[/bold] {_memory_breakdown_text(status.get('memory_breakdown', {}))}",
    ]
    if status.get("head_is_merge"):
        lines.append(
            f"[bold]Merge HEAD:[/bold] yes ({', '.join(_short_id(parent_id) for parent_id in status.get('head_parent_ids', []))})"
        )
    if verbose:
        lines.extend(
            [
                f"[bold]Origin branch:[/bold] {status.get('origin_branch') or 'n/a'}",
                f"[bold]Origin commit:[/bold] {_short_id(status.get('origin_commit_id'))}",
                f"[bold]HEAD summary:[/bold] {status.get('head_summary') or 'n/a'}",
                f"[bold]Reconstructed:[/bold] {status.get('reconstructed_at') or 'n/a'}",
            ]
        )
    lines.append(f"[bold]Summary:[/bold] {status['summary']}")
    console.print(Panel("\n".join(lines), title="RewindAI Workspace", border_style="cyan"))


def _print_branches(branches: list[dict[str, Any]], current_branch: str | None) -> None:
    table = Table(title="Branches", show_lines=False)
    table.add_column("")
    table.add_column("Branch", style="bold cyan")
    table.add_column("HEAD", style="green")
    table.add_column("Tip Message", style="white")
    table.add_column("From", style="dim")

    for branch in branches:
        marker = "*" if branch["name"] == current_branch else ""
        table.add_row(
            marker,
            branch["name"],
            _short_id(branch.get("head_commit_id")),
            branch.get("head_message") or "no commits yet",
            _short_id(branch.get("branched_from_commit_id")),
        )
    console.print(table)


def _print_log(commits: list[dict[str, Any]], verbose: bool = False) -> None:
    if not commits:
        console.print(Panel("No commits found for that ref.", border_style="yellow"))
        return

    table = Table(title="Commit History", show_lines=False)
    table.add_column("Commit", style="green")
    table.add_column("When", style="cyan")
    table.add_column("Branch", style="magenta")
    table.add_column("Kind", style="yellow")
    table.add_column("Message", style="white")
    table.add_column("Summary", style="dim")
    if verbose:
        table.add_column("Parents", style="dim")
    table.add_column("Δ", justify="right")

    for commit in commits:
        summary = commit.get("summary") if verbose else None
        parents = ", ".join(_short_id(parent_id) for parent_id in commit.get("parent_ids", [])) or "-"
        row = [
            _short_id(commit["id"]),
            _format_timestamp(commit.get("created_at")),
            commit.get("branch_name", ""),
            "merge" if commit.get("is_merge") else "commit",
            commit.get("message") or "(no message)",
            summary or "",
            str(commit.get("memory_delta_count", 0)),
        ]
        if verbose:
            row.insert(6, parents)
        table.add_row(*row)
    console.print(table)


def _memory_panel(memory: dict[str, Any], title_prefix: str) -> Panel:
    title = f"{title_prefix} {_short_id(memory.get('id'))}"
    tags = ", ".join(memory.get("tags", [])) or "no tags"
    body = f"[bold]{memory.get('type', 'fact')}[/bold]\n\n{memory.get('content', '')}\n\n[dim]tags:[/dim] {tags}"
    return Panel(body, title=title, border_style="magenta")


def _print_diff(diff: dict[str, Any], verbose: bool = False) -> None:
    only_a = diff.get("only_a", [])
    only_b = diff.get("only_b", [])

    summary_lines = [
        f"[bold]Left:[/bold] {diff['branch_a']} ({len(only_a)} unique memories)",
        f"[bold]Right:[/bold] {diff['branch_b']} ({len(only_b)} unique memories)",
    ]
    if only_a and only_b:
        summary_lines.append(
            f"[bold]Story:[/bold] {only_a[0].get('content', '')}  vs  {only_b[0].get('content', '')}"
        )
    console.print(Panel("\n".join(summary_lines), title="Diff Summary", border_style="cyan"))

    header = Table.grid(expand=True)
    header.add_column(justify="left")
    header.add_column(justify="right")
    header.add_row(
        f"[bold]Only on {diff['branch_a']}[/bold] ({len(only_a)})",
        f"[bold]Only on {diff['branch_b']}[/bold] ({len(only_b)})",
    )
    console.print(header)

    left_panels = [_memory_panel(memory, "A") for memory in only_a[:10]]
    right_panels = [_memory_panel(memory, "B") for memory in only_b[:10]]
    if not left_panels:
        left_panels = [Panel("No unique memories", border_style="green")]
    if not right_panels:
        right_panels = [Panel("No unique memories", border_style="green")]

    if verbose:
        console.print(Columns(left_panels[:5] + right_panels[:5], equal=True, expand=True))
    else:
        console.print(
            Columns(
                [Panel.fit("\n".join(memory.get("content", "") for memory in only_a[:5]) or "No unique memories", title=diff["branch_a"])]
                + [Panel.fit("\n".join(memory.get("content", "") for memory in only_b[:5]) or "No unique memories", title=diff["branch_b"])],
                equal=True,
                expand=True,
            )
        )


def _print_chat_banner(status: dict[str, Any]) -> None:
    context = status.get("branch_name") or status.get("origin_branch") or "detached"
    banner = [
        f"[bold]Mode:[/bold] {status['mode']}",
        f"[bold]Context:[/bold] {context}",
        f"[bold]HEAD:[/bold] {_short_id(status.get('head_commit_id'))}",
        f"[bold]HEAD message:[/bold] {status.get('head_message') or 'n/a'}",
        f"[bold]Session:[/bold] {_short_id(status.get('session_id'))}",
        "",
        "Type a message to chat from the active historical memory state.",
        "Commands: /status, /exit",
    ]
    console.print(Panel("\n".join(banner), title="RewindAI Chat", border_style="cyan"))


def _print_merge_preview(preview: dict[str, Any]) -> None:
    lines = [
        f"[bold]Target:[/bold] {preview['target_branch']}",
        f"[bold]Source:[/bold] {preview['source_branch']}",
        f"[bold]Mode:[/bold] {preview['mode']}",
        f"[bold]Merge base:[/bold] {_short_id(preview.get('merge_base_commit_id'))}",
        f"[bold]Conflicts:[/bold] {len(preview.get('conflicts', []))}",
        f"[bold]Auto-merged:[/bold] {len(preview.get('auto_merged', []))}",
    ]
    if preview.get("conflicts"):
        lines.append(f"[bold]Primary conflict:[/bold] {preview['conflicts'][0]['reason']}")
    elif preview.get("auto_merged"):
        lines.append(f"[bold]Highlight:[/bold] {preview['auto_merged'][0].get('content', '')}")
    console.print(Panel("\n".join(lines), title="Merge Preview", border_style="cyan"))


def _print_conflicts(conflicts: list[dict[str, Any]]) -> None:
    for index, conflict in enumerate(conflicts, start=1):
        memory_a = conflict["memory_a"]
        memory_b = conflict["memory_b"]
        body = [
            f"[bold]Reason:[/bold] {conflict['reason']}",
            "",
            f"[bold]Target ({memory_a.get('type', 'fact')}):[/bold] {memory_a.get('content', '')}",
            f"[bold]Source ({memory_b.get('type', 'fact')}):[/bold] {memory_b.get('content', '')}",
        ]
        console.print(Panel("\n".join(body), title=f"Conflict {index}", border_style="yellow"))


def _collect_manual_resolutions(conflicts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    resolutions = []
    for index, conflict in enumerate(conflicts, start=1):
        _print_conflicts([conflict])
        while True:
            choice = console.input(
                f"[bold cyan]Conflict {index} choice[/bold cyan] "
                "[dim](target/source/custom/abort)[/dim]: "
            ).strip().lower()
            if choice not in {"target", "source", "custom", "abort"}:
                console.print("[red]Choose target, source, custom, or abort.[/red]")
                continue
            if choice == "abort":
                _fail("Merge aborted.")

            content = None
            if choice == "custom":
                content = console.input("[bold cyan]Custom merged content:[/bold cyan] ").strip()
                if not content:
                    console.print("[red]Custom content cannot be empty.[/red]")
                    continue

            resolutions.append(
                {
                    "memory_a_id": conflict["memory_a"]["id"],
                    "memory_b_id": conflict["memory_b"]["id"],
                    "choice": choice,
                    "content": content,
                }
            )
            break
    return resolutions


@app.callback()
def main(
    ctx: typer.Context,
    api_url: str = typer.Option("http://localhost:8000", envvar="REWINDAI_API_URL", help="RewindAI backend URL."),
    user: str = typer.Option("default", envvar="REWINDAI_USER", help="User/workspace id."),
) -> None:
    ctx.obj = {"api_url": api_url, "user": user}


@app.command()
def status(
    ctx: typer.Context,
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON."),
    verbose: bool = typer.Option(False, "--verbose", help="Show extra metadata."),
) -> None:
    """Show the active workspace state."""
    api = _api_from_ctx(ctx)
    try:
        status_payload = api.status()
    except ApiError as exc:
        _fail(str(exc))

    if json_output:
        _emit_json(status_payload)
        return
    _print_status(status_payload, verbose=verbose)


@branch_app.command("list")
def branch_list(
    ctx: typer.Context,
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON."),
) -> None:
    """List branches and their tip commits."""
    api = _api_from_ctx(ctx)
    try:
        branches = api.branches()
        status_payload = api.status()
    except ApiError as exc:
        _fail(str(exc))

    if json_output:
        _emit_json({"branches": branches, "status": status_payload})
        return
    _print_branches(branches, status_payload.get("branch_name"))


@branch_app.command("create")
def branch_create(
    ctx: typer.Context,
    new_branch: str = typer.Argument(..., help="Name of the new branch."),
    source_ref: str = typer.Option(..., "--from", help="Branch, commit, or HEAD to branch from."),
    checkout_new_branch: bool = typer.Option(False, "--checkout", help="Attach to the new branch after creation."),
) -> None:
    """Create a branch from a ref."""
    api = _api_from_ctx(ctx)
    try:
        branch = api.create_branch(new_branch, source_ref)
        console.print(f"[green]Created branch[/green] {branch['name']} from {_short_id(branch.get('branched_from_commit_id') or branch.get('head_commit_id'))}")
        if checkout_new_branch:
            result = api.checkout(new_branch, reuse_session=True)
            console.print(f"[cyan]Attached[/cyan] {new_branch} at {_short_id(result.get('commit_id'))}")
    except ApiError as exc:
        _fail(str(exc))


@app.command()
def checkout(
    ctx: typer.Context,
    ref: str = typer.Argument(..., help="Branch name, commit id, short commit prefix, or HEAD."),
    reuse_session: bool = typer.Option(False, "--reuse-session", help="Reuse the current session when the HEAD matches."),
) -> None:
    """Checkout a branch tip or detach at a commit."""
    api = _api_from_ctx(ctx)
    try:
        result = api.checkout(ref, reuse_session=reuse_session)
    except ApiError as exc:
        _fail(str(exc))

    mode = result.get("mode", "attached")
    branch_name = result.get("branch_name") or result.get("status", {}).get("origin_branch") or "detached"
    console.print(
        Panel(
            f"[bold]Mode:[/bold] {mode}\n[bold]Branch:[/bold] {branch_name}\n[bold]HEAD:[/bold] {_short_id(result.get('commit_id'))}\n[bold]Session:[/bold] {_short_id(result.get('session_id'))}",
            title="Checkout Complete",
            border_style="green",
        )
    )


@app.command()
def log(
    ctx: typer.Context,
    ref: str | None = typer.Argument(None, help="Optional ref to start from. Defaults to HEAD."),
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON."),
    verbose: bool = typer.Option(False, "--verbose", help="Show commit summaries."),
) -> None:
    """Show commit history for the active branch or a specific ref."""
    api = _api_from_ctx(ctx)
    try:
        commits = api.log(ref)
    except ApiError as exc:
        _fail(str(exc))

    if json_output:
        _emit_json(commits)
        return
    _print_log(commits, verbose=verbose)


@app.command()
def diff(
    ctx: typer.Context,
    ref_a: str = typer.Argument(..., help="Left-hand ref."),
    ref_b: str = typer.Argument(..., help="Right-hand ref."),
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON."),
    verbose: bool = typer.Option(False, "--verbose", help="Show richer memory cards."),
) -> None:
    """Compare memory state at two refs."""
    api = _api_from_ctx(ctx)
    try:
        diff_payload = api.diff(ref_a, ref_b)
    except ApiError as exc:
        _fail(str(exc))

    if json_output:
        _emit_json(diff_payload)
        return
    _print_diff(diff_payload, verbose=verbose)


@app.command()
def merge(
    ctx: typer.Context,
    source_branch: str = typer.Argument(..., help="Source branch to merge into the current branch."),
    strategy: str = typer.Option("auto", "--strategy", help="Merge strategy: auto, favor-target, favor-source, manual."),
    target_branch: str | None = typer.Option(None, "--into", help="Optional target branch. Defaults to the current attached branch."),
    json_output: bool = typer.Option(False, "--json", help="Print raw JSON."),
) -> None:
    """Merge a source branch into the current attached workspace branch."""
    api = _api_from_ctx(ctx)
    normalized_strategy = strategy.replace("-", "_")
    if normalized_strategy not in {"auto", "favor_target", "favor_source", "manual"}:
        _fail("Unsupported strategy. Use auto, favor-target, favor-source, or manual.")

    try:
        preview = api.merge_preview(source_branch, target_branch=target_branch)
    except ApiError as exc:
        _fail(str(exc))

    if json_output and preview["mode"] == "up_to_date":
        _emit_json({"preview": preview, "result": None})
        return

    if not json_output:
        _print_merge_preview(preview)

    if preview["mode"] == "up_to_date":
        console.print("[green]Already up to date.[/green]")
        return

    if preview["mode"] == "fast_forward":
        console.print(
            f"[cyan]Fast-forwarding[/cyan] {preview['target_branch']} to {_short_id(preview.get('source_head_commit_id'))}"
        )
        try:
            result = api.merge(
                source_branch,
                target_branch=target_branch,
                strategy=normalized_strategy,
            )
        except ApiError as exc:
            _fail(str(exc))
        if json_output:
            _emit_json({"preview": preview, "result": result})
            return
        console.print(
            Panel(
                f"[bold]Target:[/bold] {result['target_branch']}\n"
                f"[bold]HEAD:[/bold] {_short_id(result.get('fast_forward_to_commit_id'))}",
                title="Fast Forward Complete",
                border_style="green",
            )
        )
        return

    conflicts = preview.get("conflicts", [])
    if conflicts:
        if json_output and normalized_strategy == "auto":
            _emit_json({"preview": preview, "result": None})
            raise typer.Exit(code=1)
        if not json_output:
            _print_conflicts(conflicts)
        if normalized_strategy == "auto":
            _fail("Conflicts detected. Re-run with --strategy favor-target, --strategy favor-source, or --strategy manual.")

    resolutions = None
    if conflicts and normalized_strategy == "manual":
        if json_output:
            _fail("Manual merge with --json is not supported. Use interactive mode without --json.")
        resolutions = _collect_manual_resolutions(conflicts)

    try:
        result = api.merge(
            source_branch,
            target_branch=target_branch,
            strategy=normalized_strategy,
            resolutions=resolutions,
        )
    except ApiError as exc:
        _fail(str(exc))

    if json_output:
        _emit_json({"preview": preview, "result": result})
        return

    merge_commit = result.get("merge_commit")
    body = [
        f"[bold]Target:[/bold] {result['target_branch']}",
        f"[bold]Source:[/bold] {result['source_branch']}",
        f"[bold]Auto-merged:[/bold] {len(result.get('auto_merged', []))}",
        f"[bold]Conflicts resolved:[/bold] {result.get('applied_resolution_count', 0)}",
    ]
    if merge_commit:
        body.extend(
            [
                f"[bold]Merge commit:[/bold] {_short_id(merge_commit.get('id'))}",
                f"[bold]Summary:[/bold] {merge_commit.get('summary') or 'n/a'}",
            ]
        )
    console.print(Panel("\n".join(body), title="Merge Complete", border_style="green"))


def _chat_loop(ctx: typer.Context) -> None:
    """Start an interactive chat from the active workspace state."""
    api = _api_from_ctx(ctx)
    try:
        status_payload = api.status()
    except ApiError as exc:
        _fail(str(exc))

    if status_payload["mode"] == "uninitialized" or not status_payload.get("session_id"):
        _fail("No active workspace. Run `rewind checkout main` first.")

    _print_chat_banner(status_payload)
    while True:
        user_input = console.input("[bold cyan]rewind> [/bold cyan]").strip()
        if not user_input:
            continue
        if user_input in {"/exit", "exit", "quit"}:
            console.print("[dim]Ending chat session.[/dim]")
            return
        if user_input == "/status":
            try:
                _print_status(api.status(), verbose=True)
            except ApiError as exc:
                console.print(f"[red]{exc}[/red]")
            continue

        try:
            response = api.chat(user_input)
        except ApiError as exc:
            console.print(f"[red]{exc}[/red]")
            continue

        assistant_text = response.get("response", "")
        response_mode = response.get("response_mode", "live")
        title = "Assistant" if response_mode == "live" else "Memory-grounded fallback"
        style = "blue" if response_mode == "live" else "yellow"

        if response.get("notice"):
            console.print(Panel(response["notice"], title="Notice", border_style="yellow"))

        console.print(Panel(Markdown(assistant_text), title=title, border_style=style))
        if response.get("compaction_occurred"):
            note = Text(
                f"Context compacted — {response.get('memories_extracted', 0)} memories extracted",
                style="magenta",
            )
            console.print(note)


@app.command("commit")
def commit_cmd(
    ctx: typer.Context,
    message: str = typer.Option(..., "-m", "--message", help="Commit message."),
) -> None:
    """Create a commit from the active attached workspace."""
    api = _api_from_ctx(ctx)
    try:
        result = api.commit(message)
    except ApiError as exc:
        _fail(str(exc))

    body = [
        f"[bold]Commit:[/bold] {_short_id(result['id'])}",
        f"[bold]Branch:[/bold] {result.get('branch_name')}",
        f"[bold]Message:[/bold] {result.get('message') or '(no message)'}",
        f"[bold]Summary:[/bold] {result.get('summary') or 'n/a'}",
        f"[bold]Memory delta:[/bold] {result.get('memory_delta_count', 0)}",
    ]
    console.print(Panel("\n".join(body), title="Commit Created", border_style="green"))


@app.command("chat")
def chat_cmd(ctx: typer.Context) -> None:
    """Start the interactive RewindAI shell."""
    from rewindai_cli.shell import run_shell

    api = _api_from_ctx(ctx)
    run_shell(api)


@app.command("ask")
def ask_cmd(
    ctx: typer.Context,
    question: str = typer.Argument(..., help="Question to ask the AI."),
) -> None:
    """One-shot chat: ask a question and get a single answer."""
    api = _api_from_ctx(ctx)
    try:
        status_payload = api.status()
    except ApiError as exc:
        _fail(str(exc))

    if status_payload["mode"] == "uninitialized" or not status_payload.get("session_id"):
        _fail("No active workspace. Run `rewind checkout <branch>` first.")

    context = status_payload.get("branch_name") or status_payload.get("origin_branch") or "detached"
    head = _short_id(status_payload.get("head_commit_id"))

    try:
        response = api.chat(question)
    except ApiError as exc:
        _fail(str(exc))

    assistant_text = response.get("response", "")
    response_mode = response.get("response_mode", "live")
    mode_tag = "" if response_mode == "live" else f"  [dim]({response_mode})[/dim]"

    console.print()
    console.print(f"[dim]context: {context} @ {head}[/dim]{mode_tag}")
    console.print()
    console.print(Panel(Markdown(assistant_text), border_style="blue", padding=(1, 2)))

    if response.get("notice"):
        console.print(f"[dim yellow]{response['notice']}[/dim yellow]")


# ── Showcase Commands ─────────────────────────────────────────────────────────

showcase_app = typer.Typer(help="Presentation operator commands.", no_args_is_help=True)
app.add_typer(showcase_app, name="showcase")

# Hidden backward-compat alias
_demo_alias = typer.Typer(help="Alias for showcase.", no_args_is_help=True, hidden=True)
app.add_typer(_demo_alias, name="demo")

BROWSER_URL = "http://localhost:5173"
EXPECTED_BRANCHES = ("main", "graphql-exploration", "merged")


def _check(label: str, passed: bool, detail: str = "") -> bool:
    icon = "[green]PASS[/green]" if passed else "[red]FAIL[/red]"
    suffix = f"  [dim]{detail}[/dim]" if detail else ""
    console.print(f"  {icon}  {label}{suffix}")
    return passed


def _find_merged_branch(api: RewindApi) -> str:
    """Find the merged branch name — handles both 'merged' and legacy 'merged-demo'."""
    try:
        branches = api.branches()
        names = {b["name"] for b in branches}
        if "merged" in names:
            return "merged"
        if "merged-demo" in names:
            return "merged-demo"
    except ApiError:
        pass
    return "merged"


@showcase_app.command("prepare")
@_demo_alias.command("prepare", hidden=True)
def showcase_prepare(ctx: typer.Context) -> None:
    """Reset data to known-good state and verify readiness."""
    import subprocess
    import sys
    from pathlib import Path

    api = _api_from_ctx(ctx)

    console.print(Panel("[bold]RewindAI Prepare[/bold]\n\nResetting to known-good state...", border_style="cyan"))

    # 1. Health check
    try:
        health = api.health()
        if health.get("status") != "ok":
            _fail("Backend health check failed.")
        neo4j_ok = str(health.get("neo4j", "")).startswith("connected")
        if not neo4j_ok:
            _fail("Neo4j is not connected. Run `docker compose up -d` first.")
        console.print("  [green]PASS[/green]  Backend healthy, Neo4j connected")
    except ApiError as exc:
        _fail(f"Cannot reach backend: {exc}\n  Start with: cd backend && uvicorn app.main:app --reload")

    # 2. Run seed script
    console.print("  [dim]...[/dim]   Running seed + verify (this resets all data)...")
    scripts_dir = Path(__file__).resolve().parents[2] / "scripts"
    seed_script = scripts_dir / "seed_demo.py"
    if not seed_script.exists():
        _fail(f"Seed script not found at {seed_script}")

    result = subprocess.run(
        [sys.executable, str(seed_script), "--api-url", api.base_url, "--user-id", api.user_id, "--verify"],
        capture_output=True,
        text=True,
        cwd=str(scripts_dir.parent),
    )
    if result.returncode != 0:
        console.print(f"[red]Seed script failed:[/red]\n{result.stderr or result.stdout}")
        raise typer.Exit(code=1)
    console.print("  [green]PASS[/green]  Data seeded and verified")

    # 3. Ensure workspace on main
    try:
        api.attach_branch("main", reuse_session=False)
        console.print("  [green]PASS[/green]  Workspace attached to main")
    except ApiError:
        pass

    # 4. Regenerate project workspace
    _regenerate_showcase_workspace()
    console.print("  [green]PASS[/green]  Project workspace created")

    console.print()
    console.print(Panel(
        "[bold green]Ready.[/bold green]\n\n"
        "Next steps:\n"
        "  [cyan]rewind showcase verify[/cyan]   — smoke-test all endpoints\n"
        "  [cyan]rewind showcase ready[/cyan]    — set up safe starting state\n"
        "  [cyan]rewind showcase live[/cyan]     — set up interactive flow\n"
        "  [cyan]rewind showcase script[/cyan]   — print the presenter script\n\n"
        f"  [cyan]rewind --user {api.user_id} chat[/cyan]    — launch the interactive shell",
        border_style="green",
        title="Prepared",
    ))


@showcase_app.command("verify")
@_demo_alias.command("verify", hidden=True)
def showcase_verify(ctx: typer.Context) -> None:
    """Smoke-test every critical endpoint."""
    api = _api_from_ctx(ctx)
    passed = 0
    total = 0
    merged = _find_merged_branch(api)

    console.print(Panel("[bold]System Verify[/bold]", border_style="cyan"))

    # Health
    total += 1
    try:
        health = api.health()
        ok = health.get("status") == "ok" and str(health.get("neo4j", "")).startswith("connected")
        if _check("Backend health + Neo4j", ok):
            passed += 1
    except ApiError as exc:
        _check("Backend health + Neo4j", False, str(exc))

    # Workspace status
    total += 1
    try:
        status_payload = api.status()
        if _check("Workspace status", status_payload.get("mode") != "uninitialized", f"mode={status_payload.get('mode')}"):
            passed += 1
    except ApiError as exc:
        _check("Workspace status", False, str(exc))

    # Branches
    total += 1
    try:
        branches = api.branches()
        names = {b["name"] for b in branches}
        merged_ok = "merged" in names or "merged-demo" in names
        all_present = "main" in names and "graphql-exploration" in names and merged_ok
        if _check("Expected branches exist", all_present, ", ".join(sorted(names))):
            passed += 1
    except ApiError as exc:
        _check("Expected branches exist", False, str(exc))

    # Diff
    total += 1
    try:
        diff_payload = api.diff("main", "graphql-exploration")
        has_rest = any("REST" in m.get("content", "") for m in diff_payload.get("only_a", []))
        has_gql = any("GraphQL" in m.get("content", "") for m in diff_payload.get("only_b", []))
        if _check("Diff main vs graphql-exploration", has_rest and has_gql, f"{len(diff_payload.get('only_a', []))} vs {len(diff_payload.get('only_b', []))}"):
            passed += 1
    except ApiError as exc:
        _check("Diff main vs graphql-exploration", False, str(exc))

    # Timeline
    total += 1
    try:
        timeline = api.timeline("main")
        if _check("Timeline (main)", len(timeline) >= 2, f"{len(timeline)} commits"):
            passed += 1
    except ApiError as exc:
        _check("Timeline (main)", False, str(exc))

    # Commit snapshot
    total += 1
    try:
        timeline = api.timeline(merged)
        if timeline:
            commit_id = timeline[-1]["commit"]["id"]
            snapshot = api.commit_snapshot(commit_id)
            mem_count = snapshot.get("active_memory_count", 0)
            if _check("Commit snapshot", mem_count > 0, f"{mem_count} memories at HEAD"):
                passed += 1
        else:
            _check("Commit snapshot", False, f"no commits on {merged}")
    except ApiError as exc:
        _check("Commit snapshot", False, str(exc))

    # Graph
    total += 1
    try:
        graph = api.graph_branch(merged)
        node_count = len(graph.get("nodes", []))
        if _check("Graph branch fetch", node_count > 0, f"{node_count} nodes"):
            passed += 1
    except ApiError as exc:
        _check("Graph branch fetch", False, str(exc))

    # Chat
    total += 1
    try:
        api.attach_branch(merged, reuse_session=False)
        chat_resp = api.chat("What API direction did we land on?")
        mode = chat_resp.get("response_mode", "unknown")
        has_response = bool(chat_resp.get("response"))
        if _check("Chat endpoint", has_response, f"mode={mode}"):
            passed += 1
        api.attach_branch("main", reuse_session=False)
    except ApiError as exc:
        _check("Chat endpoint", False, str(exc))

    console.print()
    color = "green" if passed == total else "yellow" if passed >= total - 2 else "red"
    console.print(Panel(
        f"[bold]{passed}/{total} checks passed[/bold]",
        border_style=color,
        title="Result",
    ))
    if passed < total:
        raise typer.Exit(code=1)


@showcase_app.command("ready")
@_demo_alias.command("safe", hidden=True)
def showcase_ready(ctx: typer.Context) -> None:
    """Set up the safe starting state for presentation."""
    api = _api_from_ctx(ctx)
    merged = _find_merged_branch(api)

    console.print(Panel("[bold]RewindAI Ready[/bold]\n\nAttaching to the pre-merged branch...", border_style="cyan"))

    try:
        api.attach_branch(merged, reuse_session=False)
        status_payload = api.status()
    except ApiError as exc:
        _fail(f"Failed to attach {merged}: {exc}")

    _print_status(status_payload)

    console.print()
    console.print(Panel(
        f"[bold green]Ready to present.[/bold green]\n\n"
        f"[bold]Browser:[/bold] {BROWSER_URL}\n\n"
        "[bold]Recommended flow:[/bold]\n"
        "  1. Open the browser\n"
        "  2. [cyan]Graph tab[/cyan] — merge diamond in the DAG\n"
        "  3. [cyan]Diff tab[/cyan] — compare main vs graphql-exploration\n"
        "  4. [cyan]Timeline[/cyan] — click the merge commit, inspect snapshot\n"
        "  5. [cyan]Chat tab[/cyan] — ask: \"What API direction did we land on?\"\n\n"
        "[bold]Shell (recommended):[/bold]\n"
        f"  rewind --user {api.user_id} chat\n"
        "  Then: [cyan]guide[/cyan] inside the shell for step-by-step flow",
        border_style="green",
        title="Go Time",
    ))


@showcase_app.command("live")
@_demo_alias.command("live", hidden=True)
def showcase_live(ctx: typer.Context) -> None:
    """Set up the interactive merge flow."""
    api = _api_from_ctx(ctx)

    console.print(Panel("[bold]RewindAI Live[/bold]\n\nAttaching to main for interactive flow...", border_style="cyan"))

    try:
        api.attach_branch("main", reuse_session=False)
        status_payload = api.status()
    except ApiError as exc:
        _fail(f"Failed to attach main: {exc}")

    _print_status(status_payload)

    console.print()
    console.print(Panel(
        f"[bold green]Live mode ready.[/bold green]\n\n"
        f"[bold]Browser:[/bold] {BROWSER_URL}\n\n"
        "[bold]Shell (recommended):[/bold]\n"
        f"  rewind --user {api.user_id} chat\n\n"
        "[bold]Recommended flow inside the shell:[/bold]\n"
        "  [cyan]status[/cyan]  →  [cyan]branches[/cyan]  →  [cyan]diff main graphql-exploration[/cyan]\n"
        f"  [cyan]merge graphql-exploration --strategy manual[/cyan]\n"
        "  Resolution: \"Use REST for public APIs and GraphQL for internal graph-heavy workflows.\"\n\n"
        "[bold]Fallback:[/bold] Run [cyan]rewind showcase ready[/cyan] to switch to the pre-merged branch.",
        border_style="green",
        title="Go Time",
    ))


@showcase_app.command("script")
@_demo_alias.command("script", hidden=True)
def showcase_script(ctx: typer.Context) -> None:
    """Print the full presenter script."""
    api = _api_from_ctx(ctx)
    user = api.user_id
    merged = _find_merged_branch(api)

    script = f"""
[bold cyan]═══ 90-Second Presentation ═══[/bold cyan]

[bold]Setup:[/bold] rewind --user {user} showcase prepare && rewind --user {user} showcase ready

[bold]Step 1 — Shell + Status[/bold]
  [cyan]rewind --user {user} chat[/cyan]
  Inside the shell: [cyan]status[/cyan]
  Say: "RewindAI gives AI a real workspace HEAD — we always know the exact memory state."

[bold]Step 2 — Branches + Diff[/bold]
  [cyan]branches[/cyan]
  [cyan]diff main graphql-exploration[/cyan]
  Say: "Two different memory timelines — one chose REST, the other explored GraphQL."

[bold]Step 3 — Timeline + Snapshot[/bold]
  [cyan]timeline[/cyan]
  [cyan]snapshot HEAD[/cyan]
  Say: "Every commit is an AI memory snapshot. Inspect what the agent knew — grouped by type."

[bold]Step 4 — Ask[/bold]
  [cyan]ask What API direction did we land on?[/cyan]
  Say: "The answer is grounded in merged team knowledge, not raw chat."

[bold]Step 5 — Time-Travel[/bold]
  [cyan]rewind <early-commit-id>[/cyan]
  [cyan]ask What did we decide about the API?[/cyan]
  Say: "The AI only knows what existed at that point. Historical isolation is provable."
  [cyan]back[/cyan]

[bold cyan]═══ 2-Minute Presentation ═══[/bold cyan]

[bold]Setup:[/bold] rewind --user {user} showcase prepare && rewind --user {user} showcase live

[bold]Step 1 — Workspace[/bold]
  [cyan]status[/cyan]  →  [cyan]branches[/cyan]  →  [cyan]log[/cyan]
  Say: "RewindAI tracks AI memory like Git tracks code."

[bold]Step 2 — Divergence[/bold]
  [cyan]diff main graphql-exploration[/cyan]
  Say: "Alice chose REST. Bob explored GraphQL. Divergent memory timelines."

[bold]Step 3 — Merge[/bold]
  Merge via CLI or show existing merge in shell.
  Say: "Merging AI memory — resolving cognitive conflicts like code conflicts."

[bold]Step 4 — Agent State[/bold]
  [cyan]snapshot HEAD[/cyan]  →  [cyan]project[/cyan]
  Say: "The full agent state at this point — decisions, facts, open questions."

[bold]Step 5 — Time-Travel[/bold]
  [cyan]rewind <commit>[/cyan]  →  [cyan]context[/cyan]
  [cyan]ask What did we decide?[/cyan]
  Say: "The AI doesn't know about later decisions. Time-travel is real."
  [cyan]back[/cyan]  →  [cyan]ask What API direction did we land on?[/cyan]
  Say: "Now it knows. This is Git for AI memory."

[bold cyan]═══ Recovery ═══[/bold cyan]

If anything breaks:
  [cyan]use {merged}[/cyan]          — inside the shell
  [cyan]rewind showcase ready[/cyan]  — from the CLI
"""
    console.print(Panel(script.strip(), title="Presenter Script", border_style="bright_magenta", padding=(1, 2)))


@showcase_app.command("reset")
@_demo_alias.command("reset", hidden=True)
def showcase_reset(ctx: typer.Context) -> None:
    """Alias for prepare — reset to known-good state."""
    showcase_prepare(ctx)


def _regenerate_showcase_workspace() -> None:
    """Create or refresh the showcase/workspace/public-api/ folder."""
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[2]
    ws = project_root / "showcase" / "workspace" / "public-api"
    ws.mkdir(parents=True, exist_ok=True)

    # ── README ──
    (ws / "README.md").write_text(
        "# Public API Service\n\n"
        "Team workspace for the public API design — tracked by RewindAI.\n\n"
        "## Team\n\n"
        "- **Alice Chen** — Backend lead, REST advocate\n"
        "- **Bob Kumar** — API specialist, GraphQL exploration\n\n"
        "## Branches\n\n"
        "| Branch | Direction | Owner |\n"
        "|--------|-----------|-------|\n"
        "| `main` | REST-first public API | Alice |\n"
        "| `graphql-exploration` | GraphQL alternative | Bob |\n"
        "| `merged` | Combined resolution | Team |\n\n"
        "## Resolution\n\n"
        "**REST for public APIs, GraphQL for internal graph-heavy workflows.**\n\n"
        "Every decision, fact, and question is stored as a versioned memory node in the\n"
        "knowledge graph. Branches allow parallel exploration. Merging combines knowledge\n"
        "with conflict resolution — like Git merges code.\n"
    )

    # ── .gitignore ──
    (ws / ".gitignore").write_text(
        "__pycache__/\n*.pyc\n.env\n.venv/\nnode_modules/\n*.log\n.DS_Store\n"
    )

    # ── requirements.txt ──
    (ws / "requirements.txt").write_text(
        "fastapi==0.115.0\nuvicorn[standard]==0.30.0\nhttpx==0.27.0\npydantic==2.9.0\nneo4j==5.25.0\n"
    )

    # ── docs/ ──
    docs = ws / "docs"
    docs.mkdir(exist_ok=True)

    (docs / "architecture.md").write_text(
        "# Architecture Kickoff\n\n"
        "The team needs a versioned API surface for both the browser app and the CLI.\n\n"
        "## Context\n\n"
        "- **Team:** Alice Chen (backend lead), Bob Kumar (API specialist)\n"
        "- **Requirements:** Browser-friendly, CLI-compatible, graph-query capable\n"
        "- **Timeline:** MVP phase, then stretch goals\n\n"
        "## Open Questions\n\n"
        "- REST vs GraphQL for the public API surface?\n"
        "- How to handle graph-heavy queries efficiently?\n"
        "- Pagination strategy for timeline endpoints?\n"
    )

    (docs / "rest_direction.md").write_text(
        "# REST API Direction (main branch)\n\n"
        "**Decision:** Use REST for the public application API.\n\n"
        "**Author:** Alice Chen\n\n"
        "## Rationale\n\n"
        "- REST is well-understood by consumers and integration partners\n"
        "- Stable endpoint contracts for both browser and CLI clients\n"
        "- JWT auth protects private write routes\n\n"
        "## Supporting Facts\n\n"
        "- Redis caching keeps reads fast for timeline and graph endpoints\n"
        "- Cursor-based pagination is acceptable for the initial release\n"
        "- OpenAPI spec auto-generated from Pydantic models\n"
    )

    (docs / "graphql_exploration.md").write_text(
        "# GraphQL Exploration (graphql-exploration branch)\n\n"
        "**Decision:** Use GraphQL for the public API to support flexible queries.\n\n"
        "**Author:** Bob Kumar\n\n"
        "## Rationale\n\n"
        "- Graph data maps naturally to GraphQL's nested query model\n"
        "- Schema stitching simplifies partner integrations\n"
        "- Flexible queries reduce the number of endpoints\n\n"
        "## Action Items\n\n"
        "- Evaluate Apollo federation after the merge decision lands\n"
        "- Benchmark query complexity limits for production\n"
    )

    (docs / "merged_decision.md").write_text(
        "# Merged Decision (merged branch)\n\n"
        "**Resolution:** REST for public APIs, GraphQL for internal graph-heavy workflows.\n\n"
        "## How We Got Here\n\n"
        "1. Alice's main branch advocated REST for stability and broad compatibility\n"
        "2. Bob's branch explored GraphQL for flexible graph queries\n"
        "3. The team merged both: REST externally, GraphQL internally\n\n"
        "## What This Demonstrates\n\n"
        "A genuine cognitive conflict between two API philosophies, resolved by\n"
        "synthesizing both viewpoints — exactly like merging code branches.\n"
    )

    (docs / "team_notes.md").write_text(
        "# Team Notes\n\n"
        "## Decision Log\n\n"
        "| Date | Decision | Author | Branch |\n"
        "|------|----------|--------|--------|\n"
        "| Sprint 1 | Architecture kickoff | Alice | main |\n"
        "| Sprint 1 | REST for public API | Alice | main |\n"
        "| Sprint 1 | GraphQL exploration | Bob | graphql-exploration |\n"
        "| Sprint 2 | Merged: REST public + GraphQL internal | Team | merged |\n\n"
        "## Open Items\n\n"
        "- [ ] Apollo federation evaluation\n"
        "- [ ] Rate limiting strategy for public endpoints\n"
        "- [ ] Schema versioning approach\n"
    )

    # ── src/api/ ──
    api_dir = ws / "src" / "api"
    api_dir.mkdir(parents=True, exist_ok=True)

    (api_dir / "__init__.py").write_text("")

    (api_dir / "routes.py").write_text(
        '"""REST API routes — public-facing endpoints."""\n\n'
        "from fastapi import APIRouter, Depends, Query\n\n"
        "router = APIRouter(prefix=\"/api/v1\")\n\n\n"
        "@router.get(\"/memories\")\n"
        "async def list_memories(branch_name: str = Query(\"main\")):\n"
        '    """List versioned memories on a branch."""\n'
        "    ...\n\n\n"
        "@router.get(\"/branches\")\n"
        "async def list_branches():\n"
        '    """List all branches in the knowledge graph."""\n'
        "    ...\n\n\n"
        "@router.get(\"/timeline/{branch}\")\n"
        "async def get_timeline(branch: str):\n"
        '    """Commit timeline for a branch."""\n'
        "    ...\n\n\n"
        "@router.post(\"/diff\")\n"
        "async def diff_branches(ref_a: str, ref_b: str):\n"
        '    """Compare memories between two branches."""\n'
        "    ...\n\n\n"
        "@router.post(\"/chat\")\n"
        "async def chat(message: str, user_id: str):\n"
        '    """Send a message grounded in versioned memory."""\n'
        "    ...\n"
    )

    (api_dir / "middleware.py").write_text(
        '"""API middleware — CORS, auth, request logging."""\n\n'
        "from fastapi import Request\n"
        "from starlette.middleware.base import BaseHTTPMiddleware\n\n\n"
        "class RequestLogger(BaseHTTPMiddleware):\n"
        "    async def dispatch(self, request: Request, call_next):\n"
        "        response = await call_next(request)\n"
        "        return response\n"
    )

    # ── src/graphql/ ──
    gql_dir = ws / "src" / "graphql"
    gql_dir.mkdir(parents=True, exist_ok=True)

    (gql_dir / "__init__.py").write_text("")

    (gql_dir / "schema.py").write_text(
        '"""GraphQL schema — internal graph-heavy queries."""\n\n'
        "# Used for internal workflows where flexible nested queries\n"
        "# outperform fixed REST endpoints.\n\n"
        "SCHEMA = \"\"\"\n"
        "type Memory {\n"
        "    id: ID!\n"
        "    type: String!\n"
        "    content: String!\n"
        "    tags: [String!]!\n"
        "    branch: String!\n"
        "    createdAt: DateTime!\n"
        "}\n\n"
        "type Branch {\n"
        "    name: String!\n"
        "    headCommit: Commit\n"
        "    branchedFrom: Commit\n"
        "}\n\n"
        "type Commit {\n"
        "    id: ID!\n"
        "    message: String!\n"
        "    parents: [Commit!]!\n"
        "    memories: [Memory!]!\n"
        "}\n\n"
        "type Query {\n"
        "    memories(branch: String!, type: String): [Memory!]!\n"
        "    branches: [Branch!]!\n"
        "    neighborhood(id: ID!): [Node!]!\n"
        "}\n"
        "\"\"\"\n"
    )

    (gql_dir / "resolvers.py").write_text(
        '"""GraphQL resolvers for internal graph queries."""\n\n\n'
        "async def resolve_memories(branch: str, type_filter: str | None = None):\n"
        '    """Fetch memories from the knowledge graph."""\n'
        "    ...\n\n\n"
        "async def resolve_neighborhood(node_id: str):\n"
        '    """Get connected nodes for graph visualization."""\n'
        "    ...\n"
    )

    # ── src/services/ ──
    svc_dir = ws / "src" / "services"
    svc_dir.mkdir(parents=True, exist_ok=True)

    (svc_dir / "__init__.py").write_text("")

    (svc_dir / "memory_service.py").write_text(
        '"""Memory service — versioned knowledge graph operations."""\n\n'
        "from dataclasses import dataclass\n\n\n"
        "@dataclass\n"
        "class MemoryService:\n"
        '    """Manages versioned memories in the knowledge graph."""\n\n'
        "    async def get_memories_at_commit(self, commit_id: str):\n"
        '        """Temporal query: memories active at a specific commit."""\n'
        "        ...\n\n"
        "    async def diff_branches(self, branch_a: str, branch_b: str):\n"
        '        """Compare memory states between two branches."""\n'
        "        ...\n\n"
        "    async def merge_branches(self, source: str, target: str):\n"
        '        """Merge memories with conflict detection."""\n'
        "        ...\n"
    )

    # ── src/config/ ──
    cfg_dir = ws / "src" / "config"
    cfg_dir.mkdir(parents=True, exist_ok=True)

    (cfg_dir / "__init__.py").write_text("")

    (cfg_dir / "settings.py").write_text(
        '"""Application settings."""\n\n'
        "from pydantic_settings import BaseSettings\n\n\n"
        "class Settings(BaseSettings):\n"
        "    neo4j_uri: str = \"bolt://localhost:7687\"\n"
        "    neo4j_user: str = \"neo4j\"\n"
        "    neo4j_password: str = \"rewindai\"\n"
        "    anthropic_api_key: str = \"\"\n"
        "    compaction_threshold: int = 5000\n\n"
        "    class Config:\n"
        "        env_file = \".env\"\n"
    )

    # ── tests/ ──
    tests_dir = ws / "tests"
    tests_dir.mkdir(exist_ok=True)

    (tests_dir / "__init__.py").write_text("")

    (tests_dir / "test_api.py").write_text(
        '"""API endpoint tests."""\n\n'
        "import pytest\n\n\n"
        "def test_list_branches():\n"
        '    """Verify branch listing returns expected branches."""\n'
        "    ...\n\n\n"
        "def test_diff_shows_divergence():\n"
        '    """Verify diff between main and graphql-exploration shows differences."""\n'
        "    ...\n\n\n"
        "def test_timeline_has_commits():\n"
        '    """Verify timeline returns at least one commit."""\n'
        "    ...\n"
    )
