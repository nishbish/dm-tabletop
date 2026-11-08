// Turns the Foundry VTT PF2e text of a creature ability (HTML with Foundry's own codes for damage,
// checks, areas and links) into the plain text the stat block pages use:
//   paragraphs separated by "\n", **bold**, *italic*, and nothing else.
// Used by build-pf2e-creatures.mjs. Pure functions, so they can be tested on their own.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "fortitude" -> "Fortitude", "arcana" -> "Arcana", "perception" -> "Perception"
const statName = (slug) => slug.split('-').map(cap).join(' ');

/** @Damage[(2d6+4)[fire],1d6[persistent,fire]] -> "2d6+4 fire plus 1d6 persistent fire" */
export function damageText(inner) {
  const formula = inner.split('|')[0];
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (ch === '[' || ch === '(' || ch === '{') depth++;
    else if (ch === ']' || ch === ')' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(formula.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(formula.slice(start));
  return parts
    .map((part) => {
      const m = /^(.*?)\[([^\]]*)\]$/.exec(part.trim());
      if (!m) return part.trim();
      let dice = m[1].trim();
      // (2d6+4) -> 2d6+4; {2d6}[splash] keeps its dice
      while (/^\(.*\)$/.test(dice) || /^\{.*\}$/.test(dice)) dice = dice.slice(1, -1);
      const kinds = m[2]
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      return `${dice} ${kinds.join(' ')}`.trim();
    })
    .join(' plus ');
}

/** @Check[reflex|dc:31|basic] -> "DC 31 basic Reflex" */
export function checkText(inner) {
  const [type, ...opts] = inner.split('|');
  const params = {};
  const flags = [];
  for (const o of opts) {
    const i = o.indexOf(':');
    if (i < 0) flags.push(o.trim());
    else params[o.slice(0, i).trim()] = o.slice(i + 1).trim();
  }
  const name = statName((params.type || type).trim());
  const dc = params.dc && /^\d+$/.test(params.dc) ? `DC ${params.dc} ` : '';
  const basic = flags.includes('basic') || params.basic === 'true' ? 'basic ' : '';
  return `${dc}${basic}${name}`;
}

/** @Template[cone|distance:50] -> "50-foot cone" */
export function templateText(inner) {
  const opts = inner.split('|');
  let type = opts[0];
  let distance = '';
  for (const o of opts) {
    const [k, v] = o.split(':');
    if (k === 'type') type = v;
    if (k === 'distance') distance = v;
  }
  if (type.startsWith('type:')) type = type.slice(5);
  return distance ? `${distance}-foot ${type}` : type;
}

/** [[/act balance dc=18]] -> "Balance (DC 18)" */
function actText(inner) {
  const words = inner.trim().split(/\s+/);
  const name = statName(words[0]);
  const dc = /dc=(\d+)/.exec(inner);
  return dc ? `${name} (DC ${dc[1]})` : name;
}

/** The label a Foundry code shows: {label} if given, else made from the code. */
function replaceCodes(html) {
  return (
    html
      // @Localize[...] is a glossary entry printed elsewhere in the book: not part of this text
      .replace(/@Localize\[[^\]]*\]/g, '')
      .replace(/@UUID\[([^\]]*)\](?:\{([^}]*)\})?/g, (_, path, label) => {
        if (label) return label;
        const last = path.split('.').pop();
        return /^[A-Za-z0-9]{16}$/.test(last) ? '' : last;
      })
      // @Damage[...] holds nested brackets, so it is matched by hand
      .replace(/@(Damage|Check|Template)\[/g, '\u0000$1[')
      .split('\u0000')
      .map((chunk, i) => {
        if (i === 0) return chunk;
        const kind = chunk.slice(0, chunk.indexOf('['));
        let depth = 0;
        let end = -1;
        for (let k = kind.length; k < chunk.length; k++) {
          if (chunk[k] === '[') depth++;
          else if (chunk[k] === ']') {
            depth--;
            if (depth === 0) {
              end = k;
              break;
            }
          }
        }
        if (end < 0) return chunk;
        const inner = chunk.slice(kind.length + 1, end);
        let rest = chunk.slice(end + 1);
        let label = null;
        const l = /^\{([^}]*)\}/.exec(rest);
        if (l) {
          label = l[1];
          rest = rest.slice(l[0].length);
        }
        if (label) return label + rest;
        if (kind === 'Damage') return damageText(inner) + rest;
        if (kind === 'Check') return checkText(inner) + rest;
        return templateText(inner) + rest;
      })
      .join('')
      .replace(/\[\[\/(\w+) ([^\]]*)\]\](?:\{([^}]*)\})?/g, (_, cmd, inner, label) => {
        if (label) return label;
        if (cmd === 'act') return actText(inner);
        return inner.split('#')[0].trim();
      })
  );
}

