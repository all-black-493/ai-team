---
name: Arena-inspired chat UI
source:
  url: https://arena.ai/
  page: Home ("New Chat")
  captured: 2026-11-09
  scrape_id: 01a1c1f5-dd57-773f-9c9d-a5224f22f187
  viewport: 1920x1080, light theme, signed out
  evidence:
    - .firecrawl/design-reference.json # Firecrawl branding, markdown, raw HTML
    - .firecrawl/design-reference.png # full-page screenshot
    - .firecrawl/css/ # the page's stylesheets, source of every token below
    - .firecrawl/terms-dialog.png # second capture, 2026-11-10: the terms dialog before the first message
    - .firecrawl/terms-dialog.html # that dialog's markup
colors:
  light:
    canvas: "#FCFAF8" # --surface-primary, page and sidebar
    surface: "#FFFFFF" # --surface-secondary, composer and cards
    surface-tint: "#F4F0EB" # --surface-tertiary, hover fill, popovers
    surface-floating: "#FBF5EF" # --surface-floating, banner
    surface-raised: "#F0EBE5" # --surface-raised, icon tiles
    surface-raised-alt: "#E4DFD7" # --surface-raised-alt, shadcn --muted
    ink-strong: "#252523" # --header-primary, headings and card titles
    ink: "#2E2B29" # --text-primary, body text
    ink-secondary: "#413D39" # --text-secondary, icon buttons
    ink-tertiary: "#67625B" # --text-tertiary, headline, captions
    ink-muted: "#8B867E" # --text-muted
    placeholder: "rgb(65 61 57 / 0.32)" # --text-placeholder
    hairline: "#EEEDEC" # --border-faint, shadcn --border
    border: "#E1DEDB" # --border-medium, cards, banner, focused composer
    border-strong: "#D8D4D0" # --border-strong
    primary: "#252522" # --primary / --interactive-cta
    on-primary: "#FCFAF8" # --interactive-on-cta
    primary-hover: "#3E3A37" # --interactive-cta-hover
    secondary: "#FFFFFF" # --interactive-cta-secondary
    secondary-hover: "#E9E4DC" # --interactive-cta-secondary-hover
    highlight: "#F4C406" # --highlight-background, the headline marker
    on-highlight: "#252523" # --highlight-text
    focus: "#268BE3" # --interactive-link, also shadcn --ring
    success: "#38A341"
    danger: "#D44540"
    warning: "#DDB308"
  dark:
    canvas: "#252523"
    surface: "#2C2B28"
    surface-tint: "#1B1A19"
    surface-floating: "#221F1B"
    surface-raised: "#413C3A"
    ink-strong: "#FFFFFF"
    ink: "#F4F0EB"
    ink-tertiary: "#C7C2BC"
    ink-muted: "#67625B"
    placeholder: "rgb(244 240 235 / 0.32)"
    hairline: "#413D39"
    border: "#524D47"
    border-strong: "#5F5A54"
    primary: "#FAFAFA"
    on-primary: "#252523"
    secondary: "#292624"
    secondary-hover: "#403D3A"
    highlight: "#41BE4B" # the marker turns green in dark mode
    on-highlight: "#252523"
    focus: "#299BFF"
    success: "#41BE4B"
    danger: "#F25550"
    warning: "#F4C406"
typography:
  display:
    family: Martina Plantijn # commercial, do not ship
    substitute: Newsreader # proposed; Google Fonts, has 300 and italic
    weight: 300
    tracking: -0.025em
  ui:
    family: Basel Grotesk # commercial, do not ship
    substitute: Geist # proposed; already installed, Arena's own fallback is Inter
    weights: [400, 450, 500, 700] # 450 is their "book" weight
  mono:
    family: Basel Grotesk Mono # commercial, do not ship
    substitute: Geist Mono # proposed; already installed
  scale: # all from the CSS
    header-5xl: { size: 48px, line: 1, weight: 300, family: display }
    header-2xl: { size: 24px, line: 32px, weight: 300, family: display }
    body-lg: { size: 18px, line: 28px }
    body-base: { size: 16px, line: 24px }
    body-sm: { size: 14px, line: 20px }
    body-xs: { size: 12px, line: 16px }
    body-xxs: { size: 10px, line: 12px }
    caption: { size: 10px, line: 12px, tracking: 0.05rem }
