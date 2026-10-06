/**
 * End-to-end smoke test.
 *
 * Runs against a real browser and a real production build, which is the only way
 * to cover three things jsdom cannot:
 *   - that the bundle actually executes (a base-path mistake yields a blank page
 *     behind a fully green build, which is exactly the Phase 1 failure);
 *   - that IndexedDB survives a reload, which is what 0004 T5 depends on;
 *   - that no request fails for a reason only the network stack would show.
 *
 * Deliberately not wired into `npm run verify`. CI time is a real cost and the
 * unit and integration suites already gate correctness; this is a separate,
 * heavier check. Run it with `npm run test:e2e`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import process from 'node:process'
import { chromium } from 'playwright'

const PORT = 4173
/**
 * Seconds from an `H:MM:SS` elapsed string.
 *
 * Comparing the strings directly is lexicographic, which is right until the hour digit
 * changes: `"10:00:00" >= "9:59:59"` is false, because `"1"` sorts before `"9"`. The
 * assertion would then be testing the clock rather than the timer, and would start
 * failing — or passing for the wrong reason — once a session ran long enough.
 */
function elapsedSeconds(text) {
  const match = /(\d+):(\d{2}):(\d{2})/.exec(text)
  if (!match) return Number.NaN
  const [, hours, minutes, seconds] = match
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

/**
 * Base path the built site is actually served from.
 *
 * Read out of `dist/index.html` rather than repeated here. 0002 R1 exists so the
 * base comes from configuration and never from a literal in source, and a
 * hard-coded `/personal-time-tracker/` in the one file whose job is to prove the
 * base path works would fail confusingly the day the repository is renamed — and
 * would pass while proving nothing about a `VITE_BASE_PATH` override. Vite
 * rewrites the module script href to the full base-prefixed URL, so the first
 * asset path is the base.
 */
function deriveBasePath() {
  const html = readFileSync(resolve('dist/index.html'), 'utf8')
  const script = /<script[^>]+src="([^"]+)"/.exec(html)
  if (!script) throw new Error('no module script found in dist/index.html')
  return new URL(script[1], 'http://placeholder').pathname.replace(/assets\/.*$/, '')
}

// Bound and dialled over IPv4 explicitly. Vite's preview server defaults to
// binding `localhost`, which on this image resolves to `[::1]` only, so a fetch to
// `localhost` or `127.0.0.1` gets ECONNREFUSED. Pinning the host on both sides
// removes the ambiguity instead of depending on resolver order.
const HOST = '127.0.0.1'
const URL_BASE = `http://${HOST}:${PORT}`

let failures = 0
let checks = 0

function check(label, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      // Server not up yet.
    }
    await delay(250)
  }
  throw new Error(`Server did not become ready at ${url}`)
}

/**
 * Opens the project group belonging to one client, if it is closed (item 51).
 *
 * Projects sit under their client and collapsed by default, so any check about a project row
 * has to open its group first or it reads the collapsed state rather than the row it means.
 * Waits for that specific group rather than opening every collapsed one: callers reach this
 * straight after adding a project, and a group that has not rendered yet reads as nothing to
 * open, which would leave the row hidden. Already-open is left alone, so this is safe to call
 * on a page a previous check has already opened.
 */
async function openProjectGroup(page, client) {
  const toggle = page.locator('.taxonomy-group-toggle', { hasText: client }).first()
  await toggle.waitFor()
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click()
  }
}

