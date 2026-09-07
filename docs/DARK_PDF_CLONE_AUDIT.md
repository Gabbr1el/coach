# Dark PDF Clone Audit

## Visual target

- Canvas: near-black `#090a0d`.
- Sidebar: `#0d0e12` with a single active item on `#22252e`.
- Panels: `#111217`, secondary surface `#17191f`, borders `#242730`.
- Primary text: `#f4f5f7`; secondary text: `#9297a3`; tertiary text: `#626773`.
- Accent: restrained lilac `#8c7cff`; positive status `#72d7aa`; warning `#e8b96d`.
- Corners: 8-12px, no oversized 2rem cards, almost no shadows.
- Typography: compact, editorial hierarchy; labels in uppercase with tracking.

## Density corrections

- Remove the duplicated top action bar from Home.
- Move backup, restore, deadline creation, provider setup, and routine editing into Settings or contextual menus.
- Present one primary Planner conversation, one compact Today plan, and one workspace row.
- Do not render priority cards, hero cards, workspace cards, and Planner actions as competing card grids.
- Use internal panes with fixed headers and compact rows.

## Functional corrections

- Home rail destinations must render distinct content rather than only changing active color.
- Workspace must keep one stable shell and switch the center page only.
- Coach consent remains explicit and visible.
- Video search is a transitional external flow, not a complete embedded player.
- PDF search is functional; a full PDF viewer remains a future enhancement.
- Agent diff/approval and automatic toolchain installation remain outside this visual clone.

## Acceptance

- Home and Workspace use only dark target tokens.
- There is no document-level scroll.
- Every visible navigation control changes meaningful content.
- Long chat text and code remain contained.
- Desktop and compact desktop layouts remain operable.
