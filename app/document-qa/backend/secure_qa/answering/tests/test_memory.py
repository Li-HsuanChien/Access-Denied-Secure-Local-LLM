import unittest
from dataclasses import dataclass

from secure_qa.answering import memory as m
from secure_qa.answering.memory import Conversation


@dataclass
class _Completion:
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    finish_reason: str = "stop"


class _ScriptedRuntime:
    """Records the prompts it sees and returns queued completions."""

    def __init__(self, *replies: str):
        self._replies = list(replies)
        self.calls: list[list[dict]] = []

    def complete(self, messages, **_kwargs):
        self.calls.append(messages)
        return _Completion(self._replies.pop(0) if self._replies else "")


class _BrokenRuntime:
    def complete(self, messages, **_kwargs):
        raise RuntimeError("model down")


class MemoryTest(unittest.TestCase):
    def test_rewrite_is_a_noop_without_history_and_never_calls_the_model(self):
        runtime = _ScriptedRuntime("should not be used")
        self.assertEqual(m.rewrite_query(runtime, "What is the dose limit?", None), "What is the dose limit?")
        empty = Conversation("c1")
        self.assertEqual(m.rewrite_query(runtime, "What is the dose limit?", empty), "What is the dose limit?")
        self.assertEqual(runtime.calls, [])

    def test_rewrite_uses_the_conversation_to_make_a_standalone_query(self):
        runtime = _ScriptedRuntime("annual dose limit for workers")
        convo = Conversation("c1", summary="Discussed dose limits.",
                             recent_turns=[{"role": "user", "content": "What is the annual dose limit?"},
                                           {"role": "assistant", "content": "It is 20 mSv."}])
        self.assertEqual(m.rewrite_query(runtime, "and for workers?", convo), "annual dose limit for workers")
        self.assertEqual(len(runtime.calls), 1)

    def test_rewrite_falls_back_to_the_question_on_model_error(self):
        convo = Conversation("c1", summary="context")
        self.assertEqual(m.rewrite_query(_BrokenRuntime(), "follow up", convo), "follow up")

    def test_context_block_is_none_without_history_and_labels_itself_as_context(self):
        self.assertIsNone(m.context_block(None))
        self.assertIsNone(m.context_block(Conversation("c1")))
        block = m.context_block(Conversation("c1", summary="So far: dose limits.",
                                             recent_turns=[{"role": "user", "content": "hi"}]))
        self.assertIn("do not cite", block)
        self.assertIn("So far: dose limits.", block)

    def test_summary_update_falls_back_to_heuristic_and_stays_bounded(self):
        answer = {"status": "answered", "documents": [{"text": "The limit is 20 mSv per year."}]}
        summary = m.update_summary(_BrokenRuntime(), "", "What is the dose limit?", answer)
        self.assertIn("dose limit", summary)
        self.assertIn("20 mSv", summary)
        self.assertLessEqual(len(summary), m.MAX_SUMMARY_CHARS)

    def test_summary_update_uses_the_model_when_available(self):
        runtime = _ScriptedRuntime("The analyst asked about dose limits; the assistant cited 20 mSv/year.")
        summary = m.update_summary(runtime, "old", "q", {"status": "answered"})
        self.assertEqual(summary, "The analyst asked about dose limits; the assistant cited 20 mSv/year.")


if __name__ == "__main__":
    unittest.main()
