import { beforeEach, describe, expect, it } from 'vitest'
import { canonicalStringify, mergeSnapshots, type Snapshot } from './merge'
import { Rng, entry, snapshotOf, tombstone } from '../test/factories'
import type { TimeEntry } from './entries/types'

/**
 * Convergence across simulated devices (0012 M4, 0014 Phase 3).
 *
 * The merge properties above prove a *pair* of snapshots merges deterministically.
 * They cannot prove that four devices, each editing independently and syncing in a
 * different order, end up agreeing. That is the failure mode with no symptom at all:
 * devices diverge quietly, every individual merge looks correct, and the user
 * discovers it when an entry they deleted on their phone reappears on their laptop.
 *
 * Simulated rather than driven through the real scheduler: the engine is already
 * covered, and what is under test here is the merge underneath it across many peers.
 */

const SCHEMA = 1

interface Device {
  name: string
  snapshot: Snapshot
}

let devices: Device[]

beforeEach(() => {
  devices = []
})

function mergeOk(a: Snapshot, b: Snapshot): Snapshot {
  const result = mergeSnapshots(a, b, SCHEMA)
  if (!result.ok) throw new Error(`merge unexpectedly blocked: ${result.reason}`)
  return result.merged
}

/**
 * Sync two devices.
 *
 * Deliberately naive: pull, union, push, exactly what `runSync` does. Both sides end
 * up with the union, which is the optimistic behaviour the real engine relies on before
 * its conditional push resolves any conflict.
 */
function sync(left: Device, right: Device): void {
  const merged = mergeOk(left.snapshot, right.snapshot)
  left.snapshot = merged
  right.snapshot = merged
}

function addDevice(name: string, records: TimeEntry[] = []): Device {
  const device: Device = { name, snapshot: snapshotOf(records) }
  devices.push(device)
  return device
}

/** Every device holds byte-identical data. */
function allAgree(): boolean {
  if (devices.length < 2) return true
  const first = canonicalStringify(devices[0]?.snapshot)
  return devices.every((device) => canonicalStringify(device.snapshot) === first)
}

/** Ids held by each device, for pinpointing a divergence. */
function describeDevices(): string {
  return devices
    .map((device) => {
      const ids = ((device.snapshot.entities['entries'] ?? []) as TimeEntry[])
        .map((e) => `${e.id}${e.deletedAt === null ? '' : '*'}`)
        .sort()
      return `${device.name}:[${ids.join(',')}]`
    })
    .join(' ')
}

/**
 * Connect every pair until no further sync changes anything.
 *
 * A full pairwise sweep rather than a spanning tree, because "all pairs eventually talk"
 * is the assumption; a bug that only appears in a particular pairing order would be
 * invisible under a simpler schedule.
 */
function syncUntilStable(): void {
  for (let pass = 0; pass < devices.length + 1; pass += 1) {
    let changed = false
    for (let i = 0; i < devices.length; i += 1) {
      for (let j = i + 1; j < devices.length; j += 1) {
        const a = devices[i] as Device
        const b = devices[j] as Device
        const before = canonicalStringify(a.snapshot) + canonicalStringify(b.snapshot)
        sync(a, b)
        const after = canonicalStringify(a.snapshot) + canonicalStringify(b.snapshot)
        if (before !== after) changed = true
      }
    }
    if (!changed) return
  }
  throw new Error('sync did not reach a fixed point')
}

