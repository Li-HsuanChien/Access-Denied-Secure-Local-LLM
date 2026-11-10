"""Generate the prototype's fictional sample PDFs and citation geometry.

Run from the repository root with the project virtualenv (PyMuPDF is already a
project dependency):

    .venv/bin/python app/document-qa/frontend/prototypes/ui-revamp/scripts/make_samples.py

Everything here is fictional sample content for UI review. Fonts are the
Liberation Sans files bundled with pdfjs-dist (SIL OFL 1.1) and are embedded so
pdf.js never needs to load font data.
"""

from __future__ import annotations

import json
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT.parents[1]
FONT_DIR = FRONTEND / "node_modules" / "pdfjs-dist" / "standard_fonts"
OUT = ROOT / "public" / "samples"
REVIEW_OUT = ROOT / "public" / "review-samples"
MANIFEST = ROOT / "src" / "data" / "sample-manifest.json"

REGULAR = pymupdf.Font(fontfile=str(FONT_DIR / "LiberationSans-Regular.ttf"))
BOLD = pymupdf.Font(fontfile=str(FONT_DIR / "LiberationSans-Bold.ttf"))
W, H = 612, 792
MARGIN = 68
BODY = 10.5
LEAD = 15.5
INK = (0.13, 0.12, 0.11)
MUTED = (0.42, 0.40, 0.37)
FOOTER = "SAMPLE DOCUMENT  ·  Fictional content created for UI prototype review"


def wrap(text: str, font: pymupdf.Font, size: float, width: float) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if font.text_length(candidate, size) <= width:
            line = candidate
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


class Writer:
    def __init__(self, doc: pymupdf.Document, title: str):
        self.doc, self.title = doc, title
        self.page: pymupdf.Page | None = None
        self.tw: pymupdf.TextWriter | None = None
        self.y = 0.0

    def new_page(self) -> None:
        self.finish_page()
        self.page = self.doc.new_page(width=W, height=H)
        self.tw = pymupdf.TextWriter(self.page.rect)
        self.tw.append((MARGIN, 44), self.title, font=REGULAR, fontsize=8.5)
        self.page.draw_line((MARGIN, 52), (W - MARGIN, 52), color=(0.85, 0.83, 0.8), width=0.6)
        self.y = 88

    def finish_page(self) -> None:
        if self.page is None or self.tw is None:
            return
        number = self.page.number + 1
        self.tw.append((MARGIN, H - 40), FOOTER, font=REGULAR, fontsize=7.5)
        label = f"Page {number}"
        self.tw.append((W - MARGIN - REGULAR.text_length(label, 8.5), H - 40), label, font=REGULAR, fontsize=8.5)
        self.tw.write_text(self.page, color=MUTED)
        self.page = None

    def text(self, text: str, font=REGULAR, size=BODY, lead=LEAD, gap=9.0, indent=0.0, color=INK) -> None:
        assert self.page is not None
        tw = pymupdf.TextWriter(self.page.rect, color=color)
        for line in wrap(text, font, size, W - 2 * MARGIN - indent):
            tw.append((MARGIN + indent, self.y), line, font=font, fontsize=size)
            self.y += lead
        tw.write_text(self.page)
        self.y += gap

    def h1(self, text: str) -> None:
        self.text(text, BOLD, 20, 26, 6)

    def h2(self, text: str) -> None:
        self.y += 6
        self.text(text, BOLD, 12.5, 18, 4)

    def p(self, text: str) -> None:
        self.text(text)

    def bullet(self, text: str) -> None:
        assert self.page is not None
        self.page.draw_circle((MARGIN + 6, self.y - 3.5), 1.6, color=INK, fill=INK)
        self.text(text, indent=16, gap=4)

    def table(self, header: list[str], rows: list[list[str]], widths: list[float]) -> None:
        assert self.page is not None
        x0 = MARGIN
        y = self.y
        for r, row in enumerate([header, *rows]):
            x = x0
            tw = pymupdf.TextWriter(self.page.rect, color=INK)
            for cell, width in zip(row, widths):
                tw.append((x + 6, y + 14), cell, font=BOLD if r == 0 else REGULAR, fontsize=9.5)
                x += width
            tw.write_text(self.page)
            if r == 0:
                self.page.draw_rect((x0, y, x0 + sum(widths), y + 21), color=None, fill=(0.94, 0.92, 0.88), overlay=False)
            self.page.draw_line((x0, y + 21), (x0 + sum(widths), y + 21), color=(0.8, 0.78, 0.74), width=0.5)
            y += 21
        self.y = y + 16


