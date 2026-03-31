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
        title = "Assistant" if response_mode == "live" else "Memory-grounded demo fallback"
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
    """Start the interactive RewindAI demo shell."""
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


# ── Demo Commands ────────────────────────────────────────────────────────────

demo_app = typer.Typer(help="Demo operator commands for RewindAI.", no_args_is_help=True)
app.add_typer(demo_app, name="demo")

BROWSER_URL = "http://localhost:5173"
EXPECTED_BRANCHES = ("main", "graphql-exploration", "merged-demo")


def _check(label: str, passed: bool, detail: str = "") -> bool:
    icon = "[green]PASS[/green]" if passed else "[red]FAIL[/red]"
    suffix = f"  [dim]{detail}[/dim]" if detail else ""
    console.print(f"  {icon}  {label}{suffix}")
    return passed


@demo_app.command("prepare")
def demo_prepare(ctx: typer.Context) -> None:
    """Reset demo data to known-good state and verify readiness."""
    import subprocess
    import sys
    from pathlib import Path

    api = _api_from_ctx(ctx)

    console.print(Panel("[bold]RewindAI Demo Prepare[/bold]\n\nResetting to known-good demo state...", border_style="cyan"))

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

    # 2. Run seed_demo.py --verify
    console.print("  [dim]...[/dim]   Running seed + verify (this resets all demo data)...")
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
    console.print("  [green]PASS[/green]  Demo data seeded and verified")

    # 3. Ensure workspace on main
    try:
        api.attach_branch("main", reuse_session=False)
        console.print("  [green]PASS[/green]  Workspace attached to main")
    except ApiError:
        pass

    # 4. Regenerate demo project folder
    _regenerate_demo_project()
    console.print("  [green]PASS[/green]  Demo project folder created")

    console.print()
    console.print(Panel(
        "[bold green]Demo prepared.[/bold green]\n\n"
        "Next steps:\n"
        "  [cyan]rewind demo verify[/cyan]     — smoke-test all endpoints\n"
        "  [cyan]rewind demo safe[/cyan]       — set up the safe demo path\n"
        "  [cyan]rewind demo live[/cyan]       — set up the live interactive path\n"
        "  [cyan]rewind demo script[/cyan]     — print the presenter script",
        border_style="green",
        title="Ready",
    ))


@demo_app.command("verify")
def demo_verify(ctx: typer.Context) -> None:
    """Smoke-test every demo-critical endpoint."""
    api = _api_from_ctx(ctx)
    passed = 0
    total = 0

    console.print(Panel("[bold]RewindAI Demo Verify[/bold]", border_style="cyan"))

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
        all_present = all(b in names for b in EXPECTED_BRANCHES)
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
        timeline = api.timeline("merged-demo")
        if timeline:
            commit_id = timeline[-1]["commit"]["id"]
            snapshot = api.commit_snapshot(commit_id)
            mem_count = snapshot.get("active_memory_count", 0)
            if _check("Commit snapshot inspector", mem_count > 0, f"{mem_count} memories at HEAD"):
                passed += 1
        else:
            _check("Commit snapshot inspector", False, "no commits on merged-demo")
    except ApiError as exc:
        _check("Commit snapshot inspector", False, str(exc))

    # Graph
    total += 1
    try:
        graph = api.graph_branch("merged-demo")
        node_count = len(graph.get("nodes", []))
        if _check("Graph branch fetch", node_count > 0, f"{node_count} nodes"):
            passed += 1
    except ApiError as exc:
        _check("Graph branch fetch", False, str(exc))

    # Chat
    total += 1
    try:
        api.attach_branch("merged-demo", reuse_session=False)
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
        title="Verify Result",
    ))
    if passed < total:
        raise typer.Exit(code=1)


@demo_app.command("safe")
def demo_safe(ctx: typer.Context) -> None:
    """Set up the safe (pre-merged) demo path."""
    api = _api_from_ctx(ctx)

    console.print(Panel("[bold]RewindAI Safe Demo[/bold]\n\nAttaching to the pre-merged branch...", border_style="cyan"))

    try:
        api.attach_branch("merged-demo", reuse_session=False)
        status_payload = api.status()
    except ApiError as exc:
        _fail(f"Failed to attach merged-demo: {exc}")

    _print_status(status_payload)

    console.print()
    console.print(Panel(
        f"[bold green]Safe demo ready.[/bold green]\n\n"
        f"[bold]Browser:[/bold] {BROWSER_URL}\n\n"
        "[bold]Recommended flow:[/bold]\n"
        "  1. Open the browser\n"
        "  2. [cyan]Graph tab[/cyan] — show the merge diamond in the DAG\n"
        "  3. [cyan]Diff tab[/cyan] — compare main vs graphql-exploration\n"
        "  4. [cyan]Timeline[/cyan] — click the merge commit, inspect AI memory snapshot\n"
        "  5. [cyan]Chat tab[/cyan] — ask: \"What API direction did we land on?\"\n\n"
        "[bold]CLI quick demo:[/bold]\n"
        f"  rewind --user {api.user_id} ask \"What API direction did we land on?\"\n"
        f"  rewind --user {api.user_id} log\n"
        f"  rewind --user {api.user_id} diff main graphql-exploration",
        border_style="green",
        title="Go Time",
    ))


