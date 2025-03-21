import "@logseq/libs";
import { BlockEntity, PageEntity } from "@logseq/libs/dist/LSPlugin.user";
import { formatPropertiesString, getPropertiesFromBlockContent, mergeObjects, removeProperties } from "./util";

async function main(blockId: string) {
  const srcBlock = await logseq.Editor.getBlock(blockId, {
    includeChildren: true,
  });
  if (srcBlock === null || !logseq.settings?.allowWithoutChildren && srcBlock.children?.length === 0) {
    return;
  }

  const pageRegx = /^\[\[(.*)\]\]$/;
  const allLines = srcBlock.content.split("\n");
  const firstLine = allLines[0].trim();
  const pageName = firstLine.replace(pageRegx, "$1");

  await createPageIfNotExist(pageName);
  const [firstBlock, lastBlock] = await getFirstAndLastBlock(pageName) ?? []
  let pageBlock: BlockEntity | null = null;

  // Prepare a page block if necessary
  if (logseq.settings?.moveBlockPropertiesToPage || logseq.settings?.createPageTags) {
    pageBlock = firstBlock?.["preBlock?"]
      ? firstBlock // first block is a page properties block
      : await logseq.Editor.insertBlock(firstBlock ? firstBlock.uuid : pageName, "", { isPageBlock: true, before: true });
  }

  // Move block properties to page properties
  if (logseq.settings?.moveBlockPropertiesToPage && pageBlock) {
    // Get props from block content, because the one in the object properties are renamed, e.g. fix-issue -> fixissue, and we need the originals
    const propsCount = srcBlock?.propertiesOrder.length ?? 0;
    const blockProps = getPropertiesFromBlockContent(srcBlock);
    const pageProps = getPropertiesFromBlockContent(pageBlock);

    const newPageProperties = mergeObjects(mergeObjects({}, pageProps), blockProps);
    const newPagePropertiesString = formatPropertiesString(newPageProperties);

    // updateBlock seems to be the only way to simultaneously update the database (so queries update immediately)
    await logseq.Editor.updateBlock(pageBlock.uuid, newPagePropertiesString);
    await logseq.Editor.updateBlock(srcBlock.uuid, removeProperties(allLines).join("\n"));

    do {
      const updatedSrcBlock = await logseq.Editor.getBlock(srcBlock.uuid, { includeChildren: true });

      // Wait until properties are removed from references of the block
      if ((updatedSrcBlock?.refs.length ?? 0) <= srcBlock.refs.length - propsCount) {
        // Update properties in local source block object
        Object.assign(srcBlock, updatedSrcBlock);
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 50));
    } while (true);
  }

  let newBlockContent = "";
  if (!pageRegx.test(firstLine)) {
    newBlockContent = srcBlock.content.replace(firstLine, `[[${firstLine}]]`);
  }


  const targetBlock: BlockEntity = await getLastBlock(pageName) ?? await logseq.Editor.appendBlockInPage(pageName, "")
  if (targetBlock) {
    const children = srcBlock.children as BlockEntity[];
    let targetUUID = targetBlock.uuid;

    for (let i = 0; i < children.length; i++) {
      try {
        await logseq.Editor.moveBlock(children[i].uuid, targetUUID, {
          children: false,
          before: false,
        });
        targetUUID = children[i].uuid;
      } catch (error) {
        console.error("moveBlock error", error);
        logseq.App.showMsg("move block error", "error");
        return;
      }
    }

    // remove first line.
    if (targetBlock.content === "") {
      await logseq.Editor.removeBlock(targetBlock.uuid);
    }

    // Find remaining references logseq infers from the content and move them to the "tags::" property of the page
    if (logseq.settings?.createPageTags && pageBlock && srcBlock.refs) {
      const page = await logseq.Editor.getPage(pageName);
      const pageProps = page?.["properties"] || {};

      const contentPageRefs = await Promise.all(srcBlock.refs.map(ref => logseq.Editor.getPage(ref.id)));
      const tags: string[] = contentPageRefs
          .map(pageRef => pageRef.name)
          .filter((value, index, target) => index === target.indexOf(value));

      const props = mergeObjects({}, pageProps, { tags });
      const propsString = Object.entries(props).map(([key, value]) => `${key}:: ${value}`).join(`\n`);

      // updateBlock seems to be the only way to simultaneously update the database (so queries update immediately)
      await logseq.Editor.updateBlock(pageBlock.uuid, propsString);
    }

    if (newBlockContent) {
      await logseq.Editor.updateBlock(srcBlock.uuid, newBlockContent);
    }

    await logseq.Editor.exitEditingMode(true);

    if (srcBlock.properties?.collapsed) {
      await logseq.Editor.removeBlockProperty(srcBlock.uuid, "collapsed");
    }

   
    if (logseq.settings?.redirectToPage) {
      logseq.App.pushState("page", { name: pageName });
    }
  }
}

logseq
  .ready(() => {
    logseq.useSettingsSchema([
      {
        key: "allowWithoutChildren",
        title: "Allow page without children",
        description: "Allow to create a page without children",
        type: "boolean",
        default: false,
      },
      {
        key: "redirectToPage",
        title: "Redirect to page",
        description: "Redirect to page after creation",
        type: "boolean",
        default: false,
      },
      {
        key: "createFirstBlock",
        title: "Create first block",
        description: "Create a first block on an empty new page",
        type: "boolean",
        default: true,
      },
      {
        key: "moveBlockPropertiesToPage",
        title: "Move block properties to page",
        description: "Move the block properties to page properties",
        type: "boolean",
        default: false,
      },
      {
        key: "createPageTags",
        title: "Create page tags for references",
        description: "Create page tags for references in the block text",
        type: "boolean",
        default: false,
      },
    ])

    logseq.Editor.registerSlashCommand("Turn Into Page", async (e) => {
      main(e.uuid);
    });
    logseq.Editor.registerBlockContextMenuItem("Turn into page", async (e) => {
      main(e.uuid);
    });
  })
  .catch(console.error);

async function createPageIfNotExist(pageName: string) {
  let page = await logseq.Editor.getPage(pageName);
  if (!page) {
    await logseq.Editor.createPage(
      pageName,
      {},
      {
        createFirstBlock: true,
        redirect: false,
      }
    );
  } else {
    debug("page already exist");
    const lastBlock = await getLastBlock(pageName);
    if (lastBlock === null) {
      // 无法往空页面写入 block
      await logseq.Editor.deletePage(pageName);
      await logseq.Editor.createPage(
        pageName,
        {},
        {
          createFirstBlock: true,
          redirect: false,
        }
      );
    }
  }
}

async function getAllBlocks(pageName: string): Promise<null | BlockEntity[]> {
  const blocks = await logseq.Editor.getPageBlocksTree(pageName);
  if (blocks.length === 0) {
    return null;
  }
  return blocks;
}

async function getFirstAndLastBlock(pageName): Promise<null | [BlockEntity, BlockEntity]> {
  const blocks = await getAllBlocks(pageName);

  if (!blocks) return null;

  return [blocks[0], blocks[blocks.length - 1]];
}

async function getLastBlock(pageName: string): Promise<null | BlockEntity> {
  const blocks = await getAllBlocks(pageName);

  return blocks?.[blocks.length - 1] ?? null;
}

function debug(...args: any) {
  console.debug("block-to-page", ...args);
}
