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
import { spawn } from 'node:child_process'
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
  console.log('building...')
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
    check(
      'backup panel present',
      (await page.getByRole('heading', { name: 'Backup' }).count()) === 1,
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
