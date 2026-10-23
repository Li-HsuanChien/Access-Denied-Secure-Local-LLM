# Secure Local Document-QA System

## Product Requirements Document

### Problem

Organizations handling sensitive information want the benefits of AI-assisted document research without exposing their data to cloud services. A local language model alone does not address offline deployment, document grounding, usability, or limited hardware.

### Product

The MVP is a chatbot-style research assistant that runs entirely on one air-gapped laptop.

An analyst asks questions about a permanent collection of approved documents. The system finds relevant evidence and returns:

- A document-backed answer with document and page citations
- The source passages and pages used, where each citation opens the cached source PDF at the cited page with the supporting sentence highlighted
- Interpretation of relevant diagrams, charts, tables, or schematics
- Clearly labeled general model knowledge
- Warnings when evidence is missing, conflicting, or uncertain

Conversations are multi-turn: each chat thread keeps its own memory of earlier turns (a running summary plus recent messages) so follow-up questions are understood in context, while every document-supported claim still cites retrieved evidence. Saved threads appear in the sidebar and reopen as complete conversations that can be resumed, with source PDF citations available on earlier answers. Conversation history remains encrypted on the laptop.

### Users

The product is intended for one authorized nontechnical user.

Application authentication, user roles, and document-level permissions are outside the MVP.

### Document Collection

The initial collection will contain approximately 2,000–5,000 pages of public IAEA or comparable documents with extractable digital text.

A collection of up to 10,000 pages may be used for stress testing.

In Library, users can preview accepted PDFs before confirming publication. The same tab shows Knowledge Collections with clickable PDF filenames for previewing published documents.

Documents enter the laptop through controlled removable media. Documents attached directly to chats are outside the MVP.

### Constraints

- All data and processing remain on the laptop
- No network access, cloud services, or remote resources
- Reference hardware: 8 GB RAM, integrated graphics, and no dedicated accelerator
- One question processed at a time
- Target response time below 30 seconds for straightforward text questions
- Maximum target response time of two minutes for visually complex questions

### Success Measures

The MVP will be evaluated on:

- Retrieval accuracy
- Answer correctness and grounding
- Citation correctness
- Refusal behavior when evidence is insufficient
- Visual-question accuracy
- Response latency
- Peak memory use
- Offline stability
- Absence of outbound network activity
- Resistance to instructions embedded inside documents

Several local multimodal models and compression levels may be evaluated. The deployed MVP will use one selected answering model.

### Deliverables

- Offline document-QA prototype
- Reproducible deployment and document-import process
- Model and hardware evaluation
- Benchmark and adversarial test results
- Threat model and network-isolation evidence
- Administrator and user instructions

### Out of Scope

- Fine-tuning
- Autonomous agents
- Internet or web search
- Documents attached directly to chats
- Application authentication or role-based permissions
- Dynamic model routing
- OCR for scanned-only documents
- Multi-device deployment
- Integration with live sensitive systems

In Knowledge Collections, uploads add PDFs to the library. Each PDF has a persistent on/off control for use in future answers and a Delete action requiring explicit confirmation. Disabled PDFs remain available for preview; deleting removes the PDF and its searchable content. Snapshot rollback is no longer a user-facing library workflow.
