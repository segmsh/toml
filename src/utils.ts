export interface StringToken {
  start: number;
  end: number;
  raw: string;
  value: string;
  key: string;
}

type Delimiter = '"' | "'" | '"""' | "'''";

const BARE_KEY_REGEXP: RegExp = /[A-Za-z0-9_-]/;
const SCALAR_END_REGEXP: RegExp = /[,\]}#\r\n]/;

const ESCAPES: Record<string, string> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  e: "\x1b",
  '"': '"',
  "\\": "\\",
};

const HEX_ESCAPE_LENGTHS: Record<string, number> = { x: 2, u: 4, U: 8 };

const getDelimiter = (raw: string): Delimiter => {
  if (raw.startsWith('"""')) return '"""';
  if (raw.startsWith("'''")) return "'''";
  return raw[0] as Delimiter;
};

const isMultiline = (delimiter: Delimiter): boolean => delimiter.length === 3;

const isLiteral = (delimiter: Delimiter): boolean => delimiter[0] === "'";

// A newline right after a multiline opening delimiter is not part of the value
const trimLeadingNewline = (content: string): string => {
  if (content.startsWith("\r\n")) return content.slice(2);
  if (content.startsWith("\n")) return content.slice(1);
  return content;
};

const unescape = (content: string, multiline: boolean): string => {
  let result = "";

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char !== "\\") {
      result += char;
      continue;
    }

    const next = content[i + 1];

    // Line ending backslash: trims the newline and all whitespace after it
    if (multiline && /[ \t\r\n]/.test(next)) {
      let j = i + 1;
      while (/[ \t]/.test(content[j])) j++;

      if (content[j] === "\r" || content[j] === "\n") {
        while (j < content.length && /[ \t\r\n]/.test(content[j])) j++;
        i = j - 1;
        continue;
      }
    }

    if (next in HEX_ESCAPE_LENGTHS) {
      const length = HEX_ESCAPE_LENGTHS[next];
      const hex = content.slice(i + 2, i + 2 + length);

      result += String.fromCodePoint(parseInt(hex, 16));
      i += 1 + length;
      continue;
    }

    result += ESCAPES[next] ?? next;
    i++;
  }

  return result;
};

export const decode = (raw: string): string => {
  const delimiter = getDelimiter(raw);
  const multiline = isMultiline(delimiter);
  let content = raw.slice(delimiter.length, raw.length - delimiter.length);

  if (multiline) {
    content = trimLeadingNewline(content);
  }

  return isLiteral(delimiter) ? content : unescape(content, multiline);
};

const escapeControl = (value: string, keep: string[]): string =>
  value.replace(/[\x00-\x1f\x7f]/g, (char) => {
    if (keep.includes(char)) return char;

    const escape = Object.keys(ESCAPES).find(
      (key) => ESCAPES[key] === char && key !== "e",
    );

    return escape
      ? `\\${escape}`
      : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });

const encodeBasic = (value: string): string =>
  `"${escapeControl(value.replace(/[\\"]/g, "\\$&"), [])}"`;

const encodeMultilineBasic = (value: string, newline: string): string => {
  const escaped = escapeControl(value.replace(/\\/g, "\\\\"), ["\n", "\t"])
    .replace(/"""/g, '""\\"')
    .replace(/"$/, '\\"');

  return `"""${newline}${escaped}"""`;
};

// Keeps the original delimiter when the value can be represented with it
export const encode = (value: string, raw: string): string => {
  if (decode(raw) === value) return raw;

  const delimiter = getDelimiter(raw);
  const content = raw.slice(delimiter.length);
  const originalNewline = content.startsWith("\r\n")
    ? "\r\n"
    : content.startsWith("\n")
      ? "\n"
      : "";
  const newline =
    originalNewline || (value.startsWith("\n") ? "\n" : "");

  switch (delimiter) {
    case "'":
      return /['\x00-\x08\x0a-\x1f\x7f]/.test(value)
        ? encodeBasic(value)
        : `'${value}'`;
    case "'''":
      return /'''|'$|[\x00-\x08\x0b-\x1f\x7f]/.test(value)
        ? encodeMultilineBasic(value, newline)
        : `'''${newline}${value}'''`;
    case '"""':
      return encodeMultilineBasic(value, newline);
    default:
      return encodeBasic(value);
  }
};

class Scanner {
  private index = 0;
  private readonly tokens: StringToken[] = [];
  private readonly tableArrays = new Map<string, number>();

  constructor(private readonly source: string) {}

