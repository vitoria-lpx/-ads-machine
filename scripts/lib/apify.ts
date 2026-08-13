import { ApifyClient } from 'apify-client';

export interface AdLibraryAd {
  archiveId: string;
  videoUrl: string;
  libraryUrl: string;
}

function buildSearchUrl(pageId: string): string {
  return (
    `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL` +
    `&is_targeted_country=false&media_type=video&search_type=page` +
    `&sort_data[direction]=desc&sort_data[mode]=total_impressions&view_all_page_id=${pageId}`
  );
}

/**
 * Mesmo actor e mesmos campos usados pelo skill /ad-poller (.claude/commands/ad-poller.md),
 * mas com active_status=active (só o que está rodando agora) em vez de "all".
 *
 * Algumas marcas rodam anúncios a partir de mais de uma Page ID (ex: Bendita Cânfora) --
 * roda uma chamada por página, em sequência (mesma regra do ad-poller: evitar rate limit
 * da Apify rodando em paralelo), e junta os resultados removendo duplicatas por Archive ID.
 */
export async function fetchActiveVideoAds(pageIds: string[]): Promise<AdLibraryAd[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN não configurado no .env');

  const client = new ApifyClient({ token });
  const seen = new Set<string>();
  const ads: AdLibraryAd[] = [];

  for (const pageId of pageIds) {
    const run = await client.actor('apify/facebook-ads-scraper').call({
      startUrls: [{ url: buildSearchUrl(pageId) }],
      resultsLimit: 100,
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    for (const item of items as any[]) {
      const archiveId = item.adArchiveId ?? item.adArchiveID;
      if (!archiveId || seen.has(String(archiveId))) continue;

      const displayFormat = item.snapshot?.displayFormat;
      if (displayFormat !== 'VIDEO') continue;

      // Ver ad-poller.md: a projeção de campos do Apify quebra arrays aninhados,
      // por isso checar os dois formatos possíveis de resposta.
      const videoUrl: string | undefined =
        item.snapshot?.videos?.[0]?.videoHdUrl ??
        item.snapshot?.videos?.[0]?.videoSdUrl ??
        item['snapshot.videos.videoHdUrl']?.[0] ??
        item['snapshot.videos.videoSdUrl']?.[0];

      if (!videoUrl) continue;

      seen.add(String(archiveId));
      ads.push({
        archiveId: String(archiveId),
        videoUrl,
        libraryUrl: `https://www.facebook.com/ads/library/?id=${archiveId}`,
      });
    }
  }

  return ads;
}
