import { assert, describe, it } from "vitest";
import eol from "eol";
import fs from "fs";
import path from "path";
import { parse as parseToml } from "smol-toml";
import TomlProcessor from "../src";

const processor = new TomlProcessor();

const fixtures = [
  "simple.toml",
  "typical.toml",
  "picker.toml",
  "array.toml",
  "multiline.toml",
  "edge.toml",
];

function readFixture(filename: string): string {
  return eol.lf(
    fs.readFileSync(path.join("test", "fixtures", filename), {
      encoding: "utf-8",
    }),
  );
}

// Resolves "a.b..0.c" against a parsed TOML object; key parts may contain dots
function getByKey(object: unknown, key: string): unknown {
  const resolve = (current: any, parts: string[]): unknown => {
    if (!parts.length) return current;
    if (current === null || typeof current !== "object") return undefined;

    if (parts[0] === "" && parts.length > 1) {
      return resolve(current[Number(parts[1])], parts.slice(2));
    }

    for (let length = parts.length; length > 0; length--) {
      const part = parts.slice(0, length).join(".");

      if (part in current) {
        const result = resolve(current[part], parts.slice(length));
        if (result !== undefined) return result;
      }
    }

    return undefined;
  };

  return resolve(object, key.split("."));
}

describe("TomlProcessorTest", function () {
  fixtures.forEach((filename) => {
    it(`should process ${filename} correctly`, function () {
      const input = readFixture(filename);
      const document = processor.parse(input);
      const roundTripped = processor.parse(processor.stringify(document));

      assert.equal(JSON.stringify(roundTripped), JSON.stringify(document));
    });

    it(`should roundtrip ${filename} exactly`, function () {
      const input = readFixture(filename);

      assert.equal(processor.stringify(processor.parse(input)), input);
    });

    it(`should map ${filename} segments to their values`, function () {
      const input = readFixture(filename);
      const parsed = parseToml(input);

      processor.parse(input).segments.forEach((current) => {
        assert.equal(
          getByKey(parsed, String(current.metadata?.key)),
          current.text,
          String(current.metadata?.key),
        );
      });
    });

    it(`should keep ${filename} valid after translation`, function () {
      const input = readFixture(filename);
      const document = processor.parse(input);
      const samples = [
        "Übersetzt",
        "with \"double\" and 'single' quotes",
        "back\\slash and\ttab",
        "multi\nline\n",
        "\nleading newline",
        "triple ''' and \"\"\" quotes",
        "ends with quote'",
        'ends with quote"',
        "control \u0001 char",
      ];

      document.segments.forEach((current, index) => {
        current.text = samples[index % samples.length];
      });

      const output = processor.stringify(document);
      const parsed = parseToml(output);

      document.segments.forEach((current) => {
        assert.equal(
          getByKey(parsed, String(current.metadata?.key)),
          current.text,
          String(current.metadata?.key),
        );
      });
    });
  });

  it("should segment only non-empty string values", function () {
    const document = processor.parse(
      'a = "Text"\nb = 1\nc = true\nd = 1979-05-27\ne = ""\n"f" = [1, "Item"]\n',
    );

    assert.deepEqual(
      document.segments.map(({ text, metadata }) => [metadata?.key, text]),
      [
        ["a", "Text"],
        ["f..1", "Item"],
      ],
    );
  });

  it("should resolve keys of tables and arrays of tables", function () {
    const document = processor.parse(readFixture("array.toml"));
    const keys = document.segments.map(({ metadata }) => metadata?.key);

    assert.includeMembers(keys, [
      "fruit..0.name",
      "fruit..0.geometry.shape",
      "fruit..0.color..1.name",
      "fruit..1.color..0.note",
    ]);
  });

  it("should keep the original quote style when possible", function () {
    const document = processor.parse(
      "a = 'Literal'\nb = '''\nMulti'''\nc = \"\"\"\nBasic\"\"\"\n",
    );

    document.segments[0].text = "Wörtlich";
    document.segments[1].text = "Mehr\nZeilen";
    document.segments[2].text = "Einfach";

    assert.equal(
      processor.stringify(document),
      "a = 'Wörtlich'\nb = '''\nMehr\nZeilen'''\nc = \"\"\"\nEinfach\"\"\"\n",
    );
  });

  it("should fall back to basic strings when needed", function () {
    const document = processor.parse("a = 'Literal'\n");

    document.segments[0].text = "It's";

    assert.equal(processor.stringify(document), 'a = "It\'s"\n');
  });

  it("should produce deterministic ids", function () {
    const input = readFixture("typical.toml");

    assert.deepEqual(processor.parse(input), processor.parse(input));
  });

  it("should throw on invalid toml", function () {
    assert.throws(() => processor.parse('a = "unterminated\n'));
  });
});
