import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { type DocComments } from './document';

/**
 * Commentaires JSDoc des contrôleurs (`*.controller.ts`), lus dans les sources : ils
 * deviennent les résumés et descriptions de l'OpenAPI. Les balises (`@param`…) sont ignorées.
 */
export function readControllerComments(sourceDir: string): DocComments {
  const comments = new Map<string, string>();
  const files = readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.controller.ts'))
    .sort();
  for (const file of files) {
    const path = join(sourceDir, file);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        const classComment = commentOf(node);
        if (classComment) comments.set(className, classComment);
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
            const comment = commentOf(member);
            if (comment) comments.set(`${className}.${member.name.text}`, comment);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return comments;
}

function commentOf(node: ts.Node): string | undefined {
  const text = ts
    .getJSDocCommentsAndTags(node)
    .filter(ts.isJSDoc)
    .map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? '')
    .join('\n')
    .trim();
  return text || undefined;
}
