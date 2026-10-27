"""Frozen service entry point; product behavior stays in the existing workflows."""
from __future__ import annotations

import multiprocessing
import os
import sys
import json
import faulthandler
from pathlib import Path


def main() -> None:
    faulthandler.enable()
    multiprocessing.freeze_support()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["ANONYMIZED_TELEMETRY"] = "False"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    if len(sys.argv) < 2 or sys.argv[1] not in {"host", "runtime"}:
        raise SystemExit("Usage: docqa-service host|runtime [options]")
    mode = sys.argv.pop(1)
    if mode == "host":
        from dev_host import main as run
        run()
    else:
        if '--config' in sys.argv:
            index = sys.argv.index('--config') + 1
            template = Path(sys.argv[index]).read_text(encoding='utf-8')
            if '__DOCQA_USER_DATA__' in template:
                data = Path(os.environ['SECURE_QA_DATA_DIR'])
                config = data / 'runtime.toml'
                config.write_text(template.replace('"__DOCQA_USER_DATA__"', json.dumps(str(data / 'runs'))), encoding='utf-8')
                sys.argv[index] = str(config)
        from docqa_runtime.cli import main as run
        raise SystemExit(run())


if __name__ == "__main__":
    main()
