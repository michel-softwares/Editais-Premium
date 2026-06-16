import { readdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.argv[2] || '.';
const output = process.argv[3] || 'catalog.json';
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function cleanText(value) {
  return value
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function normalizeSearch(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripDecorativePrefix(value) {
  return value.replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

function encodePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function getFolderUpdatedAt(folderName) {
  try {
    const timestamp = execFileSync('git', ['log', '-1', '--format=%ct', '--', folderName], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (timestamp) return new Date(Number(timestamp) * 1000).toISOString();
  } catch {
    // Git metadata may be unavailable in unusual environments.
  }

  return new Date().toISOString();
}

function buildTags(text, folderName) {
  const tags = new Set(['edital pronto']);
  const source = normalizeSearch(`${text} ${folderName}`);
  const catalogTagSource = normalizeSearch(
    text
      .split(/\r?\n/)
      .filter((line) => {
        const normalized = normalizeSearch(line);
        return normalized.includes('catalog_tags') || normalized.includes('tags catalogo') || normalized.includes('tags do catalogo');
      })
      .join(' '),
  );
  if (source.includes('pre-edital')) tags.add('pre-edital');
  if (source.includes('nivel medio')) tags.add('nivel medio');
  if (catalogTagSource.includes('nivel fundamental')) tags.add('nivel fundamental');
  if (catalogTagSource.includes('nivel medio')) tags.add('nivel medio');
  if (catalogTagSource.includes('nivel superior')) tags.add('nivel superior');
  if (source.includes('cebraspe')) tags.add('cebraspe');
  if (source.includes('fgv')) tags.add('fgv');
  if (source.includes('inss')) tags.add('inss');
  return [...tags];
}

function parseInfo(text, folderName, jsonName) {
  const cleaned = cleanText(text);
  const lines = cleaned.split('\n');
  
  let titleLine = folderName;
  let cargoLine = folderName;
  let descriptionLine = "baixe o arquivo .JSON importe no seu Track Concursos e comece a estudar";
  let bancaYearLine = "";
  
  const isPremiumFormat = text.includes("FICHA INFORMATIVA - EDITAL PREMIUM TRACK CONCURSOS");
  
  if (isPremiumFormat) {
    for (const line of lines) {
      if (line.includes("🏢 ÓRGÃO:")) {
        titleLine = line.replace("🏢 ÓRGÃO:", "").trim();
      } else if (line.includes("🪪 CARGO:")) {
        cargoLine = line.replace("🪪 CARGO:", "").trim();
      } else if (line.includes("🧾 BANCA:")) {
        bancaYearLine = line;
      }
    }
  } else {
    titleLine = lines[0] || folderName;
    cargoLine = lines[1] || titleLine;
    descriptionLine = lines[2] || cargoLine;
    bancaYearLine = lines[3] || '';
  }
  
  const yearMatch = bancaYearLine.match(/\b(20\d{2})\b/);
  let banca = 'A definir';
  
  let cleanBancaLine = bancaYearLine
    .replace(/🧾\s*(?:BANCA:)?/i, '')
    .replace(/\b(20\d{2})\b/, '')
    .replace(/:/g, '')
    .trim();
    
  if (cleanBancaLine) {
    banca = cleanBancaLine;
  }

  return {
    titulo: stripDecorativePrefix(titleLine),
    orgao: stripDecorativePrefix(titleLine),
    banca: banca,
    cargo: stripDecorativePrefix(cargoLine),
    ano: yearMatch ? Number(yearMatch[1]) : new Date().getFullYear(),
    tags: buildTags(cleaned, folderName),
    descricao: stripDecorativePrefix(descriptionLine),
    arquivoNome: jsonName,
  };
}

async function main() {
  const folders = await readdir(root, { withFileTypes: true });
  const editais = [];

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    if (folder.name.startsWith('.') || folder.name === 'scripts' || folder.name === 'node_modules') continue;

    const folderPath = path.join(root, folder.name);
    const files = await readdir(folderPath, { withFileTypes: true });
    const jsonFile = files.find((file) => file.isFile() && path.extname(file.name).toLowerCase() === '.json');
    const imageFile = files.find((file) => file.isFile() && imageExtensions.has(path.extname(file.name).toLowerCase()));
    const textFile = files.find((file) => file.isFile() && file.name.toLowerCase().endsWith('.txt'));

    if (!jsonFile || !imageFile || !textFile) continue;

    const text = await readFile(path.join(folderPath, textFile.name), 'utf8');
    const info = parseInfo(text, folder.name, jsonFile.name);
    const folderUrl = encodePath(folder.name);

    editais.push({
      id: slugify(folder.name),
      titulo: info.titulo,
      orgao: info.orgao,
      banca: info.banca,
      cargo: info.cargo,
      ano: info.ano,
      tags: info.tags,
      descricao: info.descricao,
      imagem: `${folderUrl}/${encodeURIComponent(imageFile.name)}`,
      arquivo: `${folderUrl}/${encodeURIComponent(jsonFile.name)}`,
      arquivoNome: info.arquivoNome,
      atualizadoEm: getFolderUpdatedAt(folder.name),
    });
  }

  editais.sort((a, b) => new Date(b.atualizadoEm) - new Date(a.atualizadoEm));

  await writeFile(
    output,
    `${JSON.stringify({ atualizadoEm: new Date().toISOString(), editais }, null, 2)}\n`,
    'utf8',
  );

  console.log(`Catalogo gerado com ${editais.length} edital(is): ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