# ---------------------------------------------------------------- documents
# Each page is a list of (kind, text). Quotes used as citations are listed in
# CITATIONS below and must appear verbatim in a paragraph.

DOCS: dict[str, dict] = {
    "maintenance-handbook": {
        "title": "Reactor Maintenance Handbook",
        "pages": [
            [("h1", "Reactor Maintenance Handbook"), ("p", "Lakeside Research Reactor · Revision 7 · Approved for internal use"),
             ("h2", "1. Purpose"),
             ("p", "This handbook sets out the routine maintenance programme for systems that support safe operation of the Lakeside research reactor. It describes inspection intervals, the records that must be kept, and the conditions that require maintenance outside the normal schedule."),
             ("p", "The handbook applies to all maintenance staff, contractors working under a facility work permit, and supervisors who approve completed work. Where this handbook and a vendor manual disagree, the more conservative requirement applies until the discrepancy is resolved by the maintenance engineer."),
             ("h2", "2. How to use this handbook"),
             ("p", "Each system chapter lists scheduled tasks first, followed by condition-based tasks. Intervals are measured in days of normal operation unless the chapter states otherwise. Time spent in an extended shutdown does not count toward an interval.")],
            [("h2", "3. Records and sign-off"),
             ("p", "Every maintenance task produces a record in the facility maintenance log. The record identifies the equipment, the task performed, the readings taken, any parts replaced, and the name of the person who completed the work."),
             ("p", "Completed work is reviewed by a supervisor within five working days. Records with missing readings are returned to the technician and the task is treated as incomplete until the readings are supplied."),
             ("h2", "4. Planning the annual outage"),
             ("p", "Tasks that require the reactor to be shut down are grouped into a planned outage. The outage plan is issued at least eight weeks in advance so that parts, permits, and contractor support can be arranged.")],
            [("h2", "5. Primary coolant system"),
             ("p", "The primary coolant system removes heat from the core and carries it to the heat exchanger. Its pumps, valves, and instrumentation are safety-related and are maintained to the schedule in this chapter."),
             ("h2", "5.1 Coolant pumps: scheduled checks"),
             ("p", "Primary coolant pumps shall receive a visual and vibration check every 30 days of normal operation. Where vibration exceeds the recorded baseline by more than 20 percent, an inspection shall be performed within 72 hours."),
             ("p", "Vibration readings are taken at the inboard and outboard bearings using the handheld analyser kept in the control room. Readings are entered in the pump log on the same shift.")],
            [("h2", "5.2 Coolant pumps: mechanical inspection"),
             ("p", "A full mechanical inspection of each primary coolant pump, including seals and bearings, shall be completed every 18 months and scheduled to coincide with the planned outage."),
             ("p", "The inspection follows the vendor procedure and includes seal leakage measurement, bearing clearance checks, and coupling alignment. Replacement seals are installed whenever leakage exceeds the vendor limit."),
             ("h2", "5.3 Valves and instrumentation"),
             ("p", "Isolation valves are stroke-tested quarterly. Flow and temperature instruments are calibrated annually against reference instruments with current calibration certificates.")],
            [("h2", "6. Secondary systems"),
             ("p", "Secondary cooling, ventilation, and electrical supply systems are maintained according to their vendor schedules unless this handbook sets a shorter interval. Ventilation filters are inspected monthly and replaced when the pressure drop reaches the marked limit."),
             ("h2", "7. Condition-based maintenance"),
             ("p", "Any technician who observes abnormal noise, leakage, or temperature should report it to the shift supervisor immediately. The supervisor decides whether the equipment may remain in service until the next scheduled check.")],
            [("h2", "8. Revision history"),
             ("p", "Revision 7 shortened the vibration response time from five days to 72 hours and added the requirement to log readings on the same shift. Revision 6 introduced the combined outage plan."),
             ("p", "Suggestions for improving this handbook should be sent to the maintenance engineer, who reviews them before each revision.")],
        ],
    },
    "radiation-protection-guide": {
        "title": "Radiation Protection Field Guide",
        "pages": [
            [("h1", "Radiation Protection Field Guide"), ("p", "Lakeside Research Reactor · Health Physics Office · Edition 3"),
             ("h2", "About this guide"),
             ("p", "This guide summarises the practical rules for working safely in areas where radiation exposure is possible. It is written for staff, students, and contractors, and does not replace the facility radiation protection programme."),
             ("p", "If you are unsure whether a rule applies to you, ask the duty health physicist before entering a designated area.")],
            [("h2", "1. Designated areas"),
             ("p", "The facility has supervised areas and controlled areas. Controlled areas are marked with yellow signage at every entrance and require specific training, dosimetry, and authorisation before entry."),
             ("h2", "2. Training before entry"),
             ("p", "Before entering a controlled area for the first time, staff must complete the eight hour initial radiation safety course and pass its written assessment with a score of at least 80 percent. The qualification remains valid only while an annual refresher is completed."),
             ("p", "Training records are held by the Health Physics Office. Supervisors should confirm that a worker's training is current before assigning work in a controlled area.")],
            [("h2", "3. Dosimetry"),
             ("p", "A personal dosimeter must be issued and logged at the access point before each entry into a controlled area. The dosimeter is worn on the chest, outside clothing, and returned at the same access point on exit."),
             ("p", "Lost or damaged dosimeters must be reported before the end of the shift so that a dose assessment can be made."),
             ("h2", "4. Visitors"),
             ("p", "Visitors who have not completed the initial course may enter a controlled area only when escorted at all times by qualified staff and after receiving a safety briefing at the access point.")],
            [("h2", "5. Contamination control"),
             ("p", "Hands and feet are monitored on leaving a controlled area. If the monitor alarms, stay at the monitor, do not touch other surfaces, and call the duty health physicist."),
             ("h2", "6. Dose limits"),
             ("p", "The facility sets an administrative dose limit below the regulatory limit to provide a margin of safety. Workers approaching the administrative limit are reassigned to work that does not involve exposure.")],
            [("h2", "7. Emergencies"),
             ("p", "In an emergency, follow the instructions of the emergency coordinator. Leave the controlled area by the nearest marked exit and report to the assembly point. Do not return for personal items."),
             ("p", "Practice drills are announced in advance. Unannounced drills may also be held at the discretion of the facility manager.")],
        ],
    },
    "annual-report-2024": {
        "title": "Annual Facility Report 2024",
        "pages": [
            [("h1", "Annual Facility Report 2024"), ("p", "Lakeside Research Reactor · Published March 2025"),
             ("h2", "Summary"),
             ("p", "The reactor operated for 214 days in 2024, compared with 251 days in 2023. Operation supported 38 research projects and the production of reference samples for three partner laboratories."),
             ("p", "There were no reportable safety events. Two minor equipment faults were corrected during scheduled maintenance.")],
            [("h2", "1. Operations"),
             ("p", "The planned maintenance outage began in May and was extended by six weeks to complete replacement of the secondary heat exchanger. The extension accounts for most of the reduction in operating days."),
             ("p", "Fuel inventory, core configuration, and experimental facilities were unchanged during the year.")],
            [("h2", "2. Occupational exposure"),
             ("p", "Average annual dose for monitored workers rose from 0.42 mSv in 2023 to 0.61 mSv in 2024. The highest individual dose was 2.3 mSv."),
             ("table", ""),
             ("p", "All individual doses remained below the facility administrative limit of 5 mSv per year, which is set well below the regulatory limit."),
             ("p", "Collective dose figures are reported in the appendix.")],
            [("h2", "3. Training and staffing"),
             ("p", "Twelve new staff completed initial radiation safety training. Refresher completion reached 97 percent by year end; the remaining staff completed refreshers in January 2025."),
             ("h2", "4. Waste and effluents"),
             ("p", "Solid waste volumes were similar to 2023. Gaseous and liquid effluents remained below one percent of authorised discharge limits.")],
            [("h2", "5. Looking ahead"),
             ("p", "Priorities for 2025 include completing the instrumentation upgrade, revising the emergency preparedness plan, and reviewing the dosimetry service contract."),
             ("p", "This report will be updated if the appendix figures change after final verification.")],
        ],
    },
    "spent-fuel-checklist": {
        "title": "Spent Fuel Pool Inspection Checklist",
        "pages": [
            [("h1", "Spent Fuel Pool Inspection Checklist"), ("p", "Lakeside Research Reactor · Form SF-12 · Monthly"),
             ("h2", "Before you start"),
             ("p", "Complete this checklist once a month and after any event that could affect pool water level or chemistry. Use a separate form for each inspection."),
             ("bullet", "Confirm that the pool area radiation monitor is operating."),
             ("bullet", "Confirm that the primary coolant pump log has been reviewed and signed within the past 30 days."),
             ("bullet", "Record the time the inspection begins.")],
            [("h2", "Pool condition"),
             ("bullet", "Water level is within the marked band on the level gauge."),
             ("bullet", "Water clarity allows the top of every fuel rack to be seen."),
             ("bullet", "No debris or foreign objects are visible on the pool floor."),
             ("bullet", "Conductivity and pH readings are within the posted limits."),
             ("h2", "Cooling and cleanup"),
             ("bullet", "Pool cooling pump is running and its discharge pressure is normal."),
             ("bullet", "Cleanup filter differential pressure is below the replacement mark.")],
            [("h2", "Sign-off"),
             ("p", "The inspector signs and dates the form. Any item not satisfied must be reported to the shift supervisor before the form is filed, and the supervisor records the action taken."),
             ("p", "Completed forms are kept for five years.")],
        ],
    },
    "emergency-plan-2019": {
        "title": "Emergency Preparedness Plan (2019 draft)",
        "pages": [
            [("h1", "Emergency Preparedness Plan"), ("p", "Lakeside Research Reactor · 2019 draft · Superseded pending revision"),
             ("h2", "1. Scope"),
             ("p", "This plan describes how the facility prepares for, responds to, and recovers from emergencies affecting the reactor building and its immediate surroundings.")],
            [("h2", "2. Drills and exercises"),
             ("p", "A full-scale emergency exercise involving off-site responders is held every two years. Building evacuation drills are held at least twice a year, one of which is unannounced."),
             ("p", "Each drill is followed by a debrief, and corrective actions are tracked to completion by the emergency coordinator.")],
            [("h2", "3. Roles"),
             ("p", "The emergency coordinator directs the on-site response. The duty health physicist advises on radiological conditions. The facility manager liaises with off-site authorities.")],
            [("h2", "4. Review"),
             ("p", "This plan is reviewed every three years, or sooner after an exercise identifies a significant weakness.")],
        ],
    },
}

