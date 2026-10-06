import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTaxonomy } from './useTaxonomy'
import { useAppDefaultCurrency } from '../settings/useAppDefaultCurrency'
import { useTagDeletes } from './useTagDeletes'
import { ClientForm } from './ClientForm'
import { ProjectForm } from './ProjectForm'
import { ChevronIcon, PlusIcon } from '../../app/Icons'
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

/** Group key for projects with no client; cannot be an id, so `domId` carries that. */
const UNGROUPED = '\u0000ungrouped'

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
  /*
   * One flag for archived clients and projects alike (0005 A2). Two flags meant two
   * checkboxes under one heading, asking the user to treat "see archived clients" and "see
   * archived projects" as separate decisions when they are one.
   */
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * The app-wide default currency, for *resolving* rates — not for editing.
   *
   * The control moved to `CurrenciesPanel`, because it is a preference rather than a
   * taxonomy record. The value still has to be read here: every project's rate on this
   * page is shown in whatever currency it resolves to, and that chain ends at this default.
   */
  const defaultCurrency = useAppDefaultCurrency()

  /*
   * A project's visibility follows its client's (item 57).
   *
   * Work filed under a client you have finished with is not something you are working on,
   * and leaving those projects on the page under a client that is no longer listed left the
   * tree with rows whose owner was missing. The project is NOT archived by this — 0005 A4
   * still holds, and it comes back whole, with its client, when archived records are shown.
   */
  const archivedClientIds = new Set(clients.filter((c) => c.archived).map((c) => c.id))
  const visibleProjects = showArchived
    ? projects
    : projects.filter(
        (p) => !p.archived && (p.clientId === null || !archivedClientIds.has(p.clientId)),
      )
  const visibleClients = showArchived ? clients : clients.filter((c) => !c.archived)

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
    <>
      {/*
        Labelled by the heading TaxonomySection renders on the same line as its add buttons.
        Not repeated here: two h2s with the same id would leave `aria-labelledby` resolving to
        whichever came first, and name the panel after the wrong one of them.
      */}
      <section className="panel settings-panel" aria-labelledby="taxonomy-heading">
        <TaxonomySection
          clients={visibleClients}
          allClients={clients}
          projects={visibleProjects}
          allProjects={projects}
          showArchived={showArchived}
          onToggleArchived={setShowArchived}
          defaultCurrency={defaultCurrency}
          now={now}
          report={report}
          banner={
            /*
              Both sources land in one place, but they are not the same: a failed read is not
              dismissible, because nothing has loaded to act on, whereas a failed write is
              something the Dismiss button can honestly clear.

              Here rather than above the tags panel because a failed *load* of the taxonomy
              affects clients, projects and tags equally — it is one read — so a single
              banner covering all of it is honest, where one inside this panel would look
              like a client-specific failure.
            */
            (error ?? loadError) !== null ? (
              <div className="alert alert-error" role="alert" data-testid="settings-error">
                <p>{error ?? loadError}</p>
                {error !== null && (
                  <button type="button" className="button" onClick={() => setError(null)}>
                    Dismiss
                  </button>
                )}
              </div>
            ) : null
          }
        />
      </section>

      {/*
        Tags in their own card (SPECS/todo.md item 50).

        They were the third section of a panel headed "Settings", below two lists of records
        that have nothing to do with them. A tag is not a client or a project, it is not
        scoped to one, and its delete flow is the only one left with an undo bar — all of
        which got lost in a shared card. Its confirmation and undo bar moved with it, which
        also means they no longer appear under a heading about clients and projects.
      */}
      <section className="panel" aria-labelledby="tags-heading">
        <h2 id="tags-heading">Tags</h2>
        <TagSection tags={tags} onDelete={tagDeletes.onDelete} now={now} report={report} />
        {tagDeletes.confirmation}
        {tagDeletes.undoBar}
      </section>
    </>
  )
}

interface SectionProps {
  now: Date
  report: (problem: unknown) => void
}

/**
 * Clients and their projects as one tree (SPECS/todo.md items 51 and 54).
 *
 * These were two stacked sections — a list of clients, then a list of projects — which asked
 * the user to hold a client in their head while scrolling past every other client's projects
 * to reach one. Now each client is one row that both carries its own actions and reveals the
 * work under it, so the tree is the only copy of that relationship on the page.
 *
 * The client's Edit and Archive sit on the group header rather than in a separate list, which
 * is the whole point: there is exactly one place a client can be acted on, and it is the same
 * place its projects are found.
 */
