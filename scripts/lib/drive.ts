import { google, drive_v3, Auth } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { exec } from 'node:child_process';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const TOKEN_PATH = path.resolve(process.cwd(), 'scripts', '.google-token.json');
const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

function openBrowser(url: string) {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log(`Não consegui abrir o navegador automaticamente. Abra manualmente este link:\n${url}`);
    }
  });
}

function saveToken(tokens: Auth.Credentials) {
  const existing = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')) : {};
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...existing, ...tokens }, null, 2));
}

async function loginInteractive(oAuth2Client: Auth.OAuth2Client): Promise<void> {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\nAbrindo o navegador para você logar na sua conta Google...');
  console.log(`Se não abrir sozinho, acesse este link:\n${authUrl}\n`);

  const code: string = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/oauth2callback') return;

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.end(
        error
          ? 'Login falhou. Pode fechar esta aba e voltar pro terminal.'
          : 'Login feito com sucesso! Pode fechar esta aba e voltar pro terminal.'
      );
      server.close();

      if (error) reject(new Error(`Login negado no Google: ${error}`));
      else if (code) resolve(code);
      else reject(new Error('Nenhum código de autorização recebido do Google.'));
    });
    server.listen(REDIRECT_PORT, () => openBrowser(authUrl));
  });

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  saveToken(tokens);
}

export async function getDriveClient(): Promise<drive_v3.Drive> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET não configurados no .env');
  }

  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  oAuth2Client.on('tokens', (tokens) => saveToken(tokens));

  if (fs.existsSync(TOKEN_PATH)) {
    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')));
  } else {
    await loginInteractive(oAuth2Client);
  }

  let drive = google.drive({ version: 'v3', auth: oAuth2Client });

  try {
    await drive.about.get({ fields: 'user' });
  } catch {
    console.log('Sessão do Google expirada (comum em apps em modo de teste, token dura ~7 dias) — é preciso logar de novo.');
    await loginInteractive(oAuth2Client);
    drive = google.drive({ version: 'v3', auth: oAuth2Client });
  }

  return drive;
}

export async function findBrandFolder(drive: drive_v3.Drive, marca: string): Promise<string> {
  const escaped = marca.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `mimeType = 'application/vnd.google-apps.folder' and name = '${escaped}' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  const folder = res.data.files?.[0];
  if (!folder?.id) {
    throw new Error(
      `Nenhuma pasta chamada "${marca}" encontrada no seu Google Drive (verifique o nome exato da pasta).`
    );
  }
  return folder.id;
}

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const MAX_RECURSION_DEPTH = 5;

async function listChildren(drive: drive_v3.Drive, folderId: string) {
  const items: { id: string; name: string; mimeType: string }[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      spaces: 'drive',
      pageSize: 100,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      items.push({ id: f.id!, name: f.name!, mimeType: f.mimeType! });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return items;
}

/** Extensões que a API de transcrição do Groq aceita (ela decide o tipo pelo nome do arquivo, não pelo conteúdo). */
const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/x-matroska': '.mkv',
  'video/3gpp': '.3gp',
};

/** Desce em subpastas (ex: "Julho", "Agosto") até MAX_RECURSION_DEPTH níveis, coletando todo vídeo encontrado. */
export async function listVideosInFolder(
  drive: drive_v3.Drive,
  folderId: string,
  depth = 0
): Promise<{ id: string; name: string; mimeType: string; ext: string }[]> {
  const children = await listChildren(drive, folderId);
  const videos = children
    .filter((f) => f.mimeType.startsWith('video/'))
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      ext: MIME_TO_EXT[f.mimeType] ?? '.mp4',
    }));

  if (depth >= MAX_RECURSION_DEPTH) return videos;

  const subfolders = children.filter((f) => f.mimeType === FOLDER_MIME_TYPE);
  for (const sub of subfolders) {
    const subVideos = await listVideosInFolder(drive, sub.id, depth + 1);
    videos.push(...subVideos);
  }

  return videos;
}

export async function downloadDriveFile(drive: drive_v3.Drive, fileId: string, destPath: string): Promise<void> {
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  await new Promise<void>((resolve, reject) => {
    const dest = fs.createWriteStream(destPath);
    res.data.pipe(dest);
    dest.on('finish', resolve);
    dest.on('error', reject);
    res.data.on('error', reject);
  });
}
