# Contributing

Thanks for contributing. This repository is building an offline document-QA desktop application. Before making a change, read the [Product Requirements Document](docs/product/PRD.md), the [System Design Document](docs/architecture/SDD.md), and the applicable [AGENTS.md instructions](AGENTS.md). The PRD and SDD define the product and system; update them when an approved change alters their requirements or design.

## Issues and discussion

- Check existing issues and pull requests before opening a new one.
- For a substantial behavior or architecture change, describe the problem and proposed approach in an issue first.
- Architecture changes must be recorded in the SDD or an Architecture Decision Record under `docs/architecture/decisions/` before implementation.
- Do not include sensitive documents, credentials, signing keys, model weights, or other restricted data in issues or commits.

## Branch names

Create feature branches from `main`. Use a short, descriptive kebab-case name with one of these prefixes:

- `feat/<description>` — product feature
- `fix/<description>` — bug fix
- `docs/<description>` — documentation
- `test/<description>` — test-only change
- `refactor/<description>` — behavior-preserving restructuring
- `chore/<description>` — maintenance or tooling

Examples: `docs/contributor-guide`, `feat/library-import`, `fix/citation-validation`.

Keep branches focused on one change. Avoid spaces, personal names, dates, and vague names such as `updates` or `work`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```text
<type>(optional-scope): <imperative summary>
```

Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `build`, and `chore`. Keep the summary concise, use imperative wording, and omit the final period.

Examples:

```text
docs: add contributor workflow
feat(library): validate imported PDFs
fix(answering): reject unsupported citations
```

Make commits small enough to review and keep unrelated formatting or cleanup out of feature commits. Never commit secrets, local configuration, generated artifacts, or restricted source documents.

## Pull requests

- Open pull requests against `main` and use a clear title, preferably following the same Conventional Commit style.
- Explain the problem, the approach, and any user-visible or architectural effects.
- Link related issues when applicable.
- Update the PRD for approved product-scope changes and the SDD or an ADR for approved design changes in the same pull request as the implementation.
- Add or update tests for changed behavior, following the SDD's public-interface test seams and acceptance requirements.
- Report the checks you ran and their results. If a required platform or hardware check was not available, say so in the PR description.
- Keep the pull request focused and respond to review comments with follow-up commits; do not rewrite shared history unless the maintainers request it.

## Code and documentation expectations

- Put code, tests, benchmarks, and contracts beside their owning feature as described in the SDD and local `AGENTS.md` files.
- Preserve offline operation, local-only service binding, evidence grounding, citation validation, privacy, and the one-question-at-a-time limit.
- Treat imported document content as untrusted input. Do not give the model tools or capabilities excluded by the SDD.
- Keep documentation links relative and verify that they point to existing files.
- Do not claim a check passed unless it was run and passed.