  scan(): StringToken[] {
    let table: string[] = [];

    for (;;) {
      this.skipBlank();
      if (this.index >= this.source.length) break;

      const start = this.index;

      if (this.startsWith("[[")) {
        this.index += 2;
        table = this.resolveTable(this.readKey(), true);
        this.expect("]]");
      } else if (this.peek() === "[") {
        this.index += 1;
        table = this.resolveTable(this.readKey(), false);
        this.expect("]");
      } else {
        const key = this.readKey();
        this.expect("=");
        this.skipSpaces();
        this.readValue([...table, ...key]);
      }

      this.assertProgress(start);
    }

    return this.tokens;
  }

  private peek(): string {
    return this.source[this.index];
  }

  private startsWith(value: string): boolean {
    return this.source.startsWith(value, this.index);
  }

  private expect(value: string) {
    this.skipSpaces();

    if (!this.startsWith(value)) {
      throw new Error(`Expected "${value}" at position ${this.index}`);
    }

    this.index += value.length;
  }

  private assertProgress(start: number) {
    if (this.index === start) {
      throw new Error(`Unexpected character at position ${this.index}`);
    }
  }

  private skipSpaces() {
    while (this.peek() === " " || this.peek() === "\t") this.index++;
  }

  // Skips whitespace, newlines and comments
  private skipBlank() {
    for (;;) {
      this.skipSpaces();

      if (this.peek() === "#") {
        while (this.index < this.source.length && this.peek() !== "\n") {
          this.index++;
        }
      } else if (this.peek() === "\n" || this.peek() === "\r") {
        this.index++;
      } else {
        return;
      }
    }
  }

  private readKey(): string[] {
    const parts: string[] = [];

    for (;;) {
      this.skipSpaces();

      const char = this.peek();

      if (char === '"' || char === "'") {
        parts.push(decode(this.readString()));
      } else {
        const start = this.index;
        while (BARE_KEY_REGEXP.test(this.peek() ?? "")) this.index++;
        parts.push(this.source.slice(start, this.index));
      }

      this.skipSpaces();

      if (this.peek() !== ".") return parts;
      this.index++;
    }
  }

  private readString(): string {
    const start = this.index;
    const delimiter = getDelimiter(this.source.slice(start, start + 3));
    const literal = isLiteral(delimiter);

    this.index += delimiter.length;

    while (this.index < this.source.length) {
      if (!literal && this.peek() === "\\") {
        this.index += 2;
        continue;
      }

      if (this.startsWith(delimiter)) {
        this.index += delimiter.length;

        // Up to two quotes are allowed right before a multiline closing delimiter
        if (isMultiline(delimiter)) {
          for (let i = 0; i < 2 && this.peek() === delimiter[0]; i++) {
            this.index++;
          }
        }

        return this.source.slice(start, this.index);
      }

      this.index++;
    }

    throw new Error(`Unterminated string at position ${start}`);
  }

  private readValue(path: string[]) {
    const char = this.peek();

    if (char === '"' || char === "'") {
      const start = this.index;
      const raw = this.readString();

      this.tokens.push({
        start,
        end: this.index,
        raw,
        value: decode(raw),
        key: path.join("."),
      });
    } else if (char === "[") {
      this.index++;

      for (let item = 0; ; item++) {
        this.skipBlank();
        if (this.peek() === "]") break;

        const start = this.index;
        this.readValue([...path, "", String(item)]);
        this.assertProgress(start);
        this.skipBlank();

        if (this.peek() === ",") this.index++;
      }

      this.index++;
    } else if (char === "{") {
      this.index++;

      for (;;) {
        this.skipBlank();
        if (this.peek() === "}") break;

        const start = this.index;
        const key = this.readKey();
        this.expect("=");
        this.skipBlank();
        this.readValue([...path, ...key]);
        this.assertProgress(start);
        this.skipBlank();

        if (this.peek() === ",") this.index++;
      }

      this.index++;
    } else {
      while (
        this.index < this.source.length &&
        !SCALAR_END_REGEXP.test(this.peek())
      ) {
        this.index++;
      }
    }
  }

  // Array of tables entries get an index, e.g. "fruit..1.color..0"
  private resolveTable(key: string[], isArray: boolean): string[] {
    const path: string[] = [];

    key.forEach((part, index) => {
      path.push(part);

      const resolved = path.join(".");
      const isLast = index === key.length - 1;

      if (isLast && isArray) {
        const item = (this.tableArrays.get(resolved) ?? -1) + 1;

        this.tableArrays.set(resolved, item);
        path.push("", String(item));
      } else if (this.tableArrays.has(resolved)) {
        path.push("", String(this.tableArrays.get(resolved)));
      }
    });

    return path;
  }
}

export const scan = (source: string): StringToken[] =>
  new Scanner(source).scan();