@demo_app.command("live")
def demo_live(ctx: typer.Context) -> None:
    """Set up the live interactive demo path."""
    api = _api_from_ctx(ctx)

    console.print(Panel("[bold]RewindAI Live Demo[/bold]\n\nAttaching to main for interactive merge flow...", border_style="cyan"))

    try:
        api.attach_branch("main", reuse_session=False)
        status_payload = api.status()
    except ApiError as exc:
        _fail(f"Failed to attach main: {exc}")

    _print_status(status_payload)

    console.print()
    console.print(Panel(
        f"[bold green]Live demo ready.[/bold green]\n\n"
        f"[bold]Browser:[/bold] {BROWSER_URL}\n\n"
        "[bold]Recommended flow:[/bold]\n"
        f"  1. rewind --user {api.user_id} status\n"
        f"  2. rewind --user {api.user_id} log\n"
        f"  3. rewind --user {api.user_id} diff main graphql-exploration\n"
        f"  4. rewind --user {api.user_id} merge graphql-exploration --strategy manual\n"
        "     Suggested resolution: \"Use REST for public APIs and GraphQL for internal graph-heavy workflows.\"\n"
        "  5. Open browser — show merge diamond in the Graph tab\n"
        f"  6. rewind --user {api.user_id} ask \"What API direction did we land on?\"\n\n"
        "[bold]Fallback:[/bold] If merge fails, run [cyan]rewind demo safe[/cyan] to switch to pre-merged branch.",
        border_style="green",
        title="Go Time",
    ))


@demo_app.command("script")
def demo_script(ctx: typer.Context) -> None:
    """Print the full presenter script for safe and live demos."""
    api = _api_from_ctx(ctx)
    user = api.user_id

    script = f"""
[bold cyan]═══ 90-Second Safe Demo Script ═══[/bold cyan]

[bold]Setup:[/bold] rewind --user {user} demo prepare && rewind --user {user} demo safe

[bold]Step 1 — Status[/bold]
  [cyan]rewind --user {user} status[/cyan]
  Say: "RewindAI gives AI a real workspace HEAD — we always know exactly what memory state the model is operating from."

[bold]Step 2 — Browser: Graph[/bold]
  Open {BROWSER_URL}, Graph tab on merged-demo
  Say: "This is the team's cognitive timeline as a graph. That diamond is a merge commit — two thinking paths joined."

[bold]Step 3 — Browser: Diff[/bold]
  Switch to Diff tab, main vs graphql-exploration
  Say: "These are two different memory timelines — one chose REST, the other explored GraphQL."

[bold]Step 4 — Browser: Snapshot Inspector[/bold]
  Click the merge commit in the Timeline sidebar
  Say: "Every commit is a snapshot. Click it and you see exactly what the AI knew at that point — grouped by type."

[bold]Step 5 — Chat[/bold]
  [cyan]rewind --user {user} ask "What API direction did we land on?"[/cyan]
  Say: "The answer is grounded in the merged memory — not raw chat history, but versioned team knowledge."

[bold]Step 6 — Rewind (Optional)[/bold]
  Click "Rewind chat to this snapshot" on an earlier commit
  Ask: "What did we decide about the API?"
  Say: "The AI only knows what existed at that point. It doesn't know about later decisions."

[bold cyan]═══ 2-Minute Live Demo Script ═══[/bold cyan]

[bold]Setup:[/bold] rewind --user {user} demo prepare && rewind --user {user} demo live

[bold]Step 1 — Status + Log[/bold]
  [cyan]rewind --user {user} status[/cyan]
  [cyan]rewind --user {user} log[/cyan]
  Say: "RewindAI tracks AI memory like Git tracks code. Commits, branches, history."

[bold]Step 2 — Diff[/bold]
  [cyan]rewind --user {user} diff main graphql-exploration[/cyan]
  Say: "Alice's team chose REST. Bob explored GraphQL. These are divergent memory timelines."

[bold]Step 3 — Live Merge[/bold]
  [cyan]rewind --user {user} merge graphql-exploration --strategy manual[/cyan]
  Resolution: "Use REST for public APIs and GraphQL for internal graph-heavy workflows."
  Say: "We're merging AI memory — resolving cognitive conflicts just like code conflicts."

[bold]Step 4 — Browser Graph[/bold]
  Open {BROWSER_URL}, refresh Graph tab
  Say: "The merged cognitive timeline, with a diamond merge commit connecting both paths."

[bold]Step 5 — Ask[/bold]
  [cyan]rewind --user {user} ask "What API direction did we land on?"[/cyan]
  Say: "The answer synthesizes both timelines. This is what Git for AI memory means."

[bold cyan]═══ Rescue Path ═══[/bold cyan]

If anything breaks during the live demo:
  [cyan]rewind --user {user} demo safe[/cyan]
This switches to the pre-merged branch instantly. Continue from Step 4 of the safe script.
"""
    console.print(Panel(script.strip(), title="Presenter Script", border_style="cyan", padding=(1, 2)))