const GLYPHS = {
  1: '[one-action]',
  2: '[two-actions]',
  3: '[three-actions]',
  r: '[reaction]',
  f: '[free-action]',
};

/** Foundry HTML -> paragraphs ("\n"), **bold**, *italic*. */
export function foundryText(html) {
  if (!html) return '';
  // Entities are decoded first and every tag is stripped after, until none is left, so no
  // markup can come back out of an encoded "&lt;script" (the pages escape this text anyway).
  let t = decodeEntities(replaceCodes(html));
  t = t
    .replace(/<span class="action-glyph">\s*([123AaRrFf])\s*<\/span>/g, (_, g) => {
      const k = g.toLowerCase() === 'a' ? 'r' : g.toLowerCase();
      return ' ' + GLYPHS[k] + ' ';
    })
    .replace(/<hr\s*\/?>/g, '\n')
    .replace(/<\/(p|div|h\d|tr|ul|ol|table)>/g, '\n')
    .replace(/<li[^>]*>/g, '\n• ')
    .replace(/<\/(td|th)>/g, ' ')
    .replace(/<br\s*\/?>/g, '\n')
    // bold and italic get private markers first, so empty or touching pairs can be cleaned up
    .replace(/<(strong|b)>/g, '\u0002')
    .replace(/<\/(strong|b)>/g, '\u0003')
    .replace(/<(em|i)>/g, '\u0004')
    .replace(/<\/(em|i)>/g, '\u0005');
  let before;
  do {
    before = t;
    t = t.replace(/<[^>]*>/g, '');
  } while (t !== before);
  t = t.replace(/[<>]/g, '');
  return t
    .split('\n')
    .map((p) =>
      p
        .replace(/\s+/g, ' ')
        // empty pairs go; a pair closed and opened again across a space is one
        .replace(/\u0002\s*\u0003/g, ' ')
        .replace(/\u0004\s*\u0005/g, ' ')
        .replace(/\u0003(\s*)\u0002/g, '$1')
        .replace(/\u0005(\s*)\u0004/g, '$1')
        // spaces go outside the markers: "**Trigger **" -> "**Trigger** "
        .replace(/([\u0002\u0004])\s+/g, ' $1')
        .replace(/\s+([\u0003\u0005])/g, '$1 ')
        .replace(/[\u0002\u0003]/g, '**')
        .replace(/[\u0004\u0005]/g, '*')
        .replace(/\s+/g, ' ')
        .replace(/ ([.,;:)])/g, '$1')
        .trim(),
    )
    .filter((p) => p.replace(/\*/g, '').trim())
    .join('\n');
}

/** "reach-10" -> "reach 10 feet", "deadly-d10" -> "deadly d10", "range-increment-60" -> "range increment 60 feet" */
export function traitLabel(slug) {
  let m;
  if ((m = /^reach-(\d+)$/.exec(slug))) return `reach ${m[1]} feet`;
  if ((m = /^range-increment-(\d+)$/.exec(slug))) return `range increment ${m[1]} feet`;
  if ((m = /^range-(\d+)$/.exec(slug))) return `range ${m[1]} feet`;
  if ((m = /^(thrown|volley)-(\d+)$/.exec(slug))) return `${m[1]} ${m[2]} feet`;
  if ((m = /^(deadly|fatal|versatile|two-hand|jousting|scatter)-(.+)$/.exec(slug)))
    return `${m[1].replace('-', ' ')} ${m[2]}`;
  return slug.replace(/-/g, ' ');
}
