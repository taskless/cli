## ADDED Requirements

### Requirement: Each release flow lives in its own workflow file

Every release flow SHALL be defined in a workflow file of its own, carrying exactly one release design and a self-contained account of its trust boundary. A workflow file SHALL NOT combine a flow that consumes contributor-authored text with a flow that holds a publishing credential.

There SHALL be one workflow for opening the version pull request, one for publishing the CLI, one for publishing the Vale platform packages, and one for publishing the CLI nightly.

#### Scenario: The version flow holds no credential

- **WHEN** inspecting the workflow that runs the version bump and opens the version pull request
- **THEN** it SHALL request no OIDC identity, reference no publishing environment, and contain no publish step

#### Scenario: Each publishing flow is separately readable

- **WHEN** inspecting any workflow that publishes to the registry
- **THEN** its trust boundary — what it may publish, what gates it, and where its credential comes from — SHALL be documented in that file, without reference to another workflow's reasoning

#### Scenario: Workflow documentation matches the live configuration

- **WHEN** a workflow's comments describe the approval policy of the environment it uses
- **THEN** that description SHALL match the environment's configured policy

### Requirement: A credential-free gate decides whether a credentialed publish job exists

Each publishing flow SHALL decide whether there is anything to publish in a job holding no publishing credential and no OIDC identity, and SHALL instantiate the credentialed job only when that gate says yes. The gate SHALL live in the same workflow file as the job it protects.

#### Scenario: An ordinary push instantiates no credentialed job

- **WHEN** a commit is pushed to the default branch and nothing needs publishing
- **THEN** no job holding an OIDC identity or referencing a publishing environment SHALL run

#### Scenario: The gate and the job it protects are not separated

- **WHEN** inspecting a publishing workflow
- **THEN** the gate deciding whether to publish SHALL be defined in that same file

### Requirement: Publishing environments are distinguished by whether a human approves each release

The repository SHALL define two publishing environments. One SHALL require a human reviewer and SHALL be used by flows where approval decides what users receive by default. The other SHALL require no reviewer and SHALL be used by flows whose review gate is code review or a reviewed pull request, and whose output reaches no user until a separate reviewed change adopts it.

The reviewer-free environment SHALL still carry a branch policy restricting it to the default branch, and SHALL remain the audit boundary and the binding point for the registry's trusted-publisher configuration.

#### Scenario: The released CLI requires an approval

- **WHEN** the released CLI is published
- **THEN** the run SHALL use the environment with a required reviewer

#### Scenario: Unattended flows use the reviewer-free environment

- **WHEN** a flow publishes without a human click
- **THEN** it SHALL use the reviewer-free environment
- **AND** that environment SHALL restrict deployments to the default branch

#### Scenario: A publishing name has a trusted publisher before it is used

- **WHEN** a workflow publishes a package name for the first time
- **THEN** a trusted-publisher binding for that name SHALL already be registered, since the binding is per package and cannot exist before the name does

### Requirement: Release flows are serialized only where a race can corrupt shared state

The workflow that opens and updates the version pull request SHALL run under a concurrency group, because two runs racing on that branch is a real failure.

Publishing workflows SHALL NOT be serialized merely because they publish. Where a credential-free gate makes a duplicate run a no-op, the flow SHALL run unserialized, and the residual window in which two runs both observe "not yet published" SHALL be handled by treating a publish failure as possibly-already-published rather than as an error.

#### Scenario: The version flow is serialized

- **WHEN** two commits are pushed to the default branch in quick succession
- **THEN** the version pull request flow SHALL process them one at a time

#### Scenario: A duplicate publish run is a no-op

- **WHEN** two runs of a publishing flow evaluate the same commit or version
- **THEN** at most one artifact SHALL be published, and the other run SHALL neither fail nor publish a duplicate
