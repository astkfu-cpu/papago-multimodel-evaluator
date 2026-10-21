"""Summarize exported archives without printing working aliases or local image paths."""
import argparse
from collections import Counter
import html
import json
from pathlib import Path
import re


def plain(value):
    return html.unescape(re.sub(r"<[^>]*>", " ", value)).strip()


def summarize(folder):
    files = sorted(Path(folder).glob("*.html"))
    if not files:
        raise ValueError("No HTML archive files found")
    raw_count, unique, accounts = 0, {}, set()
    for path in files:
        for article in re.findall(r"<article>(.*?)</article>", path.read_text(encoding="utf-8"), re.S):
            raw_count += 1
            heading = plain(re.search(r"<h2>(.*?)</h2>", article, re.S).group(1))
            match = re.fullmatch(r"(.*?) · ([A-Z_-]+) · 第 (\d+)/(\d+) 项", heading)
            if not match:
                raise ValueError("Unrecognized archive heading; inspect the input format locally")
            account, direction, _, _ = match.groups()
            meta = plain(re.search(r'<p class="meta">(.*?)</p>', article, re.S).group(1))
            pair = re.search(r"题目 ID (\S+)", meta).group(1)
            sheet = re.search(r"任务 (.*?)\s*分析 ", meta).group(1).strip()
            updated = re.search(r"更新 (\S+)", meta).group(1)
            key = (account, sheet, pair)
            row = {"direction": direction, "updated": updated, "applied": "原表两项已保存" in meta}
            if key not in unique or updated > unique[key]["updated"]:
                unique[key] = row
            accounts.add(account)
    directions = Counter(row["direction"] for row in unique.values())
    applied = Counter(row["direction"] for row in unique.values() if row["applied"])
    return {
        "archive_html_files": len(files),
        "raw_analysis_records": raw_count,
        "unique_evaluator_labels": len(accounts),
        "deduplicated_item_records": len(unique),
        "deduplicated_applied_records": sum(applied.values()),
        "directions": {key: {"item_records": directions[key], "applied_records": applied[key]} for key in sorted(directions)},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive_directory", help="Your authorized local HTML archive directory")
    print(json.dumps(summarize(parser.parse_args().archive_directory), ensure_ascii=False, indent=2))