REVIEW_DOCS: dict[str, dict] = {
    "coolant-chemistry-procedures": {
        "title": "Coolant Chemistry Procedures",
        "pages": [
            [("h1", "Coolant Chemistry Procedures"), ("p", "Lakeside Research Reactor · Chemistry Section"),
             ("p", "Primary coolant samples are taken weekly and analysed for conductivity, pH, and dissolved oxygen. Results outside the action band are reported to the shift supervisor on the same shift.")],
            [("h2", "Sampling"), ("p", "Samples are drawn from the sampling station using clean containers labelled before use.")],
            [("h2", "Records"), ("p", "Results are entered in the chemistry log and trended monthly.")],
        ],
    },
    "training-records-policy": {
        "title": "Training Records Policy",
        "pages": [
            [("h1", "Training Records Policy"), ("p", "Lakeside Research Reactor · Human Resources and Health Physics"),
             ("p", "Training records are kept for the duration of employment and for five years afterward.")],
            [("h2", "Access"), ("p", "Workers may view their own records at any time by request to the Health Physics Office.")],
        ],
    },
}

TABLE = (["Year", "Average dose", "Highest dose", "Monitored workers"],
         [["2022", "0.39 mSv", "1.8 mSv", "61"], ["2023", "0.42 mSv", "1.9 mSv", "64"], ["2024", "0.61 mSv", "2.3 mSv", "66"]],
         [80, 120, 120, 156])

