const jsUrls = [
  'https://takaratomymall.jp/js/common.js',
  'https://takaratomymall.jp/js/user.js',
  'https://takaratomymall.jp/js/goods_ajax_cart.js',
  'https://takaratomymall.jp/js/goods_ajax_bookmark.js',
  'https://takaratomymall.jp/js/goodslist_ajax_cart.js',
  'https://takaratomymall.jp/js/goods_bookmarkbutton.js',
  'https://takaratomymall.jp/js/goods_cartbutton.js',
  'https://takaratomymall.jp/js/nonmember_goods_ajax_bookmark.js?20260202',
  'https://takaratomymall.jp/js/goods_ajax_tree_count.js',
  'https://takaratomymall.jp/js/category_ajax_tags.js',
  'https://takaratomymall.jp/js/goods_list_swiper.js?20260623',
  'https://d.rcmd.jp/takaratomymall.jp/item/recommend.js'
];

for (const url of jsUrls) {
  console.log(`\n## ${url}`);
  try {
    const text = await fetchText(url);
    const candidates = [
      ...findAll(text, /(?:url|href|action)\s*:\s*["']([^"']+)["']/gi),
      ...findAll(text, /\$\.ajax\s*\(\s*["']([^"']+)["']/gi),
      ...findAll(text, /\.(?:get|post|getJSON)\s*\(\s*["']([^"']+)["']/gi),
      ...findAll(text, /["']([^"']*\.(?:aspx|ashx|asmx|json|js)(?:\?[^"']*)?)["']/gi),
      ...findAll(text, /["']([^"']*(?:ajax|api|recommend|cart|bookmark|favorite|stock|goods)[^"']*)["']/gi)
    ].map((match) => match[1]);

    printUnique(candidates.map((value) => absolutize(value, url)), 200);
  } catch (error) {
    console.error(error.message || error);
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36',
      accept: '*/*',
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8'
    }
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1] || 'utf-8';
  return new TextDecoder(charset, { fatal: false }).decode(bytes);
}

function findAll(text, pattern) {
  const matches = [];
  let match;
  while ((match = pattern.exec(text)) !== null) matches.push(match);
  return matches;
}

function printUnique(values, limit) {
  const unique = [...new Set(values)].filter(Boolean);
  if (unique.length === 0) console.log('(none)');
  unique.slice(0, limit).forEach((value) => console.log(value));
}

function absolutize(value, baseUrl) {
  if (!value || /^(?:javascript:|mailto:|tel:|#)/i.test(value)) return value;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}
