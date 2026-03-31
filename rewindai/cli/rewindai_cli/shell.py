"""Interactive RewindAI shell — presentation-grade REPL."""

from __future__ import annotations

import os
import platform
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

from rich.columns import Columns
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table
from rich.text import Text
from rich.tree import Tree

from rewindai_cli.api import ApiError, RewindApi

console = Console()

# ── Color palette ────────────────────────────────────────────────────────────

TYPE_COLORS = {
    "decision": "magenta",
    "fact": "blue",
    "context": "bright_blue",
    "action_item": "yellow",
    "question": "bright_yellow",
}

TYPE_ICONS = {
    "decision": "◆",
    "fact": "●",
    "context": "◇",
    "action_item": "▸",
    "question": "?",
}

BROWSER_URL = "http://localhost:5173"
BACKEND_URL = "http://localhost:8000"

# ── Branch → project phase mapping ──────────────────────────────────────────

BRANCH_PHASE = {
    "main": ("REST API Direction", "The team has chosen REST for the public API surface."),
    "graphql-exploration": ("GraphQL Exploration", "Bob is exploring GraphQL as an alternative API approach."),
    "merged": ("Merged Resolution", "REST for public APIs, GraphQL for internal graph-heavy workflows."),
}

BRANCH_DOCS = {
    "main": ["docs/architecture.md", "docs/rest_direction.md"],
    "graphql-exploration": ["docs/architecture.md", "docs/graphql_exploration.md"],
    "merged": ["docs/architecture.md", "docs/rest_direction.md", "docs/graphql_exploration.md", "docs/merged_decision.md"],
}

# ── Helpers ──────────────────────────────────────────────────────────────────


def _short(val: str | None, length: int = 8) -> str:
    return val[:length] if val else "—"


def _ts(val: str | None) -> str:
    if not val:
        return "—"
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00")).strftime("%b %d %H:%M")
    except Exception:
        return val


def _breakdown(bd: dict[str, int]) -> str:
    parts = []
    for key in ("decision", "fact", "context", "action_item", "question"):
        cnt = bd.get(key, 0)
        if cnt:
            parts.append(f"[{TYPE_COLORS.get(key, 'white')}]{cnt} {key}[/]")
    return ", ".join(parts) or "[dim]none[/dim]"


def _err(msg: str) -> None:
    console.print(f"  [red]{msg}[/red]")


def _phase_for_branch(branch: str) -> tuple[str, str]:
    """Return (phase_name, phase_description) for a branch."""
    if branch in BRANCH_PHASE:
        return BRANCH_PHASE[branch]
    # Backward compat: merged-demo → merged
    if branch == "merged-demo":
        return BRANCH_PHASE.get("merged", ("Unknown", ""))
    return ("Working", f"Active branch: {branch}")


def _docs_for_branch(branch: str) -> list[str]:
    if branch in BRANCH_DOCS:
        return BRANCH_DOCS[branch]
    if branch == "merged-demo":
        return BRANCH_DOCS.get("merged", [])
    return ["docs/architecture.md"]


# ── Shell class ──────────────────────────────────────────────────────────────


