#!/usr/bin/env python3
"""Compare captures with immutable originals; never mask or tolerate pixels.

Requires Pillow. Run after capture browsers close, with output outside Vite's
watched tree. A difference requires human classification against the plan.
"""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare_images(original: Path, candidate: Path, difference: Path) -> dict:
    with Image.open(original) as image:
        before = image.convert("RGBA")
    with Image.open(candidate) as image:
        after = image.convert("RGBA")
    if before.size != after.size:
        return {
            "status": "dimensions-differ",
            "original_size": list(before.size),
            "candidate_size": list(after.size),
        }
    delta = ImageChops.difference(before, after)
    bands = delta.split()
    maximum = bands[0]
    for band in bands[1:]:
        maximum = ImageChops.lighter(maximum, band)
    mask = maximum.point(lambda value: 255 if value else 0)
    count = mask.histogram()[255]
    result = {
        "status": "identical" if count == 0 else "pixels-differ",
        "size": list(before.size),
        "changed_pixels": count,
        "total_pixels": before.width * before.height,
        "changed_fraction": count / (before.width * before.height),
        "bounding_box": mask.getbbox(),
        "maximum_channel_difference": maximum.getextrema()[1],
    }
    if count:
        difference.parent.mkdir(parents=True, exist_ok=True)
        # Red indicates every changed pixel, including a one-channel difference.
        red = Image.new("RGB", before.size, (255, 0, 64))
        Image.composite(red, before.convert("RGB"), mask).save(difference)
        result["difference_image"] = str(difference.resolve())
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path, help="Accepted original capture directory")
    parser.add_argument("candidate", type=Path, help="Candidate capture directory")
    parser.add_argument("output", type=Path, help="Separate comparison output directory")
    args = parser.parse_args()
    original, candidate, output = (
        path.resolve() for path in (args.original, args.candidate, args.output)
    )
    if output == original or original in output.parents:
        parser.error("Comparison output must not modify the original reference.")
    if output == candidate or candidate in output.parents:
        parser.error("Comparison output must not modify candidate capture evidence.")
    accepted = json.loads((original / "ACCEPTED.json").read_text())
    index_path = original / "capture-index.json"
    if digest(index_path) != accepted["capture_index_sha256"]:
        parser.error("Original index does not match its acceptance marker.")
    index = json.loads(index_path.read_text())
    results = []
    names = set()
    for case in index["cases"]:
        name = case["name"]
        if Path(name).name != name or name in names:
            parser.error(f"Unsafe or duplicate capture name: {name!r}")
        names.add(name)
        before = original / "screenshots" / f"{name}.png"
        after = candidate / "screenshots" / f"{name}.png"
        if digest(before) != case["screenshotSha256"]:
            parser.error(f"Original screenshot was modified: {name}")
        result = {"name": name, "original_sha256": digest(before)}
        if not after.is_file():
            result["status"] = "missing"
        else:
            result["candidate_sha256"] = digest(after)
            result.update(compare_images(before, after, output / "differences" / f"{name}.png"))
        results.append(result)
    counts = {
        status: sum(result["status"] == status for result in results)
        for status in ("identical", "pixels-differ", "dimensions-differ", "missing")
    }
    output.mkdir(parents=True, exist_ok=True)
    report = {
        "original_index_sha256": digest(index_path),
        "original": str(original),
        "candidate": str(candidate),
        "pixel_tolerance": 0,
        "masks": [],
        "counts": counts,
        "cases": results,
    }
    (output / "comparison.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(counts))
    return 0 if counts["identical"] == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
