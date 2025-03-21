import { BlockEntity } from "@logseq/libs/dist/LSPlugin.user";

function hasProperty(block: BlockEntity, propertyKey: string): boolean {
  return block.properties?.[propertyKey] !== undefined;
}

export function toBatchBlocks(blocks: BlockEntity[]) {
  return blocks.map((c) => ({
    content: c.content,
    // children: [] 会出错
    children: c.children?.length
      ? toBatchBlocks(c.children as BlockEntity[])
      : undefined,
    properties: c.properties,
  }));
}

export function mayBeReferenced(blocks: BlockEntity[]) {
  return blocks.some((b) => {
    if (hasProperty(b, "id")) {
      return true;
    } else {
      if (b.children) {
        return mayBeReferenced(b.children as BlockEntity[]);
      } else {
        return false;
      }
    }
  });
}


export function mergeObjects(target: any, source?: any, ...args) {
  if (!source) return target;

  for (const key of Object.keys(source)) {
      if (Array.isArray(source[key])) {
          // Falls beide Werte Arrays sind, zusammenführen, ansonsten ersetzen
          target[key] = Array.isArray(target[key]) ? [...target[key], ...source[key]] : source[key];
      } else if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          // Falls beide Werte Objekte sind, rekursiv zusammenführen, ansonsten ersetzen
          target[key] = typeof target[key] === 'object' && !Array.isArray(target[key])
              ? mergeObjects({ ...target[key] }, source[key])
              : source[key];
      } else {
          // String oder andere primitive Werte werden ersetzt
          target[key] = source[key];
      }
  }
  return mergeObjects(target, ...args);
}

export function formatPropertiesString(props: any) {
  return Object.entries(props).map(([key, value]) => `${key}:: ${value}`).join(`\n`);
}


const propertyLineRegex = /^\s*([\w]+)::\s+(.*?)\s*?$/;

export function getPropertiesFromBlockContent(srcBlock: BlockEntity) {
  const lines = srcBlock.content.split("\n");
  const firstPropertyLine = getFirstPropertyLine(lines);
  const lastPropertyLine = getLastPropertyLine(lines, firstPropertyLine);

  return Object.fromEntries(lines
    .slice(firstPropertyLine, lastPropertyLine + 1)
    .map(line => line.match(propertyLineRegex))
    .filter(m => m !== null)
    .map(([m, key, textValue]) => {
      const formattedKey = key.toLowerCase().replace(/[^a-z]/, "");

      return [key, srcBlock.properties[formattedKey]];
    }));
}

/**
 * Behavior of Logseq is that the first line matching a property pattern is a property.
 */
export function getFirstPropertyLine(lines: string[]) {
  const firstPropertyLine = lines.findIndex(line => propertyLineRegex.test(line));
  return firstPropertyLine === -1 ? lines.length : firstPropertyLine;
}

/**
 * Behavior of Logseq is that any line after the first property line that matches property pattern also is a property.
 * However, if there is any interruption like non-property pattern or an empty line, all valid properties after that are ignored.
 */
export function getLastPropertyLine(lines: string[], firstPropLine = getFirstPropertyLine(lines)) {
  const lastPropLine = lines.slice(firstPropLine).findIndex(line => !propertyLineRegex.test(line));

  return (lastPropLine === -1 ? lines.length : lastPropLine) - 1;
}

export function removeProperties(allLines: string[]) {
  const firstPropertyLine = getFirstPropertyLine(allLines);
  const contentLines = allLines.slice(0, firstPropertyLine);
  return contentLines;
}

