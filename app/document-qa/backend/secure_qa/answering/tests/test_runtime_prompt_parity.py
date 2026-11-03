"""E1's benchmark prompts must match what this module sends to the model.

E1 selects and tunes the model with `llama_cpp/src/docqa_runtime/prompts.py`, a copy of
`context.py`'s prompt (the runtime is a standalone project and cannot import this
package). If `context.py` changes, this test fails until the copy and its
PROMPT_SET_VERSION are updated, so model-selection evidence never drifts from the
product prompt.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

from secure_qa.answering import context

PROMPTS = Path(__file__).resolve().parents[1] / "llama_cpp" / "src" / "docqa_runtime" / "prompts.py"


def _load_runtime_prompts():
    spec = importlib.util.spec_from_file_location("e1_runtime_prompts", PROMPTS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RuntimePromptParityTest(unittest.TestCase):
    def setUp(self):
        self.e1 = _load_runtime_prompts()

    def test_prompt_version_matches(self):
        self.assertEqual(self.e1.PRODUCT_PROMPT_VERSION, context.PROMPT_VERSION,
                         "context.py changed: update llama_cpp/src/docqa_runtime/prompts.py and bump PROMPT_SET_VERSION")

    def test_system_prompt_matches_the_product_default(self):
        # The product default has general knowledge enabled (SDD §4.2).
        self.assertEqual(self.e1.SYSTEM_PROMPT, context.system_prompt(True))

    def test_passages_and_question_render_identically(self):
        sources = [("handbook.pdf:12", "Employees may request up to three remote days."),
                   ("expenses.pdf:3", "A one-off allowance of up to 350 units.")]
        results = [SimpleNamespace(score=0.9, chunk=SimpleNamespace(document_id=src.rpartition(":")[0], text=text,
                                                                    page_start=int(src.rpartition(":")[2]),
                                                                    page_end=int(src.rpartition(":")[2])))
                   for src, text in sources]
        assembled = context.assemble("Can I work remotely?", results, documents=lambda doc_id: {"display_title": doc_id},
                                     ctx_size=4096, max_answer_tokens=512)
        ours = self.e1.grounded_messages(self.e1.format_passages(sources), "Can I work remotely?")
        self.assertEqual(ours, assembled.messages)


if __name__ == "__main__":
    unittest.main()