function TaxonomySection({
  clients,
  allClients,
  projects,
  allProjects,
  showArchived,
  onToggleArchived,
  defaultCurrency,
  now,
  report,
  banner,
}: SectionProps & {
  clients: Client[]
  allClients: Client[]
  projects: Project[]
  allProjects: Project[]
  showArchived: boolean
  onToggleArchived: (value: boolean) => void
  defaultCurrency: string | null
  banner: ReactNode
}) {
  const [creatingClient, setCreatingClient] = useState(false)
  /*
   * The group whose project form is open, so it appears under the list it is adding to
   * (item 55). Separate from the client form so opening one does not close the other
   * part-way through.
   */
  const [addingFor, setAddingFor] = useState<string | null>(null)

  /*
   * Which groups are open, and how they start (item 51).
   *
   * A `Set` rather than one flag, because "collapsed" is per client: a user who opened one
   * client's projects did not ask for every client's projects.
   *
   * Default is *nothing* open. The list used to be flat and complete, which meant a taxonomy
   * of any size was a wall. The count on each row says how much is behind it, so a collapsed
   * group is not a hidden group.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())
  function toggle(key: string): void {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  /*
   * The tree, derived rather than stored.
   *
   * Derived because the taxonomy can change under us — a project archived, a client removed —
   * and a grouping held in state would then describe a taxonomy that no longer exists.
   */
  const groups = useMemo(() => {
    const byClient = new Map<string, Project[]>()
    for (const project of projects) {
      const key = project.clientId ?? UNGROUPED
      const rows = byClient.get(key)
      // Pushed rather than replaced, so this is linear in the projects rather than quadratic.
      if (rows) rows.push(project)
      else byClient.set(key, [project])
    }

    /*
     * A client with no projects still gets a row. It exists, it can be edited or archived,
     * and a client silently missing from the only list of clients would be its own bug — the
     * "0 projects" count is also the honest answer to "where did my project go".
     */
    for (const client of clients) {
      if (!byClient.has(client.id)) byClient.set(client.id, [])
    }

    /*
     * No empty "No client" group. Every client gets a row even when it has no projects,
     * because a client is a record that exists and can be acted on. The absence of a client
     * is not a record — an empty row named "No client" told the user they had nothing under
     * it, which is a fact about their data rather than something to act on.

     * Internal work is still creatable: the client picker in the project form offers "No
     * client — internal work" (0005 R1/U1), so it is reachable from any client's add button.
     */

    /*
     * Ordering, and why a group can exist with no client to show.
     *
     * Projects belonging to a client that is archived and hidden are NOT dropped: archiving a
     * client does not archive its projects (0005 A4), so hiding the client must not take live
     * work off the page with it. Those groups are rendered without the client's actions,
     * because there is no client on screen to act on, and they sort after the live clients so
     * the ordinary case reads first.
     */
    const rank = (key: string) => (key === UNGROUPED ? 2 : byClient.has(key) ? 0 : 1)
    const nameOf = (key: string) =>
      key === UNGROUPED
        ? 'No client'
        : (allClients.find((c) => c.id === key)?.name ?? 'Unknown client')

    return (
      [...byClient.entries()]
        .map(([key, rows]) => ({
          key,
          // The key is used in an id and a testid, so it must be safe in both.
          domId: key === UNGROUPED ? 'none' : key,
          client: clients.find((c) => c.id === key) ?? null,
          name: nameOf(key),
          projects: rows.sort((a, b) => a.name.localeCompare(b.name)),
        }))
        // Orphans last, so a client whose name sorts early cannot bury them.
        .sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name))
    )
  }, [projects, clients, allClients])

  return (
    <div className="settings-block">
      <div className="panel-header taxonomy-section-heading">
        {/*
          "Clients and projects", not "Settings". Every other panel on this page is named
          for what it holds — Appearance, Currencies, Sync, Backup — and a panel called
          "Settings", inside the settings page, named nothing at all.
        */}
        <h2 id="taxonomy-heading">Clients and projects</h2>
        {/*
          Only clients here (item 56). A project is added from the list it will join — under
          its client, or under "No client" — so the client is already decided by where the
          button is. A page-level "New project" asked the user to state the same thing the
          button's own position already said.
        */}
        <button
          type="button"
          className="button button-icon"
          data-testid="new-client"
          aria-expanded={creatingClient}
          onClick={() => {
            // One form at a time. They sit in different parts of the section now, so both
            // being open at once would leave two half-finished records on screen with no
            // obvious relationship between them.
            setCreatingClient((wasCreating) => {
              if (wasCreating) return false
              setAddingFor(null)
              return true
            })
          }}
        >
          <PlusIcon />
          <span>New client</span>
        </button>
      </div>

      {banner}

      {creatingClient && (
        <ClientForm
          takenColours={allClients.map((row) => row.colour)}
          now={now}
          onDone={() => setCreatingClient(false)}
          report={report}
        />
      )}

      {groups.length === 0 && (
        <p className="hint">
          No clients or projects yet. Add a client, or a project on its own.
        </p>
      )}

      {groups.length > 0 && (
        <ul className="taxonomy-groups">
          {groups.map((group) => (
            <TaxonomyGroup
              key={group.key}
              group={group}
              expanded={expanded.has(group.key)}
              onToggle={() => toggle(group.key)}
              addingProject={addingFor === group.key}
              onAddProject={() => {
                const opening = addingFor !== group.key
                setAddingFor(opening ? group.key : null)
                if (opening) setCreatingClient(false)
                // The form lives with the projects it adds to, so the group has to be open
                // for it to be visible at all.
                if (opening) {
                  setExpanded((previous) => new Set(previous).add(group.key))
                }
              }}
              allClients={allClients}
              defaultCurrency={defaultCurrency}
              now={now}
              report={report}
            />
          ))}
        </ul>
      )}

      {/*
        One control for both record types (0005 A2: "an explicit show-archived control").

        Two of them was over-serving the requirement: separate toggles for clients and
        projects, under one heading, asked the user to decide separately whether to see
        archived *clients* and archived *projects* — which is one decision about one idea. The
        original bug this replaced was two checkboxes bound to one value, each reporting the
        other's state; one checkbox with a label naming both it shows is the honest form of
        that, and A5's Restore makes each record recoverable regardless.

        The count is both types together, because that is what the control reveals.
      */}
      <ArchivedToggle
        showArchived={showArchived}
        onToggle={onToggleArchived}
        hiddenCount={
          allClients.length - clients.length + (allProjects.length - projects.length)
        }
      />
    </div>
  )
}

