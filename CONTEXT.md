# AgentForge

AgentForge is an arena where builders create, run, submit, score, and remix AI workflows against challenges.

## Localization

**Display Language**:
The language AgentForge uses for its own interface and system-authored content. The supported display languages are English and Simplified Chinese.
_Avoid_: Site language, content language

**System Content**:
Text authored and controlled by AgentForge, including built-in challenges, catalog entries, badges, node type labels, validation feedback, and interface copy. System Content may be localized for the selected Display Language.
_Avoid_: User content, generated content

**Builder Content**:
Text authored or supplied by a builder, including build titles, prompts, custom challenge content, persisted Workflow node labels, provider metadata, and model output. Builder Content is displayed verbatim and is not automatically translated.
_Avoid_: System Content, localized content

**Canonical Value**:
A stable value used by workflows, judges, scoring, filtering, or persistence regardless of Display Language. A translated label may represent a Canonical Value but must not replace it.
_Avoid_: Display label, translated value

**Product Voice**:
The restrained, professional, developer-oriented tone used for AgentForge System Content. It may retain competitive energy but avoids childish, theatrical, role-playing, or exaggerated language.
_Avoid_: Game narration, fantasy terminology, literal translations that sound unnatural

## Evaluation Trust

**Trust Lane**:
A mutually exclusive class of competitive results defined by who controls model execution and how comparable the runs are. Results from different Trust Lanes must not share a ranking.
_Avoid_: Tier, provider type

**Official BYOK Run**:
A measured run using a builder-supplied credential sent directly to a supported model vendor's official endpoint. It may receive hidden evaluation inputs, but it is not certified as platform-controlled.
_Avoid_: Verified run, trusted run

**Verified Run**:
A competitively certified run executed through AgentForge-controlled credentials under one Benchmark Profile. Only Verified Runs belong in the certified leaderboard.
_Avoid_: Official run, platform run

**Benchmark Profile**:
A versioned comparability contract that identifies the exact model offering and the evaluation controls under which Verified Runs compete.
_Avoid_: Model ID, provider config

**Platform Credit**:
A limited entitlement granted by AgentForge for a builder to perform Platform-Sponsored Execution.
_Avoid_: Token, API credit

**Custom Endpoint Run**:
An experimental run through a non-official or privately controlled model endpoint available only to administrators or invited developers. It cannot access hidden evaluations or produce ranked submissions.
_Avoid_: BYOK run, verified run

**Platform-Sponsored Execution**:
Model execution whose external cost and execution policy are controlled by AgentForge through the Platform Model Gateway. It is the execution source for Verified Runs.
_Avoid_: Free model, platform BYOK

**Platform Model Gateway**:
The AgentForge-controlled model boundary that maps a Benchmark Profile to an approved upstream model and enforces the profile's request policy.
_Avoid_: Transparent proxy, official provider

**Benchmark Season**:
A bounded competition period during which Verified Runs share one Benchmark Profile and compatible evaluation and scoring versions. A season closes when its upstream model identity materially changes.
_Avoid_: Leaderboard period, release

**Benchmark Cost**:
The normalized competitive cost calculated from prices frozen in a Benchmark Profile. It is comparable within a Benchmark Season and is distinct from the platform's actual expense.
_Avoid_: Provider bill, actual cost

**Actual Platform Spend**:
The external expense incurred by AgentForge for Platform-Sponsored Execution. It is an operational measure and never determines leaderboard order.
_Avoid_: Benchmark Cost, score cost

**Verification Ticket**:
The user-visible Platform Credit unit that authorizes one cost-capped Verified submission attempt.
_Avoid_: Token balance, API token

**Official Provider Registry**:
The AgentForge-owned catalog of supported model vendors, their official endpoints, approved model offerings and competitive capabilities. Builders select from the registry rather than defining an official endpoint themselves.
_Avoid_: Host allowlist, provider form

**Execution Receipt**:
The non-secret evidence returned by the Platform Model Gateway identifying the enforced profile and configuration, normalized usage, operational cost and request identity for one model invocation.
_Avoid_: Model response, request log

**Credit Reservation**:
A temporary hold on a Verification Ticket while a Verified submission attempt is in progress. It is settled or refunded according to the attempt's terminal outcome.
_Avoid_: Charge, completed spend

**Legacy Submission**:
A historical submission that lacks the Benchmark Profile, Season or execution provenance required by the current Trust Lane rules. It remains viewable as history but cannot participate in a current leaderboard.
_Avoid_: Verified submission, migrated submission

**Evaluation Suite**:
A versioned collection of public and hidden cases used to evaluate Builds for a Challenge. Production hidden cases are confidential assets rather than repository fixtures.
_Avoid_: Fixtures, benchmark profile

**Verified Submission Job**:
The tracked lifecycle of one cost-capped attempt to turn a frozen Build Version into a Verified Submission. It may end without a Submission when verification fails.
_Avoid_: Browser run, background request

**Budget Fuse**:
The platform safety boundary that reserves and limits Actual Platform Spend before allowing Platform-Sponsored Execution. Crossing a hard limit closes new Verified attempts rather than selecting another Trust Lane.
_Avoid_: Soft quota, leaderboard cost

**Audit Event**:
An immutable record of a sensitive administrative decision, its actor, target and resulting state transition.
_Avoid_: Application log, activity feed

