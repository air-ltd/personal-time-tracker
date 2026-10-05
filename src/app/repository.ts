/**
 * Where this project lives, and where to tell it something is wrong.
 *
 * One place, because a repository URL hardcoded into a component is a repository URL that
 * a fork has to go and find. `appHomeUrl` solves the same problem for the app's own URL by
 * deriving it from the current origin; a repository cannot be derived from an origin, so it
 * has to be stated once here rather than repeated in every view that wants to link out.
 */
export const REPOSITORY_URL = 'https://github.com/air-ltd/personal-time-tracker'

/**
 * A prefilled "new issue" link.
 *
 * Prefilled rather than bare so the reporter is looking at a form that already knows what
 * kind of thing they found. A bare "report a bug" link and an empty form are the same
 * link, and the empty form is the one that gets abandoned.
 */
export const NEW_ISSUE_URL = `${REPOSITORY_URL}/issues/new`
