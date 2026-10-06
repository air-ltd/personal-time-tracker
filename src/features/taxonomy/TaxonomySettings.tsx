import { useCallback, useState } from 'react'
import { useTaxonomy } from './useTaxonomy'
import { useAppDefaultCurrency } from '../settings/useAppDefaultCurrency'
import { useTagDeletes } from './useTagDeletes'
import { ClientForm } from './ClientForm'
import { ProjectForm } from './ProjectForm'
import { AddToHeading } from '../../app/AddToHeading'
import {
  createOrFindTag,
  createProject,
  mergeTags,
  setArchived,
  updateProject,
  updateTag,
} from '../../storage/taxonomyRepo'
import { FALLBACK_CURRENCY, resolveCurrency } from '../../domain/taxonomy/money'
import { currencyLabel, formatMinor } from '../../domain/taxonomy/currencies'
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

export function TaxonomySettings({ now }: { now: Date }) {
  const { projects, clients, tags, loading, error: loadError } = useTaxonomy()
  /*
   * Two flags, not one.
   *
   * A single `showArchived` drove both toggles, so ticking "Show archived clients" also
   * revealed archived projects — two labelled controls bound to one value, where each
   * checkbox then reported the other's state. Split per section: the label says which
   * records it shows, and it shows exactly those.
   */
  const [showArchivedClients, setShowArchivedClients] = useState(false)
  const [showArchivedProjects, setShowArchivedProjects] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * The app-wide default currency, for *resolving* rates — not for editing.
   *
   * The control moved to `CurrenciesPanel`, because it is a preference rather than a
   * taxonomy record. The value still has to be read here: every project's rate on this
   * page is shown in whatever currency it resolves to, and that chain ends at this default.
   */
  const defaultCurrency = useAppDefaultCurrency()

  const visibleProjects = showArchivedProjects ? projects : projects.filter((p) => !p.archived)
  const visibleClients = showArchivedClients ? clients : clients.filter((c) => !c.archived)

  const report = useCallback((problem: unknown) => {
    setError(problem instanceof Error ? problem.message : String(problem))
  }, [])

  // --- delete flow -------------------------------------------------------------
  //
  // Extracted to a hook, and now tags only. Archiving replaced deleting for projects and
  // clients (0005 X1), and archiving needs none of this: it sets a flag, moves no entry, and
  // reverses with the restore the row already offers.
  const clearError = useCallback(() => setError(null), [])
  const tagDeletes = useTagDeletes({ now, report, clearError })

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

      {/*
        The app-wide default currency used to live here, under its own heading, while the
        list of currencies to offer sat in a different panel. It is not a taxonomy record —
        it is the last link in the resolution chain for *client-less* work, and its hook was
        already in `features/settings`. Moved to `CurrenciesPanel`, where both currency
        settings are siblings (0003 CU4).
      */}

      <ClientSection
        clients={visibleClients}
        allClients={clients}
        showArchived={showArchivedClients}
        onToggleArchived={setShowArchivedClients}

        now={now}
        report={report}
      />

      <ProjectSection
        projects={visibleProjects}
        allProjects={projects}
        clients={clients}
        defaultCurrency={defaultCurrency}
        showArchived={showArchivedProjects}
        onToggleArchived={setShowArchivedProjects}

        now={now}
        report={report}
      />

      <TagSection tags={tags} onDelete={tagDeletes.onDelete} now={now} report={report} />

      {tagDeletes.confirmation}
      {tagDeletes.undoBar}
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
  now,
  report,
}: SectionProps & {
  clients: Client[]
  allClients: Client[]
  showArchived: boolean
  onToggleArchived: (value: boolean) => void
}) {
  const [creating, setCreating] = useState(false)

  return (
    <div className="settings-block">
      <AddToHeading
        headingId="settings-clients-heading"
        heading="Clients"
        addLabel="New client"
        onAdd={() => setCreating(true)}
        className="panel-header taxonomy-section-heading"
        testId="new-client"
        headingLevel={3}
      />

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
            <ClientRow client={client} now={now} report={report} />
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
}: {
  client: Client
  now: Date
  report: (problem: unknown) => void
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
        {/* Formatted, not raw. `9000` is the storage unit; the user bills in £90.00 an
            hour, and a list showing "9000 minor units/hour" is the storage layer talking
            to the user — which is what 0003 CU1 exists to stop. */}
        {client.defaultRateMinor !== null &&
          ` · ${formatMinor(client.defaultRateMinor, client.currency ?? FALLBACK_CURRENCY)}/hour`}
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
  now,
  report,
}: SectionProps & {
  projects: Project[]
  allProjects: Project[]
  clients: Client[]
  defaultCurrency: string | null
  showArchived: boolean
  onToggleArchived: (value: boolean) => void
}) {
  const [creating, setCreating] = useState(false)
  /** Colours already in use, so a new project opens on a visibly distinct one (0005 P4). */
  const takenColours = useCallback(
    () => [...projects.map((row) => row.colour), ...clients.map((row) => row.colour)],
    [projects, clients],
  )
  return (
    <div className="settings-block">
      <AddToHeading
        headingId="settings-projects-heading"
        heading="Projects"
        addLabel="New project"
        onAdd={() => setCreating(true)}
        className="panel-header taxonomy-section-heading"
        testId="new-project"
        headingLevel={3}
      />

      {creating ? (
        <ProjectForm
          clients={clients}
          defaultCurrency={defaultCurrency}
          takenColours={takenColours()}
          idPrefix="project"
          report={report}
          onSubmit={async (fields) => {
            await createProject({ ...fields, now })
            setCreating(false)
          }}
          onCancel={() => setCreating(false)}
        />
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
}: {
  project: Project
  clientName: string | null
  clients: Client[]
  defaultCurrency: string | null
  now: Date
  report: (problem: unknown) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <ProjectForm
        project={project}
        clients={clients}
        defaultCurrency={defaultCurrency}
        // Every client colour on record, so a colour is offered that no other row uses.
        takenColours={clients.map((c) => c.colour)}
        idPrefix={`project-${project.id}`}
        report={report}
        onSubmit={async (fields) => {
          await updateProject(project.id, fields, now)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  /*
   * The same chain the form uses, for the rate this row displays. A project's stored rate
   * is minor units with no currency of its own unless one was overridden, so reading it
   * without resolving would divide by the wrong exponent and print nonsense.
   */
  const shownCurrency = resolveCurrency(
    { currency: project.currency },
    clients.find((c) => c.id === project.clientId) ?? null,
    defaultCurrency,
  ).code

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
        {/* The rate, where there is one. It used to say only "billable", which told the
            user nothing they could not already see — and left the one number on this row
            with nowhere to read it. */}
        {project.defaultRateMinor !== null &&
          ` · ${formatMinor(project.defaultRateMinor, shownCurrency)}/hour`}
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
  /**
   * An informational outcome, kept out of the shared error banner.
   *
   * Reusing `report` meant "that tag already exists" was announced through `role="alert"`
   * with a **Dismiss** button — an ordinary, expected result dressed as a failure, and
   * dismissible like one. It is a plain note here instead: no alert role, nothing to
   * dismiss, because nothing went wrong.
   */
  const [notice, setNotice] = useState<string | null>(null)

  async function create(event: React.FormEvent) {
    event.preventDefault()
    try {
      const { created } = await createOrFindTag({ name: newName, now })
      // T2: typing a name that already exists selects it rather than duplicating it, so
      // saying so is the difference between a helpful merge and a silent one.
      if (created) {
        setNotice(null)
      } else {
        setNotice(`"${newName.trim()}" already exists — nothing new was created.`)
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

      {/* A note, not an alert: no `role="alert"`, no Dismiss. Nothing failed here. */}
      {notice !== null && (
        <p className="hint" data-testid="settings-notice">
          {notice}
        </p>
      )}

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
