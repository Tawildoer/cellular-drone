"""MkDocs hook: the status page's progress table, counted from docs/PLAN.md.

PLAN.md stays the one place checkboxes are ticked (CLAUDE.md); this only
reads it, so the site can't drift from the plan. A section is a `## Phase`
or, inside Phase 1, each `###` sub-phase. Nested checkboxes count too.
"""

import re
from pathlib import Path

MARKER = "<!-- plan-progress -->"
HEADING = re.compile(r"^(##|###) (.+?)\s*$")
BOX = re.compile(r"^\s*- \[( |x|~)\]")
BAR_WIDTH = 10


def _sections(plan: str) -> list[tuple[str, dict[str, int]]]:
    sections: list[tuple[str, dict[str, int]]] = []
    current: dict[str, int] | None = None
    for line in plan.splitlines():
        heading = HEADING.match(line)
        if heading:
            level, title = heading.groups()
            # A `##` with `###` children (Phase 1) only labels them.
            title = re.sub(r"\s*←.*$", "", title).split(" (")[0].rstrip(".")
            current = {"done": 0, "doing": 0, "todo": 0}
            sections.append((("" if level == "##" else "↳ ") + title, current))
            continue
        box = BOX.match(line)
        if box and current is not None:
            current[{"x": "done", "~": "doing", " ": "todo"}[box.group(1)]] += 1
    return [(title, counts) for title, counts in sections if sum(counts.values()) > 0]


def _bar(done: int, doing: int, total: int) -> str:
    filled = round(BAR_WIDTH * done / total)
    half = min(BAR_WIDTH - filled, round(BAR_WIDTH * doing / total))
    return "█" * filled + "▒" * half + "░" * (BAR_WIDTH - filled - half)


def render(plan: str) -> str:
    rows = ["| Section | Done | In progress | To do | |", "| --- | ---: | ---: | ---: | --- |"]
    totals = {"done": 0, "doing": 0, "todo": 0}
    for title, c in _sections(plan):
        total = sum(c.values())
        for key in totals:
            totals[key] += c[key]
        rows.append(f"| {title} | {c['done']} | {c['doing']} | {c['todo']} | `{_bar(c['done'], c['doing'], total)}` {round(100 * c['done'] / total)}% |")
    total = sum(totals.values())
    rows.append(
        f"| **All** | **{totals['done']}** | **{totals['doing']}** | **{totals['todo']}** | "
        f"`{_bar(totals['done'], totals['doing'], total)}` **{round(100 * totals['done'] / total)}%** |"
    )
    return "\n".join(rows)


def on_page_markdown(markdown, page, config, files):
    if MARKER not in markdown:
        return markdown
    plan = Path(config["docs_dir"], "PLAN.md").read_text(encoding="utf-8")
    return markdown.replace(MARKER, render(plan))