@demo_app.command("reset")
def demo_reset(ctx: typer.Context) -> None:
    """Alias for `demo prepare` — reset to known-good state."""
    demo_prepare(ctx)


def _regenerate_demo_project() -> None:
    """Create or refresh the demo/project/public-api-demo/ folder."""
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[2]
    demo_dir = project_root / "demo" / "project" / "public-api-demo"
    demo_dir.mkdir(parents=True, exist_ok=True)

    (demo_dir / "README.md").write_text(
        "# Public API Design — RewindAI Demo Project\n\n"
        "This folder represents the team's API design decisions tracked by RewindAI.\n\n"
        "## Branches\n\n"
        "- **main** — REST-first public API direction (Alice)\n"
        "- **graphql-exploration** — GraphQL alternative exploration (Bob)\n"
        "- **merged-demo** — Merged outcome combining both approaches\n\n"
        "## Key Decision\n\n"
        "Use REST for public APIs and GraphQL for internal graph-heavy workflows.\n\n"
        "## How RewindAI Tracks This\n\n"
        "Every decision, fact, and open question is stored as a versioned memory node "
        "in a Neo4j graph. Branches allow parallel exploration. Merging combines knowledge "
        "with conflict resolution — just like Git merges code.\n"
    )

    docs_dir = demo_dir / "docs"
    docs_dir.mkdir(exist_ok=True)

    (docs_dir / "architecture.md").write_text(
        "# Architecture Kickoff\n\n"
        "RewindAI needs a versioned API surface that works for both the browser demo and the CLI.\n\n"
        "## Context\n\n"
        "- Team members: Alice Chen (backend lead), Bob Kumar (API specialist)\n"
        "- Requirements: browser-friendly, CLI-compatible, graph-query capable\n"
        "- Timeline: MVP in 8 hours, stretch goals over 2-3 days\n"
    )

    (docs_dir / "rest_direction.md").write_text(
        "# REST API Direction (main branch)\n\n"
        "**Decision:** Use REST for the public application API so the browser demo and CLI share stable endpoints.\n\n"
        "**Author:** Alice Chen\n\n"
        "## Rationale\n\n"
        "- REST is well-understood by judges and demo audiences\n"
        "- Stable endpoint contracts for both browser and CLI clients\n"
        "- JWT auth protects private write routes used by the team workspace\n\n"
        "## Supporting Facts\n\n"
        "- Redis caching keeps graph and timeline reads fast enough for the live demo\n"
        "- Cursor-light pagination is acceptable for the first demo cut\n"
    )

    (docs_dir / "graphql_exploration.md").write_text(
        "# GraphQL Exploration (graphql-exploration branch)\n\n"
        "**Decision:** Use GraphQL for the public application API to support flexible graph-heavy queries.\n\n"
        "**Author:** Bob Kumar\n\n"
        "## Rationale\n\n"
        "- Graph data naturally maps to GraphQL's nested query model\n"
        "- Schema stitching can simplify partner integrations without duplicating resolver logic\n"
        "- Flexible queries reduce the number of endpoints needed\n\n"
        "## Action Items\n\n"
        "- Evaluate Apollo federation after the merge decision lands\n"
    )

    (docs_dir / "merged_decision.md").write_text(
        "# Merged Decision (merged-demo branch)\n\n"
        "**Resolution:** Use REST for public APIs and GraphQL for internal graph-heavy workflows.\n\n"
        "## How We Got Here\n\n"
        "1. Alice's main branch advocated REST for stability and demo clarity\n"
        "2. Bob's graphql-exploration branch explored GraphQL for flexible graph queries\n"
        "3. The team merged both perspectives, keeping REST for external consumers\n"
        "   and GraphQL for internal graph-heavy workflows\n\n"
        "## What This Demonstrates\n\n"
        "RewindAI's merge resolved a genuine cognitive conflict between two API philosophies,\n"
        "creating a decision that synthesizes both viewpoints — exactly like merging code branches.\n"
    )

    src_dir = demo_dir / "src"
    (src_dir / "api").mkdir(parents=True, exist_ok=True)
    (src_dir / "graphql").mkdir(parents=True, exist_ok=True)

    (src_dir / "api" / "routes.py").write_text(
        '"""REST API routes — public-facing endpoints."""\n\n'
        "# GET  /api/v1/memories     — list versioned memories\n"
        "# GET  /api/v1/branches     — list branches\n"
        "# GET  /api/v1/timeline/:b  — commit timeline\n"
        "# POST /api/v1/diff         — compare branches\n"
        "# POST /api/v1/chat         — send a message\n"
    )

    (src_dir / "graphql" / "schema.py").write_text(
        '"""GraphQL schema — internal graph-heavy queries."""\n\n'
        "# type Memory { id, type, content, tags, branch, createdAt }\n"
        "# type Branch { name, headCommit, branchedFrom }\n"
        "# type Commit { id, message, parents, memories }\n"
        "# query neighborhood(id) -> [Memory | Commit | Branch]\n"
    )
