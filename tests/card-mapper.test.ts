import { describe, expect, it } from 'vitest'
import { cardMapper } from '../src/card-mapper.ts'
import type {
  CardChild,
  LarkButtonElement,
  LarkCardBody,
  LarkCardElement,
  LarkColumnSetElement,
  LarkImgElement,
  LarkMarkdownElement,
  LarkSelectElement,
  LarkTableElement,
} from '../src/types.ts'

const { cardToFallbackText, cardToLarkInteractive } = cardMapper

const byTag = (tag: string) => (el: { tag: string }) => el.tag === tag

const ELEMENT_ID_PATTERN = /^el_[A-Za-z0-9]+$/
const MAX_ELEMENT_ID_LENGTH = 20
const FIRST = 0
const SECOND = 1
const EXPECTED_ONE = 1
const EXPECTED_TWO = 2

const expectValidElementId = (el: LarkCardElement) => {
  expect((el as { element_id: string }).element_id).toMatch(ELEMENT_ID_PATTERN)
  expect(String((el as { element_id: string }).element_id).length).toBeLessThanOrEqual(
    MAX_ELEMENT_ID_LENGTH,
  )
}

/** Get the first action child from an actions column_set. */
const firstActionItem = (elements: LarkCardElement[]): LarkCardElement => {
  const colSet = elements.find(byTag('column_set')) as LarkColumnSetElement
  return colSet.columns.at(FIRST)!.elements.at(FIRST)!
}

/** Get the first element from elements array. */
const firstOf = <TItem>(arr: TItem[]): TItem => arr.at(FIRST)!

/** Get the second element from elements array. */
const secondOf = <TItem>(arr: TItem[]): TItem => arr.at(SECOND)!

/** Build a card with a single actions child. */
const actionsCard = (actionChildren: CardChild[]) => ({
  children: [{ children: actionChildren, type: 'actions' as const }],
  type: 'card' as const,
})

