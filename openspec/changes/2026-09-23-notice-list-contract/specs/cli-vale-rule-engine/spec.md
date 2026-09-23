## ADDED Requirements

### Requirement: Independent Vale advisories stay separate notices

When a single Vale run has more than one thing to say without failing, the engine SHALL carry each as its own notice rather than folding them into one.

The two arise independently and a project can perfectly well draw both at once: the converter-skip notice naming files this build cannot parse, and Vale's own stderr from a run that still exited zero. The config schema's advisories about the assembled rules are a third, and they ride beside whatever Vale itself reported. Folding them into one message made the second and later ones render without a marker of their own, which reads as stray output rather than as something the run is telling the author.

The engine SHALL NOT choose a separator between notices: presentation belongs to the renderer, which marks each notice and each of its lines.

#### Scenario: A skip notice and a zero-exit diagnostic are two notices

- **WHEN** one Vale run both declines a converter-dependent file and writes a diagnostic to stderr while exiting zero
- **THEN** the engine SHALL report two notices, one for each

#### Scenario: A config advisory rides beside Vale's own report

- **WHEN** the config schema advises on an assembled rule and Vale then reports a diagnostic of its own
- **THEN** the two SHALL reach the check result as separate notices

#### Scenario: A config advisory survives a Vale that could not run

- **WHEN** the config schema advises on an assembled rule and the Vale binary is unavailable
- **THEN** the advisory and the unavailability message SHALL both reach the result, as separate notices
