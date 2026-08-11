# Stripe Dashboard Typography Reference

Use this as a reference to redesign the UI to match Stripe Dashboard's typographic aesthetic.

---

## Primary Font: Söhne (Sohne)

Stripe's dashboard uses **Söhne** by [Klim Type Foundry](https://klim.co.nz/retail-fonts/sohne/).

- **Type:** Geometric sans-serif, variable font (`Sohne-var`)
- **Character:** Clean, modern, slightly geometric — feels precise and trustworthy
- **License:** Paid/proprietary — must purchase a license to use commercially

---

## Free Alternative: Inter (Recommended)

Since Söhne requires a paid license, use **Inter** as the open-source equivalent.
It is the de-facto standard for SaaS dashboards and closely mirrors Söhne's feel.

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

---

## Typographic Scale (Stripe-style)

| Role              | Size     | Weight      | Line Height | Use Case                          |
|-------------------|----------|-------------|-------------|-----------------------------------|
| Page Title        | 24px     | 600 (Semi)  | 1.3         | Main page headers (h1)            |
| Section Heading   | 18px     | 600 (Semi)  | 1.4         | Card titles, section headers (h2) |
| Subsection        | 14px     | 600 (Semi)  | 1.4         | Table headers, labels (h3)        |
| Body / Default    | 14px     | 400 (Regular) | 1.5       | General text, descriptions        |
| Small / Metadata  | 12px     | 400 (Regular) | 1.5       | Timestamps, secondary info        |
| Label / Tag       | 11px     | 500 (Medium) | 1.4        | Badges, status labels, chips      |
| Monospace / Code  | 13px     | 400 (Regular) | 1.6       | IDs, API keys, code snippets      |

> **Monospace font:** Use `'JetBrains Mono'` or `'Roboto Mono'` for IDs, tokens, and any code-like data.

---

## Font Weights Used

| Weight | Name         | Usage                              |
|--------|--------------|------------------------------------|
| 400    | Regular      | Body text, descriptions            |
| 500    | Medium       | Navigation items, input labels     |
| 600    | Semi-Bold    | Headings, card titles, CTA buttons |
| 700    | Bold         | Rarely used — critical alerts only |

> Stripe avoids heavy bold weights in the dashboard. Semi-bold (600) does most of the heavy lifting.

---

## Color Palette for Text

| Token           | Hex       | Usage                                |
|-----------------|-----------|--------------------------------------|
| Primary text    | `#0A2540` | Main headings, dark body text        |
| Secondary text  | `#425466` | Descriptions, metadata               |
| Tertiary text   | `#697386` | Placeholder, disabled, timestamps   |
| Link / Brand    | `#635BFF` | Clickable links, active nav          |
| Danger          | `#DF1B41` | Error states, destructive actions    |
| Success         | `#09825D` | Positive amounts, success states     |
| Background      | `#FFFFFF` | Page / card background (light mode) |
| Surface         | `#F6F9FC` | Sidebar, table row alternates        |
| Border          | `#E3E8EF` | Card borders, dividers, input borders|

---

## Number Formatting (Dashboard-specific)

- Use **tabular figures** (OpenType `tnum`) for all numeric data — amounts, IDs, percentages
- This ensures numbers align vertically in tables

```css
.tabular-nums {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}
```

---

## Tailwind CSS Config (Inter)

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Roboto Mono', 'monospace'],
      },
    },
  },
}
```

---

## CSS Variables (Design Token Pattern)

```css
:root {
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Roboto Mono', monospace;

  --text-xs:   11px;
  --text-sm:   12px;
  --text-base: 14px;
  --text-md:   16px;
  --text-lg:   18px;
  --text-xl:   24px;

  --font-regular:   400;
  --font-medium:    500;
  --font-semibold:  600;
  --font-bold:      700;

  --color-text-primary:   #0A2540;
  --color-text-secondary: #425466;
  --color-text-tertiary:  #697386;
  --color-text-link:      #635BFF;
  --color-text-danger:    #DF1B41;
  --color-text-success:   #09825D;
}
```

---

## AI Redesign Prompt Snippet

Use this when prompting an AI to redesign a component:

> "Redesign this component to match Stripe Dashboard's visual style. Use the Inter font family with semi-bold (600) for headings and regular (400) for body. Follow this type scale: 24px page titles, 18px section headings, 14px body text, 12px metadata. Use `#0A2540` for primary text, `#425466` for secondary, `#697386` for tertiary. Apply `font-variant-numeric: tabular-nums` on all numbers. Keep the design clean, light mode, with subtle borders (`#E3E8EF`) and a surface background of `#F6F9FC` for sidebar/table elements."
