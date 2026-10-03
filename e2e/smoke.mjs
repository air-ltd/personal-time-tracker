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
      elapsedAfter >= elapsedBefore,
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

    // 6. Backup is reachable and works on a real build (Phase 2B gate).
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