rounded:
  tile: 3px # icon tiles in suggestion cards
  send: 4px # composer send button
  control: 6px # rounded-md, icon buttons, selects, sidebar items
  card: 8px # rounded-lg, suggestion cards, banner, buttons
  composer: 14px # the prompt box
  pill: 9999px
spacing:
  base: 4px
  control-height: 32px # h-8 / size-8 everywhere in the composer and sidebar
  rail-collapsed: 49px # --sidebar-width-icon, calc(3rem + 1px)
  rail-expanded: 240px # --sidebar-width
  prompt-column: 672px # max-w-2xl, composer and suggestions
  thread-column: 800px # max-w-[800px] appears in the HTML; not seen in use
components:
  composer: { fill: surface, border: hairline, focus-border: border, radius: 14px }
  suggestion-card: { fill: canvas, hover-fill: surface-tint, border: border, radius: 8px, padding: 8px }
  icon-tile: { fill: surface-raised, border: hairline, radius: 3px, padding: 6px }
  banner: { fill: surface-floating, border: border, radius: 8px }
  icon-button: { size: 32px, radius: 6px, ink: ink-secondary, hover-fill: surface-tint }
  send-button: { size: 32px, radius: 4px, border: border, fill: transparent, disabled-opacity: 0.5 }
  sidebar-item: { height: 32px, radius: 6px, icon: 20px, hover-fill: surface-tint }
---

# Arena-inspired chat UI

