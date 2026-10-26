posthog.groupIdentify({
  groupType: "organization",
  groupKey: String(orgSubject),
  properties: { email: whoami.email },
});
