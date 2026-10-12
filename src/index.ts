import {
  Document,
  Element,
  Processor,
  Root,
  Segment,
  id,
  root,
  segment,
  text,
} from "@segmsh/core";
import { parse as parseToml } from "smol-toml";
import { encode, scan } from "./utils.js";

export default class TomlProcessor implements Processor {
  parse(res: string): Document {
    // Validates the source; the scanner relies on well-formed TOML
    parseToml(res);

    const children: Root["children"] = [];
    const segments: Segment[] = [];
    let position = 0;

    scan(res).forEach((token) => {
      if (!token.value.trim()) return;

      if (token.start > position) {
        children.push(text(res.slice(position, token.start)));
      }

      const segId = id(token.key);

      segments.push({
        id: segId,
        text: token.value,
        metadata: { key: token.key },
      });

      children.push({
        type: "element",
        tagName: "string",
        properties: { raw: token.raw },
        children: [segment(segId)],
      });

      position = token.end;
    });

    if (position < res.length) {
      children.push(text(res.slice(position)));
    }

    return { tree: root(children), segments };
  }

  stringify(document: Document): string {
    const segmentsMap = new Map<string, Segment>(
      document.segments.map((current) => [current.id, current]),
    );

    return document.tree.children
      .map((child) => {
        if (child.type === "text") return child.value;
        if (child.type !== "element") return "";

        const raw = String((child as Element).properties.raw);
        const ref = child.children[0];
        const current =
          ref?.type === "segment" ? segmentsMap.get(ref.id) : undefined;

        return current ? encode(current.text, raw) : raw;
      })
      .join("");
  }
}
