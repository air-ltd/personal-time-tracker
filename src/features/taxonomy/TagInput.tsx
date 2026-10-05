import { useCallback, useId, useState } from 'react'
import { createOrFindTag } from '../../storage/taxonomyRepo'
import type { Tag } from '../../domain/taxonomy/types'

/**
 * Inline tag entry (0005 T1–T2).
 *
 * T1 is the reason this exists as its own component rather than a text field on the form:
 * tags are created here, by typing, at the moment they are needed. A user who has to stop
 * and design a taxonomy before recording an entry will not record the entry.
 *
 * T2 falls out of `createOrFindTag`: typing `Research` when `research` exists selects the
 * existing tag. Creating a second tag that differs only in case would make the tag list a
 * thing to clean up by hand, which is the outcome T4's merge exists to avoid.
 */

export interface TagInputProps {
  /** Every live tag, so a typed name can be matched case-insensitively. */
  tags: Tag[]
  /** Ids currently on the entry, in the order they were added. */
  selected: string[]
  onChange: (ids: string[]) => void
  now: Date
  report: (problem: unknown) => void
  /**
   * Told about the in-flight commit, so a parent can wait for it and use its result.
   *
   * A callback rather than a ref to fill in, because the child should not be writing to
   * something the parent owns — and React's own lint rule says so for the same reason. The
   * parent keeps the promise in its ref; this only hands it over.
   *
   * It exists because pressing the entry form's Save button blurs this input, which commits
   * the typed tag; the blur handler is fire-and-forget, so the entry was written before the
   * tag existed and the tag landed in the taxonomy unattached — a silent loss, plus an
   * orphan to clean up.
   *
   * It hands back the **new selection**, not just completion, because awaiting is not enough
   * on its own: `onChange` schedules a state update, so the parent's `selected` is still the
   * old value in the closure that is about to write the entry. Returning the ids is what
   * lets it save the tag the user typed.
   */
  onCommitting?: ((work: Promise<string[] | null>) => void) | undefined
}

export function TagInput({
  tags,
  selected,
  onChange,
  now,
  report,
  onCommitting,
}: TagInputProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  // Scoped, because these ids address document elements and a second entry form — or a
  // second tag input on one page — would silently cross-wire its label to the other's field.
  const inputId = useId()
  const listId = useId()
  const hintId = useId()

  const selectedTags = selected
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is Tag => tag !== undefined)

  /**
   * Names still unselected, offered as a datalist.
   *
   * A hint rather than the only route: a datalist cannot be keyboard-navigated reliably
   * across browsers, so it works alongside typing and never blocks it.
   */
  const suggestions = tags.filter((tag) => !selected.includes(tag.id)).map((tag) => tag.name)

  /**
   * Commit a typed name.
   *
   * Resolves to the selection to save, or null when there was nothing to commit — so a
   * parent awaiting this can tell "I changed nothing" from "I added a tag", which are the
   * same `undefined` otherwise.
   */
  const add = useCallback(
    async (rawName: string): Promise<string[] | null> => {
      const name = rawName.trim()
      // Busy first, then the field. Clearing before the guard meant a keystroke arriving
      // while a creation was in flight was discarded on the floor — the user watched their
      // word vanish because they typed during a round trip they had not asked for.
      if (name === '' || busy) return null
      setBusy(true)
      try {
        const { tag } = await createOrFindTag({ name, now })
        const next = selected.includes(tag.id) ? selected : [...selected, tag.id]
        onChange(next)
        // Cleared on success only. On failure the name is restored below, and clearing here
        // first would mean two writes to undo one.
        setText('')
        return next
      } catch (problem) {
        setText(name)
        report(problem)
        return null
      } finally {
        setBusy(false)
      }
    },
    [busy, now, onChange, report, selected],
  )

  /**
   * Publish the in-flight commit before it starts.
   *
   * Assigned synchronously, so there is no window in which the work has begun but the parent
   * has not been told — which is the window the bug lived in.
   */
  function commit(name: string): void {
    /*
     * An empty field has nothing to commit, and must not replace a commit that is already in
     * flight with a promise resolving to null — the parent would await *that* and save the
     * entry without the tag. Pressing Enter and then Save blurs an already-emptied field,
     * which is exactly that sequence.
     */
    if (name.trim() === '') return
    const work = add(name)
    if (onCommitting) onCommitting(work)
  }

  /**
   * Commit on a separator.
   *
   * Enter and comma both finish a tag, because people type either: comma is the habit from
   * every other tagging field, Enter is the habit from a chip input. Space is
   * deliberately not a separator — tag names contain spaces.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit(text)
      return
    }
    /*
     * Backspace on an empty field removes the last tag, which is how chip inputs behave.
     *
     * Guarded on and trimmed from `selected` — the raw id array. It used to guard on
     * `selectedTags`, the chips that resolved to a live tag, and trim from `selected`: the
     * two disagree when a selected id names a tag that has since been deleted, and then
     * Backspace did nothing at all while appearing to work. `selected` is both what is
     * written to the entry and what the user removed, so it is the only consistent choice.
     */
    if (event.key === 'Backspace' && text === '' && selected.length > 0) {
      onChange(selected.slice(0, -1))
    }
  }

  return (
    <div className="field tag-input">
      <label htmlFor={inputId}>Tags</label>

      {selectedTags.length > 0 && (
        <ul className="tag-chips" data-testid="entry-tag-chips">
          {selectedTags.map((tag) => (
            <li key={tag.id}>
              <span className="chip">
                {/* Colour is decoration here; the name is the content, so it is always
                    present as text and never encoded in the swatch alone (0005 N2). */}
                <span
                  className="tag-swatch"
                  style={{ background: tag.colour }}
                  aria-hidden="true"
                />
                {tag.name}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={`Remove tag ${tag.name}`}
                  onClick={() => onChange(selected.filter((id) => id !== tag.id))}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <input
        id={inputId}
        type="text"
        list={listId}
        autoComplete="off"
        disabled={busy}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(text)}
        aria-describedby={hintId}
      />
      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <p id={hintId} className="hint">
        Type a tag and press Enter. New tags are created as you go — there is nothing to set up
        first.
      </p>
    </div>
  )
}