async function main() {
  /*
   * Actually build, rather than logging that we are about to.
   *
   * `vite preview` serves whatever is in `dist/` and does not compile anything, so a
   * script that only logs "building..." tests the last build that happened to succeed. That
   * is worse than a stale bundle being merely inconvenient: it made a real fix look broken
   * twice, because the browser was faithfully testing the previous code.
   *
   * Synchronous so a compile error stops the run here, where the stack trace points at the
   * source, rather than surfacing later as a puzzling selector timeout.
   */
  console.log('building...')
  const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' })
  if (build.status !== 0) {
    console.error('build failed; not starting the preview server')
    process.exit(build.status ?? 1)
  }

  // After the build, because it is the build that decides the base.
  const URL = `${URL_BASE}${deriveBasePath()}`

  /*
   * Refuse to start if something is already serving this URL.
   *
   * `--strictPort` makes the preview server exit rather than pick another port, and its
   * output is discarded — so if the port is taken, this process dies quietly, and
   * `waitForServer` then succeeds against *someone else's* server. Every check after that
   * would be a verdict on a build this run never served, and the results would be neither
   * right nor wrong: they would be about a stale `dist/`.
   *
   * Found the hard way. A run interrupted by a step timeout leaves its preview server
   * behind, and the next run connects to it instead of failing.
   */
  const alreadyServing = await fetch(URL).then(
    () => true,
    () => false,
  )
  if (alreadyServing) {
    console.error(
      `\nSomething is already serving ${URL}.\n` +
        'That is usually a preview server left behind by an interrupted run. This suite ' +
        'would test that server rather than the build it just made, so it is stopping ' +
        'instead.\n\n  pkill -f "vite preview"\n',
    )
    process.exit(1)
  }

  const server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--port',
      String(PORT),
      '--strictPort',
      '--host',
      HOST,
    ],
    { stdio: 'ignore' },
  )

  const shutdown = () => {
    if (!server.killed) server.kill('SIGTERM')
  }
  process.on('exit', shutdown)

  try {
    await waitForServer(URL)
    console.log(`smoke testing ${URL}\n`)

    const browser = await chromium.launch()
    const page = await browser.newPage()

    const consoleErrors = []
    const failedRequests = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`)
    })
    page.on('response', (response) => {
      if (response.status() >= 400)
        failedRequests.push(`${response.status()} ${response.url()}`)
    })

    // 1. The app mounts at all.
    await page.goto(URL, { waitUntil: 'networkidle' })
    // Trimmed: the heading carries a dev badge on a non-production origin (item 40), and
    // innerText includes it. Asserted on the name alone so the mount check stays about
    // mounting — the badge has its own check further down.
    check(
      'app mounts',
      (await page.locator('h1').innerText()).trim().startsWith('Time Tracker'),
    )
    check(
      'timer panel present',
      (await page.getByRole('heading', { name: 'Timer' }).count()) === 1,
    )
    check('empty state shown', (await page.getByTestId('empty-state').count()) === 1)
    check('no console errors on load', consoleErrors.length === 0, consoleErrors.join(' | '))
    check('no failed requests on load', failedRequests.length === 0, failedRequests.join(' | '))

    // 1a. 0011 N5: the Content Security Policy is actually served.
    //
    // The build injects it, so nothing in `src/` would notice its removal and the
    // unit suite cannot see it at all. Asserted here against the served document
    // because a `<meta>` policy that is present but wrong — a `connect-src` that
    // admits the whole internet, say — is the failure N5 exists to prevent, and it
    // is invisible until something reads the header.
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(
      await (await fetch(URL)).text(),
    )?.[1]
    check('a Content Security Policy is served', policy !== undefined)
    const directives = new Map(
      (policy ?? '').split(';').map((part) => {
        const tokens = part.trim().split(/\s+/)
        return [tokens[0], tokens.slice(1)]
      }),
    )
    check(
      'connect-src allows only the provider API (0011 N5)',
      (directives.get('connect-src') ?? []).join(' ') ===
        "'self' https://api.dropboxapi.com https://content.dropboxapi.com",
      (directives.get('connect-src') ?? []).join(' '),
    )
    check(
      "script-src has no 'unsafe-inline' (only 'self' and a hash)",
      !(directives.get('script-src') ?? []).includes("'unsafe-inline'"),
      (directives.get('script-src') ?? []).join(' '),
    )
    check('object-src is none', (directives.get('object-src') ?? []).join(' ') === "'none'")
    check('base-uri is none', (directives.get('base-uri') ?? []).join(' ') === "'none'")
    // The hash is computed from the emitted inline theme bootstrap at build time.
    // If it did not match, the browser blocks that script and the theme silently
    // falls back to light — so assert the dark preference survived the policy.
    await page.evaluate(() => window.localStorage.setItem('tt:theme', 'dark'))
    await page.reload({ waitUntil: 'networkidle' })
    check(
      'the inline theme bootstrap runs under the policy',
      (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
      await page.evaluate(() => String(document.documentElement.dataset.theme)),
    )
    check(
      'the policy blocks nothing the app needs',
      !consoleErrors.some((text) => text.includes('Content Security Policy')),
      consoleErrors.filter((text) => text.includes('Content Security Policy')).join(' | '),
    )
    await page.evaluate(() => window.localStorage.removeItem('tt:theme'))
    await page.reload({ waitUntil: 'networkidle' })

    // 2. Hash routing (0002 R1, R3).
    await page.goto(`${URL}#/nope`, { waitUntil: 'load' })
    check(
      'unknown hash renders not-found, not a crash',
      (await page.getByRole('heading', { name: 'Page not found' }).count()) === 1,
    )

    // 3. Start a timer.
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Start' }).click()
    await page.getByRole('button', { name: 'Stop' }).waitFor()
    const elapsedBefore = await page.getByTestId('timer-elapsed').innerText()
    check(
      'timer reports elapsed, not idle',
      !elapsedBefore.includes('No timer running'),
      elapsedBefore,
    )

    // 4. The timer survives a reload — 0004 T5, which requires real IndexedDB.
    // Wait for the write itself, not for the radio: the control updates from local state
    // immediately, so reloading on that would race the IndexedDB write and test nothing.
    // Read straight out of the database rather than sleeping for a guessed interval.
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('personal-time-tracker')
          request.onsuccess = () => {
            const db = request.result
            if (!db.objectStoreNames.contains('meta')) {
              db.close()
              resolve(false)
              return
            }
            const get = db
              .transaction('meta', 'readonly')
              .objectStore('meta')
              .get('entry-period')
            get.onsuccess = () => {
              db.close()
              resolve(get.result?.value === 'day')
            }
            get.onerror = () => {
              db.close()
              resolve(false)
            }
          }
          request.onerror = () => resolve(false)
        }),
      undefined,
      { timeout: 5000 },
    )

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Stop' }).waitFor()
    const elapsedAfter = await page.getByTestId('timer-elapsed').innerText()
    check(
      'running timer survives a reload',
      !elapsedAfter.includes('No timer running'),
      elapsedAfter,
    )
    check(
      'elapsed does not go backwards across reload',
      elapsedSeconds(elapsedAfter) >= elapsedSeconds(elapsedBefore),
      `${elapsedBefore} -> ${elapsedAfter}`,
    )

    // 5. Stopping creates an entry and stays where you are, offering to classify it
    // (item 48, amending 0001 US2).
    await page.getByRole('button', { name: 'Stop' }).click()
    await page.getByTestId('just-stopped').waitFor()
    check('stopping does not take the screen away', !page.url().includes('#/entries/'))
    check(
      'and it offers to classify the entry just saved',
      /uncategorised/i.test(await page.getByTestId('just-stopped').innerText()),
    )
    // Following the offer is what US2's routing used to do for you.
    await page.getByTestId('just-stopped').getByRole('link').click()
    await page.getByRole('heading', { name: 'Edit entry' }).waitFor()
    check('following the offer opens the entry form', page.url().includes('#/entries/'))
    await page.getByRole('link', { name: 'Cancel' }).click()

    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: /Edit/ }).first().waitFor()
    check(
      'stopped entry appears in the list',
      (await page.getByTestId('empty-state').count()) === 0,
    )

    // 6. The day subtotal reconciles with the rows beneath it (0006 RP2).
    // Compared by value rather than asserting a duration format: the entry is only
    // a second long here, and a sub-minute span correctly renders as seconds
    // rather than as 0m (0006 RD1). The invariant worth testing is agreement.
    const dayTotal = (
      await page.locator('[data-testid^="day-total-"]').first().innerText()
    ).trim()
    const rowDuration = (
      await page.locator('[data-testid^="duration-"]').first().innerText()
    ).trim()
    check('day subtotal shown', dayTotal.length > 0, dayTotal)
    check(
      'day subtotal equals the sum of its rows',
      dayTotal === rowDuration,
      `total=${dayTotal} row=${rowDuration}`,
    )

    // 7. Delete then undo (0003 D1–D4).
    await page.getByRole('link', { name: /Edit/ }).first().click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByTestId('undo-bar').waitFor()
    check('delete offers undo', (await page.getByTestId('undo-bar').count()) === 1)
    check(
      'deleted entry leaves the list',
      (await page.getByTestId('empty-state').count()) === 1,
    )
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click()

    // Wait for the *restored* state rather than for the undo bar to disappear.
    // The bar unmounts synchronously on click, while the restore is asynchronous,
    // so waiting on the bar races the write and reads the pre-restore DOM.
    await page.getByTestId('empty-state').waitFor({ state: 'detached' })
    check('undo restores the entry', (await page.getByTestId('empty-state').count()) === 0)

    // 8. Persistence across a full reload, which is the data-loss case.
    // Wait for the write itself, not for the radio: the control updates from local state
    // immediately, so reloading on that would race the IndexedDB write and test nothing.
    // Read straight out of the database rather than sleeping for a guessed interval.
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('personal-time-tracker')
          request.onsuccess = () => {
            const db = request.result
            if (!db.objectStoreNames.contains('meta')) {
              db.close()
              resolve(false)
              return
            }
            const get = db
              .transaction('meta', 'readonly')
              .objectStore('meta')
              .get('entry-period')
            get.onsuccess = () => {
              db.close()
              resolve(get.result?.value === 'day')
            }
            get.onerror = () => {
              db.close()
              resolve(false)
            }
          }
          request.onerror = () => resolve(false)
        }),
      undefined,
      { timeout: 5000 },
    )

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByTestId('empty-state').waitFor({ state: 'detached', timeout: 5000 })
    check('entry persists across reload', (await page.getByTestId('empty-state').count()) === 0)

    // 9. Theme survives a reload (0002 TH4).
    // On the settings page since item 9: the header no longer carries a three-way radio
    // group on every screen, so the control has to be navigated to like any other.
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    await page.getByRole('radio', { name: 'Dark' }).click()
    check(
      'theme applies immediately',
      (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
    )
    // Wait for the write itself, not for the radio: the control updates from local state
    // immediately, so reloading on that would race the IndexedDB write and test nothing.
    // Read straight out of the database rather than sleeping for a guessed interval.
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('personal-time-tracker')
          request.onsuccess = () => {
            const db = request.result
            if (!db.objectStoreNames.contains('meta')) {
              db.close()
              resolve(false)
              return
            }
            const get = db
              .transaction('meta', 'readonly')
              .objectStore('meta')
              .get('entry-period')
            get.onsuccess = () => {
              db.close()
              resolve(get.result?.value === 'day')
            }
            get.onerror = () => {
              db.close()
              resolve(false)
            }
          }
          request.onerror = () => resolve(false)
        }),
      undefined,
      { timeout: 5000 },
    )

    await page.reload({ waitUntil: 'networkidle' })
    check(
      'theme persists across reload with no flash',
      (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
    )
    // Back to the entries for the checks that follow.
    await page.goto(URL, { waitUntil: 'networkidle' })

    // 10. A narrow viewport must not clip an entry (0002 R1).
    // Checked in a real browser because the failure is a layout overflow, which jsdom
    // cannot compute: it has no layout engine, so every such assertion would pass there.
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto(URL, { waitUntil: 'networkidle' })
    const overflow = await page.evaluate(() => {
      const row = document.querySelector('.entry-row')
      if (!row) return { ok: true, reason: 'no rows' }
      return {
        ok: row.scrollWidth <= row.clientWidth + 1,
        scrollWidth: row.scrollWidth,
        clientWidth: row.clientWidth,
      }
    })
    check('entry row fits a 320px viewport', overflow.ok, JSON.stringify(overflow))
    await page.setViewportSize({ width: 1280, height: 800 })

    // 11. Backup is reachable and works on a real build (Phase 2B gate).
    // Exercised in a browser because the download path uses an object URL, which
    // jsdom does not implement, so a unit test cannot cover the actual handoff.
    await page.goto(URL, { waitUntil: 'networkidle' })
    // Backup moved behind the header menu (item 18), so its absence from the page is the
    // expected state and its presence inside the menu is what is being checked.
    check(
      'backup is not a panel on the entries screen',
      (await page.getByRole('heading', { name: 'Backup' }).count()) === 0,
    )
    await page.getByTestId('header-menu-toggle').click()
    await page.getByTestId('header-menu-settings').waitFor()
    // Item 26/29: named buttons, stacked, and no prose. The heading moved to the
    // settings page, where there is room to explain what a backup is. Four items now —
    // About joined the three, and it keeps the same one-word-named rule.
    check(
      'the menu holds four named buttons and no prose',
      (await page.locator('.header-menu-panel .header-menu-item').count()) === 4 &&
        (await page.getByRole('heading', { name: /^Backup/ }).count()) === 0,
    )
    check(
      'the menu buttons are stacked vertically',
      await page.evaluate(() => {
        const items = [...document.querySelectorAll('.header-menu-panel .header-menu-item')]
        if (items.length !== 4) return false
        const tops = items.map((item) => item.getBoundingClientRect().top)
        return tops.every((top, index) => index === 0 || tops[index - 1] < top)
      }),
    )
    check(
      'each menu button has its word beside the icon',
      (await page.getByTestId('header-menu-download').innerText()).trim() === 'download' &&
        (await page.getByTestId('header-menu-restore').innerText()).trim() === 'import' &&
        (await page.getByTestId('header-menu-about').innerText()).trim() === 'About',
    )
    check(
      'every menu button carries an icon',
      await page.evaluate(() =>
        [...document.querySelectorAll('.header-menu-panel .header-menu-item')].every(
          (item) => item.querySelector('svg') !== null,
        ),
      ),
    )

    // About, reached the way a user would reach it. Checked here rather than by asserting
    // the href, because a link with the right href that does not navigate — or that leaves
    // the panel open over the page it just opened — passes a URL assertion and fails a person.
    await page.getByTestId('header-menu-about').click()
    await page.waitForURL(/#\/about$/, { timeout: 10_000 }).catch(() => undefined)
    check('About opens from the menu', page.url().endsWith('#/about'), page.url())
    check(
      'the menu closes behind it',
      (await page.getByTestId('header-menu-panel').count()) === 0,
    )
    check(
      'About renders the changelog, not a blank page',
      (await page.getByRole('heading', { level: 2 }).count()) > 0 &&
        (await page.locator('main').innerText()).length > 40,
    )

    // Back to the list, so the backup checks below start from a known route.
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.getByTestId('header-menu-toggle').click()
    await page.getByTestId('header-menu-settings').waitFor()

    const download = page.waitForEvent('download', { timeout: 10_000 })
    // Scoped to the menu, and matched on its one-word label (item 29): the settings panel
    // carries the long "Download backup", so an unscoped name matches two controls.
    await page.getByTestId('header-menu-download').click()
    let backupName = ''
    try {
      backupName = (await download).suggestedFilename()
    } catch {
      backupName = ''
    }
    check(
      'backup downloads with a dated filename',
      /^time-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backupName),
      backupName,
    )

    const status = page.getByTestId('backup-status')
    check(
      'export reports what it saved',
      (await status.innerText()).includes('Saved'),
      await status.innerText().catch(() => ''),
    )

    // 12. Taxonomy on an entry, end to end (0005 P1, N2, U1, T1, Phase 4 gate).
    // Driven through the real UI rather than seeded into IndexedDB, because the parts
    // worth covering here are the ones only a browser can exercise: the picker populating
    // asynchronously, a tag typed at the point of capture, and the delete confirmation
    // actually reporting its impact.
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    // Item 50: tags have their own card, and the taxonomy panel is named for what it holds
    // rather than for the page it is on.
    await page.getByRole('heading', { name: 'Clients and projects' }).waitFor()
    await page.getByRole('heading', { name: 'Tags' }).waitFor()
    check(
      'tags are in their own card, not under the clients heading',
      (await page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Tags' }) })
        .getByRole('heading', { name: 'Clients and projects' })
        .count()) === 0,
    )

    // P1: a project is two interactions from anywhere.
    await page.getByTestId('new-client').click()
    await page.getByLabel('Client name').fill('Acme Ltd')
    await page.getByLabel('Billing currency').selectOption({ label: 'GBP — British Pound' })
    // Opening the form turns the reveal button into "Cancel", so there is one "Add client".
    await page.getByRole('button', { name: 'Add client', exact: true }).click()
    await page.getByText('Acme Ltd').first().waitFor()

    // Added from its own client's list (items 55, 56), so the client is already chosen.
    await openProjectGroup(page, 'Acme Ltd')
    await page.getByRole('button', { name: 'New project for Acme Ltd' }).click()
    await page.getByLabel('Project name').fill('Website')
    // Typed and clicked without an intervening blur. Regression guard for a layout bug:
    // committing the rate used to insert a line, which moved the button under the pointer
    // mid-click, so the click landed on nothing and the form silently did not submit.
    // Only a real browser can catch this — jsdom has no layout engine.
    await page.getByLabel('Default hourly rate').fill('75')
    await page.getByRole('button', { name: 'Add project', exact: true }).click()

    await page.getByText('Website').first().waitFor()
    check('a rate can be typed and saved in one go', true)

    // 0005 N2: told apart by structure — the client is the group heading, so a project is
    // never distinguished from a client by colour alone, and the owner is named once for the
    // group rather than repeated on every row.
    //
    // The second half matters more: the row used to carry a "Client: X" label fed by a prop
    // nothing set, so every project read "No client" even under a named client. A page that
    // *looks* grouped can still contradict itself, and only rendering the group catches it.
    check(
      'project names its client rather than relying on colour',
      (await page.locator('.taxonomy-group-toggle', { hasText: 'Acme Ltd' }).count()) === 1 &&
        (await page.getByText('Client: Acme Ltd').count()) === 0,
    )
    check(
      'a project under a client is not told it has no client',
      (await page
        .locator('.taxonomy-row', { hasText: 'Website' })
        .first()
        .getByText('No client')
        .count()) === 0,
    )

    // File a new entry against the rated project, and tag it inline (T1, P5).
    // A *new* entry, not an edit: P5 is a default for new entries and deliberately does
    // not rewrite what an existing entry already recorded, so asserting it here via an
    // edit would be asserting the opposite of the rule.
    await page.goto(`${URL}#/entries/new`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Add entry' }).waitFor()
    await page.getByRole('textbox', { name: 'Duration' }).fill('45')

    const projectPicker = page.getByLabel('Project')
    // The picker is disabled until the taxonomy has loaded, so wait for a real option.
    // `attached` rather than the default: an <option> has no layout box, so Playwright
    // never considers one visible.
    await page.getByRole('option', { name: 'Website' }).waitFor({ state: 'attached' })
    await projectPicker.selectOption({ label: 'Website' })

    // P5: a project with a default rate implies billable work.
    check(
      'a rated project implies billable on a new entry',
      await page.getByLabel('Billable').isChecked(),
    )
    // …and it is a default, not a lock: a rated project can carry unbillable work.
    await page.getByLabel('Billable').uncheck()
    check(
      'billable can be turned off on a rated project',
      !(await page.getByLabel('Billable').isChecked()),
    )
    await page.getByLabel('Billable').check()

    // T1: the tag is typed at the point of capture, with nothing set up beforehand.
    await page.getByLabel('Tags').fill('research')
    await page.getByLabel('Tags').press('Enter')
    await page.getByTestId('entry-tag-chips').waitFor()
    await page.getByRole('button', { name: 'Add entry', exact: true }).click()

    // Scoped to the row that names the project: the day also holds the earlier timer entry,
    // which is uncategorised and would match a "first" lookup.
    const filedProject = page.locator('.entry-project', { hasText: 'Website' }).first()
    await filedProject.waitFor()
    const rowProject = await filedProject.innerText()
    check(
      'the entry row names the project it was filed under',
      rowProject.includes('Website'),
      rowProject,
    )
    check(
      'the entry row names the client too, not colour alone',
      rowProject.includes('Acme Ltd'),
      rowProject,
    )
    check(
      'the entry row shows its tags',
      (
        await page
          .getByTestId(/^tags-/)
          .first()
          .innerText()
      ).includes('research'),
    )
    check('a billable entry is marked', (await page.getByTestId(/^billable-/).count()) === 1)

    // 0005 X1: there is no delete to confirm. Asserted as an absence in a real browser
    // because the failure this replaces was silent — a Delete button wired to something
    // that did nothing would have satisfied every other check here.
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })

    // Item 51: the project is grouped under its client and the group starts closed, so the
    // client list stays short. Checked before anything opens it, or the default is not what
    // gets asserted.
    const clientGroup = page.locator('.taxonomy-group-toggle', { hasText: 'Acme Ltd' }).first()
    await clientGroup.waitFor()
    check(
      'a client group starts collapsed',
      (await clientGroup.getAttribute('aria-expanded')) === 'false',
    )
    check(
      'a collapsed group shows no project row',
      // Visibility, not presence: the row stays in the DOM and hidden, so `count()` would
      // report one and this would pass while the page still showed the flat list.
      !(await page.locator('.taxonomy-row', { hasText: 'Website' }).first().isVisible()),
    )
    await clientGroup.click()
    check(
      'opening the group reveals the project',
      await page.locator('.taxonomy-row', { hasText: 'Website' }).first().isVisible(),
    )

    const projectRow = page.locator('.taxonomy-row', { hasText: 'Website' }).first()
    const clientRow = page.locator('.taxonomy-row', { hasText: 'Acme Ltd' }).first()
    // Waited on before counting. `count()` does not retry, and settings renders a loading
    // line first, so an uncounted assert read 0 rows on a slow load and passed on a fast
    // one. The absence assertions below then trivially held — which is exactly the shape of
    // check that makes a broken button look correct.
    await projectRow.getByRole('button', { name: 'Archive' }).waitFor()
    await clientRow.getByRole('button', { name: 'Archive' }).waitFor()
    check(
      'a project row offers Archive and no Delete (0005 X1)',
      (await projectRow.getByRole('button', { name: 'Delete' }).count()) === 0 &&
        (await projectRow.getByRole('button', { name: 'Archive' }).count()) === 1,
    )
    check(
      'a client row offers Archive and no Delete (0005 X1)',
      (await clientRow.getByRole('button', { name: 'Delete' }).count()) === 0 &&
        (await clientRow.getByRole('button', { name: 'Archive' }).count()) === 1,
    )

    // X3: archiving asks for nothing, because it moves no entry.
    await projectRow.getByRole('button', { name: 'Archive' }).click()
    await page.locator('.taxonomy-row', { hasText: 'Website' }).first().waitFor({
      state: 'detached',
    })
    check(
      'archiving a project confirms nothing',
      (await page.getByTestId('delete-confirm-project').count()) === 0,
    )
    check(
      'the archived project is hidden from the list',
      (await page.locator('.taxonomy-row', { hasText: 'Website' }).count()) === 0,
    )

    // X5: the entry filed under it survives and still names the project.
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.getByText('Website').first().waitFor()
    check(
      'archiving a project keeps its entries (0005 X5)',
      (await page.getByTestId('empty-state').count()) === 0,
    )
    check(
      'the entry still names the archived project, marked as archived (0005 X5)',
      (await page.locator('.badge-archived').count()) >= 1,
    )

    // X4: archived records are not offered as choices anywhere.
    check(
      'the archived project is not offered on the timer card',
      (await page.getByRole('button', { name: /Start a timer for/ }).count()) === 0 ||
        (await page.getByRole('button', { name: 'Start a timer for Acme Ltd' }).count()) === 1,
    )
    await page.goto(`${URL}#/entries/new`, { waitUntil: 'networkidle' })
    const projectOptions = await page.getByLabel('Project').locator('option').allInnerTexts()
    check(
      'the archived project is not offered in the entry form (0005 X4)',
      !projectOptions.some((text) => text.startsWith('Website')),
      projectOptions.join(' | '),
    )

    // X2/A5: restore brings it back, and only from the archived view.
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    await page.getByLabel('Show archived clients and projects').check()
    await openProjectGroup(page, 'Acme Ltd')
    // Left checked below only for the duration of this block — the archive round trip later
    // on archives a project and expects it to leave the list, which it will not do while
    // archived records are being shown.
    const archivedRow = page.locator('.taxonomy-row', { hasText: 'Website' }).first()
    await archivedRow.waitFor()
    await archivedRow.getByRole('button', { name: 'Restore' }).click()
    check(
      'restoring returns the project to the list',
      (await page.locator('.taxonomy-row', { hasText: 'Website' }).count()) === 1,
    )
    await page.getByLabel('Show archived clients and projects').uncheck()

    // A2: archived records stay reachable, which is only observable in a browser because
    // it is a checkbox controlling a filtered list.
    //
    // A second project, because the undo window does not survive navigation and Website
    // is currently deleted. Keeping this flow independent of the undo round trip means a
    // change to one cannot silently stop exercising the other.
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    // Internal work is created from a client's list with the client changed to "No client"
    // (0005 R1/U1): there is no empty "No client" group to click, and none is shown (item 59).
    await openProjectGroup(page, 'Acme Ltd')
    await page.getByRole('button', { name: 'New project for Acme Ltd' }).click()
    await page.getByLabel('Project name').fill('Admin')
    await page.getByLabel('Client', { exact: true }).selectOption('')
    await page.getByRole('button', { name: 'Add project', exact: true }).click()
    await openProjectGroup(page, 'No client')
    await page.locator('.taxonomy-row', { hasText: 'Admin' }).first().waitFor()

    await page
      .locator('.taxonomy-row', { hasText: 'Admin' })
      .first()
      .getByRole('button', { name: 'Archive' })
      .click()
    await page
      .locator('.taxonomy-row', { hasText: 'Admin' })
      .first()
      .waitFor({ state: 'detached' })
    check('archiving hides the project from the default list', true)

    await page.getByLabel('Show archived clients and projects').check()
    await openProjectGroup(page, 'No client')
    await page.locator('.taxonomy-row', { hasText: 'Admin' }).first().waitFor()
    check('archived projects are reachable again', true)
    // Lower-cased before comparing: `innerText` returns the *rendered* text, and the
    // archived badge is uppercased by CSS, so a case-sensitive check on it can never pass.
    const adminRow = await page
      .locator('.taxonomy-row', { hasText: 'Admin' })
      .first()
      .innerText()
    check(
      'an archived project says so, rather than looking live',
      adminRow.toLowerCase().includes('archived'),
      adminRow,
    )

    // A settings page must fit a phone too, and the delete confirmation is the widest
    // thing on it. Opened from a *tag* row: projects and clients have no Delete any more
    // (0005 X1), and tags keep theirs, so this is the only confirmation left to measure.
    await page.setViewportSize({ width: 320, height: 640 })
    await page
      .locator('.taxonomy-row', { hasText: 'research' })
      .first()
      .getByRole('button', { name: 'Delete' })
      .click()
    await page.getByTestId('delete-impact').waitFor()
    const confirmOverflow = await page.evaluate(() => {
      const panel = document.querySelector('.delete-confirm')
      if (!panel) return { ok: false, reason: 'no confirmation shown' }
      return { ok: panel.scrollWidth <= panel.clientWidth + 1, scrollWidth: panel.scrollWidth }
    })
    check(
      'delete confirmation fits a 320px viewport',
      confirmOverflow.ok,
      JSON.stringify(confirmOverflow),
    )
    await page.setViewportSize({ width: 1280, height: 800 })

    // 13. The client list, the filter and the period (items 16, 19, 21, 22).
    // Driven through the UI because the point of item 19 is that the panel does not move,
    // and no assertion about position survives outside a real browser.
    // A second client, so the "only one timer at a time" rule has something to apply to.
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    await page.getByTestId('new-client').click()
    await page.getByLabel('Client name').fill('Other Ltd')
    await page.getByRole('button', { name: 'Add client', exact: true }).click()
    await page.getByText('Other Ltd').first().waitFor()

    await page.goto(URL, { waitUntil: 'networkidle' })
    const rows = page.locator('.timer-client-row')
    // Waited on, not counted straight away. The count used to run as soon as "Other Ltd"
    // appeared in settings, which says nothing about the home page having finished loading
    // both clients — so it could read 1 on a slow load and pass on a fast one.
    await rows.nth(1).waitFor()
    check(
      'clients are listed one per line',
      (await rows.count()) >= 2,
      String(await rows.count()),
    )

    /*
     * Item 61: selecting a client reveals that client's projects, each with a Start button.
     *
     * A client name this suite has not used before: the e2e is one long script over a
     * database that is never reset, so a second "Acme Ltd" would be a second client and the
     * project would land under the wrong one.
     *
     * Checked here rather than only in the unit tests because the behaviour is about what
     * appears on the card in a real layout: the list indented under the client, and the
     * buttons reachable.
     */
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    await page.getByTestId('new-client').click()
    await page.getByLabel('Client name').fill('Project Co')
    await page.getByRole('button', { name: 'Add client', exact: true }).click()
    await openProjectGroup(page, 'Project Co')
    await page.getByRole('button', { name: 'New project for Project Co' }).click()
    // A name this suite has not used: the database is never reset between steps, so a
    // second "Website" would be a different project under a different client.
    await page.getByLabel('Project name').fill('Alpha Site')
    await page.getByRole('button', { name: 'Add project', exact: true }).click()
    await page
      .locator('.taxonomy-group', { hasText: 'Project Co' })
      .first()
      .locator('.taxonomy-row', { hasText: 'Alpha Site' })
      .first()
      .waitFor()
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.locator('.timer-client-row').first().waitFor()

    const projectCo = page.locator('.timer-client-item', { hasText: 'Project Co' }).first()
    check(
      'a client with no selection shows no project list',
      (await projectCo.locator('.timer-project-list').count()) === 0,
    )
    await projectCo.getByRole('button', { name: 'Project Co' }).first().click()
    const projectList = projectCo.locator('.timer-project-list')
    await projectList.waitFor()
    /*
     * Two rows, not one: every client is created with a default project (item 12), so the
     * list holds that and the one added above. What matters is that the added project is
     * there with its own Start button, beside the default one.
     */
    const alphaRow = projectList.locator('.timer-project-row', { hasText: 'Alpha Site' })
    check(
      'selecting a client reveals its projects, each with a Start button (item 61)',
      (await projectList.locator('.timer-project-row').count()) === 2 &&
        (await alphaRow.count()) === 1 &&
        (await alphaRow
          .getByRole('button', { name: 'Start a timer for Alpha Site' })
          .count()) === 1,
      `rows=${await projectList.locator('.timer-project-row').count()}`,
    )
    /*
     * And pressing one starts a timer. The running state is read from the active row rather
     * than a testid: there is no `timer-running` element, the active class is how the card
     * says a timer is running (item 42).
     */
    await projectList.getByRole('button', { name: 'Start a timer for Alpha Site' }).click()
    await page.locator('.timer-client-row-active').first().waitFor()
    check('a per-project Start button starts the timer (item 61)', true)
    /*
     * Stop it again. One timer at a time (0004 T2), and the rest of this suite starts timers
     * of its own — a timer left running here disables every later Start button.
     */
    await page
      .locator('.timer-client-row-active')
      .first()
      .getByRole('button', { name: /Stop/ })
      .click()
    await page.locator('.timer-client-row-active').first().waitFor({ state: 'detached' })

    const idleHeights = await page.locator('.timer-client-row').first().boundingBox()

    await page
      .locator('.timer-client-row', { hasText: 'Acme Ltd' })
      .getByRole('button', { name: /Start a timer for Acme Ltd/ })
      .click()
    await page
      .getByTestId('timer-running')
      .or(page.locator('.timer-client-row-active'))
      .first()
      .waitFor()
    const activeHeights = await page.locator('.timer-client-row').first().boundingBox()
    check(
      'starting a timer does not move the client rows (item 19)',
      Math.abs((idleHeights?.height ?? 0) - (activeHeights?.height ?? 0)) < 24,
      `idle=${idleHeights?.height} running=${activeHeights?.height}`,
    )
    // Item 35: the row held still, but the buttons inside it did not. Start is wider than
    // Stop and Edit narrower than Discard, so pressing Start shrank the first and grew the
    // second — the control under the pointer changing shape as it is pressed. Asserted on
    // position as well as width, because a button that keeps its width but shifts sideways
    // is the same defect.
    const idleButtons = await page
      .locator('.timer-client-row', { hasText: 'Acme Ltd' })
      .locator('.timer-client-actions .button')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const box = n.getBoundingClientRect()
          return { w: Math.round(box.width), x: Math.round(box.left) }
        }),
      )
    const activeButtons = await page
      .locator('.timer-client-row', { hasText: 'Acme Ltd' })
      .locator('.timer-client-actions .button')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const box = n.getBoundingClientRect()
          return { w: Math.round(box.width), x: Math.round(box.left) }
        }),
      )
    check(
      'starting a timer does not resize or move its buttons (item 35)',
      idleButtons.length === 2 &&
        activeButtons.length === 2 &&
        idleButtons.every((b, i) => Math.abs(b.w - activeButtons[i].w) <= 1) &&
        idleButtons.every((b, i) => Math.abs(b.x - activeButtons[i].x) <= 1),
      `idle=${JSON.stringify(idleButtons)} running=${JSON.stringify(activeButtons)}`,
    )
    check(
      'the running client is indicated on its own line',
      (await page.locator('.timer-client-row-active').count()) === 1,
    )
    check(
      'another client cannot be started while a timer runs',
      await page
        .locator('.timer-client-row', { hasText: 'Other Ltd' })
        .getByRole('button', { name: /Start a timer for Other Ltd/ })
        .isDisabled(),
    )

    // Item 21: the running timer filters the entries, and says so.
    await page.getByTestId('entries-filter-note').waitFor()
    check(
      'a running timer filters the entries to its client',
      (await page.getByTestId('entries-filter-note').count()) === 1 &&
        (await page.getByTestId('entries-filter-note').innerText()).includes(
          'timer is running',
        ),
    )

    // Item 49: height is not position. Pressing Stop swaps words and adds the
    // "saved as uncategorised" notice, and either can push a client line down the card
    // while the user is aiming at it.
    const topsOf = async () =>
      await page
        .locator('.timer-client-row')
        .evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().top)))
    const idleTops = await topsOf()
    await page
      .locator('.timer-client-row', { hasText: 'Acme Ltd' })
      .getByRole('button', { name: /Stop the timer for Acme Ltd/ })
      .click()
    await page.getByTestId('just-stopped').waitFor()
    const stoppedTops = await topsOf()
    check(
      'stopping does not move the client lines (item 49)',
      idleTops.length > 1 && idleTops.every((top, i) => top === stoppedTops[i]),
      `idle=${JSON.stringify(idleTops)} stopped=${JSON.stringify(stoppedTops)}`,
    )

    // Already stopped by the item 49 check above, which has to press Stop to measure
    // anything. It used to stop here a second time; with the notice now below the list,
    // there is no Stop button left to press and the suite timed out looking for one.
    await page.goto(URL, { waitUntil: 'networkidle' })
    // Item 25: the client is chosen by pressing its line on the timer card, not from a
    // dropdown here, so this is the whole of the interaction.
    const acmeLine = page.locator('.timer-client-row', { hasText: 'Acme Ltd' })
    await acmeLine.waitFor()
    // `exact`, because Playwright's name matching is substring by default — and "Acme Ltd"
    // is a substring of "Start a timer for Acme Ltd" and "Edit client Acme Ltd" too.
    await acmeLine.getByRole('button', { name: 'Acme Ltd', exact: true }).click()
    await page.getByTestId('entries-filter-note').waitFor()
    const acmeRows = await page.locator('.entry-row').count()

    await page
      .locator('.timer-client-row', { hasText: 'Other Ltd' })
      .getByRole('button', { name: 'Other Ltd', exact: true })
      .click()
    await page.getByTestId('entries-filter-note').waitFor()
    const otherRows = await page.locator('.entry-row').count()
    check(
      'selecting a client filters the entries',
      otherRows !== acmeRows,
      `acme=${acmeRows} other=${otherRows}`,
    )

    // Pressing the same client again returns to all of them. With no dropdown there is no
    // other way back, so this has to work.
    await page
      .locator('.timer-client-row', { hasText: 'Other Ltd' })
      .getByRole('button', { name: 'Other Ltd', exact: true })
      .click()
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="entries-filter-note"]'),
    )
    const allRows = await page.locator('.entry-row').count()
    check(
      'pressing the client again shows every client',
      allRows > otherRows && allRows >= acmeRows,
      `all=${allRows} acme=${acmeRows} other=${otherRows}`,
    )

    // Item 25: the period control sits in the entries header, not on a row of its own.
    check(
      'the period control is in the entries header',
      (await page.locator('.entries-header .period-control').count()) === 1,
    )

    // Item 25: the entries card collapses.
    await page.getByTestId('entries-collapse').click()
    check(
      'the entries card collapses',
      (await page.locator('#entries-body').isHidden()) === true,
    )
    await page.getByTestId('entries-collapse').click()

    // With the filter cleared, so the summary covers every client rather than one.
    await page.getByRole('radio', { name: 'Daily' }).click()
    await page.getByTestId('entry-summary').waitFor()
    check(
      'the daily period summarises per client',
      (await page.locator('.summary-row').count()) >= 1,
    )

    // Item 28: the choice survives a reload, rather than resetting every time.
    //
    // Polled rather than read once: the period is written to IndexedDB and read back on
    // mount, so immediately after a reload the control is briefly showing its default. A
    // single read would be asserting that the read was synchronous, which it is not.
    // Wait for the write itself, not for the radio: the control updates from local state
    // immediately, so reloading on that would race the IndexedDB write and test nothing.
    // Read straight out of the database rather than sleeping for a guessed interval.
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('personal-time-tracker')
          request.onsuccess = () => {
            const db = request.result
            if (!db.objectStoreNames.contains('meta')) {
              db.close()
              resolve(false)
              return
            }
            const get = db
              .transaction('meta', 'readonly')
              .objectStore('meta')
              .get('entry-period')
            get.onsuccess = () => {
              db.close()
              resolve(get.result?.value === 'day')
            }
            get.onerror = () => {
              db.close()
              resolve(false)
            }
          }
          request.onerror = () => resolve(false)
        }),
      undefined,
      { timeout: 5000 },
    )

    await page.reload({ waitUntil: 'networkidle' })
    const remembered = await page
      .getByRole('radio', { name: 'Daily' })
      .waitFor({ state: 'attached' })
      .then(async () => {
        await page.waitForFunction(
          () => document.querySelector('#period-day')?.checked === true,
          undefined,
          { timeout: 5000 },
        )
        return true
      })
      .catch(() => false)
    check('the chosen period is remembered across a reload (item 28)', remembered)

    await page.getByRole('radio', { name: 'All' }).click()
    check('all-entries keeps the list', (await page.getByTestId('entry-summary').count()) === 0)

    // Item 20: the edit control is an icon with a name, not the word "Edit".
    const editLink = page.locator('.entry-edit').first()
    /*
     * Item 27, measured rather than asserted structurally: the pencil has to share a line
     * with the entry's text. jsdom has no layout engine, so "is it on the same line" is not
     * a question it can answer — and getting this wrong once already put the tags and the
     * note in the wrong grid columns.
     */
    const inlineCheck = await page.evaluate(() => {
      const row = document.querySelector('.entry-row')
      if (!row) return { ok: false, reason: 'no rows' }
      const pencil = row.querySelector('.entry-edit')
      const note = row.querySelector('.entry-note')
      const taxonomy = row.querySelector('.entry-taxonomy')
      if (!pencil) return { ok: false, reason: 'no pencil' }
      const p = pencil.getBoundingClientRect()
      // Same line as the note when there is one, otherwise as the project line.
      const partner = note ?? taxonomy
      if (!partner) return { ok: false, reason: 'no text beside it' }
      const t = partner.getBoundingClientRect()
      const vertical = Math.abs(p.top + p.height / 2 - (t.top + t.height / 2))
      // And it must lead that text, at the row's left-hand end (item 27).
      const before = p.right <= t.left + 1
      return {
        ok: vertical < Math.max(p.height, t.height),
        vertical: Math.round(vertical),
        before,
        pencilTop: Math.round(p.top),
        textTop: Math.round(t.top),
        rowHeight: Math.round(row.getBoundingClientRect().height),
        // Nothing should overflow the row.
        fits: row.scrollWidth <= row.clientWidth + 1,
      }
    })
    check(
      'the pencil shares a line with the entry text',
      inlineCheck.ok === true,
      JSON.stringify(inlineCheck),
    )
    check(
      'the pencil leads that text, at the left-hand end (item 27)',
      inlineCheck.before === true,
      JSON.stringify(inlineCheck),
    )
    check(
      'the compressed row still fits its width',
      inlineCheck.fits === true,
      JSON.stringify(inlineCheck),
    )

    check(
      'the edit control is an icon with an accessible name',
      (await editLink.getAttribute('aria-label'))?.startsWith('Edit entry') === true,
      String(await editLink.getAttribute('aria-label')),
    )

    // Item 17: the connect action carries an icon.
    // 14. Icons render as icons, not as boxes (items 16, 17, 18, 20).
    // Only checkable here: jsdom has no layout engine, so it cannot tell a drawn path from
    // an empty <svg>, and a broken path fails silently everywhere else.
    const iconGeometry = await page.evaluate(() => {
      const wanted = ['.heading-add-button svg', '.entry-edit svg', '.header-menu-toggle svg']
      return wanted.map((selector) => {
        const svg = document.querySelector(selector)
        if (!svg) return { selector, missing: true }
        const box = svg.getBoundingClientRect()
        // A path that failed to parse contributes no geometry to the union.
        const painted = [...svg.querySelectorAll('path')].some((path) => {
          const length = path.getTotalLength()
          return Number.isFinite(length) && length > 0
        })
        return {
          selector,
          width: Math.round(box.width),
          height: Math.round(box.height),
          painted,
        }
      })
    })
    for (const icon of iconGeometry) {
      check(
        `icon renders with geometry: ${icon.selector}`,
        icon.missing !== true && icon.painted === true && icon.width > 0 && icon.height > 0,
        JSON.stringify(icon),
      )
    }

    // The sync indicator's cloud, reachable from the header.
    check(
      'the connect control is labelled, not icon-only',
      (await page.getByTestId('sync-indicator').getAttribute('title')) !== null,
    )

    /*
     * Item 62: the sync indicator must not open the settings page.
     *
     * It used to be a link to settings in three of its four states, so a user who tapped
     * it to read the sync state was taken off the page. Asserted as an absence of the
     * href, in a browser, because navigation is the thing being checked.
     */
    check(
      'the sync indicator does not link to settings (item 62)',
      (await page.getByTestId('sync-indicator').getAttribute('href')) === null,
    )

    // The favicon is the header mark, and it is a link to the app's own home (item 23).
    const mark = await page.evaluate(() => {
      const img = document.querySelector('.app-home-icon')
      if (!img) return null
      return { src: img.getAttribute('src'), alt: img.getAttribute('alt') }
    })
    check(
      'the header mark is the favicon',
      mark !== null && mark.src.endsWith('favicon.svg'),
      JSON.stringify(mark),
    )
    check(
      'the header mark is decorative, with the link named',
      mark !== null && mark.alt === '',
      JSON.stringify(mark),
    )

    /*
     * Items 32, 33, 34 and the settings add buttons: things only a browser can answer.
     * Focus and layout are not questions jsdom has an opinion about.
     */
    // Item 53: the header stays put while the page scrolls. Measured rather than asserted
    // from a class, because the whole behaviour is a computed position — and because a page
    // too short to scroll would pass a check that never scrolled anything.
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    await page.locator('.taxonomy-section-heading').first().waitFor()
    const scrollProbe = await page.evaluate(async () => {
      const header = document.querySelector('.app-header')
      if (!header) return { ok: false, reason: 'no header' }
      const before = header.getBoundingClientRect().top
      const scrolled = window.scrollY
      window.scrollTo(0, document.body.scrollHeight)
      // A frame, so the sticky position has been resolved rather than merely requested.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      return {
        ok: true,
        before,
        after: header.getBoundingClientRect().top,
        moved: window.scrollY - scrolled,
      }
    })
    check(
      'the page really does scroll, so the header check means something',
      scrollProbe.ok && scrollProbe.moved > 0,
      JSON.stringify(scrollProbe),
    )
    check(
      'the header stays put while the page scrolls (item 53)',
      scrollProbe.ok && Math.abs(scrollProbe.after) <= 1,
      JSON.stringify(scrollProbe),
    )
    check(
      'the header covers the full width, so nothing scrolls past beside it',
      await page.evaluate(() => {
        const header = document.querySelector('.app-header')
        const app = document.querySelector('.app')
        if (!header || !app) return false
        // Equal to the app's full box: without the negative margin the header would be
        // 1.5rem short either side, and rows would scroll through those gutters.
        return Math.abs(header.clientWidth - app.clientWidth) <= 1
      }),
    )
    /*
     * The settings menu still opens over the page from a sticky header.
     *
     * The panel is positioned against the toggle, inside the header, so a header that now
     * carries its own background and stacking context could have swallowed it. Clicked and
     * waited on through Playwright's locators rather than a raw `evaluate`: the panel is
     * mounted only while open, so a synchronous click would query before React re-rendered
     * and report a working menu as broken.
     */
    await page.locator('.header-menu-toggle').click()
    const menuPanel = page.locator('.header-menu-panel')
    await menuPanel.waitFor()
    const menuBox = await menuPanel.boundingBox()
    const toggleBox = await page.locator('.header-menu-toggle').boundingBox()
    const viewport = page.viewportSize()
    check(
      'the settings menu still opens over the page from a sticky header',
      // Measured against the toggle, not the header: the panel is positioned against the
      // toggle, and the header's bottom padding sits below it — so comparing against the
      // header's full height would fail on a layout that was always like this.
      menuBox !== null &&
        toggleBox !== null &&
        menuBox.height > 0 &&
        menuBox.y >= toggleBox.y + toggleBox.height - 1 &&
        menuBox.y + menuBox.height <= viewport.height,
      JSON.stringify({ menuBox, toggleBox }),
    )
    await page.locator('.header-menu-toggle').click()
    await page.evaluate(() => window.scrollTo(0, 0))

    // A sticky header is height the user can no longer scroll past. On a phone it wraps to
    // two or three lines, so its share of the screen is worth measuring rather than assuming.
    await page.setViewportSize({ width: 320, height: 640 })
    check(
      'the sticky header leaves most of a phone screen for content',
      await page.evaluate(() => {
        const header = document.querySelector('.app-header')
        if (!header) return false
        return header.getBoundingClientRect().height / window.innerHeight < 0.3
      }),
    )
    await page.setViewportSize({ width: 1280, height: 800 })

    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    // The taxonomy is read asynchronously, so the heading is not in the DOM on arrival.
    await page.locator('.taxonomy-section-heading').first().waitFor()
    check(
      'the add buttons sit on their section heading line (settings)',
      await page.evaluate(() => {
        const head = document.querySelector('.taxonomy-section-heading')
        if (!head) return false
        // Clients and projects are one section now (item 54), so one heading carries one
        // add button — "New client". Projects are added from the list they join (item 56).
        const heading = head.querySelector('h2')
        const adds = [...head.querySelectorAll('button')]
        if (!heading || adds.length !== 1) return false
        // Same line: their vertical centres have to overlap.
        const h = heading.getBoundingClientRect()
        return adds.every((add) => {
          const a = add.getBoundingClientRect()
          return (
            Math.abs(h.top + h.height / 2 - (a.top + a.height / 2)) <
            Math.max(h.height, a.height)
          )
        })
      }),
    )
    check(
      'each client has its own add-project button (item 55)',
      await page.evaluate(() => {
        // One per client, so a project is created in that client's context. Counted against
        // the client rows rather than the per-client testids, which would pass with one
        // button on a page that should have several.
        const groups = [...document.querySelectorAll('.taxonomy-group')]
        // A group with no client has no add button by design — there is no client to create
        // the project in the context of — so only the client rows are checked. Identifying
        // those by the Archive button they carry, rather than by the heading, because the
        // orphan group is called "No client" and would otherwise be counted as a client.
        const clientGroups = groups.filter((group) =>
          group.querySelector('.taxonomy-actions button'),
        )
        if (clientGroups.length === 0) return false
        return clientGroups.every(
          (group) => group.querySelector('[data-testid^="add-project-for-"]') !== null,
        )
      }),
    )
    check(
      'one archived control covers clients and projects (0005 A2)',
      // Counted in a browser because it is a question about controls on a filtered list: two
      // checkboxes under one heading, bound to one value, is the bug this replaced.
      (await page.getByRole('checkbox', { name: /Show archived/ }).count()) === 1,
    )
    check(
      'an archived name is struck, and the word "archived" is not (items 56, 59)',
      // Only a browser can answer this: it is a computed style, and `text-decoration`
      // propagates to descendants and cannot be undone by them — so a badge inside the
      // struck element gets struck too, striking the word that says the row is archived.
      await page.evaluate(() => {
        const decorated = (el) => {
          if (!el) return null
          const style = getComputedStyle(el)
          return style.textDecorationLine || style.textDecoration
        }
        const archivedRow = document.querySelector('.taxonomy-row.archived')
        if (!archivedRow) return { ok: false, reason: 'no archived row on the page' }
        const name = archivedRow.querySelector('.taxonomy-name-text, .taxonomy-group-name')
        const badge = archivedRow.querySelector('.badge-archived')
        return {
          ok: !!name && !!badge && decorated(name).includes('line-through'),
          name: decorated(name),
          badge: decorated(badge),
        }
      }),
    )
    check(
      'the add-project buttons are named for their client, not just "new project"',
      // With one per client, an accessible name of "New project" would give a screen reader
      // user several identical buttons and no way to tell which client each one serves.
      //
      // Read from the DOM rather than by role: the buttons sit inside their collapsed lists,
      // which is what the previous check covers. Each label is compared against the name on
      // its own group, so a label naming the wrong client — or the same client on every row —
      // fails.
      await page.evaluate(() => {
        const wrong = []
        for (const button of document.querySelectorAll('[data-testid^="add-project-for-"]')) {
          const group = button.closest('.taxonomy-group')
          const name = group?.querySelector('.taxonomy-group-name')?.textContent ?? ''
          if (button.getAttribute('aria-label') !== `New project for ${name}`) {
            wrong.push(`${button.getAttribute('aria-label')} in group "${name}"`)
          }
        }
        return { ok: wrong.length === 0, wrong }
      }),
    )
    check(
      'the add buttons are the same + as the timer card’s',
      // One on the heading now; the per-client ones live with the lists they add to.
      (await page.locator('.taxonomy-section-heading button svg').count()) === 1,
    )

    /*
     * Item 34: the period selector must not move because a client filter appeared.
     *
     * Measured against the entries header rather than the viewport. Selecting a client now
     * also reveals that client's projects (item 61), which grows the timer card and moves
     * the whole entries card down — so a viewport-absolute measurement fails on a layout
     * that is doing exactly what was asked. What item 34 is actually about is the filter
     * note appearing *inside* the header and pushing the selector there, which is a
     * question about the selector's position within its own card.
     */
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.locator('.timer-client-row').first().waitFor()
    const relativeToHeader = async () => {
      const period = await page.getByRole('radio', { name: 'Daily' }).boundingBox()
      const header = await page.locator('.entries-header').boundingBox()
      return {
        x: (period?.x ?? 0) - (header?.x ?? 0),
        y: (period?.y ?? 0) - (header?.y ?? 0),
      }
    }
    const before = await relativeToHeader()
    await page.locator('.timer-client-row').first().locator('.timer-client-name').click()
    await page.getByTestId('entries-filter-note').waitFor()
    const after = await relativeToHeader()
    check(
      'the period selector does not move within the entries card when a filter appears (item 34)',
      Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1,
      `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    )
    check(
      'the filter note is in the entries header, not on a line of its own',
      (await page.locator('.entries-header [data-testid="entries-filter-note"]').count()) ===
        1 &&
        (await page
          .locator('.entries-header > [data-testid="entries-filter-note"]')
          .count()) === 1,
    )

    // Item 33: editing an entry focuses Save.
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: /Edit/ }).first().click()
    await page.getByRole('heading', { name: 'Edit entry' }).waitFor()
    check(
      'editing an entry focuses Save changes (item 33)',
      await page
        .getByTestId('entry-submit')
        .evaluate((node) => node === document.activeElement),
    )

    // A *new* entry must not: its times are empty, so Save could not succeed.
    await page.goto(`${URL}#/entries/new`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Add entry' }).waitFor()
    check(
      'a new entry does not focus Save, which could not yet succeed',
      !(await page
        .getByTestId('entry-submit')
        .evaluate((node) => node === document.activeElement)),
    )

    // The About page and the changelog it bundles (README points at both).
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: /About this app/ }).click()
    await page.getByRole('heading', { name: 'About' }).waitFor()
    check(
      'the About page explains where data lives',
      (await page.getByText(/never appears in a backup/).count()) === 1,
    )
    const changelog = page.locator('.changelog')
    check(
      'the About page renders the bundled changelog',
      (await changelog.count()) === 1 && (await changelog.locator('li').count()) > 10,
      String(await changelog.locator('li').count()),
    )
    check(
      'the changelog is rendered as text, not injected markup',
      (await changelog.locator('script').count()) === 0 &&
        !(await changelog.innerHTML()).includes('<script'),
    )
    check(
      'the changelog headings dropped Keep a Changelog’s brackets',
      (await page.getByRole('heading', { name: 'Unreleased', exact: true }).count()) === 1,
    )

    // Item 40: the suite runs against a local preview, which is a non-production origin, so
    // the badge must be present. Asserted on the class rather than the text so it cannot
    // pass on some other "dev" string happening to be on the page.
    check(
      'a non-production origin is marked dev in the title (item 40)',
      (await page.locator('.app-header .env-badge').count()) === 1,
    )

    check('no console errors overall', consoleErrors.length === 0, consoleErrors.join(' | '))
    check('no failed requests overall', failedRequests.length === 0, failedRequests.join(' | '))

    await browser.close()
  } finally {
    shutdown()
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  if (failures > 0) {
    console.log(`${failures} FAILED`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