class RewindShell:
    """Interactive shell for RewindAI."""

    def __init__(self, api: RewindApi) -> None:
        self.api = api
        self.linked_project: str | None = None
        self._last_branch: str | None = None
        # Auto-link the showcase workspace if it exists
        for candidate in (
            Path(__file__).resolve().parents[2] / "showcase" / "workspace" / "public-api",
            Path(__file__).resolve().parents[2] / "demo" / "project" / "public-api-demo",
        ):
            if candidate.is_dir():
                self.linked_project = str(candidate)
                break

    # ── Dispatch ─────────────────────────────────────────────────────────

    COMMANDS = {
        "help", "link", "status", "branches", "use", "graph", "diff",
        "timeline", "snapshot", "rewind", "ask", "context", "memories",
        "llm", "verify", "script", "open", "clear", "exit", "quit",
        "back", "head", "log", "project", "guide",
    }

    def dispatch(self, raw: str) -> bool:
        """Parse and run a command. Returns False to exit the shell."""
        raw = raw.strip()
        if not raw:
            return True

        # Backward compat
        if raw == "/exit":
            return False
        if raw == "/status":
            raw = "status"

        parts = raw.split(None, 1)
        cmd = parts[0].lower()
        args = parts[1] if len(parts) > 1 else ""

        if cmd in self.COMMANDS:
            handler = getattr(self, f"cmd_{cmd}", None)
            if handler:
                try:
                    result = handler(args)
                    if result is False:
                        return False
                except ApiError as exc:
                    _err(str(exc))
                except Exception as exc:
                    _err(f"Unexpected error: {exc}")
                return True

        # Freeform: treat as chat question
        self._do_chat(raw)
        return True

    # ── Banner ───────────────────────────────────────────────────────────

    def print_banner(self) -> None:
        try:
            st = self.api.status()
        except ApiError:
            st = {"mode": "uninitialized", "summary": "Backend unreachable"}

        branch = st.get("branch_name") or st.get("origin_branch") or "—"
        mode = st.get("mode", "unknown")
        head = _short(st.get("head_commit_id"))
        mem = st.get("active_memory_count", 0)
        phase_name, _ = _phase_for_branch(branch)

        banner = (
            f"[bold bright_magenta]RewindAI[/bold bright_magenta]  "
            f"[dim]git for AI memory[/dim]\n\n"
            f"  [bold]branch:[/bold] [cyan]{branch}[/cyan]   "
            f"[bold]mode:[/bold] {'[yellow]' + mode + '[/yellow]' if mode == 'detached' else mode}   "
            f"[bold]HEAD:[/bold] [green]{head}[/green]   "
            f"[bold]memories:[/bold] {mem}\n"
            f"  [bold]phase:[/bold]  [dim]{phase_name}[/dim]\n\n"
            f"  Type [cyan]help[/cyan] for commands, or just type a question.\n"
            f"  Type [cyan]guide[/cyan] for the recommended presentation flow."
        )
        console.print(Panel(banner, border_style="bright_magenta", padding=(1, 2)))

    # ── Commands ─────────────────────────────────────────────────────────

    def cmd_help(self, args: str) -> None:
        table = Table(
            show_header=False, show_edge=False, pad_edge=False,
            box=None, padding=(0, 3, 0, 0),
        )
        table.add_column("cmd", style="bold cyan", min_width=18)
        table.add_column("desc", style="white")

        table.add_row("", "")
        table.add_row("[dim]── Workspace ──[/dim]", "")
        table.add_row("status", "Workspace state, branch, HEAD, memory count")
        table.add_row("branches", "List all branches")
        table.add_row("use <branch>", "Switch to a branch")
        table.add_row("back", "Reattach to last branch after rewind")
        table.add_row("head", "Current HEAD commit details")
        table.add_row("", "")
        table.add_row("[dim]── History ──[/dim]", "")
        table.add_row("log", "Commit log for current branch")
        table.add_row("timeline", "Visual commit timeline with merge badges")
        table.add_row("graph", "Memory graph as DAG tree")
        table.add_row("diff [a] [b]", "Compare two branches side-by-side")
        table.add_row("snapshot [id]", "Inspect AI memory state at a commit")
        table.add_row("rewind <id>", "Time-travel to a historical snapshot")
        table.add_row("", "")
        table.add_row("[dim]── Memory & AI ──[/dim]", "")
        table.add_row("context", "What the AI knows right now")
        table.add_row("memories [type]", "List memory items, optionally filtered")
        table.add_row("ask <question>", "One-shot question from current state")
        table.add_row("[dim]<freeform text>[/dim]", "[dim]Also sends as a chat question[/dim]")
        table.add_row("", "")
        table.add_row("[dim]── Project ──[/dim]", "")
        table.add_row("project", "Show linked project workspace and state")
        table.add_row("link [path]", "Link a project workspace folder")
        table.add_row("open", "URLs, paths, and open browser")
        table.add_row("", "")
        table.add_row("[dim]── Presenter ──[/dim]", "")
        table.add_row("guide", "Recommended presentation flow")
        table.add_row("llm", "Model / fallback status")
        table.add_row("verify", "Smoke-test checklist")
        table.add_row("script", "Full presenter script with narration")
        table.add_row("", "")
        table.add_row("[dim]── Utility ──[/dim]", "")
        table.add_row("clear", "Clear the screen")
        table.add_row("exit", "Quit the shell")

        console.print(Panel(table, title="[bold]Commands[/bold]", border_style="bright_magenta", padding=(0, 2)))

    def cmd_status(self, args: str) -> None:
        st = self.api.status()
        mode = st.get("mode", "unknown")
        branch = st.get("branch_name") or st.get("origin_branch") or "—"
        is_merge = st.get("head_is_merge", False)
        parents = st.get("head_parent_ids", [])
        phase_name, phase_desc = _phase_for_branch(branch)

        mode_style = "[yellow]detached[/yellow]" if mode == "detached" else f"[green]{mode}[/green]"

        lines = [
            f"  [bold]Mode[/bold]         {mode_style}",
            f"  [bold]Branch[/bold]       [cyan]{branch}[/cyan]",
            f"  [bold]HEAD[/bold]         [green]{_short(st.get('head_commit_id'))}[/green]  {st.get('head_message') or '—'}",
            f"  [bold]Session[/bold]      [dim]{_short(st.get('session_id'))}[/dim]",
            f"  [bold]Memories[/bold]     {st.get('active_memory_count', 0)} active  ({_breakdown(st.get('memory_breakdown', {}))})",
            f"  [bold]Phase[/bold]        {phase_name}",
        ]
        if is_merge:
            lines.append(f"  [bold]Merge HEAD[/bold]   [green]yes[/green] ({', '.join(_short(p) for p in parents)})")
        if mode == "detached":
            lines.append(f"  [dim]  Historical snapshot — AI knows only what existed at this point[/dim]")
        if self.linked_project:
            lines.append(f"  [bold]Project[/bold]      [dim]{Path(self.linked_project).name}[/dim]")

        console.print(Panel("\n".join(lines), title="[bold]Workspace[/bold]", border_style="cyan", padding=(1, 1)))

    def cmd_branches(self, args: str) -> None:
        branches = self.api.branches()
        st = self.api.status()
        current = st.get("branch_name")

        table = Table(show_lines=False, border_style="dim", padding=(0, 1))
        table.add_column("", width=2)
        table.add_column("Branch", style="bold cyan")
        table.add_column("HEAD", style="green")
        table.add_column("Tip Message")
        table.add_column("Phase", style="dim")

        for b in branches:
            marker = "[bright_magenta]*[/bright_magenta]" if b["name"] == current else " "
            phase_name, _ = _phase_for_branch(b["name"])
            table.add_row(
                marker,
                b["name"],
                _short(b.get("head_commit_id")),
                b.get("head_message") or "[dim]no commits[/dim]",
                phase_name,
            )
        console.print(Panel(table, title="[bold]Branches[/bold]", border_style="cyan", padding=(0, 1)))

    def cmd_use(self, args: str) -> None:
        branch = args.strip()
        if not branch:
            _err("Usage: use <branch-name>")
            return
        st = self.api.status()
        self._last_branch = st.get("branch_name")
        result = self.api.attach_branch(branch, reuse_session=False)
        new_st = result.get("status", {})
        phase_name, phase_desc = _phase_for_branch(branch)
        console.print(Panel(
            f"  [bold]Branch[/bold]   [cyan]{branch}[/cyan]\n"
            f"  [bold]HEAD[/bold]     [green]{_short(new_st.get('head_commit_id'))}[/green]\n"
            f"  [bold]Session[/bold]  [dim]{_short(new_st.get('session_id'))}[/dim]\n"
            f"  [bold]Memories[/bold] {new_st.get('active_memory_count', 0)} active\n"
            f"  [bold]Phase[/bold]    {phase_name}\n"
            f"  [dim]{phase_desc}[/dim]",
            title=f"[bold green]Attached → {branch}[/bold green]",
            border_style="green",
            padding=(1, 1),
        ))

    def cmd_back(self, args: str) -> None:
        if not self._last_branch:
            _err("No previous branch to return to. Use: use <branch-name>")
            return
        self.cmd_use(self._last_branch)

    def cmd_head(self, args: str) -> None:
        st = self.api.status()
        cid = st.get("head_commit_id")
        if not cid:
            _err("No HEAD commit.")
            return
        lines = [
            f"  [bold]Commit[/bold]    [green]{_short(cid)}[/green]",
            f"  [bold]Message[/bold]   {st.get('head_message') or '—'}",
            f"  [bold]Summary[/bold]   {st.get('head_summary') or '—'}",
            f"  [bold]Branch[/bold]    [cyan]{st.get('branch_name') or st.get('origin_branch') or '—'}[/cyan]",
            f"  [bold]Merge[/bold]     {'[green]yes[/green]' if st.get('head_is_merge') else 'no'}",
        ]
        if st.get("head_parent_ids"):
            lines.append(f"  [bold]Parents[/bold]   {', '.join(_short(p) for p in st['head_parent_ids'])}")
        console.print(Panel("\n".join(lines), title="[bold]HEAD[/bold]", border_style="green", padding=(1, 1)))

    def cmd_log(self, args: str) -> None:
        commits = self.api.log(args.strip() or None)
        if not commits:
            console.print("  [dim]No commits found.[/dim]")
            return

        table = Table(show_lines=False, border_style="dim", padding=(0, 1))
        table.add_column("Commit", style="green", min_width=10)
        table.add_column("When", style="cyan")
        table.add_column("Kind", style="yellow")
        table.add_column("Message")
        table.add_column("Δ", justify="right", style="dim")

        for c in commits:
            kind = "[green]merge[/green]" if c.get("is_merge") else "commit"
            table.add_row(
                _short(c["id"]),
                _ts(c.get("created_at")),
                kind,
                c.get("message") or "—",
                str(c.get("memory_delta_count", 0)),
            )
        console.print(Panel(table, title="[bold]Commit History[/bold]", border_style="cyan", padding=(0, 1)))

    def cmd_timeline(self, args: str) -> None:
        st = self.api.status()
        branch = args.strip() or st.get("branch_name") or st.get("origin_branch") or "main"
        head_id = st.get("head_commit_id")
        entries = self.api.timeline(branch)

        if not entries:
            console.print(f"  [dim]No commits on {branch}.[/dim]")
            return

        lines = [f"  [bold cyan]{branch}[/bold cyan]\n"]
        for i, entry in enumerate(entries):
            c = entry["commit"]
            cid = _short(c["id"])
            is_merge = c.get("is_merge", False)
            is_head = c["id"] == head_id
            is_last = i == len(entries) - 1

            if is_merge:
                node = "[green]◆[/green]"
            elif is_head:
                node = "[bright_magenta]●[/bright_magenta]"
            else:
                node = "[dim]○[/dim]"

            head_tag = " [bright_magenta]← HEAD[/bright_magenta]" if is_head else ""
            merge_tag = " [green]merge[/green]" if is_merge else ""
            line = f"  {node}  [green]{cid}[/green]  {c.get('message') or '—'}{merge_tag}{head_tag}"
            lines.append(line)

            if not is_last:
                lines.append("  [dim]│[/dim]")

        console.print(Panel("\n".join(lines), title="[bold]Timeline[/bold]", border_style="cyan", padding=(1, 1)))

    def cmd_graph(self, args: str) -> None:
        st = self.api.status()
        branch = args.strip() or st.get("branch_name") or st.get("origin_branch") or "main"
        head_id = st.get("head_commit_id")
        graph = self.api.graph_branch(branch)

        nodes = graph.get("nodes", [])
        edges = graph.get("edges", [])

        commits = []
        memories = []
        for n in nodes:
            label = n.get("label", "")
            if label == "Commit":
                commits.append(n)
            elif label == "Memory":
                memories.append(n)

        commits.sort(key=lambda c: c.get("properties", {}).get("createdAt", ""), reverse=True)

        tree = Tree(f"[bold bright_magenta]◈ {branch}[/bold bright_magenta]  [dim]({len(commits)} commits, {len(memories)} memories)[/dim]")

        for c in commits:
            props = c.get("properties", {})
            cid = _short(c.get("id"))
            msg = props.get("message", "—")
            is_merge = props.get("isMerge", False) or props.get("is_merge", False)
            parent_ids = props.get("parentIds", []) or props.get("parent_ids", [])
            is_head = c.get("id") == head_id

            icon = "◆" if is_merge else "●" if is_head else "○"
            color = "green" if is_merge else "bright_magenta" if is_head else "dim"
            head_tag = " ← HEAD" if is_head else ""
            merge_info = f" [dim]({len(parent_ids)} parents)[/dim]" if is_merge else ""

            commit_node = tree.add(f"[{color}]{icon}[/{color}] [{color}]{cid}[/{color}]  {msg}{merge_info}{head_tag}")

            linked_mem_ids = set()
            for e in edges:
                if e.get("source") == c.get("id") or e.get("target") == c.get("id"):
                    other = e["target"] if e["source"] == c.get("id") else e["source"]
                    for m in memories:
                        if m.get("id") == other:
                            linked_mem_ids.add(m["id"])

            linked = [m for m in memories if m.get("id") in linked_mem_ids]
            if linked:
                types_count: dict[str, int] = {}
                for m in linked:
                    t = m.get("properties", {}).get("type", m.get("type", "fact"))
                    types_count[t] = types_count.get(t, 0) + 1
                summary = ", ".join(f"{cnt} {t}" for t, cnt in types_count.items())
                commit_node.add(f"[dim]{summary}[/dim]")

        console.print(Panel(tree, title="[bold]Memory Graph[/bold]", border_style="cyan", padding=(1, 1)))

    def cmd_diff(self, args: str) -> None:
        parts = args.strip().split()
        if len(parts) >= 2:
            ref_a, ref_b = parts[0], parts[1]
        elif len(parts) == 1:
            ref_a = parts[0]
            ref_b = "graphql-exploration" if ref_a == "main" else "main"
        else:
            st = self.api.status()
            ref_a = st.get("branch_name") or "main"
            ref_b = "graphql-exploration" if ref_a == "main" else "main"

        diff = self.api.diff(ref_a, ref_b)
        only_a = diff.get("only_a", [])
        only_b = diff.get("only_b", [])

        console.print(Rule(f"[bold]Diff: {ref_a}  ↔  {ref_b}[/bold]", style="cyan"))
        console.print(f"  [bold]{ref_a}[/bold] has [magenta]{len(only_a)}[/magenta] unique memories")
        console.print(f"  [bold]{ref_b}[/bold] has [magenta]{len(only_b)}[/magenta] unique memories")
        console.print()

        def _mem_block(mems: list[dict], title: str, color: str) -> Panel:
            if not mems:
                return Panel("[dim]No unique memories[/dim]", title=title, border_style=color, padding=(1, 1))
            parts = []
            for m in mems[:6]:
                icon = TYPE_ICONS.get(m.get("type", "fact"), "●")
                tc = TYPE_COLORS.get(m.get("type", "fact"), "white")
                parts.append(f"  [{tc}]{icon}[/{tc}] [{tc}]{m.get('type', 'fact')}[/{tc}]")
                parts.append(f"    {m.get('content', '—')}")
                parts.append("")
            return Panel("\n".join(parts).rstrip(), title=title, border_style=color, padding=(1, 1))

        console.print(Columns([
            _mem_block(only_a, f"Only on {ref_a}", "red"),
            _mem_block(only_b, f"Only on {ref_b}", "green"),
        ], equal=True, expand=True))

    def cmd_snapshot(self, args: str) -> None:
        commit_id = args.strip()
        if not commit_id or commit_id.upper() == "HEAD":
            st = self.api.status()
            commit_id = st.get("head_commit_id", "")
        if not commit_id:
            _err("No commit specified and no HEAD available.")
            return

        snap = self.api.commit_snapshot(commit_id)
        c = snap.get("commit", {})
        is_merge = snap.get("is_merge", False)
        parents = snap.get("parent_ids", [])
        branch = snap.get("branch_name", "—")
        mem_count = snap.get("active_memory_count", 0)
        bd = snap.get("memory_breakdown", {})
        phase_name, phase_desc = _phase_for_branch(branch)

        # ── Commit metadata ──
        lines = [
            f"  [bold]Commit[/bold]       [green]{_short(c.get('id'))}[/green]",
            f"  [bold]Message[/bold]      {c.get('message') or '—'}",
            f"  [bold]Timestamp[/bold]    {_ts(c.get('created_at'))}",
            f"  [bold]Branch[/bold]       [cyan]{branch}[/cyan]",
            f"  [bold]Author[/bold]       {c.get('user_id') or '—'}",
        ]
        if parents:
            lines.append(f"  [bold]Parents[/bold]      {', '.join(_short(p) for p in parents)}")
        if is_merge:
            lines.append(f"  [bold]Merge[/bold]        [green]yes[/green]  from {snap.get('merged_from_branch') or '—'}")
        if snap.get("compaction_snapshot_count", 0):
            lines.append(f"  [bold]Compactions[/bold]  {snap['compaction_snapshot_count']}")

        console.print(Panel("\n".join(lines), title="[bold]Snapshot[/bold]", border_style="bright_magenta", padding=(1, 1)))

        # ── Agent state summary ──
        agent_lines = [
            f"  [bold bright_magenta]{snap.get('context_summary', '—')}[/bold bright_magenta]",
            "",
            f"  The AI has [bold]{mem_count}[/bold] active memories: {_breakdown(bd)}",
            f"  Phase: [bold]{phase_name}[/bold] — {phase_desc}",
        ]
        if is_merge:
            agent_lines.append("  This is a [green]merge point[/green] — knowledge from multiple branches combined.")
        console.print(Panel("\n".join(agent_lines), title="[bold]Agent State at This Point[/bold]", border_style="magenta", padding=(1, 1)))

        # ── Memory groups ──
        grouped = snap.get("grouped_memories", {})
        type_order = ["decision", "fact", "action_item", "question", "context"]
        for mem_type in type_order:
            items = grouped.get(mem_type, [])
            if not items:
                continue
            icon = TYPE_ICONS.get(mem_type, "●")
            color = TYPE_COLORS.get(mem_type, "white")
            label = mem_type.replace("_", " ").title()
            mem_lines = []
            for m in items:
                tags = ", ".join(m.get("tags", []))
                tag_str = f" [dim][{tags}][/dim]" if tags else ""
                mem_lines.append(f"  {icon} {m.get('content', '—')}{tag_str}")
            console.print(Panel(
                "\n".join(mem_lines),
                title=f"[{color}]{label} ({len(items)})[/{color}]",
                border_style=color,
                padding=(0, 1),
            ))

        # ── Project context ──
        if self.linked_project:
            docs = _docs_for_branch(branch)
            project_path = Path(self.linked_project)
            existing = [d for d in docs if (project_path / d).exists()]
            if existing:
                doc_list = "  ".join(f"[dim]{d}[/dim]" for d in existing)
                console.print(f"  [bold]Relevant docs:[/bold]  {doc_list}")

        # ── Next steps ──
        console.print(f"\n  [dim]→ rewind {_short(c.get('id'))}[/dim]   [dim]time-travel to this point[/dim]")
        console.print(f"  [dim]→ ask ...[/dim]            [dim]query the AI from current state[/dim]")

    def cmd_rewind(self, args: str) -> None:
        commit_id = args.strip()
        if not commit_id:
            _err("Usage: rewind <commit-id>")
            return

        st = self.api.status()
        self._last_branch = st.get("branch_name")

        result = self.api.checkout(commit_id)
        new_st = result.get("status", {})
        branch = new_st.get("origin_branch") or new_st.get("branch_name") or "—"
        mem_count = new_st.get("active_memory_count", 0)
        bd = new_st.get("memory_breakdown", {})
        phase_name, phase_desc = _phase_for_branch(branch)

        console.print(Panel(
            f"  [bold]Mode[/bold]        [yellow]detached[/yellow]  (historical snapshot)\n"
            f"  [bold]Origin[/bold]      [cyan]{branch}[/cyan]\n"
            f"  [bold]HEAD[/bold]        [green]{_short(result.get('commit_id'))}[/green]\n"
            f"  [bold]Session[/bold]     [dim]{_short(result.get('session_id'))}[/dim]\n"
            f"  [bold]Memories[/bold]    {mem_count} active  ({_breakdown(bd)})\n"
            f"  [bold]Phase[/bold]       {phase_name}\n\n"
            f"  [bold bright_magenta]Time-travel active.[/bold bright_magenta]\n"
            f"  The AI now knows [bold]only[/bold] what existed at this point in history.\n"
            f"  Later decisions, facts, and context are invisible.\n\n"
            f"  [dim]→ ask ...[/dim]     query the AI from this historical state\n"
            f"  [dim]→ context[/dim]     see exactly what the AI knows\n"
            f"  [dim]→ snapshot HEAD[/dim]  inspect memories at this point\n"
            f"  [dim]→ back[/dim]        return to {self._last_branch or 'previous branch'}",
            title="[bold bright_magenta]Rewound[/bold bright_magenta]",
            border_style="bright_magenta",
            padding=(1, 1),
        ))

    def cmd_ask(self, args: str) -> None:
        question = args.strip()
        if not question:
            _err("Usage: ask <question>")
            return
        self._do_chat(question)

    def cmd_context(self, args: str) -> None:
        st = self.api.status()
        branch = st.get("branch_name") or st.get("origin_branch") or "main"
        mem_count = st.get("active_memory_count", 0)
        bd = st.get("memory_breakdown", {})
        mode = st.get("mode", "unknown")
        phase_name, phase_desc = _phase_for_branch(branch)

        lines = [
            f"  [bold]Branch[/bold]      [cyan]{branch}[/cyan]  ({'[yellow]detached[/yellow]' if mode == 'detached' else '[green]attached[/green]'})",
            f"  [bold]HEAD[/bold]        [green]{_short(st.get('head_commit_id'))}[/green]  {st.get('head_message') or '—'}",
            f"  [bold]Memories[/bold]    [bold]{mem_count}[/bold] active  ({_breakdown(bd)})",
            f"  [bold]Phase[/bold]       {phase_name}",
        ]
        if mode == "detached":
            lines.append(f"\n  [bold yellow]Historical snapshot[/bold yellow] — AI sees only this point in time.")
        else:
            lines.append(f"\n  [bold green]Live[/bold green] — AI has full branch context up to HEAD.")

        # Fetch and show memories by type
        try:
            memories = self.api.memories(branch)
        except ApiError:
            memories = []

        if memories:
            lines.append("")
            grouped: dict[str, list] = {}
            for m in memories:
                grouped.setdefault(m.get("type", "fact"), []).append(m)

            for mem_type in ("decision", "fact", "action_item", "question"):
                items = grouped.get(mem_type, [])
                if items:
                    color = TYPE_COLORS.get(mem_type, "white")
                    icon = TYPE_ICONS.get(mem_type, "●")
                    label = mem_type.replace("_", " ").title()
                    lines.append(f"  [{color}]{icon} {label}:[/{color}]")
                    for m in items[:3]:
                        lines.append(f"    [dim]•[/dim] {m.get('content', '—')}")
                    if len(items) > 3:
                        lines.append(f"    [dim]... and {len(items) - 3} more[/dim]")

        console.print(Panel("\n".join(lines), title="[bold]AI Context[/bold]", border_style="bright_magenta", padding=(1, 1)))

    def cmd_memories(self, args: str) -> None:
        st = self.api.status()
        branch = st.get("branch_name") or st.get("origin_branch") or "main"
        type_filter = args.strip().lower() or None

        memories = self.api.memories(branch)
        if type_filter:
            memories = [m for m in memories if m.get("type") == type_filter]

        if not memories:
            label = f" ({type_filter})" if type_filter else ""
            console.print(f"  [dim]No memories{label} on {branch}.[/dim]")
            return

        grouped: dict[str, list] = {}
        for m in memories:
            grouped.setdefault(m.get("type", "fact"), []).append(m)

        for mem_type in ("decision", "fact", "context", "action_item", "question"):
            items = grouped.get(mem_type, [])
            if not items:
                continue
            color = TYPE_COLORS.get(mem_type, "white")
            icon = TYPE_ICONS.get(mem_type, "●")
            label = mem_type.replace("_", " ").title()
            mem_lines = []
            for m in items:
                tags = ", ".join(m.get("tags", []))
                tag_str = f" [dim][{tags}][/dim]" if tags else ""
                mem_lines.append(f"  {icon} {m.get('content', '—')}{tag_str}")
            console.print(Panel(
                "\n".join(mem_lines),
                title=f"[{color}]{label} ({len(items)})[/{color}]",
                border_style=color,
                padding=(0, 1),
            ))

    def cmd_llm(self, args: str) -> None:
        st = self.api.status()
        branch = st.get("branch_name") or st.get("origin_branch") or "—"

        mode = "unknown"
        notice = None
        try:
            resp = self.api.chat("ping")
            mode = resp.get("response_mode", "unknown")
            notice = resp.get("notice")
        except ApiError:
            mode = "unreachable"

        mode_style = {
            "live": "[green]live[/green]  — Claude API responding",
            "fallback": "[yellow]fallback[/yellow]  — Memory-grounded synthesis",
            "mock": "[yellow]mock[/yellow]  — Simulated responses from memory state",
            "unreachable": "[red]unreachable[/red]  — Chat endpoint failed",
        }

        lines = [
            f"  [bold]Provider[/bold]    {mode_style.get(mode, mode)}",
            f"  [bold]Branch[/bold]      [cyan]{branch}[/cyan]",
            f"  [bold]Memories[/bold]    {st.get('active_memory_count', 0)} active",
            "",
            "  Answers are grounded in the versioned memory graph",
            "  regardless of provider status.",
        ]
        if notice:
            lines.append(f"\n  [dim]{notice}[/dim]")

        console.print(Panel("\n".join(lines), title="[bold]LLM Status[/bold]", border_style="cyan", padding=(1, 1)))

    def cmd_verify(self, args: str) -> None:
        console.print(Panel("[bold]System Check[/bold]", border_style="cyan"))
        passed = 0
        total = 0

        def check(label: str, ok: bool, detail: str = "") -> None:
            nonlocal passed, total
            total += 1
            icon = "[green]PASS[/green]" if ok else "[red]FAIL[/red]"
            suffix = f"  [dim]{detail}[/dim]" if detail else ""
            console.print(f"  {icon}  {label}{suffix}")
            if ok:
                passed += 1

        try:
            h = self.api.health()
            check("Backend + Neo4j", h.get("status") == "ok" and str(h.get("neo4j", "")).startswith("connected"))
        except ApiError as e:
            check("Backend + Neo4j", False, str(e))

        try:
            st = self.api.status()
            check("Workspace", st.get("mode") != "uninitialized", f"mode={st.get('mode')}")
        except ApiError as e:
            check("Workspace", False, str(e))

        try:
            br = self.api.branches()
            names = {b["name"] for b in br}
            # Accept both "merged" and "merged-demo" for backward compat
            merged_ok = "merged" in names or "merged-demo" in names
            check("Branches", "main" in names and "graphql-exploration" in names and merged_ok, ", ".join(sorted(names)))
        except ApiError as e:
            check("Branches", False, str(e))

        try:
            d = self.api.diff("main", "graphql-exploration")
            check("Diff", bool(d.get("only_a")) and bool(d.get("only_b")), f"{len(d.get('only_a', []))} vs {len(d.get('only_b', []))}")
        except ApiError as e:
            check("Diff", False, str(e))

        try:
            tl = self.api.timeline("main")
            check("Timeline", len(tl) >= 2, f"{len(tl)} commits")
        except ApiError as e:
            check("Timeline", False, str(e))

        # Find the merged branch (either name)
        merged_branch = "merged"
        try:
            br = self.api.branches()
            names = {b["name"] for b in br}
            if "merged" not in names and "merged-demo" in names:
                merged_branch = "merged-demo"
        except ApiError:
            pass

        try:
            tl = self.api.timeline(merged_branch)
            if tl:
                snap = self.api.commit_snapshot(tl[-1]["commit"]["id"])
                check("Snapshot", snap.get("active_memory_count", 0) > 0, f"{snap.get('active_memory_count', 0)} memories")
            else:
                check("Snapshot", False, "no commits")
        except ApiError as e:
            check("Snapshot", False, str(e))

        try:
            g = self.api.graph_branch(merged_branch)
            check("Graph", len(g.get("nodes", [])) > 0, f"{len(g.get('nodes', []))} nodes")
        except ApiError as e:
            check("Graph", False, str(e))

        try:
            self.api.attach_branch(merged_branch, reuse_session=False)
            r = self.api.chat("ping")
            check("Chat", bool(r.get("response")), f"mode={r.get('response_mode', '?')}")
            self.api.attach_branch("main", reuse_session=False)
        except ApiError as e:
            check("Chat", False, str(e))

        console.print()
        color = "green" if passed == total else "yellow" if passed >= total - 2 else "red"
        console.print(f"  [{color}][bold]{passed}/{total} passed[/bold][/{color}]")

    def cmd_script(self, args: str) -> None:
        script = """\
[bold cyan]═══ 90-Second Presentation ═══[/bold cyan]

  [cyan]use merged[/cyan]
  "Git for AI memory. The merged branch combines two thinking paths."

  [cyan]status[/cyan]
  "Real workspace HEAD — we know exactly what memory state the AI operates from."

  [cyan]diff main graphql-exploration[/cyan]
  "Divergent memory timelines — one chose REST, the other explored GraphQL."

  [cyan]timeline[/cyan]
  "Every commit is a snapshot of the AI's knowledge at that moment."

  [cyan]snapshot HEAD[/cyan]
  "Inspect exactly what the AI knew — grouped by type, with full context."

  [cyan]ask What API direction did we land on?[/cyan]
  "The answer comes from merged team knowledge, not raw chat history."

[bold cyan]═══ 2-Minute Presentation ═══[/bold cyan]

  [cyan]status[/cyan]  →  [cyan]branches[/cyan]  →  [cyan]timeline[/cyan]
  "RewindAI tracks AI memory like Git tracks code. Commits, branches, history."

  [cyan]diff main graphql-exploration[/cyan]
  "Alice chose REST. Bob explored GraphQL. Divergent memory timelines."

  [cyan]snapshot HEAD[/cyan]
  "This is the current agent state — every decision, fact, and question."

  [cyan]rewind <early-commit-id>[/cyan]
  "Time-travel. The AI now only knows what existed at that point."

  [cyan]ask What did we decide about the API?[/cyan]
  "It doesn't know about the merge. Historical isolation is provable."

  [cyan]back[/cyan]
  "Return to the present. Context fully restored."

  [cyan]ask What API direction did we land on?[/cyan]
  "Now it knows the merged outcome. Time-travel is real."

[bold cyan]═══ Recovery ═══[/bold cyan]

  [cyan]use merged[/cyan]    — reattach to the safe branch instantly
  [cyan]verify[/cyan]         — check all systems"""
        console.print(Panel(script, title="[bold]Presenter Script[/bold]", border_style="bright_magenta", padding=(1, 2)))

    def cmd_project(self, args: str) -> None:
        if not self.linked_project:
            console.print(Panel(
                "  No project workspace linked.\n\n"
                "  Use [cyan]link <path>[/cyan] to attach a project folder,\n"
                "  or [cyan]link[/cyan] to use the default workspace.",
                title="[bold]Project[/bold]",
                border_style="dim",
                padding=(1, 1),
            ))
            return

        project_path = Path(self.linked_project)
        st = self.api.status()
        branch = st.get("branch_name") or st.get("origin_branch") or "—"
        phase_name, phase_desc = _phase_for_branch(branch)

        # Count files
        all_files = [f for f in project_path.rglob("*") if f.is_file()]
        doc_count = sum(1 for f in all_files if f.suffix == ".md")
        py_count = sum(1 for f in all_files if f.suffix == ".py")

        # Build file tree
        tree = Tree(f"[bold cyan]{project_path.name}/[/bold cyan]")
        relevant_docs = set(_docs_for_branch(branch))

        def _add_dir(parent_tree, dir_path: Path, depth: int = 0):
            if depth > 3:
                return
            items = sorted(dir_path.iterdir(), key=lambda p: (not p.is_dir(), p.name))
            for item in items:
                if item.name.startswith(".") and item.name != ".gitignore":
                    continue
                rel = str(item.relative_to(project_path))
                if item.is_dir():
                    subtree = parent_tree.add(f"[bold]{item.name}/[/bold]")
                    _add_dir(subtree, item, depth + 1)
                else:
                    marker = " [bright_magenta]←[/bright_magenta]" if rel in relevant_docs else ""
                    parent_tree.add(f"{item.name}{marker}")

        _add_dir(tree, project_path)

        console.print(Panel(tree, title="[bold]Project Workspace[/bold]", border_style="cyan", padding=(1, 1)))

        # Phase and relevance info
        console.print(Panel(
            f"  [bold]Branch[/bold]    [cyan]{branch}[/cyan]\n"
            f"  [bold]Phase[/bold]     {phase_name}\n"
            f"  [bold]Summary[/bold]   {phase_desc}\n"
            f"  [bold]Files[/bold]     {len(all_files)} ({doc_count} docs, {py_count} source)\n\n"
            f"  [dim]Files marked with [bright_magenta]←[/bright_magenta] are relevant to the current branch.[/dim]",
            title="[bold]Project State[/bold]",
            border_style="magenta",
            padding=(1, 1),
        ))

    def cmd_guide(self, args: str) -> None:
        st = self.api.status()
        branch = st.get("branch_name") or st.get("origin_branch") or "—"

        # Find the merged branch name
        merged_name = "merged"
        try:
            br = self.api.branches()
            names = {b["name"] for b in br}
            if "merged" not in names and "merged-demo" in names:
                merged_name = "merged-demo"
        except ApiError:
            pass

        guide = f"""\
  [bold]Recommended Presentation Flow[/bold]

  [bold cyan]1.[/bold cyan] [cyan]use {merged_name}[/cyan]          switch to the merged branch
  [bold cyan]2.[/bold cyan] [cyan]status[/cyan]                workspace overview
  [bold cyan]3.[/bold cyan] [cyan]project[/cyan]               show the linked project workspace
  [bold cyan]4.[/bold cyan] [cyan]branches[/cyan]              three branches, three perspectives
  [bold cyan]5.[/bold cyan] [cyan]diff main graphql-exploration[/cyan]
                             divergent memory timelines
  [bold cyan]6.[/bold cyan] [cyan]timeline[/cyan]              commit history with merge point
  [bold cyan]7.[/bold cyan] [cyan]snapshot HEAD[/cyan]          agent state at the merge point
  [bold cyan]8.[/bold cyan] [cyan]ask What API direction did we land on?[/cyan]
                             answer grounded in merged knowledge

  [bold]Time-Travel (the wow moment):[/bold]

  [bold cyan]9.[/bold cyan] [cyan]rewind <early-commit>[/cyan]  go back in time
  [bold cyan]10.[/bold cyan] [cyan]context[/cyan]               see what the AI knows now
  [bold cyan]11.[/bold cyan] [cyan]ask What did we decide about the API?[/cyan]
                             it doesn't know about later decisions
  [bold cyan]12.[/bold cyan] [cyan]back[/cyan]                  return to the present

  [dim]Current: {branch} — type any command to begin[/dim]"""

        console.print(Panel(guide, title="[bold]Presentation Guide[/bold]", border_style="bright_magenta", padding=(1, 1)))

    def cmd_link(self, args: str) -> None:
        path = args.strip()
        if not path:
            # Try default paths
            for candidate in (
                Path(__file__).resolve().parents[2] / "showcase" / "workspace" / "public-api",
                Path(__file__).resolve().parents[2] / "demo" / "project" / "public-api-demo",
            ):
                if candidate.is_dir():
                    path = str(candidate)
                    break
            if not path:
                _err("Usage: link <path>  (no default workspace found — run prepare first)")
                return

        resolved = Path(path).expanduser().resolve()
        if not resolved.is_dir():
            _err(f"Directory not found: {resolved}")
            return

        self.linked_project = str(resolved)
        files = list(resolved.rglob("*"))
        file_count = sum(1 for f in files if f.is_file())
        doc_count = sum(1 for f in files if f.suffix == ".md")

        console.print(Panel(
            f"  [bold]Project[/bold]   {resolved.name}\n"
            f"  [bold]Path[/bold]      [dim]{resolved}[/dim]\n"
            f"  [bold]Files[/bold]     {file_count} files ({doc_count} docs)\n\n"
            f"  Type [cyan]project[/cyan] to explore the workspace.",
            title="[bold green]Project Linked[/bold green]",
            border_style="green",
            padding=(1, 1),
        ))

    def cmd_open(self, args: str) -> None:
        lines = [
            f"  [bold]Browser[/bold]     [cyan]{BROWSER_URL}[/cyan]",
            f"  [bold]Backend[/bold]     [cyan]{self.api.base_url}/health[/cyan]",
            f"  [bold]Neo4j[/bold]       [cyan]http://localhost:7474[/cyan]",
        ]
        if self.linked_project:
            lines.append(f"  [bold]Project[/bold]     [dim]{self.linked_project}[/dim]")

        console.print(Panel("\n".join(lines), title="[bold]Quick Links[/bold]", border_style="cyan", padding=(1, 1)))

        if platform.system() == "Darwin":
            try:
                subprocess.Popen(["open", BROWSER_URL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                console.print(f"  [dim]Opened {BROWSER_URL} in browser[/dim]")
            except Exception:
                pass

    def cmd_clear(self, args: str) -> None:
        console.clear()

    def cmd_exit(self, args: str) -> bool:
        console.print("  [dim]Exiting RewindAI shell.[/dim]")
        return False

    def cmd_quit(self, args: str) -> bool:
        return self.cmd_exit(args)

    # ── Chat ─────────────────────────────────────────────────────────────

    def _do_chat(self, message: str) -> None:
        st = self.api.status()
        branch = st.get("branch_name") or st.get("origin_branch") or "—"
        head = _short(st.get("head_commit_id"))
        mode = st.get("mode", "unknown")

        try:
            resp = self.api.chat(message)
        except ApiError as exc:
            _err(str(exc))
            return

        text = resp.get("response", "")
        response_mode = resp.get("response_mode", "live")
        notice = resp.get("notice")

        style = "blue" if response_mode == "live" else "yellow"
        title = "Assistant" if response_mode == "live" else "Assistant (memory-grounded)"

        context_tag = f"  [dim]{branch} @ {head}[/dim]"
        if mode == "detached":
            context_tag += "  [yellow]detached — historical snapshot[/yellow]"
        elif response_mode != "live":
            context_tag += f"  [dim yellow]({response_mode})[/dim yellow]"

        console.print(f"\n{context_tag}")
        if notice:
            console.print(f"  [dim yellow]{notice}[/dim yellow]")
        console.print(Panel(Markdown(text), title=title, border_style=style, padding=(1, 2)))

        if resp.get("compaction_occurred"):
            console.print(f"  [magenta]Context compacted — {resp.get('memories_extracted', 0)} memories extracted[/magenta]")


def run_shell(api: RewindApi) -> None:
    """Entry point for the interactive shell."""
    shell = RewindShell(api)
    shell.print_banner()

    while True:
        try:
            raw = console.input("[bold bright_magenta]rewind>[/bold bright_magenta] ")
        except (KeyboardInterrupt, EOFError):
            console.print("\n  [dim]Exiting.[/dim]")
            break
        if not shell.dispatch(raw):
            break
