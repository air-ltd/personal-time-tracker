import { useCallback, useState } from 'react'
import { useTaxonomy } from './useTaxonomy'
import { ColorPicker } from './ColorPicker'
import { CurrencySelect } from './CurrencySelect'
import { RateField } from './RateField'
import { DeleteConfirm } from './DeleteConfirm'
import { ClientForm } from './ClientForm'
import { PlusIcon } from '../../app/Icons'
import { ProjectUndoBar, type TaxonomyUndo } from './TaxonomyUndoBar'
import {
  clientDeleteImpact,
  type DeleteClientReceipt,
  type DeleteProjectReceipt,
  type DeleteTagReceipt,
  createOrFindTag,
  createProject,
  deleteClient,
  deleteProject,
  deleteTag,
  mergeTags,
  projectDeleteImpact,
  setArchived,
  tagEntryCount,
  undoDeleteClient,
  undoDeleteProject,
  undoDeleteTag,
  updateProject,
  updateTag,
} from '../../storage/taxonomyRepo'
import { writeDefaultCurrency } from '../../storage/settingsRepo'
import { useAppDefaultCurrency } from '../settings/useAppDefaultCurrency'
import { FALLBACK_CURRENCY, resolveCurrency } from '../../domain/taxonomy/money'
import { currencyLabel } from '../../domain/taxonomy/currencies'
import { suggestColour } from '../../domain/taxonomy/colour'
import { formatDuration } from '../../domain/time/duration'
import type { Client, Project, Tag } from '../../domain/taxonomy/types'

/**
 * Taxonomy settings (0005 P1, A1–A5, T4, X1–X6).
 *
 * This is the only place destructive taxonomy operations live (0005 X6): a project
 * deletion that orphans entries belongs away from a save button on an entry form, where
 * a mis-click costs an hour of history.
 *
 * Reachable in two interactions from anywhere (0005 P1) — a link in the header, then the
 * form — because a missing project blocks entry capture and the user should not have to
 * abandon a running timer to fix it.
 */

/**
 * A count with a verb that agrees with it.
 *
 * Written out rather than composing a noun and a verb separately, because the two have
 * to agree in English — "1 entry uses", "2 entries use" — and splitting them into a
 * noun helper and a separate verb produced "1 entry use this project" in three places.
 */
function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

interface DeleteState {
  kind: 'project' | 'client' | 'tag'
  id: string
  name: string
  impact: string[]
  keeps: string
  requireStrongConfirm: boolean
}

