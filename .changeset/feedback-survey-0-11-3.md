---
"@taskless/cli": patch
---

The feedback survey is replaced for 0.11.3. Only the kind of rule the user was trying to create is required now; the user's own words, the completion verdict, what worked, what did not, the agent in use, and the most valuable rule so far are all optional. A `skip` at the invite no longer dismisses the survey: the agent sends its own account of the session and leaves the user's words out. `feedback dismiss` is reserved for a user who asks that nothing be sent. Every install is invited once more, since the new survey keeps its own cadence.