**Consent Version**:
The immutable identity of the disclosure a builder accepted for one kind of model execution. A changed disclosure creates a new Consent Version rather than rewriting prior acceptance.
_Avoid_: Terms checkbox, current consent

## Community component publishing

**Component Library**:
The collection through which builders discover reusable AgentForge capabilities and their examples. Platform-provided entries and community-published entries have distinct origins.
_Avoid_: Model registry, leaderboard

**Author Self-Test**:
An author's evaluation of their own contribution using their own official model credential and allowance. It is not platform certification or evidence of improvement over a baseline.
_Avoid_: Verified Run, platform evaluation

**Publication Request**:
An author's request for AgentForge to review a contribution for public listing in the Component Library. It is distinct from a competitive Submission.
_Avoid_: Submission, benchmark entry

**Publication Review**:
The platform's assessment of whether a contribution may be publicly listed. Permission to list does not itself grant competitive verification.
_Avoid_: Verified certification, model score


**Community Experimental Release**:
A community contribution approved for public listing without implying completed platform effectiveness evaluation. Its publication status and evaluation evidence are distinct.
_Avoid_: Verified component, guaranteed improvement

**Platform Component Evaluation**:
A platform-selected assessment of a contribution's effects within a stated evaluation scope. It is separate from the author's self-test and competitive Verified certification.
_Avoid_: Publication Review, Verified Run


**Instruction Skill**:
A reusable contribution consisting of instructions and reference material for a model, without permission to run contributed code or access external tools by itself.
_Avoid_: Executable Skill, tool server

**Execution Admission**:
A platform decision permitting a particular executable extension to operate within an approved scope. It is independent of permission to list the contribution publicly and applies to private use as well.
_Avoid_: Publication Review, author consent

**Extension Application**:
An author's request to have an executable Skill or MCP integration considered for support and execution admission. Receipt or review of the application does not make the extension runnable.
_Avoid_: Installed component, active release

## Future vendor-agent testing

**Vendor Agent**:
An agent service maintained by an external vendor that builders may participate in testing through AgentForge. It is a test subject, distinct from a reusable Skill, a tool integration or an official model offering.
_Avoid_: Official Provider, MCP tool, Verified Agent

## Execution runtimes

**Execution Runtime**:
The task-execution mechanism selected for a frozen AgentForge run, distinct from the selected model offering. Different runtimes may use different execution strategies and are not automatically competitively comparable.
_Avoid_: Model provider, deployment environment

**Runtime Adapter**:
The AgentForge boundary that connects an execution runtime or a vendor's task service to the platform's authorized run lifecycle and evidence model.
_Avoid_: Model API adapter, tool permission

## Evaluation execution

**Evaluation Job**:
An accepted request for a frozen evaluation providing challenge feedback, a competitive result, Author Self-Test evidence, Platform Component Evaluation evidence or Creation Run evidence. Its purpose determines authority, budget ownership and permitted evidence; completion does not itself grant certification.
_Avoid_: Publication Review, Submission, email task

**Execution Budget Reservation**:
A temporary allocation of approved execution allowance that prevents concurrent evaluations from exceeding that allowance. It is not a purchased balance or a reservation of a Verification Ticket.
_Avoid_: Wallet balance, payment, Credit Reservation

## Artifact creation and showcases

**Environment Template**:
A versioned description of the approved resources and capabilities available to a Build. Selecting or composing a template requests capabilities; it does not grant execution permission.
_Avoid_: Runtime, model provider, permission grant

**Creation Brief**:
A builder's own task and approved inputs for a work, distinct from a platform Challenge and its evaluation suite.
_Avoid_: Hidden case, component self-test

**Creation Run**:
An execution of a frozen Build against a Creation Brief, producing private creation evidence. It does not itself produce a competitive Submission or certification.
_Avoid_: Author Self-Test, Verified Run

**Artifact Bundle**:
A sealed set of output files from one execution attempt and output scope. It is the work's result, not the Build's instructions or permission to publish them.
_Avoid_: Build Version, mutable workspace, public release

**Work Publication**:
An author's reviewed release of selected files from a fixed Artifact Bundle for viewing. Publishing the result does not grant access to or permission to fork private instructions and dependencies.
_Avoid_: Component Publication Request, competitive Submission

**Showcase Entry**:
A Work Publication admitted to a particular public challenge selection round. It receives community preference evidence, distinct from a hidden competitive Submission.
_Avoid_: Verified Submission, platform component evaluation

**Community Preference**:
The audience's recorded choices between eligible works within a stated selection policy. It is distinct from deterministic functional correctness and model trust certification.
_Avoid_: Model benchmark score, Verified score, Elo

**Artifact Arena implementation status (2026-09-07)**:
The current worktree contains partial contracts, migration/schema work, domain seams, fail-closed availability behavior and Agent Builder/preview foundations for these terms. A non-executing approved-environment compiler/validator and immutable runtime permission snapshot seam now exist; authoritative catalog resolution wiring, approved sandbox/runtime admission, CreationRun execution, durable Artifact/Showcase/Voting persistence, real sandbox/Pi execution, hidden Agent judging and production opening remain unavailable until their corresponding AA-V and operational gates have real evidence.
_Avoid_: treating the glossary, contract tests, in-memory providers, HTTP 503 behavior or a successful build as production acceptance