export function TaxonomySettings({ now }: { now: Date }) {
  const { projects, clients, tags, loading, error: loadError } = useTaxonomy()
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<TaxonomyUndo | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DeleteState | null>(null)

  // The app-wide default, from `meta` rather than a taxonomy table — which is why it is
  // its own hook instead of another field on `useTaxonomy`, whose name would then be a
  // lie. It also feeds the project forms below, so the resolution that used to be
  // reimplemented there with a hardcoded `GBP` is now the domain chain.
  const defaultCurrency = useAppDefaultCurrency()

  const visibleProjects = showArchived ? projects : projects.filter((p) => !p.archived)
  const visibleClients = showArchived ? clients : clients.filter((c) => !c.archived)

  const report = useCallback((problem: unknown) => {
    setError(problem instanceof Error ? problem.message : String(problem))
  }, [])

  // --- delete flow -------------------------------------------------------------

  async function askToDelete(
    kind: 'project' | 'client' | 'tag',
    record: Project | Client | Tag,
  ) {
    setError(null)
    try {
      if (kind === 'project') {
        // X1/X3: the count and the billable hours are loaded before the prompt, and
        // billable hours are what decide whether a second step is required.
        const impact = await projectDeleteImpact(record.id)
        const billable =
          impact.billableEntryCount > 0 ? formatDuration(impact.billableMinutes * 60_000) : null
        setPendingDelete({
          kind,
          id: record.id,
          name: record.name,
          requireStrongConfirm: impact.billableEntryCount > 0,
          impact: [
            `${counted(impact.entryCount, 'entry uses', 'entries use')} this project.`,
            ...(impact.billableEntryCount > 0
              ? [
                  `${counted(impact.billableEntryCount, 'is', 'are')} billable — ${billable} of billable time.`,
                ]
              : []),
          ],
          keeps: 'The entries are kept. They lose their project and appear as Uncategorised.',
        })
      } else if (kind === 'client') {
        // X4: projects survive; it is their client that goes.
        const impact = await clientDeleteImpact(record.id)
        setPendingDelete({
          kind,
          id: record.id,
          name: record.name,
          requireStrongConfirm: false,
          impact: [
            `${counted(impact.projectCount, 'project belongs', 'projects belong')} to this client.`,
          ],
          keeps:
            'The projects are kept. They stop belonging to a client, and their entries count as uncategorised by client.',
        })
      } else {
        const count = await tagEntryCount(record.id)
        setPendingDelete({
          kind,
          id: record.id,
          name: record.name,
          requireStrongConfirm: false,
          impact: [`${counted(count, 'entry carries', 'entries carry')} this tag.`],
          keeps: 'The entries are kept. They lose the tag.',
        })
      }
    } catch (problem) {
      report(problem)
    }
  }

  async function runDelete() {
    if (!pendingDelete) return
    const { kind, id, name } = pendingDelete
    setPendingDelete(null)
    try {
      if (kind === 'project') {
        const receipt = await deleteProject(id, now)
        if (receipt) {
          const count = receipt.orphanedEntryIds.length
          setUndoReceipt({ kind, receipt })
          setUndo({
            label: `${kind} "${name}"`,
            detail:
              count > 0
                ? `${count} ${count === 1 ? 'entry is' : 'entries are'} now uncategorised`
                : null,
          })
        }
      } else if (kind === 'client') {
        const receipt = await deleteClient(id, now)
        if (receipt) {
          const count = receipt.unlinkedProjectIds.length
          setUndoReceipt({ kind, receipt })
          setUndo({
            label: `${kind} "${name}"`,
            detail:
              count > 0
                ? `${count} ${count === 1 ? 'project has' : 'projects have'} no client`
                : null,
          })
        }
      } else {
        const receipt = await deleteTag(id, now)
        if (receipt) {
          const count = receipt.untaggedEntryIds.length
          setUndoReceipt({ kind, receipt })
          setUndo({
            label: `${kind} "${name}"`,
            detail:
              count > 0
                ? `${count} ${count === 1 ? 'entry lost' : 'entries lost'} the tag`
                : null,
          })
        }
      }
    } catch (problem) {
      report(problem)
    }
  }

  /**
   * Undo needs the receipt, but the bar is told a sentence rather than being handed the
   * union to narrow — so the receipt is held here and the bar stays a presentation
   * concern.
   */
  const [undoReceipt, setUndoReceipt] = useState<
    | { kind: 'project'; receipt: DeleteProjectReceipt }
    | { kind: 'client'; receipt: DeleteClientReceipt }
    | { kind: 'tag'; receipt: DeleteTagReceipt }
    | null
  >(null)

  // Stable, so the undo bar's auto-hide timer is armed once per deletion.
  const dismissUndo = useCallback(() => {
    setUndo(null)
    setUndoReceipt(null)
  }, [])

  async function runUndo() {
    if (!undoReceipt) return
    try {
      const outcome =
        undoReceipt.kind === 'project'
          ? await undoDeleteProject(undoReceipt.receipt, now)
          : undoReceipt.kind === 'client'
            ? await undoDeleteClient(undoReceipt.receipt, now)
            : await undoDeleteTag(undoReceipt.receipt, now)
      if (!outcome.ok) setError(outcome.reason)
      setUndoReceipt(null)
      setUndo(null)
    } catch (problem) {
      report(problem)
    }
  }

  if (loading) return <p className="hint">Loading settings…</p>

  return (
    <section className="panel settings-panel">
      <div className="panel-header">
        <h2>Settings</h2>
      </div>

      {/*
        Both sources land in one place, but they are not the same: a failed read is not
        dismissible, because nothing has loaded to act on, whereas a failed write is
        something the Dismiss button can honestly clear.
      */}
      {(error ?? loadError) !== null && (
        <div className="alert alert-error" role="alert" data-testid="settings-error">
          <p>{error ?? loadError}</p>
          {error !== null && (
            <button type="button" className="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* 0003 CU4: the last link in the resolution chain, for client-less work. */}
      <div className="settings-block">
        <h3>Default currency</h3>
        <CurrencySelect
          label="Currency for work with no client"
          inheritLabel={`Not set — fall back to ${FALLBACK_CURRENCY}`}
          value={defaultCurrency}
          // No local copy: `writeDefaultCurrency` bumps the revision, and the hook
          // re-reads on that. A second copy of this value in component state is the
          // thing 0002 S2 exists to avoid, and it is how the value being displayed and
          // the value being resolved could come to disagree.
          onChange={(code) => void writeDefaultCurrency(code).catch(report)}
        />
        <p className="hint">
          Reports show money in the project&apos;s currency, then the client&apos;s, then this
          one.
        </p>
      </div>

      <ClientSection
        clients={visibleClients}
        allClients={clients}
        showArchived={showArchived}
        onToggleArchived={setShowArchived}
        onDelete={(client) => void askToDelete('client', client)}
        now={now}
        report={report}
      />

      <ProjectSection
        projects={visibleProjects}
        allProjects={projects}
        clients={clients}
        defaultCurrency={defaultCurrency}
        showArchived={showArchived}
        onToggleArchived={setShowArchived}
        onDelete={(project) => void askToDelete('project', project)}
        now={now}
        report={report}
      />

      <TagSection
        tags={tags}
        onDelete={(tag) => void askToDelete('tag', tag)}
        now={now}
        report={report}
      />

      {pendingDelete && (
        <DeleteConfirm
          name={pendingDelete.name}
          entity={pendingDelete.kind}
          impact={pendingDelete.impact}
          keeps={pendingDelete.keeps}
          requireStrongConfirm={pendingDelete.requireStrongConfirm}
          onConfirm={() => void runDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {undo && (
        <ProjectUndoBar pending={undo} onUndo={() => void runUndo()} onDismiss={dismissUndo} />
      )}
    </section>
  )
}

interface SectionProps {
  now: Date
  report: (problem: unknown) => void
}

function ClientSection({
  clients,
  allClients,
  showArchived,
  onToggleArchived,
  onDelete,
  now,
  report,
}: SectionProps & {
  clients: Client[]
  allClients: Client[]
  showArchived: boolean
  onToggleArchived: (value: boolean) => void
  onDelete: (client: Client) => void
}) {
  const [creating, setCreating] = useState(false)

  return (
    <div className="settings-block">
      <SectionHeading noun="client" onAdd={() => setCreating(true)} />

      {creating ? (
        <ClientForm
          takenColours={allClients.map((row) => row.colour)}
          now={now}
          onDone={() => setCreating(false)}
          report={report}
        />
      ) : null}

      {clients.length === 0 && <p className="hint">No clients yet.</p>}

      <ul className="taxonomy-list">
        {clients.map((client) => (
          <li
            key={client.id}
            className={client.archived ? 'taxonomy-row archived' : 'taxonomy-row'}
          >
            <ClientRow
              client={client}
              now={now}
              report={report}
              onDelete={() => onDelete(client)}
            />
          </li>
        ))}
      </ul>

      <ArchivedToggle
        plural="clients"
        singular="client"
        showArchived={showArchived}
        onToggle={onToggleArchived}
        hiddenCount={allClients.length - clients.length}
      />
    </div>
  )
}

function ClientRow({
  client,
  now,
  report,
  onDelete,
}: {
  client: Client
  now: Date
  report: (problem: unknown) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div className="taxonomy-edit">
        <ClientForm
          client={client}
          now={now}
          onDone={() => setEditing(false)}
          report={report}
        />
      </div>
    )
  }

  return (
    <>
      <span className="taxonomy-name">
        {client.name}
        {client.archived && <span className="badge badge-archived"> archived</span>}
      </span>
      <span className="taxonomy-meta">
        {currencyLabel(client.currency)}
        {client.defaultRateMinor !== null && ` · ${client.defaultRateMinor} minor units/hour`}
      </span>
      <span className="taxonomy-actions">
        <button type="button" className="button" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            // Caught: the user has pressed Archive and a silent failure leaves the row
            // unchanged with no explanation, which reads as the button being broken. `report`
            // is already used for every other failure in this file.
            void setArchived('client', client.id, !client.archived, now).catch(report)
          }}
        >
          {client.archived ? 'Restore' : 'Archive'}
        </button>
        <button type="button" className="button button-danger" onClick={onDelete}>
          Delete
        </button>
      </span>
    </>
  )
}

function ProjectSection({
  projects,
  allProjects,
  clients,
  defaultCurrency,
  showArchived,
  onToggleArchived,
  onDelete,
  now,
  report,
}: SectionProps & {
  projects: Project[]
  allProjects: Project[]
  clients: Client[]
  defaultCurrency: string | null
  showArchived: boolean
  onToggleArchived: (value: boolean) => void
  onDelete: (project: Project) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)
  const [rate, setRate] = useState<number | null>(null)
  const [currency, setCurrency] = useState<string | null>(null)
  const [colour, setColour] = useState<string>(() => suggestColour([]))

  const client = clients.find((c) => c.id === clientId) ?? null
  // The rate field needs a currency to know the exponent, so it follows the same chain
  // the saved record will resolve by: what this form has picked, then the client, then
  // the app default. It used to end at a hardcoded `GBP`, so a user whose default is JPY
  // was shown a rate in pounds and saved a rate that is interpreted in yen.
  const effectiveCurrency = resolveCurrency({ currency }, client, defaultCurrency).code

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      await createProject({ name, clientId, defaultRateMinor: rate, currency, colour, now })
      setName('')
      setRate(null)
      setCurrency(null)
      setCreating(false)
    } catch (problem) {
      report(problem)
    }
  }

  return (
    <div className="settings-block">
      <SectionHeading noun="project" onAdd={() => setCreating(true)} />

      {creating ? (
        <form className="taxonomy-form" onSubmit={(e) => void submit(e)}>
          <div className="field">
            <label htmlFor="project-name">Project name</label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="project-client">Client</label>
            <select
              id="project-client"
              value={clientId ?? ''}
              onChange={(e) => setClientId(e.target.value || null)}
            >
              {/* 0005 R1/U1: no client is a legitimate state, so it is offered as a
                  choice rather than being an absent option. */}
              <option value="">No client — internal work</option>
              {clients
                .filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <RateField
            label="Default hourly rate"
            currency={effectiveCurrency}
            value={rate}
            onChange={setRate}
            // Always supplied, so the line is already there when the rate commits: a hint
            // that appears at the moment focus leaves the field moves the Save button under
            // the pointer mid-click. See the note on `.rate-feedback`.
            hint={
              rate === null
                ? 'A rate here makes new entries for this project billable.'
                : 'Entries for this project will default to billable.'
            }
          />
          <CurrencySelect
            label="Currency override"
            inheritLabel={
              client ? `Use the client’s ${currencyLabel(client.currency)}` : 'Use the default'
            }
            value={currency}
            onChange={setCurrency}
          />
          <ColorPicker
            label="Project colour"
            value={colour}
            onChange={setColour}
            takenColours={projects.map((p) => p.colour)}
          />
          <div className="button-row">
            <button type="submit" className="button button-primary">
              Add project
            </button>
            <button type="button" className="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {projects.length === 0 && <p className="hint">No projects yet.</p>}

      {/* 0005 N2: projects are grouped by client so the two types are never told apart by
          colour alone. */}
      <ul className="taxonomy-list">
        {[...projects]
          .sort((a, b) => {
            const groupOrder = (p: Project) => (p.clientId === null ? '￿' : p.clientId)
            return groupOrder(a).localeCompare(groupOrder(b)) || a.name.localeCompare(b.name)
          })
          .map((project) => {
            const owner = clients.find((c) => c.id === project.clientId)
            return (
              <li
                key={project.id}
                className={project.archived ? 'taxonomy-row archived' : 'taxonomy-row'}
              >
                <ProjectRow
                  project={project}
                  clientName={owner?.name ?? null}
                  clients={clients}
                  defaultCurrency={defaultCurrency}
                  now={now}
                  report={report}
                  onDelete={() => onDelete(project)}
                />
              </li>
            )
          })}
      </ul>

      <ArchivedToggle
        plural="projects"
        singular="project"
        showArchived={showArchived}
        onToggle={onToggleArchived}
        hiddenCount={allProjects.length - projects.length}
      />
    </div>
  )
}

function ProjectRow({
  project,
  clientName,
  clients,
  defaultCurrency,
  now,
  report,
  onDelete,
}: {
  project: Project
  clientName: string | null
  clients: Client[]
  defaultCurrency: string | null
  now: Date
  report: (problem: unknown) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.name)
  const [clientId, setClientId] = useState<string | null>(project.clientId)
  const [rate, setRate] = useState<number | null>(project.defaultRateMinor)
  const [currency, setCurrency] = useState<string | null>(project.currency)
  const [colour, setColour] = useState(project.colour)

  const client = clients.find((c) => c.id === clientId) ?? null
  const effectiveCurrency = resolveCurrency({ currency }, client, defaultCurrency).code

  async function save() {
    try {
      await updateProject(
        project.id,
        { name, clientId, defaultRateMinor: rate, currency, colour },
        now,
      )
      setEditing(false)
    } catch (problem) {
      report(problem)
    }
  }

  if (editing) {
    return (
      <div className="taxonomy-edit">
        <div className="field">
          <label htmlFor={`project-${project.id}-name`}>Project name</label>
          <input
            id={`project-${project.id}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`project-${project.id}-client`}>Client</label>
          <select
            id={`project-${project.id}-client`}
            value={clientId ?? ''}
            onChange={(e) => setClientId(e.target.value || null)}
          >
            <option value="">No client — internal work</option>
            {clients
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <RateField
          label="Default hourly rate"
          currency={effectiveCurrency}
          value={rate}
          onChange={setRate}
        />
        <CurrencySelect
          label="Currency override"
          inheritLabel={
            client ? `Use the client’s ${currencyLabel(client.currency)}` : 'Use the default'
          }
          value={currency}
          onChange={setCurrency}
        />
        <ColorPicker label="Project colour" value={colour} onChange={setColour} />
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={() => void save()}>
            Save
          </button>
          <button type="button" className="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <span className="taxonomy-name">
        <span
          className="taxonomy-swatch"
          style={{ background: project.colour }}
          aria-hidden="true"
        />
        {project.name}
        {project.archived && <span className="badge badge-archived"> archived</span>}
      </span>
      {/* Labelled, never colour alone (0005 N2): the client is named, and a project with
          no client says so rather than showing nothing. */}
      <span className="taxonomy-meta">
        {clientName === null ? 'No client' : `Client: ${clientName}`}
        {project.defaultRateMinor !== null && ' · billable'}
        {project.currency !== null && ` · ${currencyLabel(project.currency)}`}
      </span>
      <span className="taxonomy-actions">
        <button type="button" className="button" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            void setArchived('project', project.id, !project.archived, now).catch(report)
          }}
        >
          {project.archived ? 'Restore' : 'Archive'}
        </button>
        <button type="button" className="button button-danger" onClick={onDelete}>
          Delete
        </button>
      </span>
    </>
  )
}

function TagSection({
  tags,
  onDelete,
  now,
  report,
}: SectionProps & { tags: Tag[]; onDelete: (tag: Tag) => void }) {
  const [newName, setNewName] = useState('')
  const [mergeFrom, setMergeFrom] = useState<string | null>(null)
  const [mergeInto, setMergeInto] = useState<string>('')

  async function create(event: React.FormEvent) {
    event.preventDefault()
    try {
      const { created } = await createOrFindTag({ name: newName, now })
      // T2: typing a name that already exists selects it rather than duplicating it, so
      // saying so is the difference between a helpful merge and a silent one.
      if (!created) {
        report(new Error(`"${newName.trim()}" already exists — nothing new was created.`))
      }
      setNewName('')
    } catch (problem) {
      report(problem)
    }
  }

  async function runMerge() {
    if (!mergeFrom || mergeInto === '') return
    try {
      await mergeTags(mergeFrom, mergeInto, now)
      setMergeFrom(null)
      setMergeInto('')
    } catch (problem) {
      report(problem)
    }
  }

  return (
    <div className="settings-block">
      <h3>Tags</h3>
      <p className="hint">
        Tags can also be typed straight into an entry as you record it — anything you add here
        does not have to exist first.
      </p>

      <form className="taxonomy-form inline-form" onSubmit={(e) => void create(e)}>
        <div className="field">
          <label htmlFor="tag-name">New tag</label>
          <input
            id="tag-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <button type="submit" className="button button-primary">
          Add tag
        </button>
      </form>

      {tags.length === 0 && <p className="hint">No tags yet.</p>}

      <ul className="taxonomy-list">
        {tags.map((tag) => (
          <li key={tag.id} className="taxonomy-row">
            <TagRow
              tag={tag}
              tags={tags}
              merging={mergeFrom === tag.id}
              onStartMerge={() => {
                setMergeFrom(tag.id)
                setMergeInto('')
              }}
              now={now}
              report={report}
              onDelete={() => onDelete(tag)}
            />
          </li>
        ))}
      </ul>

      {mergeFrom && (
        <div className="taxonomy-edit" data-testid="tag-merge">
          <div className="field">
            <label htmlFor="tag-merge-target">
              Merge “{tags.find((t) => t.id === mergeFrom)?.name}” into
            </label>
            <select
              id="tag-merge-target"
              value={mergeInto}
              onChange={(e) => setMergeInto(e.target.value)}
            >
              <option value="">Choose a tag</option>
              {tags
                .filter((t) => t.id !== mergeFrom)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="button button-primary"
              disabled={mergeInto === ''}
              onClick={() => void runMerge()}
            >
              Merge tags
            </button>
            <button type="button" className="button" onClick={() => setMergeFrom(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TagRow({
  tag,
  tags,
  merging,
  onStartMerge,
  now,
  report,
  onDelete,
}: {
  tag: Tag
  tags: Tag[]
  merging: boolean
  onStartMerge: () => void
  now: Date
  report: (problem: unknown) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tag.name)

  async function save() {
    try {
      await updateTag(tag.id, { name }, now)
      setEditing(false)
    } catch (problem) {
      report(problem)
    }
  }

  if (editing) {
    return (
      <div className="taxonomy-edit">
        <div className="field">
          <label htmlFor={`tag-${tag.id}-name`}>Tag name</label>
          <input
            id={`tag-${tag.id}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={() => void save()}>
            Save
          </button>
          <button type="button" className="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <span className="taxonomy-name">
        <span
          className="taxonomy-swatch"
          style={{ background: tag.colour }}
          aria-hidden="true"
        />
        {tag.name}
      </span>
      <span className="taxonomy-meta" />
      <span className="taxonomy-actions">
        <button type="button" className="button" onClick={() => setEditing(true)}>
          Rename
        </button>
        {/* T4: merge rather than per-entry cleanup. */}
        {tags.length > 1 && !merging && (
          <button type="button" className="button" onClick={onStartMerge}>
            Merge…
          </button>
        )}
        <button type="button" className="button button-danger" onClick={onDelete}>
          Delete
        </button>
      </span>
    </>
  )
}

/**
 * A section heading with its add button on the same line (items 32 and 33).
 *
 * The button was on a line of its own under the heading, which cost a row of height on
 * both of the longest lists in the app and read as a separate thing rather than as the way
 * you add to the list you are looking at. It is a "+" for the same reason the timer card's
 * is: the surrounding section already says what is being added, and the glyph keeps the row
 * compact.
 *
 * `aria-label` still carries the full verb, so the control is named rather than being a
 * bare symbol to a screen reader.
 */
function SectionHeading({ noun, onAdd }: { noun: 'client' | 'project'; onAdd: () => void }) {
  return (
    <div className="taxonomy-section-heading">
      <h3>{noun === 'client' ? 'Clients' : 'Projects'}</h3>
      <button
        type="button"
        className="button timer-add-client"
        onClick={onAdd}
        /*
         * "New client", not "Add client": the form's own submit button is called "Add
         * client", and while that form is open both were on screen with the same
         * accessible name — so "Add client" matched two controls.
         */
        aria-label={`New ${noun}`}
        title={`New ${noun}`}
        data-testid={`new-${noun}`}
      >
        <PlusIcon />
      </button>
    </div>
  )
}

function ArchivedToggle({
  plural,
  singular,
  showArchived,
  onToggle,
  hiddenCount,
}: {
  /** Names the section, so two toggles on one page stay distinguishable to a screen reader. */
  plural: 'clients' | 'projects'
  singular: 'client' | 'project'
  showArchived: boolean
  onToggle: (value: boolean) => void
  hiddenCount: number
}) {
  return (
    <div className="archived-toggle">
      {/* A2: archived records stay hidden by default but must remain reachable, or
          historical entries become impossible to edit. */}
      <label>
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => onToggle(e.target.checked)}
        />{' '}
        Show archived {plural}
      </label>
      {hiddenCount > 0 && !showArchived && (
        <span className="hint">
          {counted(hiddenCount, `${singular} is`, `${plural} are`)} hidden.
        </span>
      )}
    </div>
  )
}
