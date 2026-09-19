/*
 * Deterministic WCAG 2.1 AA contrast gate (research.md §4, spec SC-003).
 * Reads the SHIPPED frontend/src/styles/tokens.css (not a mirrored copy),
 * resolves :root custom properties (including one-level var() references),
 * and checks every declared foreground/background pair below at
 * 4.5:1 (normal text) or 3:1 (large text / UI components).
 *
 * Run: npm run check:contrast
 */
const fs = require('fs');
const path = require('path');
const contrast = require('wcag-contrast');

const TOKENS_PATH = path.join(__dirname, '..', 'src', 'styles', 'tokens.css');

function parseRootTokens(css) {
  const rootMatch = css.match(/:root\s*{([^}]*)}/);
  if (!rootMatch) throw new Error('No :root block found in tokens.css');
  const body = rootMatch[1];
  const tokens = {};
  const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = declRe.exec(body))) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

function resolveOneLevelVar(value, tokens) {
  const varMatch = value.match(/^var\((--[\w-]+)\)$/);
  if (varMatch && tokens[varMatch[1]]) {
    return tokens[varMatch[1]];
  }
  return value;
}

function resolveToken(name, tokens) {
  if (!tokens[name]) {
    throw new Error(`Unknown token referenced in pair manifest: ${name}`);
  }
  return resolveOneLevelVar(tokens[name], tokens);
}

