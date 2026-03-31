"""Interactive RewindAI demo shell / REPL."""

from __future__ import annotations

import os
import platform
import shlex
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


# ── Shell class ──────────────────────────────────────────────────────────────

class RewindShell:
    """Interactive demo shell for RewindAI."""

    def __init__(self, api: RewindApi) -> None:
        self.api = api
        self.linked_project: str | None = None
        self._last_branch: str | None = None
        # Pre-set the default demo project if it exists
        default_project = Path(__file__).resolve().parents[2] / "demo" / "project" / "public-api-demo"
        if default_project.is_dir():
            self.linked_project = str(default_project)

    # ── Dispatch ─────────────────────────────────────────────────────────

    COMMANDS = {
        "help", "link", "status", "branches", "use", "graph", "diff",
        "timeline", "snapshot", "rewind", "ask", "context", "memories",
        "llm", "verify", "script", "open", "clear", "exit", "quit",
        "back", "head", "log",
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

        banner = (
            f"[bold bright_magenta]RewindAI Shell[/bold bright_magenta]  "
            f"[dim]git for AI memory[/dim]\n\n"
            f"  [bold]branch:[/bold] [cyan]{branch}[/cyan]   "
            f"[bold]mode:[/bold] {'[yellow]' + mode + '[/yellow]' if mode == 'detached' else mode}   "
            f"[bold]HEAD:[/bold] [green]{head}[/green]   "
            f"[bold]memories:[/bold] {mem}\n\n"
            f"  Type [cyan]help[/cyan] for commands, or just ask a question.\n"
            f"  Type [cyan]exit[/cyan] to quit."
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
        table.add_row("status", "Show workspace state, branch, HEAD, memory count")
        table.add_row("branches", "List all branches")
        table.add_row("use <branch>", "Switch to a branch")
        table.add_row("back", "Reattach to last branch after detached rewind")
        table.add_row("head", "Show current HEAD commit details")
        table.add_row("", "")
        table.add_row("[dim]── History ──[/dim]", "")
        table.add_row("log", "Show commit log for current branch")
        table.add_row("timeline", "Visual commit timeline with merge badges")
        table.add_row("graph", "ASCII DAG of the current branch graph")
        table.add_row("diff [a] [b]", "Compare two branches side-by-side")
        table.add_row("snapshot [id]", "Inspect AI memory at a commit")
        table.add_row("rewind <id>", "Checkout a historical snapshot (detached)")
        table.add_row("", "")
        table.add_row("[dim]── Memory ──[/dim]", "")
        table.add_row("context", "Summary of what the AI knows right now")
        table.add_row("memories [type]", "List memory items, optionally filtered by type")
        table.add_row("ask <question>", "One-shot question from current memory state")
        table.add_row("[dim]<freeform text>[/dim]", "[dim]Also sends as a chat question[/dim]")
        table.add_row("", "")
        table.add_row("[dim]── Demo ──[/dim]", "")
        table.add_row("llm", "Show model / fallback status")
        table.add_row("verify", "Run demo smoke-test checklist")
        table.add_row("script", "Print the presenter demo script")
        table.add_row("link [path]", "Link a demo project folder")
        table.add_row("open", "Print useful URLs and paths")
        table.add_row("", "")
        table.add_row("[dim]── Utility ──[/dim]", "")
        table.add_row("clear", "Clear the screen")
        table.add_row("exit", "Quit the shell")

        console.print(Panel(table, title="[bold]RewindAI Shell Commands[/bold]", border_style="bright_magenta", padding=(0, 2)))

    def cmd_status(self, args: str) -> None:
        st = self.api.status()
        mode = st.get("mode", "unknown")
        branch = st.get("branch_name") or st.get("origin_branch") or "—"
        is_merge = st.get("head_is_merge", False)
        parents = st.get("head_parent_ids", [])

        mode_style = "[yellow]detached[/yellow]" if mode == "detached" else f"[green]{mode}[/green]"

        lines = [
            f"  [bold]Mode[/bold]         {mode_style}",
            f"  [bold]Branch[/bold]       [cyan]{branch}[/cyan]",
            f"  [bold]HEAD[/bold]         [green]{_short(st.get('head_commit_id'))}[/green]",
            f"  [bold]Message[/bold]      {st.get('head_message') or '—'}",
            f"  [bold]Session[/bold]      [dim]{_short(st.get('session_id'))}[/dim]",
            f"  [bold]Memories[/bold]     {st.get('active_memory_count', 0)} active",
            f"  [bold]Breakdown[/bold]    {_breakdown(st.get('memory_breakdown', {}))}",
        ]
        if is_merge:
            lines.append(f"  [bold]Merge HEAD[/bold]   [green]yes[/green] ({', '.join(_short(p) for p in parents)})")
        if self.linked_project:
            lines.append(f"  [bold]Project[/bold]      [dim]{self.linked_project}[/dim]")

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
        table.add_column("From", style="dim")

        for b in branches:
            marker = "[bright_magenta]*[/bright_magenta]" if b["name"] == current else " "
            table.add_row(
                marker,
                b["name"],
                _short(b.get("head_commit_id")),
                b.get("head_message") or "[dim]no commits[/dim]",
                _short(b.get("branched_from_commit_id")),
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
        console.print(Panel(
            f"  [bold]Branch[/bold]   [cyan]{branch}[/cyan]\n"
            f"  [bold]HEAD[/bold]     [green]{_short(new_st.get('head_commit_id'))}[/green]\n"
            f"  [bold]Session[/bold]  [dim]{_short(new_st.get('session_id'))}[/dim]\n"
            f"  [bold]Memories[/bold] {new_st.get('active_memory_count', 0)} active",
            title=f"[bold green]Attached to {branch}[/bold green]",
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

            # Build the node symbol
            if is_merge:
                node = "[green]◆[/green]"
            elif is_head:
                node = "[bright_magenta]●[/bright_magenta]"
            else:
                node = "[dim]○[/dim]"

            # Build the line
            head_tag = " [bright_magenta]← HEAD[/bright_magenta]" if is_head else ""
            merge_tag = " [green]merge[/green]" if is_merge else ""
            line = f"  {node}  [green]{cid}[/green]  {c.get('message') or '—'}{merge_tag}{head_tag}"
            lines.append(line)

            # Connector
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

        # Classify nodes
        commits = []
        memories = []
        branch_nodes = []
        for n in nodes:
            label = n.get("label", "")
            if label == "Commit":
                commits.append(n)
            elif label == "Memory":
                memories.append(n)
            elif label == "Branch":
                branch_nodes.append(n)

        # Sort commits by createdAt
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

            # Find memories linked to this commit via edges
            linked_mem_ids = set()
            for e in edges:
                if e.get("source") == c.get("id") or e.get("target") == c.get("id"):
                    other = e["target"] if e["source"] == c.get("id") else e["source"]
                    for m in memories:
                        if m.get("id") == other:
                            linked_mem_ids.add(m["id"])

            # Show a compact summary of linked memories
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

        # Summary
        console.print(Rule(f"[bold]Diff: {ref_a} vs {ref_b}[/bold]", style="cyan"))
        console.print(f"  [bold]{ref_a}[/bold] has [magenta]{len(only_a)}[/magenta] unique memories")
        console.print(f"  [bold]{ref_b}[/bold] has [magenta]{len(only_b)}[/magenta] unique memories")
        console.print()

        # Side by side panels
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

        # Header
        lines = [
            f"  [bold]Commit[/bold]      [green]{_short(c.get('id'))}[/green]",
            f"  [bold]Message[/bold]     {c.get('message') or '—'}",
            f"  [bold]Timestamp[/bold]   {_ts(c.get('created_at'))}",
            f"  [bold]Branch[/bold]      [cyan]{snap.get('branch_name', '—')}[/cyan]",
            f"  [bold]Author[/bold]      {c.get('user_id') or '—'}",
        ]
        if parents:
            lines.append(f"  [bold]Parents[/bold]     {', '.join(_short(p) for p in parents)}")
        if is_merge:
            lines.append(f"  [bold]Merge[/bold]       [green]yes[/green]  from {snap.get('merged_from_branch') or '—'}")
        if snap.get("compaction_snapshot_count", 0):
            lines.append(f"  [bold]Compactions[/bold] {snap['compaction_snapshot_count']}")
        lines.append("")
        lines.append(f"  [bold bright_magenta]{snap.get('context_summary', '—')}[/bold bright_magenta]")

        console.print(Panel("\n".join(lines), title="[bold]Snapshot[/bold]", border_style="bright_magenta", padding=(1, 1)))

        # Memory groups
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

        console.print(Panel(
            f"  [bold]Mode[/bold]       [yellow]detached[/yellow]  (historical snapshot)\n"
            f"  [bold]Origin[/bold]     [cyan]{branch}[/cyan]\n"
            f"  [bold]HEAD[/bold]       [green]{_short(result.get('commit_id'))}[/green]\n"
            f"  [bold]Session[/bold]    [dim]{_short(result.get('session_id'))}[/dim]\n"
            f"  [bold]Memories[/bold]   {mem_count} active\n\n"
            f"  The AI now knows [bold]only[/bold] what existed at this point.\n"
            f"  Ask a question to test historical isolation.\n"
            f"  Type [cyan]back[/cyan] to reattach to {self._last_branch or 'a branch'}.",
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

        lines = [
            f"  [bold]The AI currently operates from:[/bold]",
            f"  Branch [cyan]{branch}[/cyan] in [{'yellow' if mode == 'detached' else 'green'}]{mode}[/] mode",
            f"  HEAD: [green]{_short(st.get('head_commit_id'))}[/green] — {st.get('head_message') or '—'}",
            f"  [bold]{mem_count}[/bold] active memories: {_breakdown(bd)}",
        ]

        # Fetch and show top items per type
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

        # Quick chat probe
        mode = "unknown"
        notice = None
        try:
            resp = self.api.chat("ping")
            mode = resp.get("response_mode", "unknown")
            notice = resp.get("notice")
        except ApiError:
            mode = "unreachable"

        mode_style = {
            "live": "[green]live[/green]  — Anthropic Claude API responding",
            "fallback": "[yellow]fallback[/yellow]  — Memory-grounded demo synthesis",
            "mock": "[yellow]mock[/yellow]  — Simulated responses from memory state",
            "unreachable": "[red]unreachable[/red]  — Backend chat endpoint failed",
        }

        lines = [
            f"  [bold]Provider[/bold]    {mode_style.get(mode, mode)}",
            f"  [bold]Branch[/bold]      [cyan]{branch}[/cyan]",
            f"  [bold]Memories[/bold]    {st.get('active_memory_count', 0)} active",
            "",
            "  Answers remain grounded in the versioned memory graph",
            "  regardless of provider status.",
        ]
        if notice:
            lines.append(f"\n  [dim]{notice}[/dim]")

        console.print(Panel("\n".join(lines), title="[bold]LLM Status[/bold]", border_style="cyan", padding=(1, 1)))

    def cmd_verify(self, args: str) -> None:
        console.print(Panel("[bold]Demo Verify[/bold]", border_style="cyan"))
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
            check("Branches", all(b in names for b in ("main", "graphql-exploration", "merged-demo")), ", ".join(sorted(names)))
        except ApiError as e:
            check("Branches", False, str(e))

        try:
            d = self.api.diff("main", "graphql-exploration")
            check("Diff", bool(d.get("only_a")) and bool(d.get("only_b")), f"{len(d.get('only_a',[]))} vs {len(d.get('only_b',[]))}")
        except ApiError as e:
            check("Diff", False, str(e))

        try:
            tl = self.api.timeline("main")
            check("Timeline", len(tl) >= 2, f"{len(tl)} commits")
        except ApiError as e:
            check("Timeline", False, str(e))

        try:
            tl = self.api.timeline("merged-demo")
            if tl:
                snap = self.api.commit_snapshot(tl[-1]["commit"]["id"])
                check("Snapshot", snap.get("active_memory_count", 0) > 0, f"{snap.get('active_memory_count', 0)} memories")
            else:
                check("Snapshot", False, "no commits")
        except ApiError as e:
            check("Snapshot", False, str(e))

        try:
            g = self.api.graph_branch("merged-demo")
            check("Graph", len(g.get("nodes", [])) > 0, f"{len(g.get('nodes', []))} nodes")
        except ApiError as e:
            check("Graph", False, str(e))

        try:
            self.api.attach_branch("merged-demo", reuse_session=False)
            r = self.api.chat("ping")
            check("Chat", bool(r.get("response")), f"mode={r.get('response_mode', '?')}")
            self.api.attach_branch("main", reuse_session=False)
        except ApiError as e:
            check("Chat", False, str(e))

        console.print()
        color = "green" if passed == total else "yellow" if passed >= total - 2 else "red"
        console.print(f"  [{color}][bold]{passed}/{total} passed[/bold][/{color}]")

    def cmd_script(self, args: str) -> None:
        user = self.api.user_id
        script = f"""\
[bold cyan]═══ Safe Demo (90 seconds) ═══[/bold cyan]

  [cyan]use merged-demo[/cyan]
  Say: "Git for AI memory. The merged branch combines two thinking paths."

  [cyan]status[/cyan]
  Say: "The workspace has a real HEAD, branch, and memory count."

  [cyan]diff main graphql-exploration[/cyan]
  Say: "These are divergent memory timelines — REST vs GraphQL."

  [cyan]timeline[/cyan]
  Say: "Every commit is a snapshot of the AI's knowledge."

  [cyan]snapshot HEAD[/cyan]
  Say: "Click any commit and inspect what the AI knew — grouped by type."

  [cyan]ask What API direction did we land on?[/cyan]
  Say: "The answer comes from merged team knowledge, not raw chat."

[bold cyan]═══ Rescue ═══[/bold cyan]

  [cyan]use merged-demo[/cyan]
  This reattaches to the safe branch instantly."""
        console.print(Panel(script, title="[bold]Presenter Script[/bold]", border_style="bright_magenta", padding=(1, 2)))

    def cmd_link(self, args: str) -> None:
        path = args.strip()
        if not path:
            default = Path(__file__).resolve().parents[2] / "demo" / "project" / "public-api-demo"
            if default.is_dir():
                path = str(default)
            else:
                _err("Usage: link <path>  (or just `link` if demo project exists)")
                return

        resolved = Path(path).expanduser().resolve()
        if not resolved.is_dir():
            _err(f"Directory not found: {resolved}")
            return

        self.linked_project = str(resolved)
        # Count files
        files = list(resolved.rglob("*"))
        file_count = sum(1 for f in files if f.is_file())
        doc_count = sum(1 for f in files if f.suffix == ".md")

        console.print(Panel(
            f"  [bold]Project[/bold]   {resolved.name}\n"
            f"  [bold]Path[/bold]      [dim]{resolved}[/dim]\n"
            f"  [bold]Files[/bold]     {file_count} files ({doc_count} docs)\n\n"
            f"  This is the visual project context for the demo session.",
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

        docs = Path(__file__).resolve().parents[2] / "docs" / "demo.md"
        if docs.exists():
            lines.append(f"  [bold]Demo Docs[/bold]   [dim]{docs}[/dim]")

        console.print(Panel("\n".join(lines), title="[bold]Quick Links[/bold]", border_style="cyan", padding=(1, 1)))

        # Try to open browser on macOS
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

        try:
            resp = self.api.chat(message)
        except ApiError as exc:
            _err(str(exc))
            return

        text = resp.get("response", "")
        mode = resp.get("response_mode", "live")
        notice = resp.get("notice")

        style = "blue" if mode == "live" else "yellow"
        title = "Assistant" if mode == "live" else "Assistant (memory-grounded)"

        console.print(f"\n  [dim]{branch} @ {head}[/dim]" + (f"  [dim yellow]({mode})[/dim yellow]" if mode != "live" else ""))
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
