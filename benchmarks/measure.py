"""Wall-clock and resident-memory measurement around a single call."""

from __future__ import annotations

import gc
import os
import resource
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import psutil

_PROCESS = psutil.Process(os.getpid())


def rss_mb() -> float:
    return _PROCESS.memory_info().rss / 1024 / 1024


def peak_rss_mb() -> float:
    """High-water mark RSS of this process.

    Unlike current RSS it does not fall when the OS compresses or swaps pages out
    under memory pressure, so it is the steadier figure on a busy machine.
    """
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak / 1024 / 1024 if sys.platform == "darwin" else peak / 1024  # bytes on macOS, KB on Linux


@dataclass
class Measurement:
    label: str
    result: Any
    elapsed_s: float
    mem_before_mb: float
    mem_after_mb: float

    @property
    def mem_delta_mb(self) -> float:
        return self.mem_after_mb - self.mem_before_mb


def measure(fn: Callable[[], Any], label: str, verbose: bool = True) -> Measurement:
    """Run `fn()` and record elapsed time and the change in this process's RSS.

    RSS covers this Python process only. A store running in another process
    (Qdrant in Docker) must have its memory sampled separately.
    """
    gc.collect()  # keep garbage from earlier steps out of the delta
    mem_before = rss_mb()
    start = time.perf_counter()  # monotonic and higher resolution than time.time()
    result = fn()
    elapsed = time.perf_counter() - start
    mem_after = rss_mb()
    if verbose:
        print(f"{label}: {elapsed:.3f}s, {mem_after - mem_before:+.1f}MB delta (RSS {mem_after:.0f}MB)", flush=True)
    return Measurement(label, result, elapsed, mem_before, mem_after)
