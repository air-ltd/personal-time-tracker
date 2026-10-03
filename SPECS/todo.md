1. [x] Timer accuracy on save screen to the second. Done in `phase-2b`: the form's
   duration preview now shows `H:MM:SS` alongside the rounded minutes.
2. [ ] Need ability to categorise by job/client. Phase 4 (taxonomy).
3. [ ] Within a job/client have projects. Phase 4 (taxonomy). The data model already
   has `Client` and `Project.clientId`, so this is a UI and reporting phase rather
   than a schema change.
4. [x] Timer accuracy on front screen always to the second. Done in `phase-2b`: the
   running timer shows `H:MM:SS`.
5. [ ] stop should just stop and save, not present another screen - give a method for modify entry after the fact.
6. [x] Dropbox key given in the browser, with the setup instructions in-app. Done in
   `phase-2b`: `src/sync/appKey.ts` resolves the key from `localStorage` first and the
   build-time variable second, and `src/features/sync/DropboxSetup.tsx` collects it and
   shows the console steps plus both redirect URIs inline.
7. [x] Connecting to Dropbox appeared to work, then said "not connected". Done in
   `phase-2b`. Two bugs, both reproduced before fixing:
   (a) the PKCE verifier lived only in memory, and the OAuth redirect is a full page
   load, so it was gone on return and redemption silently failed — it is now persisted
   in `sessionStorage`, single-use, with an expiry (0012 AU4.1–AU4.3);
   (b) the Sync panel asked "am I connected?" without waiting for the token
   exchange to finish, so it read the store too early and reported not-connected for
   a successful authorisation (0012 AU4.4).
   Also added `state` verification (AU9) and made failures report their reason instead
   of failing quietly (AU10).
8. [ ] saving to 1 second accuracy, rather than to the minute.