describe('cardToLarkInteractive', () => {
  describe('basic elements', () => {
    it('outputs schema 2.0 and config', () => {
      const card = { children: [], type: 'card' as const }
      const result = cardToLarkInteractive(card) as LarkCardBody
      expect(result.schema).toBe('2.0')
      expect(result.config).toMatchObject({ update_multi: true })
    })

    it('text produces markdown with valid element_id', () => {
      const result = cardToLarkInteractive({
        children: [{ content: 'Hello **world**', type: 'text' as const }],
        type: 'card' as const,
      }) as LarkCardBody
      const mdEl = result.body.elements.find(byTag('markdown')) as LarkMarkdownElement
      expect(mdEl).toBeDefined()
      expect(mdEl.content).toBe('Hello **world**')
      expectValidElementId(mdEl as LarkCardElement)
    })

    it('divider produces hr', () => {
      const result = cardToLarkInteractive({
        children: [{ type: 'divider' as const }],
        type: 'card' as const,
      }) as LarkCardBody
      const hrEl = result.body.elements.find(byTag('hr')) as LarkCardElement
      expect(hrEl).toBeDefined()
      expectValidElementId(hrEl)
    })

    it('image produces img', () => {
      const result = cardToLarkInteractive({
        children: [{ alt: 'A photo', type: 'image' as const, url: 'img_key_123' }],
        type: 'card' as const,
      }) as LarkCardBody
      const imgEl = result.body.elements.find(byTag('img')) as LarkImgElement
      expect(imgEl).toBeDefined()
      expect(imgEl.img_key).toBe('img_key_123')
      expectValidElementId(imgEl as LarkCardElement)
    })

    it('unknown component degrades to markdown if content exists', () => {
      const result = cardToLarkInteractive({
        children: [{ content: 'fallback', type: 'unknown_type' as const }],
        type: 'card' as const,
      }) as LarkCardBody
      const mdEl = result.body.elements.find(byTag('markdown'))
      expect(mdEl).toBeDefined()
      expect(mdEl).toHaveProperty('element_id')
    })
  })

  describe('header', () => {
    it('includes title with template', () => {
      const result = cardToLarkInteractive({
        children: [],
        title: 'Test Card',
        type: 'card' as const,
      }) as LarkCardBody
      expect(result.header).toMatchObject({
        template: 'blue',
        title: { content: 'Test Card', tag: 'plain_text' },
      })
    })

    it('includes subtitle when provided', () => {
      const result = cardToLarkInteractive({
        children: [],
        subtitle: 'Sub',
        title: 'Title',
        type: 'card' as const,
      }) as LarkCardBody
      expect(result.header!.subtitle).toMatchObject({ content: 'Sub', tag: 'plain_text' })
    })

    it('imageUrl inserts img at start of elements', () => {
      const result = cardToLarkInteractive({
        children: [{ content: 'text', type: 'text' as const }],
        imageUrl: 'img_v3_xxx',
        title: 'Card',
        type: 'card' as const,
      }) as LarkCardBody
      const firstEl = firstOf(result.body.elements) as LarkImgElement
      expect(firstEl.tag).toBe('img')
      expect(firstEl.img_key).toBe('img_v3_xxx')
    })
  })

  describe('button mapping', () => {
    const firstButton = (elements: LarkCardElement[]): LarkButtonElement =>
      firstActionItem(elements) as LarkButtonElement

    it('primary maps to primary_filled', () => {
      const result = cardToLarkInteractive(
        actionsCard([{ id: 'b', label: 'Click', style: 'primary', type: 'button' }]),
      ) as LarkCardBody
      expect(firstButton(result.body.elements).type).toBe('primary_filled')
    })

    it('danger maps to danger', () => {
      const result = cardToLarkInteractive(
        actionsCard([{ id: 'b', label: 'Del', style: 'danger', type: 'button' }]),
      ) as LarkCardBody
      expect(firstButton(result.body.elements).type).toBe('danger')
    })

    it('default maps to default', () => {
      const result = cardToLarkInteractive(
        actionsCard([{ id: 'b', label: 'Btn', style: 'default', type: 'button' }]),
      ) as LarkCardBody
      expect(firstButton(result.body.elements).type).toBe('default')
    })

    it('always has behaviors with id', () => {
      const result = cardToLarkInteractive(
        actionsCard([{ id: 'my_btn', label: 'Click', type: 'button' }]),
      ) as LarkCardBody
      expect(firstButton(result.body.elements).behaviors).toEqual([
        { type: 'callback', value: { id: 'my_btn' } },
      ])
    })

    it('with value includes action in behaviors', () => {
      const result = cardToLarkInteractive(
        actionsCard([{ id: 'btn1', label: 'Do it', type: 'button', value: 'my_action' }]),
      ) as LarkCardBody
      expect(firstButton(result.body.elements).behaviors).toEqual([
        { type: 'callback', value: { action: 'my_action', id: 'btn1' } },
      ])
    })

    it('disabled is mapped', () => {
      const result = cardToLarkInteractive(
        actionsCard([{ disabled: true, id: 'b', label: 'Off', type: 'button' }]),
      ) as LarkCardBody
      expect(firstButton(result.body.elements).disabled).toBe(true)
    })
  })

  describe('actions layout', () => {
    it('produces column_set with flex_mode flow and multiple columns', () => {
      const result = cardToLarkInteractive(
        actionsCard([
          { id: 'a', label: 'A', type: 'button' },
          { id: 'b', label: 'B', type: 'button' },
        ]),
      ) as LarkCardBody
      const colSet = result.body.elements.find(byTag('column_set')) as LarkColumnSetElement
      expect(colSet).toBeDefined()
      expect(colSet.flex_mode).toBe('flow')
      expect(colSet.columns).toHaveLength(EXPECTED_TWO)
    })

    it('no action wrapper element exists', () => {
      const result = cardToLarkInteractive(
        actionsCard([{ id: 'a', label: 'A', type: 'button' }]),
      ) as LarkCardBody
      expect(result.body.elements.find(byTag('action'))).toBeUndefined()
    })
  })

  describe('link-button', () => {
    it('maps to button with open_url behavior', () => {
      const result = cardToLarkInteractive(
        actionsCard([{ label: 'Visit', type: 'link-button', url: 'https://example.com' }]),
      ) as LarkCardBody
      const btnEl = firstActionItem(result.body.elements) as LarkButtonElement
      expect(btnEl.tag).toBe('button')
      expect(btnEl.behaviors).toEqual([{ default_url: 'https://example.com', type: 'open_url' }])
    })
  })

  describe('select', () => {
    it('maps to select_static with options', () => {
      const result = cardToLarkInteractive(
        actionsCard([
          {
            id: 'priority',
            label: 'Priority',
            options: [
              { label: 'High', type: 'option', value: 'high' },
              { label: 'Low', type: 'option', value: 'low' },
            ],
            type: 'select',
          },
        ]),
      ) as LarkCardBody
      const selectEl = firstActionItem(result.body.elements) as LarkSelectElement
      expect(selectEl.tag).toBe('select_static')
      expect(selectEl.placeholder).toMatchObject({ content: 'Priority', tag: 'plain_text' })
      expect(selectEl.options).toEqual([
        { text: { content: 'High', tag: 'plain_text' }, value: 'high' },
        { text: { content: 'Low', tag: 'plain_text' }, value: 'low' },
      ])
      expect(selectEl.behaviors).toEqual([{ type: 'callback', value: { id: 'priority' } }])
    })

    it('radio_select also maps to select_static', () => {
      const result = cardToLarkInteractive(
        actionsCard([
          {
            id: 'status',
            label: 'Status',
            options: [{ label: 'Open', type: 'option', value: 'open' }],
            type: 'radio_select',
          },
        ]),
      ) as LarkCardBody
      expect(firstActionItem(result.body.elements).tag).toBe('select_static')
    })

    it('initialOption sets initial_option', () => {
      const result = cardToLarkInteractive(
        actionsCard([
          {
            id: 'sel',
            initialOption: 'opt1',
            label: 'Pick',
            options: [{ label: 'Opt1', type: 'option', value: 'opt1' }],
            type: 'select',
          },
        ]),
      ) as LarkCardBody
      expect((firstActionItem(result.body.elements) as LarkSelectElement).initial_option).toBe(
        'opt1',
      )
    })
  })

  describe('section', () => {
    it('recursively expands all children to parent level', () => {
      const result = cardToLarkInteractive({
        children: [
          {
            children: [
              { content: 'section text', type: 'text' as const },
              { alt: 'pic', type: 'image' as const, url: 'img_key' },
            ],
            type: 'section' as const,
          },
        ],
        type: 'card' as const,
      }) as LarkCardBody
      expect(result.body.elements).toHaveLength(EXPECTED_TWO)
      expect(firstOf(result.body.elements).tag).toBe('markdown')
      expect(secondOf(result.body.elements).tag).toBe('img')
    })

    it('nested section flattens correctly', () => {
      const result = cardToLarkInteractive({
        children: [
          {
            children: [
              {
                children: [{ content: 'deep', type: 'text' as const }],
                type: 'section' as const,
              },
            ],
            type: 'section' as const,
          },
        ],
        type: 'card' as const,
      }) as LarkCardBody
      expect(result.body.elements).toHaveLength(EXPECTED_ONE)
      expect((firstOf(result.body.elements) as LarkMarkdownElement).content).toBe('deep')
    })
  })

  describe('link', () => {
    it('maps to markdown with [label](url)', () => {
      const result = cardToLarkInteractive({
        children: [{ label: 'View', type: 'link' as const, url: 'https://example.com' }],
        type: 'card' as const,
      }) as LarkCardBody
      const mdEl = result.body.elements.find(byTag('markdown')) as LarkMarkdownElement
      expect(mdEl.content).toBe('[View](https://example.com)')
    })
  })

  describe('fields', () => {
    it('maps to column_set rows with label left and value right', () => {
      const result = cardToLarkInteractive({
        children: [
          {
            children: [
              { label: 'Name', type: 'field' as const, value: 'John' },
              { label: 'Role', type: 'field' as const, value: 'Dev' },
            ],
            type: 'fields' as const,
          },
        ],
        type: 'card' as const,
      }) as LarkCardBody
      const colSets = result.body.elements.filter(byTag('column_set'))
      expect(colSets).toHaveLength(EXPECTED_TWO)
      const firstRow = firstOf(colSets) as LarkColumnSetElement
      expect(firstRow.columns).toHaveLength(EXPECTED_TWO)
      const labelCol = firstOf(firstRow.columns)
      const valueCol = secondOf(firstRow.columns)
      expect((firstOf(labelCol.elements) as LarkMarkdownElement).content).toBe(
        '<font color="grey">Name</font>',
      )
      expect((firstOf(valueCol.elements) as LarkMarkdownElement).content).toBe('John')
      expect((firstOf(valueCol.elements) as LarkMarkdownElement).text_align).toBe('right')
    })
  })

  describe('table', () => {
    it('maps to lark table component', () => {
      const result = cardToLarkInteractive({
        children: [
          {
            headers: ['Name', 'Age'],
            rows: [
              ['Alice', '30'],
              ['Bob', '25'],
            ],
            type: 'table' as const,
          },
        ],
        type: 'card' as const,
      }) as LarkCardBody
      const tableEl = result.body.elements.find(byTag('table')) as LarkTableElement
      expect(tableEl).toBeDefined()
      expectValidElementId(tableEl as LarkCardElement)
      expect(tableEl.columns).toEqual([
        { data_type: 'text', display_name: 'Name', horizontal_align: 'left', name: 'col_0' },
        { data_type: 'text', display_name: 'Age', horizontal_align: 'left', name: 'col_1' },
      ])
      expect(tableEl.rows).toEqual([
        { col_0: 'Alice', col_1: '30' },
        { col_0: 'Bob', col_1: '25' },
      ])
    })

    it('empty headers produces no elements', () => {
      const result = cardToLarkInteractive({
        children: [{ headers: [], rows: [], type: 'table' as const }],
        type: 'card' as const,
      }) as LarkCardBody
      expect(result.body.elements).toHaveLength(FIRST)
    })
  })
})

describe('cardToFallbackText', () => {
  it('extracts title and all text content', () => {
    const result = cardToFallbackText({
      children: [
        { content: 'Body text here', type: 'text' as const },
        { type: 'divider' as const },
      ],
      subtitle: 'A subtitle',
      title: 'My Card',
      type: 'card' as const,
    })
    expect(result).toContain('My Card')
    expect(result).toContain('Body text here')
  })
})
