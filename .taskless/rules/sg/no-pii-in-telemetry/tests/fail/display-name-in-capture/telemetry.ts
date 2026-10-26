ph.capture({
  distinctId,
  event,
  properties: {
    ...properties,
    cli: anonymousId,
    displayName: whoami.user,
  },
});
