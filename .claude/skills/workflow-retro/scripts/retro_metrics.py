#!/usr/bin/env python3
"""Deep-mode metrics extractor for the workflow-retro skill.

Parses Claude Code session journals (~/.claude/projects/<slug>/) including
per-subagent journals (<session>/subagents/agent-*.jsonl + .meta.json) and
emits ONE compact JSON document on stdout. Designed so the model never has
to read raw journals into context for the quantitative part of a retro.

Schema facts this parser depends on (verified 2026-07-04 on claude-code v2.x):
- A streamed assistant turn is written as SEVERAL jsonl lines sharing one
  message.id, each carrying CUMULATIVE usage -> aggregate per message.id
  with per-field max, never sum raw lines.
- Subagent meta: {agentType, description, name?, toolUseId, spawnDepth}.
  Nested agents (spawnDepth >= 2) sit FLAT in the same session's subagents/
  dir; parentage is recovered by finding which journal contains the
  tool_use block whose id == meta.toolUseId.
- The parent-side Agent toolUseResult has NO token totals (async_launched),
  so subagent journals are the only source of subagent usage.

Stdlib only. Journals are UTF-8 (read with encoding='utf-8').
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

USAGE_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)


def parse_ts(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def slugify(path):
    return re.sub(r"[^A-Za-z0-9]", "-", str(path))


def resolve_project_dir(cli_value):
    if cli_value:
        return Path(cli_value)
    root = Path.home() / ".claude" / "projects"
    slug = slugify(Path.cwd().resolve())
    candidate = root / slug
    if candidate.is_dir():
        return candidate
    # Drive-letter case may differ (E-- vs e--): retry case-insensitively.
    if root.is_dir():
        for child in root.iterdir():
            if child.is_dir() and child.name.lower() == slug.lower():
                return child
    return candidate  # let the caller fail with a clear message


def norm_path(p):
    return str(p).replace("\\", "/").lower()


def parse_journal(path):
    """Parse one jsonl journal -> metrics dict."""
    usage_by_msg = {}
    models = set()
    tool_calls = {}
    seen_tool_ids = set()
    tool_use_ids = set()
    reads = {}
    writes = {}
    skills = []
    agent_spawns = []
    tool_errors = 0
    first_ts = last_ts = None
    parse_errors = 0

    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                parse_errors += 1
                continue
            ts = parse_ts(obj.get("timestamp"))
            if ts:
                first_ts = ts if first_ts is None else min(first_ts, ts)
                last_ts = ts if last_ts is None else max(last_ts, ts)
            otype = obj.get("type")
            msg = obj.get("message") or {}
            content = msg.get("content")
            if otype == "assistant":
                if msg.get("model"):
                    models.add(msg["model"])
                usage = msg.get("usage") or {}
                mid = msg.get("id")
                if mid and usage:
                    slot = usage_by_msg.setdefault(mid, dict.fromkeys(USAGE_FIELDS, 0))
                    for f in USAGE_FIELDS:
                        slot[f] = max(slot[f], usage.get(f) or 0)
                if isinstance(content, list):
                    for block in content:
                        if not isinstance(block, dict) or block.get("type") != "tool_use":
                            continue
                        bid = block.get("id")
                        if bid in seen_tool_ids:
                            continue
                        seen_tool_ids.add(bid)
                        tool_use_ids.add(bid)
                        name = block.get("name") or "?"
                        tool_calls[name] = tool_calls.get(name, 0) + 1
                        binput = block.get("input") or {}
                        if name == "Read" and binput.get("file_path"):
                            key = norm_path(binput["file_path"])
                            reads[key] = reads.get(key, 0) + 1
                        elif name in ("Write", "Edit") and binput.get("file_path"):
                            key = norm_path(binput["file_path"])
                            writes[key] = writes.get(key, 0) + 1
                        elif name == "Skill" and binput.get("skill"):
                            skills.append(binput["skill"])
                        elif name == "Agent":
                            agent_spawns.append(
                                {
                                    "tool_use_id": bid,
                                    "subagent_type": binput.get("subagent_type"),
                                    "name": binput.get("name"),
                                }
                            )
            elif otype == "user" and isinstance(content, list):
                for block in content:
                    if (
                        isinstance(block, dict)
                        and block.get("type") == "tool_result"
                        and block.get("is_error")
                    ):
                        tool_errors += 1

    usage = dict.fromkeys(USAGE_FIELDS, 0)
    for slot in usage_by_msg.values():
        for f in USAGE_FIELDS:
            usage[f] += slot[f]
    prompt_side = (
        usage["input_tokens"]
        + usage["cache_read_input_tokens"]
        + usage["cache_creation_input_tokens"]
    )
    return {
        "usage": usage,
        "cache_hit_pct": round(100.0 * usage["cache_read_input_tokens"] / prompt_side, 1)
        if prompt_side
        else None,
        "models": sorted(models),
        "api_turns": len(usage_by_msg),
        "tool_calls_total": sum(tool_calls.values()),
        "tool_calls_by_tool": dict(sorted(tool_calls.items(), key=lambda kv: -kv[1])),
        "tool_errors": tool_errors,
        "skills_loaded": skills,
        "agent_spawns": agent_spawns,
        "reads": reads,
        "writes": writes,
        "tool_use_ids": tool_use_ids,
        "started": first_ts.isoformat() if first_ts else None,
        "ended": last_ts.isoformat() if last_ts else None,
        "duration_s": round((last_ts - first_ts).total_seconds(), 1)
        if first_ts and last_ts
        else None,
        "parse_errors": parse_errors,
    }


def load_agents(session_dir):
    agents = []
    sub = session_dir / "subagents"
    if not sub.is_dir():
        return agents
    for journal in sorted(sub.glob("agent-*.jsonl")):
        meta_path = journal.with_name(journal.stem + ".meta.json")
        meta = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        agents.append(
            {
                "agent_id": journal.stem.replace("agent-", ""),
                "agent_type": meta.get("agentType"),
                "name": meta.get("name"),
                "description": meta.get("description"),
                "spawn_depth": meta.get("spawnDepth"),
                "tool_use_id": meta.get("toolUseId"),
                "journal": str(journal),
                "metrics": parse_journal(journal),
            }
        )
    return agents


def resolve_parents(agents, orchestrator_metrics):
    by_tool_use = {}
    for agent in agents:
        for tid in agent["metrics"]["tool_use_ids"]:
            by_tool_use[tid] = agent["agent_id"]
    for agent in agents:
        tid = agent["tool_use_id"]
        if tid and tid in orchestrator_metrics["tool_use_ids"]:
            agent["parent"] = "orchestrator"
        else:
            agent["parent"] = by_tool_use.get(tid, "orchestrator?")


def concurrency(agents):
    intervals = []
    for agent in agents:
        m = agent["metrics"]
        s, e = parse_ts(m["started"]), parse_ts(m["ended"])
        if s and e:
            intervals.append((s, e, agent["agent_id"]))
    if not intervals:
        return {}
    events = []
    for s, e, aid in intervals:
        events.append((s, 1, aid))
        events.append((e, -1, aid))
    events.sort(key=lambda x: (x[0], x[1]))
    cur = peak = 0
    active, peak_set = set(), set()
    for _, delta, aid in events:
        if delta == 1:
            active.add(aid)
        else:
            active.discard(aid)
        cur += delta
        if cur > peak:
            peak, peak_set = cur, set(active)
    wall_start = min(s for s, _, _ in intervals)
    wall_end = max(e for _, e, _ in intervals)
    wall = (wall_end - wall_start).total_seconds()
    total = sum((e - s).total_seconds() for s, e, _ in intervals)
    return {
        "agents_wall_clock_s": round(wall, 1),
        "sum_agent_duration_s": round(total, 1),
        "parallel_factor": round(total / wall, 2) if wall else None,
        "max_concurrent": peak,
        "max_concurrent_agents": sorted(peak_set),
        "timeline": [
            {"agent_id": aid, "start": s.isoformat(), "end": e.isoformat()}
            for s, e, aid in sorted(intervals)
        ],
    }


def duplicate_reads(agents, orchestrator_metrics):
    readers = {}  # path -> {journal_label: count}
    sources = [("orchestrator", orchestrator_metrics)] + [
        (a["agent_id"], a["metrics"]) for a in agents
    ]
    for label, metrics in sources:
        for path, count in metrics["reads"].items():
            readers.setdefault(path, {})[label] = count
    dupes = [
        {"path": path, "readers": who, "total_reads": sum(who.values())}
        for path, who in readers.items()
        if len(who) > 1 or sum(who.values()) > 2
    ]
    dupes.sort(key=lambda d: (-len(d["readers"]), -d["total_reads"]))
    return dupes[:25]


def sum_usage(metrics_list):
    total = dict.fromkeys(USAGE_FIELDS, 0)
    for m in metrics_list:
        for f in USAGE_FIELDS:
            total[f] += m["usage"][f]
    return total


def strip_internal(metrics):
    out = dict(metrics)
    out.pop("tool_use_ids", None)
    out.pop("reads", None)
    out.pop("writes", None)
    out["writes_paths"] = sorted(metrics["writes"].keys())
    return out


def list_sessions(project_dir):
    rows = []
    for jsonl in sorted(
        project_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True
    ):
        session_dir = project_dir / jsonl.stem
        sub = session_dir / "subagents"
        metas = sorted(sub.glob("agent-*.meta.json")) if sub.is_dir() else []
        agent_types = []
        for mp in metas:
            try:
                agent_types.append(json.loads(mp.read_text(encoding="utf-8")).get("agentType"))
            except (json.JSONDecodeError, OSError):
                agent_types.append("?")
        rows.append(
            {
                "session": jsonl.stem,
                "modified": datetime.fromtimestamp(jsonl.stat().st_mtime).isoformat(
                    timespec="seconds"
                ),
                "size_kb": round(jsonl.stat().st_size / 1024),
                "subagents": len(metas),
                "agent_types": agent_types,
            }
        )
    return rows


def main():
    # Windows consoles default to a legacy codepage; journal text is UTF-8.
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--session", help="session UUID (or unique prefix); default: latest with subagents")
    ap.add_argument("--project-dir", help="override ~/.claude/projects/<slug> resolution")
    ap.add_argument("--list", action="store_true", help="list sessions (newest first) and exit")
    args = ap.parse_args()

    project_dir = resolve_project_dir(args.project_dir)
    if not project_dir.is_dir():
        sys.exit(f"project journal dir not found: {project_dir} (pass --project-dir)")

    if args.list:
        json.dump(list_sessions(project_dir), sys.stdout, indent=1)
        return

    sessions = list_sessions(project_dir)
    if args.session:
        matches = [s for s in sessions if s["session"].startswith(args.session)]
        if len(matches) != 1:
            sys.exit(f"--session {args.session!r} matched {len(matches)} sessions; use --list")
        session = matches[0]["session"]
    else:
        with_agents = [s for s in sessions if s["subagents"]]
        if not with_agents:
            sys.exit("no session with subagent journals found; use --list / --session")
        session = with_agents[0]["session"]

    session_file = project_dir / f"{session}.jsonl"
    orch = parse_journal(session_file)
    agents = load_agents(project_dir / session)
    resolve_parents(agents, orch)

    agent_metrics = [a["metrics"] for a in agents]
    report = {
        "session": session,
        "project_dir": str(project_dir),
        "note": (
            "orchestrator covers the WHOLE session jsonl (may include turns outside the "
            "pipeline); subagent usage is NOT included in orchestrator usage"
        ),
        "orchestrator": strip_internal(orch),
        "agents": [
            {k: v for k, v in a.items() if k not in ("metrics", "tool_use_id")}
            | {"metrics": strip_internal(a["metrics"])}
            for a in agents
        ],
        "totals": {
            "agents_only": sum_usage(agent_metrics),
            "orchestrator_plus_agents": sum_usage(agent_metrics + [orch]),
            "agent_tool_calls": sum(m["tool_calls_total"] for m in agent_metrics),
            "agent_tool_errors": sum(m["tool_errors"] for m in agent_metrics),
        },
        "parallelism": concurrency(agents),
        "duplicate_reads": duplicate_reads(agents, orch),
    }
    json.dump(report, sys.stdout, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
