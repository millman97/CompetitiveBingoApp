import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import ts from 'typescript';

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(directory, entry.name))
      : [join(directory, entry.name)]
  );
const errors = [];
if (existsSync('src/web'))
  errors.push('Use the root frontend directories instead of src/web.');
for (const directory of [
  'apis',
  'components',
  'error',
  'hooks',
  'model/domain',
  'routing',
  'screens',
  'stores',
  'utils',
]) {
  if (!existsSync(`src/${directory}`)) errors.push(`Missing src/${directory}.`);
}
for (const file of walk('src').filter(
  (file) =>
    /\.tsx?$/.test(file) &&
    !/[\\/](worker|contract|generated|__tests__)[\\/]/.test(file)
)) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const ui = /[\\/](screens|components)[\\/]/.test(file);
  if (ui && file.endsWith('.tsx')) {
    if (basename(dirname(file)) !== basename(file, '.tsx'))
      errors.push(`${file}: component and folder names must match.`);
    if (!source.statements.some(ts.isExportAssignment))
      errors.push(`${file}: export the primary component as default.`);
  }
  for (const node of source.statements.filter(ts.isImportDeclaration)) {
    const specifier = node.moduleSpecifier.text;
    if (specifier.startsWith('@dev-and-test/'))
      errors.push(`${file}: internal archetype packages are unavailable here.`);
    if (ui && specifier.endsWith('/apiRequest'))
      errors.push(`${file}: use a named API operation from src/apis.`);
  }
}
if (errors.length) {
  errors.forEach((error) => console.error(error));
  process.exitCode = 1;
} else console.log('Frontend structure follows the archetype boundaries.');