/**
 * One client and the projects under it: a header row that is both the client's record and the
 * control for its projects.
 */
function TaxonomyGroup({
  group,
  expanded,
  onToggle,
  addingProject,
  onAddProject,
  allClients,
  defaultCurrency,
  now,
  report,
}: SectionProps & {
  group: {
    key: string
    domId: string
    client: Client | null
    name: string
    projects: Project[]
  }
  expanded: boolean
  onToggle: () => void
  /** Whether this client's project form is showing on its own row. */
  addingProject: boolean
  onAddProject: () => void
  allClients: Client[]
  defaultCurrency: string | null
}) {
  const [editing, setEditing] = useState(false)
  const client = group.client
  const bodyId = `projects-${group.domId}`

  return (
    <li className="taxonomy-group">
      {/*
        Editing replaces the row but not the tree: the projects stay on screen underneath, so
        saving an edit cannot make the work under this client appear to vanish.
      */}
      {editing && client !== null ? (
        <div className="taxonomy-edit">
          <ClientForm
            client={client}
            now={now}
            onDone={() => setEditing(false)}
            report={report}
          />
        </div>
      ) : (
        <div className={client?.archived ? 'taxonomy-row archived' : 'taxonomy-row'}>
          {/*
            A button rather than a plain name because the name is the control: clicking it is
            how you see this client's projects. `aria-expanded` carries the state for anything
            that cannot see the disclosure, and `aria-controls` ties it to what it reveals.
          */}
          <button
            type="button"
            className="taxonomy-group-toggle"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={onToggle}
            data-testid={`toggle-projects-${group.domId}`}
          >
            <ChevronIcon />
            <span className="taxonomy-group-name">{group.name}</span>
            {client?.archived === true && (
              <span className="badge badge-archived"> archived</span>
            )}
          </button>

          <span className="taxonomy-meta">
            {/*
              The currency and rate are the client's, and the count is what is behind the
              disclosure — together they answer "is my work here, and what is it billed at?"
              without expanding anything.
            */}
            {client !== null && currencyLabel(client.currency)}
            {client !== null &&
              client.defaultRateMinor !== null &&
              /*
                Formatted, not raw. `9000` is the storage unit; the user bills in £90.00 an
                hour, and a list showing "9000 minor units/hour" is the storage layer talking
                to the user — which is what 0003 CU1 exists to stop.
              */
              ` · ${formatMinor(client.defaultRateMinor, client.currency ?? FALLBACK_CURRENCY)}/hour`}
            {` · ${counted(group.projects.length, 'project', 'projects')}`}
          </span>

          {/*
            No actions for the orphan group, and none for a client that is archived and hidden
            — in both cases there is no client on screen to edit or archive.
          */}
          {client !== null && (
            <span className="taxonomy-actions">
              <button type="button" className="button" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  // Caught: the user has pressed Archive and a silent failure leaves the row
                  // unchanged with no explanation, which reads as the button being broken.
                  // `report` is already used for every other failure in this file.
                  void setArchived('client', client.id, !client.archived, now).catch(report)
                }}
              >
                {client.archived ? 'Restore' : 'Archive'}
              </button>
            </span>
          )}
        </div>
      )}

      {/*
        Opened from the list it adds to, so the client is already chosen and the form appears
        where the new row will. A form at the top of the section would have appeared to come
        from nowhere.
      */}
      {addingProject && (
        <div className="taxonomy-edit">
          <ProjectForm
            clients={allClients}
            defaultCurrency={defaultCurrency}
            /*
              The group's own colours, and the client's. Not the whole taxonomy: the picker
              only has to avoid the colours already in view here, and every project in the
              app would leave it with almost nothing to offer (0005 P4).
            */
            takenColours={[
              ...group.projects.map((row) => row.colour),
              // No client in the orphan group, so there is no client colour to avoid.
              ...(client !== null ? [client.colour] : []),
            ]}
            idPrefix="project"
            initialClientId={client?.id}
            report={report}
            onSubmit={async (fields) => {
              await createProject({ ...fields, now })
              onAddProject()
            }}
            onCancel={onAddProject}
          />
        </div>
      )}

      <ul className="taxonomy-list" id={bodyId} hidden={!expanded}>
        {group.projects.map((project) => (
          <li
            key={project.id}
            className={project.archived ? 'taxonomy-row archived' : 'taxonomy-row'}
          >
            <ProjectRow
              project={project}
              clients={allClients}
              defaultCurrency={defaultCurrency}
              now={now}
              report={report}
            />
          </li>
        ))}

        {/*
          Underneath the last project, inside the group it adds to (item 56). It goes here
          rather than on the client row so that where the button is says which list the new
          project joins — including for the "No client" group, which is how internal work
          gets created at all now that there is no page-level project button.

          Inside the collapsible list on purpose: it hides with the projects it adds to,
          leaving the client row as the only thing on screen when the group is closed.
        */}
        {/*
          No button under an archived client (item 58): work is not being started for a
          client that has been finished with, and offering the affordance invites it. The
          orphan group keeps its button — internal work belongs to nobody, so nothing is
          finished.
        */}
        {client?.archived !== true && (
          <li className="taxonomy-add-row">
            <button
              type="button"
              className="button"
              data-testid={`add-project-for-${group.domId}`}
              aria-expanded={addingProject}
              // An explicit label, because the name is built from a visible "New project" and
              // the client it belongs to, and the accessible-name computation trims each of
              // those separately — running them together as "New projectfor Acme Ltd". It
              // also has to be unique: with one button per group, "New project" alone would
              // leave a screen reader user several identical controls and no way to tell
              // which client each one serves.
              aria-label={`New project for ${group.name}`}
              onClick={onAddProject}
            >
              <PlusIcon />
              <span>New project</span>
            </button>
          </li>
        )}
      </ul>
    </li>
  )
}

