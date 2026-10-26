telemetry.capture("cli_report_published", {
  ...tierCounts(report),
  withheldFixtures: report.redaction.withheldFixtures,
});
