"""Answer parsing and citation rules (SDD §7.3)."""

from __future__ import annotations

import unittest

from secure_qa.answering.citations import parse

SUPPLIED = {"S1", "S2", "S3"}


class ParseTest(unittest.TestCase):
    def test_three_sections(self):
        a = parse(
            "From your documents:\nThe limit is 50 mSv per year [S1].\n- Five-year average is 100 mSv [S1][S2].\n"
            "General model knowledge:\nALARA is widely used.\nLimitations and uncertainty:\nNo data on contractors.",
            SUPPLIED,
        )
        self.assertEqual([(c.text, c.labels) for c in a.claims],
                         [("The limit is 50 mSv per year.", ["S1"]), ("Five-year average is 100 mSv.", ["S1", "S2"])])
        self.assertEqual(a.general, ["ALARA is widely used."])
        self.assertEqual(a.limitations, ["No data on contractors."])
        self.assertEqual(a.violations, [])

    def test_marker_after_full_stop_belongs_to_that_sentence(self):
        a = parse("From your documents: Pressure is 15.5 MPa. [S2] Heat goes to the steam generator. [S3]", SUPPLIED)
        self.assertEqual([(c.text, c.labels) for c in a.claims],
                         [("Pressure is 15.5 MPa.", ["S2"]), ("Heat goes to the steam generator.", ["S3"])])

    def test_marker_lists_ranges_and_bare_numbers(self):
        a = parse("From your documents:\nA is true [S1, S3]. B is true [S1-S3]. C is true [2].", SUPPLIED)
        self.assertEqual([c.labels for c in a.claims], [["S1", "S3"], ["S1", "S2", "S3"], ["S2"]])

    def test_abbreviations_do_not_split_claims(self):
        a = parse("From your documents:\nSee pp. 4 and Fig. 2, e.g. the pump curve [S1].", SUPPLIED)
        self.assertEqual(len(a.claims), 1)
        self.assertEqual(a.claims[0].labels, ["S1"])

    def test_uncited_and_unknown_citations_are_violations(self):
        a = parse("From your documents:\nCited fact [S1]. Uncited fact. Invented source [S9].", SUPPLIED)
        self.assertEqual([c.problem for c in a.claims], [None, "uncited_claim", "unknown_citation"])
        self.assertEqual([c.text for c in a.valid_claims], ["Cited fact."])
        self.assertEqual({v.code for v in a.violations}, {"uncited_claim", "unknown_citation"})

    def test_text_before_any_heading_must_be_cited(self):
        a = parse("The answer is 42.", SUPPLIED)
        self.assertEqual(a.claims[0].problem, "uncited_claim")

    def test_general_knowledge_must_not_carry_citations(self):
        a = parse("General model knowledge:\nReactors make heat [S1].", SUPPLIED)
        self.assertEqual([v.code for v in a.violations], ["cited_general_knowledge"])
        self.assertEqual(a.general, ["Reactors make heat."])  # label removed if it is ever shown

    def test_markdown_headings_and_think_blocks(self):
        a = parse("<think>scratch [S9]</think>\n**From your documents:**\n* Fact one [S1].\n## Limitations\nNone.", SUPPLIED)
        self.assertEqual([(c.text, c.labels) for c in a.claims], [("Fact one.", ["S1"])])
        self.assertEqual(a.limitations, ["None."])
        self.assertEqual(a.violations, [])

    def test_a_sentence_starting_with_a_heading_word_is_not_a_heading(self):
        a = parse("From your documents:\nLimitations of the design are listed [S1].", SUPPLIED)
        self.assertEqual(len(a.claims), 1)
        self.assertEqual(a.limitations, [])


if __name__ == "__main__":
    unittest.main()