function ProjectRow({
  project,
  clients,
  defaultCurrency,
  now,
  report,
}: {
  project: Project
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
        {/*
          Its own element so the archived strike reaches the name and stops there. A
          descendant cannot turn off a decoration propagated from an ancestor, so leaving the
          name as a bare text node struck the "archived" badge with it — striking the word
          that says the row is archived, which argues with itself.
        */}
        <span className="taxonomy-name-text">{project.name}</span>
        {project.archived && <span className="badge badge-archived"> archived</span>}
      </span>
      {/*
        Deliberately does not name the client (0005 N2). It used to read "Client: Acme Ltd",
        or "No client" when there was none — but item 51 moved the owner to the group heading
        above, so repeating it here was both redundant and, when the prop was left null, a
        lie: every row read "No client" even under a named client. The heading names the
        owner, which satisfies N2 by grouping rather than by labelling.
      */}
      <span className="taxonomy-meta">
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
  showArchived,
  onToggle,
  hiddenCount,
}: {
  showArchived: boolean
  onToggle: (value: boolean) => void
  /** Archived clients and projects together, because one control reveals both. */
  hiddenCount: number
}) {
  return (
    <div className="archived-toggle">
      {/*
        A2: archived records stay hidden by default but must remain reachable, or historical
        entries become impossible to edit.

        The label names both types it reveals rather than a section. It used to take the
        section's name because there were two controls and each covered one type; there is
        one now, so there is one thing to say about it.
      */}
      <label>
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => onToggle(e.target.checked)}
        />{' '}
        Show archived clients and projects
      </label>
      {hiddenCount > 0 && !showArchived && (
        <span className="hint">{counted(hiddenCount, 'record is', 'records are')} hidden.</span>
      )}
    </div>
  )
}
