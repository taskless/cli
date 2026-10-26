posthog.identify({
  distinctId,
  properties: {
    cli: anonymousId,
    cliVersion: CLI_VERSION,
    scaffoldVersion,
    ghOwner,
    ...dimensions,
  },
});