# Citation quotes: (key, document, page, page_end, quote)
CITATIONS = [
    ("pump-30-day", "maintenance-handbook", 3, 3, "Primary coolant pumps shall receive a visual and vibration check every 30 days of normal operation. Where vibration exceeds the recorded baseline by more than 20 percent, an inspection shall be performed within 72 hours."),
    ("pump-18-month", "maintenance-handbook", 4, 4, "A full mechanical inspection of each primary coolant pump, including seals and bearings, shall be completed every 18 months and scheduled to coincide with the planned outage."),
    ("pump-log", "spent-fuel-checklist", 1, 1, "Confirm that the primary coolant pump log has been reviewed and signed within the past 30 days."),
    ("training-course", "radiation-protection-guide", 2, 2, "Before entering a controlled area for the first time, staff must complete the eight hour initial radiation safety course and pass its written assessment with a score of at least 80 percent. The qualification remains valid only while an annual refresher is completed."),
    ("dosimeter", "radiation-protection-guide", 3, 3, "A personal dosimeter must be issued and logged at the access point before each entry into a controlled area."),
    ("visitors", "radiation-protection-guide", 3, 3, "Visitors who have not completed the initial course may enter a controlled area only when escorted at all times by qualified staff and after receiving a safety briefing at the access point."),
    ("dose-rise", "annual-report-2024", 3, 3, "Average annual dose for monitored workers rose from 0.42 mSv in 2023 to 0.61 mSv in 2024."),
    ("dose-limit", "annual-report-2024", 3, 3, "All individual doses remained below the facility administrative limit of 5 mSv per year, which is set well below the regulatory limit."),
    ("outage-extended", "annual-report-2024", 2, 3, "The planned maintenance outage began in May and was extended by six weeks to complete replacement of the secondary heat exchanger."),
    ("operating-days", "annual-report-2024", 1, 1, "The reactor operated for 214 days in 2024, compared with 251 days in 2023."),
    ("no-events", "annual-report-2024", 1, 1, "There were no reportable safety events. Two minor equipment faults were corrected during scheduled maintenance."),
    ("pool-monthly", "spent-fuel-checklist", 1, 1, "Complete this checklist once a month and after any event that could affect pool water level or chemistry."),
    ("pool-signoff", "spent-fuel-checklist", 3, 3, "Any item not satisfied must be reported to the shift supervisor before the form is filed, and the supervisor records the action taken."),
    ("drills", "emergency-plan-2019", 2, 2, "Building evacuation drills are held at least twice a year, one of which is unannounced."),
]


