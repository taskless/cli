auth = {
  user: whoami.user,
  email: whoami.email,
  orgs: whoami.orgs.map((o) => o.name),
};