// Pair manifest - the accessibility contract for this feature (design-system.md §1/§3).
// level: 'AA-normal' => 4.5:1, 'AA-large' => 3:1 (large text or UI components/focus rings).
const PAIR_MANIFEST = [
  // Body text on every background it is used on
  { fg: '--c-ink', bg: '--c-bg', level: 'AA-normal', note: 'primary text on page background' },
  { fg: '--c-ink', bg: '--c-surface', level: 'AA-normal', note: 'primary text on card surface' },
  { fg: '--c-ink', bg: '--c-surface-strong', level: 'AA-normal', note: 'primary text on pressed surface' },
  { fg: '--c-ink', bg: '--c-bg-white', level: 'AA-normal', note: 'primary text on form fields' },
  { fg: '--c-ink-muted', bg: '--c-bg', level: 'AA-normal', note: 'secondary text on page background' },
  { fg: '--c-ink-muted', bg: '--c-surface', level: 'AA-normal', note: 'secondary text on card surface' },
  { fg: '--c-ink-muted', bg: '--c-bg-white', level: 'AA-normal', note: 'secondary text on form fields' },
  { fg: '--c-ink-faint', bg: '--c-bg-white', level: 'AA-normal', note: 'tertiary text on form fields' },

  // Brand as text/icon (large text / UI components only - buttons carry their own fill+label pair below)
  { fg: '--c-brand', bg: '--c-bg', level: 'AA-large', note: 'brand link/icon on page background' },
  { fg: '--c-brand', bg: '--c-bg-white', level: 'AA-large', note: 'brand link/icon on form fields' },
  { fg: '--c-brand-strong', bg: '--c-bg', level: 'AA-normal', note: 'brand-strong text on page background' },
  { fg: '--c-brand-strong', bg: '--c-bg-white', level: 'AA-normal', note: 'brand-strong text on form fields' },

  // Filled brand button (primary Button variant) - label MUST be --c-bg-white or --c-ink
  { fg: '--c-bg-white', bg: '--c-brand', level: 'AA-normal', note: 'primary button label' },
  { fg: '--c-bg-white', bg: '--c-brand-strong', level: 'AA-normal', note: 'primary button label (hover/active)' },

  // Status chips: soft tint background + status foreground text/icon (StatusMessage, FlagBadge)
  { fg: '--c-status-info', bg: '--c-status-soft-info', level: 'AA-normal', note: 'info chip text' },
  { fg: '--c-status-success', bg: '--c-status-soft-success', level: 'AA-normal', note: 'success chip text' },
  { fg: '--c-status-warning', bg: '--c-status-soft-warning', level: 'AA-normal', note: 'warning chip text' },
  { fg: '--c-status-error', bg: '--c-status-soft-error', level: 'AA-normal', note: 'error chip text' },
  { fg: '--c-status-neutral', bg: '--c-status-soft-neutral', level: 'AA-normal', note: 'neutral chip text' },

  // Status chips on the page/card background directly (icon-only or unfilled usage)
  { fg: '--c-status-info', bg: '--c-bg', level: 'AA-large', note: 'info icon on page background' },
  { fg: '--c-status-success', bg: '--c-bg', level: 'AA-large', note: 'success icon on page background' },
  { fg: '--c-status-warning', bg: '--c-bg', level: 'AA-large', note: 'warning icon on page background' },
  { fg: '--c-status-error', bg: '--c-bg', level: 'AA-large', note: 'error icon on page background' },
  { fg: '--c-status-neutral', bg: '--c-bg', level: 'AA-large', note: 'neutral icon on page background' },

  // Admin dashboard (spec 005): navigation and data panels
  { fg: '--c-nav-ink', bg: '--c-nav-bg', level: 'AA-normal', note: 'sidebar link text' },
  { fg: '--c-nav-ink', bg: '--c-nav-bg-active', level: 'AA-normal', note: 'sidebar active link text' },
  { fg: '--c-nav-ink', bg: '--c-nav-bg-hover', level: 'AA-normal', note: 'sidebar hovered link text' },
  { fg: '--c-nav-ink-muted', bg: '--c-nav-bg', level: 'AA-normal', note: 'sidebar secondary text' },
  { fg: '--c-nav-ink-muted', bg: '--c-nav-bg-active', level: 'AA-normal', note: 'sidebar secondary text on active item' },
  { fg: '--c-nav-accent', bg: '--c-nav-bg', level: 'AA-large', note: 'sidebar brand mark / icon accent' },
  { fg: '--c-ink', bg: '--c-panel', level: 'AA-normal', note: 'primary text on dashboard panel' },
  { fg: '--c-ink-muted', bg: '--c-panel', level: 'AA-normal', note: 'secondary text on dashboard panel' },
  { fg: '--c-ink-faint', bg: '--c-panel', level: 'AA-normal', note: 'tertiary text on dashboard panel' },
  { fg: '--c-brand-strong', bg: '--c-panel', level: 'AA-normal', note: 'link text on dashboard panel' },
  { fg: '--c-brand', bg: '--c-panel', level: 'AA-large', note: 'chart bar (single series) and focus ring on panel' },
  { fg: '--c-brand', bg: '--c-track', level: 'AA-large', note: 'chart bar on its track' },
  { fg: '--c-status-info', bg: '--c-panel', level: 'AA-large', note: 'info chart bar on panel' },
  { fg: '--c-status-success', bg: '--c-panel', level: 'AA-large', note: 'success chart bar on panel' },
  { fg: '--c-status-warning', bg: '--c-panel', level: 'AA-large', note: 'warning chart bar on panel' },
  { fg: '--c-status-error', bg: '--c-panel', level: 'AA-large', note: 'error chart bar on panel' },
  { fg: '--c-status-neutral', bg: '--c-panel', level: 'AA-large', note: 'neutral chart bar on panel' },
  { fg: '--c-status-info', bg: '--c-panel', level: 'AA-normal', note: 'info status text on panel' },
  { fg: '--c-status-success', bg: '--c-panel', level: 'AA-normal', note: 'success status text on panel' },
  { fg: '--c-status-warning', bg: '--c-panel', level: 'AA-normal', note: 'warning status text on panel' },
  { fg: '--c-status-error', bg: '--c-panel', level: 'AA-normal', note: 'error status text on panel' },
  { fg: '--c-status-neutral', bg: '--c-panel', level: 'AA-normal', note: 'neutral status text on panel' },

  // Focus ring vs. the surfaces it appears on (WCAG 1.4.11 non-text contrast, 3:1)
  { fg: '--c-brand', bg: '--c-surface', level: 'AA-large', note: 'focus ring on card surface' },
  { fg: '--c-brand', bg: '--c-bg-white', level: 'AA-large', note: 'focus ring on form fields' },
];

function levelThreshold(level) {
  return level === 'AA-large' ? 3 : 4.5;
}

function main() {
  const css = fs.readFileSync(TOKENS_PATH, 'utf8');
  const tokens = parseRootTokens(css);

  const failures = [];
  for (const pair of PAIR_MANIFEST) {
    const fgHex = resolveToken(pair.fg, tokens);
    const bgHex = resolveToken(pair.bg, tokens);
    const ratio = contrast.hex(fgHex, bgHex);
    const threshold = levelThreshold(pair.level);
    if (ratio < threshold) {
      failures.push({ ...pair, fgHex, bgHex, ratio: ratio.toFixed(2), threshold });
    }
  }

  if (failures.length > 0) {
    console.error(`check:contrast FAILED - ${failures.length} pair(s) below WCAG AA:\n`);
    for (const f of failures) {
      console.error(
        `  ${f.fg} (${f.fgHex}) on ${f.bg} (${f.bgHex}) = ${f.ratio}:1, needs >= ${f.threshold}:1 [${f.level}] - ${f.note}`
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(`check:contrast passed - ${PAIR_MANIFEST.length} pair(s) meet WCAG 2.1 AA.`);
}

main();