def build(name: str, spec: dict, out: Path) -> pymupdf.Document:
    doc = pymupdf.open()
    writer = Writer(doc, spec["title"])
    for page in spec["pages"]:
        writer.new_page()
        for kind, text in page:
            if kind == "table":
                writer.table(TABLE[0], TABLE[1], TABLE[2])
            else:
                getattr(writer, kind)(text)
    writer.finish_page()
    doc.set_metadata({"title": f"{spec['title']} (sample)", "author": "Prototype sample data", "subject": "Fictional sample content"})
    doc.subset_fonts()
    doc.save(out / f"{name}.pdf", garbage=4, deflate=True)
    return pymupdf.open(out / f"{name}.pdf")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW_OUT.mkdir(parents=True, exist_ok=True)
    opened = {name: build(name, spec, OUT) for name, spec in DOCS.items()}
    for name, spec in REVIEW_DOCS.items():
        build(name, spec, REVIEW_OUT)

    # A scanned-only page (shapes, no text layer) and a password-protected file for review rejections.
    scan = pymupdf.open()
    page = scan.new_page(width=W, height=H)
    page.draw_rect((40, 40, W - 40, H - 40), color=None, fill=(0.93, 0.92, 0.9))
    for i in range(24):
        page.draw_line((90, 110 + i * 24), (W - 90 - (i % 4) * 40, 110 + i * 24), color=(0.6, 0.58, 0.55), width=5)
    scan.save(REVIEW_OUT / "inspection-photos-scan.pdf")
    locked = pymupdf.open()
    locked_page = locked.new_page(width=W, height=H)
    locked_page.insert_text((MARGIN, 100), "Locked sample", fontsize=14)
    locked.save(REVIEW_OUT / "contractor-agreement-locked.pdf", encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="sample", owner_pw="sample-owner")

    documents = {}
    for name, spec in DOCS.items():
        doc = opened[name]
        documents[name] = {"title": spec["title"], "file": f"{name}.pdf", "pages": doc.page_count,
                           "size": (OUT / f"{name}.pdf").stat().st_size}
    citations = {}
    for key, name, start, end, quote in CITATIONS:
        doc = opened[name]
        page = doc[start - 1]
        hits = page.search_for(quote)
        if not hits:
            # Long quotes can wrap across many lines; search sentence by sentence.
            parts = [part if part.endswith(".") else part + "." for part in quote.split(". ")]
            found = [page.search_for(part) for part in parts]
            hits = [rect for group in found for rect in group] if all(found) else []
        if not hits:
            raise SystemExit(f"Quote for {key!r} not found on {name} p{start}")
        pages = [{"page_number": start, "highlight_rects": [[round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)] for r in hits],
                  "coordinates_reliable": True, "page_width": page.rect.width, "page_height": page.rect.height}]
        for extra in range(start + 1, end + 1):
            pages.append({"page_number": extra, "highlight_rects": [], "coordinates_reliable": False,
                          "page_width": W, "page_height": H})
        citations[key] = {"document": name, "page_start": start, "page_end": end, "quote": quote, "pages": pages}
    MANIFEST.write_text(json.dumps({"documents": documents, "citations": citations}, indent=1) + "\n")
    print(f"Wrote {len(documents)} documents and {len(citations)} citations")


if __name__ == "__main__":
    main()
