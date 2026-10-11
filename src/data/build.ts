// One id per build. The page carries it in a meta tag and /version.json serves it, so a home screen app that kept an old page
// in memory can tell a newer hub is live and reload itself.
export const BUILD = String(Date.now());