describe('convergence across devices', () => {
  it('three devices editing different records all end up with the union', () => {
    const phone = addDevice('phone', [entry({ id: 'a' })])
    const laptop = addDevice('laptop', [entry({ id: 'b' })])
    const tablet = addDevice('tablet', [entry({ id: 'c' })])

    // Each device learns of the others in a different order.
    sync(phone, laptop)
    sync(tablet, phone)
    syncUntilStable()

    expect(allAgree(), describeDevices()).toBe(true)
    expect(
      ((phone.snapshot.entities['entries'] ?? []) as TimeEntry[]).map((e) => e.id).sort(),
    ).toEqual(['a', 'b', 'c'])
    void laptop
    void tablet
  })

  it('converges regardless of the order pairs happen to sync', () => {
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const rng = new Rng(seed)
      devices = []
      const pool = ['a', 'b', 'c', 'd']
      const names = ['one', 'two', 'three', 'four']
      for (const name of names) {
        const records: TimeEntry[] = []
        const seen = new Set<string>()
        for (let i = 0; i < 4; i += 1) {
          const id = rng.pick(pool)
          if (seen.has(id)) continue
          seen.add(id)
          records.push(
            entry({ id, note: `${name}-${id}`, updatedAt: new Date(rng.int(0, 60) * 60_000) }),
          )
        }
        addDevice(name, records)
      }

      // Random pair order, so different seeds sync different pairs first.
      const order: [number, number][] = []
      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) order.push([i, j])
      }
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i)
        const tmp = order[i] as [number, number]
        order[i] = order[j] as [number, number]
        order[j] = tmp
      }
      for (const [i, j] of order) {
        sync(devices[i] as Device, devices[j] as Device)
      }
      syncUntilStable()

      expect(allAgree(), `seed ${seed}: ${describeDevices()}`).toBe(true)
    }
  })

  it('a deletion on one device reaches every other device', () => {
    const phone = addDevice('phone', [entry({ id: 'a' }), entry({ id: 'b' })])
    const laptop = addDevice('laptop', [entry({ id: 'a' }), entry({ id: 'b' })])

    // The phone deletes one; the laptop still holds it live.
    phone.snapshot = snapshotOf([
      (phone.snapshot.entities['entries'] ?? [])[0] as TimeEntry,
      tombstone({ id: 'b' }),
    ])

    sync(phone, laptop)
    syncUntilStable()

    expect(allAgree(), describeDevices()).toBe(true)
    const laptopRecords = (laptop.snapshot.entities['entries'] ?? []) as TimeEntry[]
    // Still present, but tombstoned. Dropping it entirely would let a device that was
    // offline bring it back on the next pull.
    expect(laptopRecords.find((e) => e.id === 'b')?.deletedAt).not.toBeNull()
  })

  it('a device offline for a long time does not resurrect a deleted entry', () => {
    const online = addDevice('online', [
      entry({ id: 'a' }),
      entry({ id: 'b' }),
      entry({ id: 'c' }),
    ])
    const laptop = addDevice('laptop', [
      entry({ id: 'a' }),
      entry({ id: 'b' }),
      entry({ id: 'c' }),
    ])

    online.snapshot = snapshotOf([
      (online.snapshot.entities['entries'] ?? [])[0] as TimeEntry,
      (online.snapshot.entities['entries'] ?? [])[2] as TimeEntry,
      tombstone({ id: 'b' }),
    ])

    // The laptop is away while the deletion happens elsewhere, then returns.
    sync(online, addDevice('third', [entry({ id: 'a' })]))
    sync(online, devices[2] as Device)
    syncUntilStable()

    const laptopB = ((laptop.snapshot.entities['entries'] ?? []) as TimeEntry[]).find(
      (e) => e.id === 'b',
    )
    expect(laptopB?.deletedAt, describeDevices()).not.toBeNull()
  })

  it('an edit made before a deletion is not lost, and the deletion still wins', () => {
    // The realistic sequence: someone edits an entry on the laptop while offline, and
    // deletes the same entry on their phone. Last write wins on updatedAt, and the
    // deletion is the later one.
    const phone = addDevice('phone', [
      entry({ id: 'a', updatedAt: new Date('2026-10-13T10:00:00Z') }),
    ])
    const laptop = addDevice('laptop', [
      entry({ id: 'a', note: 'edited offline', updatedAt: new Date('2026-10-13T09:00:00Z') }),
    ])

    phone.snapshot = snapshotOf([
      tombstone({ id: 'a', deletedAt: new Date('2026-10-13T10:00:00Z') }),
    ])
    sync(phone, laptop)
    syncUntilStable()

    const winner = ((phone.snapshot.entities['entries'] ?? []) as TimeEntry[]).find(
      (e) => e.id === 'a',
    )
    expect(winner?.deletedAt, describeDevices()).not.toBeNull()
  })

  it('five devices converge on one state', () => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      addDevice(name, [entry({ id: 'shared' }), entry({ id: `${name}-only` })])
    }
    syncUntilStable()

    expect(allAgree(), describeDevices()).toBe(true)
    expect((devices[0]?.snapshot.entities['entries'] ?? []) as TimeEntry[]).toHaveLength(6)
  })

  it('repeated syncs do not drift, so a device cannot wander over time', () => {
    const one = addDevice('one', [entry({ id: 'a' })])
    const two = addDevice('two', [entry({ id: 'b' })])
    sync(one, two)

    const settled = canonicalStringify(one.snapshot)
    for (let i = 0; i < 20; i += 1) {
      sync(one, two)
    }

    // Twenty idle syncs must not mutate anything. A merge that reordered or rewrote
    // records on every pass would churn revisions and defeat the "nothing to publish"
    // check in the engine.
    expect(canonicalStringify(one.snapshot)).toBe(settled)
  })
})
