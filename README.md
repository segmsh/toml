# @segmsh/toml

TOML processor for [segm.sh](https://segm.sh). This package parses TOML files into a document (AST + segments) and stringifies them back, treating string values as translatable segments while leaving everything else byte-for-byte intact.

## Installation

```bash
npm install @segmsh/toml
```

## Usage

```typescript
import TomlProcessor from "@segmsh/toml";

const processor = new TomlProcessor();

const tomlContent = '[owner]\nname = "Tom"\nport = 8080\n';
const document = processor.parse(tomlContent);
// document.segments[0].text === "Tom"
// document.segments[0].metadata === { key: "owner.name" }

// ... modify document segments ...

const newTomlContent = processor.stringify(document);
```

## Features

- **Source Preservation**: Comments, formatting, key order and non-string values are kept exactly as written.
- **String Values Only**: Numbers, booleans, dates, keys and empty strings are never segmented.
- **Key Paths**: Each segment carries its key path in `metadata.key` (e.g. `fruit..0.color..1.name` for arrays).
- **Quote Styles**: Translated values keep their original quote style (basic, literal, multiline) whenever the new text allows it.
- **Round-trip**: Parsing and stringifying an unchanged document returns the original input.

## Development

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

## License

[Apache-2.0](LICENSE)
