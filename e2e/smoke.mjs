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
    check('app mounts', (await page.locator('h1').innerText()) === 'Time Tracker')
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

    // 5. Stopping routes to the form and creates an entry (0001 US2).
    await page.getByRole('button', { name: 'Stop' }).click()
    await page.getByRole('heading', { name: 'Edit entry' }).waitFor()
    check('stopping routes to the entry form', page.url().includes('#/entries/'))

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
    // Item 26/29: three named buttons, stacked, and no prose. The heading moved to the
    // settings page, where there is room to explain what a backup is.
    check(
      'the menu holds three named buttons and no prose',
      (await page.locator('.header-menu-panel .header-menu-item').count()) === 3 &&
        (await page.getByRole('heading', { name: /^Backup/ }).count()) === 0,
    )
    check(
      'the menu buttons are stacked vertically',
      await page.evaluate(() => {
        const items = [...document.querySelectorAll('.header-menu-panel .header-menu-item')]
        if (items.length !== 3) return false
        const tops = items.map((item) => item.getBoundingClientRect().top)
        return tops[0] < tops[1] && tops[1] < tops[2]
      }),
    )
    check(
      'each menu button has its word beside the icon',
      (await page.getByTestId('header-menu-download').innerText()).trim() === 'download' &&
        (await page.getByTestId('header-menu-restore').innerText()).trim() === 'import',
    )

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
    await page.getByRole('heading', { name: 'Settings' }).waitFor()

    // P1: a project is two interactions from anywhere.
    await page.getByTestId('new-client').click()
    await page.getByLabel('Client name').fill('Acme Ltd')
    await page.getByLabel('Billing currency').selectOption({ label: 'GBP — British Pound' })
    // Opening the form turns the reveal button into "Cancel", so there is one "Add client".
    await page.getByRole('button', { name: 'Add client', exact: true }).click()
    await page.getByText('Acme Ltd').first().waitFor()

    await page.getByTestId('new-project').click()
    await page.getByLabel('Project name').fill('Website')
    await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Acme Ltd' })
    // Typed and clicked without an intervening blur. Regression guard for a layout bug:
    // committing the rate used to insert a line, which moved the button under the pointer
    // mid-click, so the click landed on nothing and the form silently did not submit.
    // Only a real browser can catch this — jsdom has no layout engine.
    await page.getByLabel('Default hourly rate').fill('75')
    await page.getByRole('button', { name: 'Add project', exact: true }).click()
    await page.getByText('Website').first().waitFor()
    check('a rate can be typed and saved in one go', true)

    check(
      'project names its client rather than relying on colour',
      (await page.getByText('Client: Acme Ltd').count()) >= 1,
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

    // X1/X3: deleting a project states the impact and demands more where money is
    // involved. Billable was ticked, so this is the two-step path.
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    const projectRow = page.locator('.taxonomy-row', { hasText: 'Website' }).first()
    await projectRow.getByRole('button', { name: 'Delete' }).click()
    await page.getByTestId('delete-impact').waitFor()
    const impact = await page.getByTestId('delete-impact').innerText()
    check(
      'delete states the entry count before confirming',
      /1 entry uses/.test(impact),
      impact,
    )
    check('delete warns about billable time', /is billable/.test(impact), impact)
    check(
      'the first confirmation does not delete anything',
      (await page.locator('.taxonomy-row', { hasText: 'Website' }).count()) === 1,
    )

    // Cancelled, so the delete below starts from a clean slate; the committed path is
    // driven once, further down, where the undo bar matters.
    await page
      .getByTestId('delete-confirm-project')
      .getByRole('button', { name: 'Cancel' })
      .click()
    check(
      'cancelling leaves the project alone',
      (await page.locator('.taxonomy-row', { hasText: 'Website' }).count()) === 1,
    )

    // X5: undo puts the project and its references back.
    // Undone here without navigating first, because the undo window belongs to the
    // settings view — leaving the page closes it. See SPECS/todo.md.
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    const deleteProject = async () => {
      const row = page.locator('.taxonomy-row', { hasText: 'Website' }).first()
      await row.getByRole('button', { name: 'Delete' }).click()
      await page.getByTestId('delete-impact').waitFor()
      await page.getByTestId('delete-confirm-accept').click()
      await page.getByTestId('delete-confirm-strong').click()
    }

    await deleteProject()
    await page.getByTestId('undo-bar').waitFor()
    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click()
    await page.locator('.taxonomy-row', { hasText: 'Website' }).first().waitFor()
    check('undo restores the deleted project', true)

    // And again, this time left deleted, to check the orphaned entries (X1/X2).
    await deleteProject()
    await page.getByTestId('undo-bar').waitFor()
    await page.locator('.taxonomy-row', { hasText: 'Website' }).first().waitFor({
      state: 'detached',
    })

    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.getByText('Uncategorised').first().waitFor()
    check(
      'deleting a project keeps its entries',
      (await page.getByTestId('empty-state').count()) === 0,
    )
    check(
      'the orphaned entry lost only its project, not its tags',
      (await page.getByTestId(/^tags-/).count()) >= 1,
    )

    // A2: archived records stay reachable, which is only observable in a browser because
    // it is a checkbox controlling a filtered list.
    //
    // A second project, because the undo window does not survive navigation and Website
    // is currently deleted. Keeping this flow independent of the undo round trip means a
    // change to one cannot silently stop exercising the other.
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    await page.getByTestId('new-project').click()
    await page.getByLabel('Project name').fill('Admin')
    await page.getByRole('button', { name: 'Add project', exact: true }).click()
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

    await page.getByLabel('Show archived projects').check()
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
    // thing on it.
    await page.setViewportSize({ width: 320, height: 640 })
    await page
      .locator('.taxonomy-row', { hasText: 'Admin' })
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
    check(
      'clients are listed one per line',
      (await rows.count()) >= 2,
      String(await rows.count()),
    )

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

    // Stop it again so the rest of the checks start from idle.
    await page
      .locator('.timer-client-row', { hasText: 'Acme Ltd' })
      .getByRole('button', { name: /Stop the timer for Acme Ltd/ })
      .click()
    await page.getByRole('heading', { name: 'Edit entry' }).waitFor()

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
      const wanted = ['.timer-add-client svg', '.entry-edit svg', '.header-menu-toggle svg']
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
    await page.goto(`${URL}#/settings`, { waitUntil: 'networkidle' })
    // The taxonomy is read asynchronously, so the sections are not in the DOM on arrival.
    await page.locator('.taxonomy-section-heading').first().waitFor()
    check(
      'the add buttons sit on their section heading line (settings)',
      await page.evaluate(() => {
        const heads = [...document.querySelectorAll('.taxonomy-section-heading')]
        if (heads.length < 2) return false
        return heads.every((head) => {
          const heading = head.querySelector('h3')
          const add = head.querySelector('button')
          if (!heading || !add) return false
          // Same line: their vertical centres have to overlap.
          const h = heading.getBoundingClientRect()
          const a = add.getBoundingClientRect()
          return (
            Math.abs(h.top + h.height / 2 - (a.top + a.height / 2)) <
            Math.max(h.height, a.height)
          )
        })
      }),
    )
    check(
      'the add buttons are the same + as the timer card’s',
      (await page.locator('.taxonomy-section-heading button svg').count()) >= 2,
    )

    // Item 34: the period selector must not move because a client filter appeared.
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.locator('.timer-client-row').first().waitFor()
    const periodBefore = await page.getByRole('radio', { name: 'Daily' }).boundingBox()
    await page.locator('.timer-client-row').first().locator('.timer-client-name').click()
    await page.getByTestId('entries-filter-note').waitFor()
    const periodAfter = await page.getByRole('radio', { name: 'Daily' }).boundingBox()
    check(
      'the period selector does not move when a client filter appears (item 34)',
      Math.abs((periodBefore?.x ?? 0) - (periodAfter?.x ?? 0)) < 1 &&
        Math.abs((periodBefore?.y ?? 0) - (periodAfter?.y ?? 0)) < 1,
      `before=${JSON.stringify(periodBefore)} after=${JSON.stringify(periodAfter)}`,
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
