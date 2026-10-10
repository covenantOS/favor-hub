Meetings end-to-end checks (Playwright, Edge). They run against a local `wrangler pages dev dist` on port 8837 with a real SFU app,
the local D1 from `db/*.sql`, a stand-in for Google Calendar (`gstub.py`) and the test sign-in key (`signin-test/testkey.py serve 8899`).
Paths inside the scripts point at the Q: scratch folders on the desktop. `.dev.vars` is never committed.