A design reference taken from the home page of [arena.ai](https://arena.ai/) on 2026-11-09, for building this project's chat surfaces with shadcn/ui (base-nova, Tailwind v4).

Arena's wordmark, column logo, copy and fonts are theirs. Use this file for the system (tokens, spacing, component recipes), not for their brand. Nothing here gives rights to their logo, imagery or text.

![Arena home page, 1920x1080, light theme](.firecrawl/design-reference.png)

**How values are labelled**

- **CSS**: read from Arena's stylesheet (`.firecrawl/css/2wmbsk7cu43fn.css`). Exact.
- **HTML**: read from the classes on the rendered elements. Exact for that element.
- **Screenshot**: estimated from the capture. Approximate.
- **Proposed**: a choice for this repo, not something Arena does.

## Overview

A quiet, warm, almost paper-like chat app. The page is one centred column on a cream canvas, with a thin icon rail on the left. Color is held back for one thing: a yellow marker behind a single italic word in the headline. Everything else is warm greys, 1px hairlines and white cards. There are no gradients and almost no shadows.

The personality comes from pairing a light-weight serif display face with a plain grotesk UI face, and from the warmth of the neutrals (every grey leans 24–37° towards orange).

## Colors

All values are from the CSS. Arena defines its own tokens and maps them onto shadcn's variable names, so they port directly.

| Role | Light | Dark | Arena token | shadcn variable |
| --- | --- | --- | --- | --- |
| Page canvas | `#FCFAF8` | `#252523` | `surface-primary` | `--background`, `--sidebar` |
| Card / composer | `#FFFFFF` | `#2C2B28` | `surface-secondary` | `--card` |
| Popovers, sidebar hover | `#F4F0EB` | `#1B1A19` | `surface-tertiary` | `--popover`, `--sidebar-accent` |
| Hover fill in menus and dialogs | `#E9E4DC` | `#403D3A` | `interactive-cta-secondary-hover` | `--accent` (adjusted, see below) |
| Muted fill | `#E4DFD7` | `#413C3A` | `surface-raised-alt` | `--muted` |
| Body text | `#2E2B29` | `#F4F0EB` | `text-primary` | `--foreground` |
| Headings | `#252523` | `#FFFFFF` | `header-primary` | `--card-foreground` |
| Muted text | `#67625B` | `#9C9891` | `text-tertiary` / `brand-neutral-7` | `--muted-foreground` (adjusted, see below) |
| Hairline | `#EEEDEC` | `#413D39` | `border-faint` | `--border` |
| Card border | `#E1DEDB` | `#524D47` | `border-medium` | (none) |
| Form field border | `#D8D4D0` | `#5F5A54` | `border-strong` | `--input` (adjusted, see below) |
| Main button | `#252522` | `#FAFAFA` | `interactive-cta` | `--primary` |
| Secondary button | `#FFFFFF` | `#292624` | `interactive-cta-secondary` | `--secondary` |
| Focus ring | `#268BE3` | `#299BFF` | `interactive-link` | `--ring` |
| Destructive | `#D44540` | `#F25550` | `interactive-negative` | `--destructive` |

- **Main buttons are near-black, not colored.** In light mode the main button is ink on cream; dark mode inverts it. Firecrawl's automatic branding guessed a peach `#F8C397` primary; the stylesheet contradicts that, so ignore it.
- **The yellow `#F4C406` is a highlighter, not a button color.** It appears once, behind the italic word in the headline (`bg-highlight`, HTML). In dark mode the same token is green `#41BE4B`.
- **Popovers are tinted, not white.** `--popover` maps to the hover fill `#F4F0EB`, so menus read as a step back from the white composer.
- **Two border weights.** `--border` is the faint hairline (sidebar edge, composer at rest). Cards, the banner and the focused composer use the darker `border-medium`. shadcn has no slot for the second one, so add it (see Implementation).
- **Placeholder text is ink at 32% opacity**, not a separate grey.
- **Three adjustments from Arena's own shadcn mapping** (applied in `app/globals.css`):
  - **`--muted-foreground`:** Arena maps it to `text-muted` (`#8B867E` / `#67625B`), which reaches only 3.2–3.5:1 in light mode and 2.5–2.9:1 in dark, below WCAG AA for small text. It uses `text-tertiary` (light) and `brand-neutral-7` (dark) instead, at 5.3–6.1:1. Arena uses `text-tertiary` for its own captions.
  - **`--accent`:** Arena maps both `--accent` and `--popover` to `surface-tertiary`, so a hover inside a menu or dialog would be invisible. It uses the secondary-hover tone instead.
  - **`--input`:** set to `border-strong`, so form fields stay visible on the tinted dialog background.
- Arena also defines 10-step ramps for yellow, green, teal, blue, red and a warm neutral (`--brand-*-1` to `-10` in the CSS). Only the neutral ramp and the yellow appear on this page.

## Typography

| Use | Arena font | Size / line | Weight | Notes |
| --- | --- | --- | --- | --- |
| Hero headline | Martina Plantijn | 48px / 1 | 300 | `header-5xl`, tracking -0.025em, color `text-tertiary` (CSS, HTML) |
| Section heading | Martina Plantijn | 24px / 32px | 300 | `header-2xl` (CSS) |
| Composer text | Basel Grotesk | 16px / 24px | 400 | `body-base` (HTML) |
| UI default | Basel Grotesk | 14px / 20px | 400 | `body-sm`, mode menus use `text-sm font-medium` (HTML) |
| Card title, labels | Basel Grotesk | 12px / 16px | 450 | `body-xs` + `font-book` (HTML) |
| Card subtitle | Basel Grotesk | 10px / 12px | 400 | `body-xxs`, `text-tertiary`, truncated (HTML) |
| Caption | Basel Grotesk | 10px / 12px | 400 | tracking 0.05rem (CSS) |

- **Display type is light (300) and slightly tight (-0.025em).** It is never bold. The headline is set in the tertiary grey, and only the highlighted word is in full ink, set in italic.
- **The UI face uses a 450 "book" weight** for titles instead of 500. Geist's variable font supports 450.
- **Text is small.** Card titles are 12px and subtitles 10px. Only the composer uses 16px.
- **Substitutes (proposed).** Both families are commercial. Use **Newsreader** (Google Fonts; 300 and 300 italic) for display and keep **Geist** and **Geist Mono**, which this app already loads. Arena's own fallbacks are Inter and DM Mono.
- **Font files (CSS `@font-face`).** Basel Grotesk at 400, 450, 500 and 700; Basel Grotesk Mono at 400; Martina Plantijn at 300, upright and italic. There's no bold serif at all.
- **Where the serif goes.** It's used for `header-5xl` (48px), `header-2xl` (24px) and dialog titles (18px, `tracking-tight`, computed from the live dialog). Dialog titles are set `font-semibold`, but Arena only ships the serif at 300, so the browser fakes the bold. Card titles and labels use the sans at 450.
- **Reader text-size setting (CSS).** Under `[data-lb-text-size=sm]` and `[data-lb-text-size=lg]`, `text-sm`, `text-base`, `body-xs` and `body-sm` shift one step down or up: for example `body-sm` 14/20 becomes 12/16 or 18/26, and `text-base` becomes 14/20 or 21/30. It's probably a leaderboard preference ("lb"); it wasn't seen on the home page.

## Layout

The home page, top to bottom (screenshot and HTML):

1. **Icon rail**, fixed on the left: 49px collapsed, 240px expanded. It holds sidebar toggle, new chat, leaderboard and search, with one icon pinned to the bottom. Its fill is the canvas, separated only by a hairline on its right edge.
2. **Dismissible banner**, centred near the top (`top-[56px]` from `md`). A one-line message, a vertical divider, then three social icon buttons.
3. **Hero**, vertically centred: the wordmark, then the 48px serif headline with 16px below it (`mb-4`).
4. **Composer**, 672px wide (`max-w-2xl`).
5. **"Get started"**: a 12px tertiary label, then a 3×2 grid of suggestion cards with 8px gaps, the same width as the composer.

The column is narrow on purpose: at 1920px wide, the content uses about 35% of the width and the rest is empty canvas. The base spacing unit is 4px. Gaps inside components are 8px (`gap-2`) and between groups 12px (`gap-3`).

## Elevation

Flat. Depth comes from fill steps (canvas → white → tinted) and hairlines, not shadows.

- **Nothing on the home page has a shadow** (HTML). The only shadow class in the markup belongs to the sidebar's floating variant, which isn't used.
- **Dialogs use `shadow-lg`** (`0 10px 15px -3px` and `0 4px 6px -4px`, both black at 10%) over a black backdrop at 80%, with no blur. Computed from the live dialog.
- **Keep cards and the composer shadowless.** Only dialogs, and probably menus, float. Menus weren't seen.

## Shapes

| Radius | Used on | Source |
| --- | --- | --- |
| 3px | Icon tiles inside suggestion cards | HTML |
| 4px | Composer send button, the main button in dialogs | HTML, computed |
| 6px (`rounded-md`) | Icon buttons, mode selects, sidebar items | HTML |
| 8px (`rounded-lg`) | Suggestion cards, banner, standard buttons | HTML, branding |
| 14px | Composer | HTML |

Small radii everywhere except the composer, which is the one soft, large shape on the page.

## Components

### Composer (prompt box)

- **Box:** white (`surface`), 1px hairline border, 14px radius. On focus the border darkens to `border-medium`. **There is no focus ring.** (HTML)
- **Textarea:** borderless, 16/24 text, 12px padding from `md`, at least 80px tall, at most 40vh. Placeholder "Ask anything…" in ink at 32%. (HTML)
- **Footer row:** 32px tall.
  - **Left:** a "+" attach button (32px, 6px radius, `ink-secondary`, hover fill `surface-tint`).
  - **Then two ghost selects** (mode "Battle", model "Auto"). Each has a 16px icon, a 14px medium label and a 12px chevron that flips when open. They have no border, 8px side padding, and the hover fill `surface-tint`. The label uses `header-secondary` (`#2E2B29` / `#F4F0EB`), turns `ink-strong` on hover, and `ink-tertiary` while the menu is open.
  - **Right:** the send button, 32px square with a 4px radius, a `border-medium` outline and a transparent fill. Its 16px arrow uses `interactive-active` (`#1D1D1B` / `#FFFFFF`) and sits at 50% opacity until there's text. When pressed it fills with `interactive-cta-active` (`#413D39` / `#EAE6E1`). (HTML, CSS)
- **Mode menu entries**, a title over a one-line description (markdown): "Battle Mode / Battle 2 anonymous models", "Agent Mode / Built for complex tasks", "Side by Side / Compare 2 models of your choice", "Direct / Chat with 1 model at a time".

### Suggestion card

- **Card:** a `<button>` row with an 8px gap and 8px padding, 8px radius, a `border-medium` border, and the canvas fill (not white). On hover the fill becomes `surface-tint`. (HTML)
- **Icon tile:** 6px padding, 3px radius, `surface-raised` fill with a hairline border. On card hover, the tile turns white and its border darkens. (HTML)
- **Text:** a 12px book-weight title in `ink-strong`, over a 10px subtitle in `ink-tertiary` that truncates to one line. (HTML)
- **Focus:** a 2px blue ring, offset 2px against the canvas. (HTML)

### Banner

- **Container:** `surface-floating` fill, `border-medium` border, 8px radius, a single line that doesn't wrap. (HTML)
- **Contents:** a dismiss "×", the 16px message and a vertical divider (`border-e`), then 32px social icon buttons. (HTML, screenshot)

### Sidebar rail

- **Build:** shadcn `Sidebar` with `collapsible="icon"` (HTML, `data-sidebar` attributes).
- **Items:** 32px tall with a 6px radius and 8px padding. Icons are 20px, labels 16px and hidden when collapsed. Hover and active fill is `surface-tint`.
- **Edge:** a 1px hairline on the right.

### Buttons

- **Primary:** `#252522` fill with cream `#FCFAF8` text; hover `#3E3A37` (CSS). In dialogs it has a 4px radius and normal (400) weight; see Dialog.
- **Secondary:** white; hover `#E9E4DC` (CSS).
- **Outline:** the canvas fill, a `#E1DEDB` border, `#252523` text, 8px radius (Firecrawl branding).
- **Ghost:** no fill; hover `surface-tint` (HTML).
- **Disabled:** opacity 0.5 with pointer events off.

### Headline marker

- **Markup:** wrap one word in an inline-block span with the yellow fill (`highlight`), full-ink text, italic, 8px side padding and `leading-[1]`. Keep the rest of the headline in `ink-tertiary`. (HTML)
- **Limits:** use it once per screen at most.

### Dialog

Measured on the terms dialog Arena shows before the first message (`.firecrawl/terms-dialog.png`, computed styles):

- **Panel:** 610px wide, canvas fill (`#FCFAF8`, not the tinted popover color), a 1px hairline border, 8px radius, `shadow-lg` and 24px padding.
- **Backdrop:** black at 80% (`bg-black/80`), no blur. It fades in and out.
- **Title:** an 18px serif (`text-lg`, 16px on mobile) with `tracking-tight` in `ink` (`#2E2B29`). A 20px logo mark sits before it with an 8px gap.
- **Body:** 14/20 (12px on mobile) in `ink-secondary` (`#413D39`). Links are `interactive-link` blue; links in the body text are underlined.
- **Close:** an "×" 16px from the top-right corner at 70% opacity, full on hover.
- **Footer:** a full-width tinted band across the bottom.
  - **Left:** a hint in 12px `ink-tertiary`: "Or hit **Enter** on your keyboard to agree", with "Enter" in `ink-secondary` medium after a return-arrow icon.
  - **Right:** the main button.
- **Main button:** `interactive-cta` fill (`#252522`) with `on-cta` text, 16px by 8px padding, 14px **normal** weight and a **4px** radius. Hover is `#3E3A37`, pressed `#413D39`. It's full width on mobile.

## Motion

- **Entrance:** elements fade in and slide up (`animate-in fade-in slide-in-from-bottom-5`, ease-out, 150–300ms). The headline waits 200ms (HTML).
- **Stagger:** suggestion cards come in about 35ms apart (`animation-delay`) (HTML).
- **Reduced motion:** every entrance animation is behind `motion-safe:` (HTML).
- **Controls:** color changes take 150ms and the select chevron turns over 200ms (HTML).
- **Repo note:** `ChatAvatar` already follows this: its hover animation only runs under `motion-safe`.

## Iconography

- **Style:** outline icons on a 24px grid with a 1.5px stroke, drawn in `currentColor` (HTML). The markup looks like Iconoir; that identification is inferred.
- **Sizes:** 20px in the sidebar, 16px in buttons and selects, 12px for chevrons.
- **Proposed:** keep this repo's `lucide-react`, and pass `strokeWidth={1.5}` to match the thinner line.

## Do's and Don'ts

**Do**

- Keep the canvas cream (`#FCFAF8`) and put content on white.
- Separate surfaces with hairlines and fill steps.
- Use near-black for the main action.
- Set display text in the light serif with tight tracking, and mark at most one word.
- Keep UI text small (12–14px) and secondary text truncated to one line.
- Gate every entrance animation behind `motion-safe:`.
- Use the blue ring for keyboard focus on controls. The composer is the one exception: it signals focus with a darker border.

**Don't**

- Don't use the yellow as a button or link color.
- Don't add shadows to cards or the composer.
- Don't use bold display type, or pure greys (every neutral here is warm).
- Don't use large radii except on the composer.
- Don't reuse Arena's wordmark, column logo, headline copy or commercial fonts.

## Responsive

These come from the class names in the HTML; only the desktop layout was captured.

- **Below `md` (768px):**
  - The rail is hidden, and the banner sits at the top.
  - The suggestion cards become one row that scrolls sideways, each at least 200px wide, instead of the 3-column grid.
  - The composer moves below the suggestions (`order-2 md:order-1`), and its textarea padding drops from 12px to 4px.
- **Below `sm` (640px):** the headline breaks after "Experience", and the banner hides its message text, keeping only the icons.

## Chat conversation

**The conversation screen was not captured.** On 2026-11-10 one prompt was typed and sent in an anonymous Firecrawl browser, and Arena stopped at a **Terms of Use & Privacy Policy** dialog that needs "Agree" (or Enter) before the message is sent. That would accept Arena's terms, so it wasn't clicked. Two publicly posted share links (`/c/<id>`) both redirected signed-out visitors to the home page.

What was seen on the way:

- **Mode menu** (the "Battle" select): Battle Mode, Agent Mode, Side by Side and Direct, each a title over a one-line description. A second select reads "Modality: Auto".
- **Privacy notice:** after a send attempt, a notice appears below the composer. It says conversations may be shared with AI providers and published, and not to submit personal or sensitive information.
- **Terms gate:** the first send opens the terms dialog above. Enter agrees.

Still unknown: the message list, user and model message styling, model labels in Battle mode, the voting controls, streaming and loading states, and how the composer docks once a conversation starts.

## Implementation in this repo

This app uses shadcn **base-nova** with Geist. Nova fits: 32px controls, 6–8px radii, hairlines instead of shadows. The system lives in `app/globals.css` and `app/layout.tsx`, with small weight and border edits to a few shadcn components.

**Applied** (2026-11-09; measured in the browser in light, dark and mobile):

- **Colors:** shadcn's variables in `:root` and `.dark` come from the Colors table, including the three adjustments above.
- **Extra tokens:**
  - `--border-medium` as the `border-border-medium` utility;
  - `--highlight` and `--highlight-foreground` as `bg-highlight` and `text-highlight-foreground`. The marker is yellow in light mode and green in dark.
- **Display font:** Newsreader 300, upright and italic, loaded in `app/layout.tsx` as `--font-display` (the `font-display` utility). `--font-heading` stays on Geist, so shadcn titles keep the sans.
- **Type scale:** `text-display` (48/1, 300, -0.025em), `text-heading` (24/32, 300, -0.025em) and `text-2xs` (10/12) are theme sizes. The weight and tracking are part of each size, so use them with `font-display`. Tailwind's `text-xs` to `text-lg` already match Arena's body sizes.
- **Book weight:** `font-book` (450). Dialog, AlertDialog, Sheet, Drawer, Card, Empty and Item titles, `Label`/`FieldLabel` and `FieldTitle` use it instead of `font-medium`. Buttons keep 500, as Arena's controls do.
- **Outline button:** `border-border-medium` on the canvas fill in both themes, with the dark-mode input tint removed (`components/ui/button.tsx`).
- **Hero:** the home page `<h1>` uses `font-display text-display text-muted-foreground`, with one word in a `<mark>` on `bg-highlight` (`app/page.tsx`).
- **Layout:** the top header became the icon rail, `components/app-sidebar.tsx`. It's a shadcn `Sidebar` with `collapsible="icon"`, 49px collapsed and 240px open, and it starts collapsed. It holds the toggle, the Bots link and the Clerk sign-in/sign-up or user button. The open state is remembered in shadcn's `sidebar_state` cookie, and below `md` a top bar holds the toggle.
- **Radius, icons, motion:**
  - **Radius:** `--radius: 0.5rem`.
  - **Icons:** `.lucide { stroke-width: 1.5 }`.
  - **Motion:** no `animate-in` / `animate-out` under `prefers-reduced-motion: reduce`.

**Deliberate deviations:**

- **Placeholder text** uses `--muted-foreground` (5.3:1), not ink at 32% opacity (about 2:1, unreadable on the tinted dialog).

**Not built yet** (no screen needs them):

- **Composer:** a white `InputGroup` with a 14px radius.
- **Suggestion cards:** `Item`-style buttons with `text-2xs` subtitles.
- **Banner.**

Build them from the existing components when the chat screen arrives. "Chat conversation" lists what is known about that screen so far.

## Known Gaps

- **Captured so far:** the signed-out home page at 1920×1080 in light mode, plus the terms dialog. The chat thread, side-by-side battle view, leaderboard tables, menus, toasts, mobile layout and dark mode were **not seen**. The dark colors come from the CSS only.
- **The message thread is undocumented** (bubbles, model labels, voting controls). Seeing it requires accepting Arena's terms; see "Chat conversation".
- **Text-size setting:** the reader setting (`[data-lb-text-size]`, see Typography) was found in the CSS, but where it's switched on wasn't seen.
- **Hover and pressed states** were read from class names, not observed.
- **Wordmark:** the logo is an image of their own wordmark; its font wasn't checked.
- **Firecrawl's branding output** reported peach `#F8C397` as the primary color and the inputs as square. Neither matches the stylesheet or the screenshot, so both were ignored.

## Rerun

```bash
firecrawl scrape "https://arena.ai" --format branding,markdown,images,rawHtml \
  --full-page-screenshot --wait-for 3000 --max-age 0 --json \
  -o .firecrawl/design-reference.json
# The screenshot URL in the JSON is signed and expires; download it right away:
curl -sL "<screenshot-url>" -o .firecrawl/design-reference.png
# Stylesheets are listed as <link rel="stylesheet"> in rawHtml; theme tokens live in
# the ":root,.light{...}" and ".dark{...}" blocks of the largest one.
```
