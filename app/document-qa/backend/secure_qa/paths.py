"""Development paths shared by the workflow modules, their tests, demos and benchmarks.

Model weights and benchmark data are local-only and gitignored, at the repository root.
The packaged application will pass real paths in; nothing here is used in a release build.
"""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]  # app/document-qa/backend: run `python -m secure_qa...` from here
REPO_ROOT = BACKEND_ROOT.parents[2]
MODELS_DIR = Path(os.environ.get("SECURE_QA_MODELS_DIR", REPO_ROOT / "models"))
DATA_DIR = Path(os.environ.get("SECURE_QA_DATA_DIR", REPO_ROOT / ".bench_data"))
