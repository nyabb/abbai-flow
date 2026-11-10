import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * A stylesheet that does not parse is invisible in the test suite: nothing
 * imports CSS in jsdom, so a missing `}` or a comment whose `/*` was lost only
 * surfaces as an esbuild warning at the very end of a production build — where
 * it is easy to scroll past.
 *
 * Both have happened: an unterminated `:root` in tokens.css and a lost comment
 * opener in chore-planner.css, whose prose esbuild then tried to parse as CSS.
 * This check walks every stylesheet and asserts what a parser needs: balanced
 * comment delimiters and balanced braces outside comments and strings.
 */
const stylesDir = path.dirname(fileURLToPath(import.meta.url));
const sheets = readdirSync(stylesDir).filter((name) => name.endsWith('.css'));

interface Problem {
  file: string;
  detail: string;
}

function inspect(file: string): Problem[] {
  const text = readFileSync(path.join(stylesDir, file), 'utf8');
  const problems: Problem[] = [];
  const lineAt = (index: number) => text.slice(0, index).split('\n').length;

  let depth = 0;
  let quote: string | null = null;
  const openBraces: number[] = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (quote) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }

    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        problems.push({ file, detail: `unclosed comment starting at line ${lineAt(i)}` });
        break;
      }
      // A `*/` inside a comment cannot happen, so the only other failure is text
      // that reaches a closing marker without an opener — detected below.
      i = end + 2;
      continue;
    }

    if (text.startsWith('*/', i)) {
      problems.push({ file, detail: `stray */ at line ${lineAt(i)} (its /* is missing)` });
      i += 2;
      continue;
    }

    if (char === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const next = (text.slice(i + 2, end === -1 ? undefined : end) ?? '').trim();
      // Only flag a real line comment; a URL is preceded by a property value.
      if (!/^[\w-]+\s*:/.test(text.slice(Math.max(0, i - 40), i))) {
        problems.push({
          file,
          detail: `// line comment at line ${lineAt(i)} (${next.slice(0, 30)})`,
        });
      }
      i = end === -1 ? text.length : end + 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      i += 1;
      continue;
    }

    if (char === '{') {
      openBraces.push(i);
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth < 0) {
        problems.push({ file, detail: `extra } at line ${lineAt(i)}` });
        depth = 0;
      }
      openBraces.pop();
    }
    i += 1;
  }

  if (depth > 0) {
    const first = openBraces[0];
    problems.push({
      file,
      detail: `${depth} unclosed { — the first opens at line ${first === undefined ? '?' : lineAt(first)}`,
    });
  }

  return problems;
}

describe('stylesheets parse', () => {
  it('finds the stylesheets to check', () => {
    expect(sheets.length).toBeGreaterThan(10);
  });

  it.each(sheets)('%s is balanced', (file) => {
    expect(inspect(file)).toEqual([]);
  });
});
