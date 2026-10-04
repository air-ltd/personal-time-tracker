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

const BASE = `/personal-time-tracker/`
// Bound and dialled over IPv4 explicitly. Vite's preview server defaults to
// binding `localhost`, which on this image resolves to `[::1]` only, so a fetch to
// `localhost` or `127.0.0.1` gets ECONNREFUSED. Pinning the host on both sides
// removes the ambiguity instead of depending on resolver order.
const HOST = '127.0.0.1'
const URL = `http://${HOST}:${PORT}${BASE}`

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
    await page.reload({ waitUntil: 'networkidle' })
    check(
      'theme persists across reload with no flash',
      (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
    )
    // Back to the entries for the checks that follow.
    await page.goto(URL, { waitUntil: 'networkidle' })

    // 10. A narrow viewport must not clip an entry (0002 B7).
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
    check(
      'the menu holds settings and backup',
      (await page.getByRole('heading', { name: /^Backup/ }).count()) === 1,
    )

    const download = page.waitForEvent('download', { timeout: 10_000 })
    await page.getByRole('button', { name: 'Download backup' }).click()
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
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByLabel('Client name').fill('Acme Ltd')
    await page.getByLabel('Billing currency').selectOption({ label: 'GBP — British Pound' })
    // Opening the form turns the reveal button into "Cancel", so there is one "Add client".
    await page.getByRole('button', { name: 'Add client', exact: true }).click()
    await page.getByText('Acme Ltd').first().waitFor()

    await page.getByRole('button', { name: 'Add project' }).click()
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
    await page.getByRole('button', { name: 'Add project' }).click()
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
    await page.getByRole('button', { name: 'Add client' }).click()
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
    check(
      'a running timer filters the entries to its client',
      (await page.getByTestId('client-filter-locked').count()) === 1,
    )

    // Stop it again so the rest of the checks start from idle.
    await page
      .locator('.timer-client-row', { hasText: 'Acme Ltd' })
      .getByRole('button', { name: /Stop the timer for Acme Ltd/ })
      .click()
    await page.getByRole('heading', { name: 'Edit entry' }).waitFor()

    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.getByLabel('Client', { exact: true }).first().waitFor()
    await page.getByTestId('client-filter').selectOption({ label: 'Acme Ltd' })
    const acmeRows = await page.locator('.entry-row').count()
    await page.getByTestId('client-filter').selectOption({ label: 'Other Ltd' })
    const otherRows = await page.locator('.entry-row').count()
    check(
      'selecting a client filters the entries',
      otherRows !== acmeRows,
      `acme=${acmeRows} other=${otherRows}`,
    )

    await page.getByTestId('client-filter').selectOption('')
    await page.getByRole('radio', { name: 'Daily' }).click()
    check(
      'the daily period summarises per client',
      (await page.getByTestId('entry-summary').count()) === 1,
    )
    await page.getByRole('radio', { name: 'All' }).click()
    check('all-entries keeps the list', (await page.getByTestId('entry-summary').count()) === 0)

    // Item 20: the edit control is an icon with a name, not the word "Edit".
    const editLink = page.locator('.entry-edit').first()
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
