import { useState } from 'react'
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
}

export function TagInput({ tags, selected, onChange, now, report }: TagInputProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

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

  async function add(rawName: string): Promise<void> {
    const name = rawName.trim()
    setText('')
    if (name === '' || busy) return
    setBusy(true)
    try {
      const { tag } = await createOrFindTag({ name, now })
      if (!selected.includes(tag.id)) onChange([...selected, tag.id])
    } catch (problem) {
      setText(name)
      report(problem)
    } finally {
      setBusy(false)
    }
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
      void add(text)
      return
    }
    // Backspace on an empty field removes the last tag, which is how chip inputs behave.
    if (event.key === 'Backspace' && text === '' && selectedTags.length > 0) {
      onChange(selected.slice(0, -1))
    }
  }

  return (
    <div className="field tag-input">
      <label htmlFor="entry-tags">Tags</label>

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
        id="entry-tags"
        type="text"
        list="entry-tag-suggestions"
        autoComplete="off"
        disabled={busy}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void add(text)}
        aria-describedby="entry-tags-hint"
      />
      <datalist id="entry-tag-suggestions">
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <p id="entry-tags-hint" className="hint">
        Type a tag and press Enter. New tags are created as you go — there is nothing to set up
        first.
      </p>
    </div>
  )
}
