/**
 * FlClash 中文完整版覆写 v1.6
 * 适用：FlClash + Mihomo 内核
 * 目标：中文策略组、地区自动/手动双模式、Chrome Gemini 稳定出口、
 *      美国节点误标防护、可选真实美国出口检测、AI 独立分流、Fake-IP + DoH。
 *
 * 重要：
 * 1) FlClash「设置 → 网络 → 覆写 DNS」关闭。
 * 2) FlClash「追加系统 DNS」关闭。
 * 3) 出站模式使用「规则」；Android 由系统 VPN/TUN 接管。
 * 4) IPv6 建议关闭；本脚本同时关闭 Mihomo 顶层与 DNS IPv6。
 * 5) 仅靠节点名称无法证明真实出口国家。真正自动识别需要一个按来源国家返回不同 HTTP 状态的检测端点。
 */

const SETTINGS = {
  TEST_URL: "https://www.gstatic.com/generate_204",
  GEMINI_TEST_URL: "https://gemini.google.com/",
  TEST_INTERVAL: 600,
  TEST_TOLERANCE: 80,

  // 真实美国出口检测端点（可选）。
  // 要求：美国来源返回 HTTP 204，非美国返回非 204。
  // 部署仓库中的 flclash/us-geo-check-worker.js 后，把 /us 地址填到这里。
  // 留空时不会伪装成“真实美国检测”，而是使用下方候选组。
  US_GEO_TEST_URL: "",

  // 已人工确认真实美国出口的节点名正则。留空则不生成“✅ 美国已验证”组。
  // 示例："(?i)(美国高速 22|美国ISP家宽 12)"
  VERIFIED_US_FILTER: "",

  // 已确认误标/不希望进入美国自动池的节点。可继续追加，用 | 分隔。
  // 当前把截图中实际出口为香港的“延迟≠速度美国三网优化...”排除。
  US_EXCLUDE_FILTER: "(?i)(延迟≠速度美国三网优化)",

  BLOCK_QUIC: false,
};

const GROUP = {
  MAIN: "🚀 节点选择",
  AUTO: "♻️ 自动选择",
  AI: "🤖 AI 服务",
  GEMINI: "💎 Gemini",
  CHROME_GEMINI: "🧩 Chrome Gemini",
  US_VERIFIED: "✅ 美国已验证",
  US_TRUE_STABLE: "🇺🇸 美国真实稳定",
  US_TRUE_AUTO: "🇺🇸 美国真实自动",
  US_CANDIDATE_STABLE: "🇺🇸 美国候选稳定",
  US_CANDIDATE_AUTO: "🇺🇸 美国候选自动",
  GOOGLE: "🔍 Google",
  YOUTUBE: "📺 YouTube",
  TELEGRAM: "✈️ Telegram",
  GITHUB: "🐙 GitHub",
  SOCIAL: "🌐 海外社交",
  STREAMING: "🎬 流媒体",
  APPLE: "🍎 Apple",
  MICROSOFT: "🪟 Microsoft",
  ADS: "🛑 广告拦截",
  DIRECT: "🎯 国内直连",
  FINAL: "🐟 漏网之鱼",

  HK: "🇭🇰 香港节点",
  TW: "🇹🇼 台湾节点",
  JP: "🇯🇵 日本节点",
  SG: "🇸🇬 新加坡节点",
  US: "🇺🇸 美国节点",
  KR: "🇰🇷 韩国节点",
  OTHER: "🌍 其他节点",
  ALL: "🧭 全部节点",

  HK_AUTO: "🇭🇰 香港自动",
  TW_AUTO: "🇹🇼 台湾自动",
  JP_AUTO: "🇯🇵 日本自动",
  SG_AUTO: "🇸🇬 新加坡自动",
  US_AUTO: "🇺🇸 美国自动",
  KR_AUTO: "🇰🇷 韩国自动",
};

const INFO_FILTER =
  "(?i)(流量|剩余|到期|套餐|官网|客服|更新|订阅|使用说明|公告|traffic|expire|expiry|网址|联系|邮箱|email)";

const REGION = {
  HK: "(?i)(香港|港|🇭🇰|Hong[ ._-]*Kong|(^|[^A-Za-z])HK([^A-Za-z]|$))",
  TW: "(?i)(台湾|臺灣|台灣|🇹🇼|Taiwan|(^|[^A-Za-z])TW([^A-Za-z]|$))",
  JP: "(?i)(日本|🇯🇵|Japan|Tokyo|Osaka|(^|[^A-Za-z])JP([^A-Za-z]|$))",
  SG: "(?i)(新加坡|狮城|獅城|🇸🇬|Singapore|(^|[^A-Za-z])SG([^A-Za-z]|$))",
  US: "(?i)(美国|美國|🇺🇸|United[ ._-]*States|America|Los[ ._-]*Angeles|San[ ._-]*Jose|Seattle|Dallas|New[ ._-]*York|(^|[^A-Za-z])US(A)?([^A-Za-z]|$))",
  KR: "(?i)(韩国|韓國|🇰🇷|Korea|Seoul|(^|[^A-Za-z])KR([^A-Za-z]|$))",
};

const ALL_REGION_FILTER = [
  REGION.HK, REGION.TW, REGION.JP, REGION.SG, REGION.US, REGION.KR,
].map(function (x) {
  return "(?:" + x.replace(/^\(\?i\)/, "") + ")";
}).join("|");

function stripCaseFlag(s) {
  return (s || "").replace(/^\(\?i\)/, "");
}

function combineExclude() {
  const parts = [];
  for (let i = 0; i < arguments.length; i++) {
    if (arguments[i]) parts.push(stripCaseFlag(arguments[i]));
  }
  return "(?i)(" + parts.join("|") + ")";
}

const US_EXCLUDE = combineExclude(INFO_FILTER, SETTINGS.US_EXCLUDE_FILTER);

function urlTestGroup(name, filter, url, expectedStatus, emptyFallback, excludeFilter) {
  const testUrl = url || SETTINGS.TEST_URL;
  const group = {
    name: name,
    type: "url-test",
    "include-all": true,
    url: testUrl,
    interval: SETTINGS.TEST_INTERVAL,
    tolerance: SETTINGS.TEST_TOLERANCE,
    lazy: true,
    "exclude-filter": excludeFilter || INFO_FILTER,
    "exclude-type": "direct",
    "empty-fallback": emptyFallback || "DIRECT",
  };
  if (filter) group.filter = filter;
  if (expectedStatus) group["expected-status"] = expectedStatus;
  else if (testUrl === SETTINGS.TEST_URL) group["expected-status"] = "204";
  return group;
}

function fallbackGroup(name, filter, url, expectedStatus, emptyFallback, excludeFilter) {
  const group = {
    name: name,
    type: "fallback",
    "include-all": true,
    url: url || SETTINGS.TEST_URL,
    interval: SETTINGS.TEST_INTERVAL,
    lazy: true,
    "exclude-filter": excludeFilter || INFO_FILTER,
    "exclude-type": "direct",
    "empty-fallback": emptyFallback || "DIRECT",
  };
  if (filter) group.filter = filter;
  if (expectedStatus) group["expected-status"] = expectedStatus;
  return group;
}

function selectGroup(name, proxies) {
  return { name: name, type: "select", proxies: proxies };
}

function manualRegionGroup(name, filter, autoGroup, excludeFilter) {
  return {
    name: name,
    type: "select",
    proxies: autoGroup ? [autoGroup] : [],
    "include-all": true,
    filter: filter,
    "exclude-filter": excludeFilter || INFO_FILTER,
    "exclude-type": "direct",
    "empty-fallback": "DIRECT",
  };
}

function provider(behavior, path, url) {
  return {
    type: "http",
    behavior: behavior,
    format: "mrs",
    path: "./ruleset/" + path,
    url: url,
    interval: 86400,
    proxy: GROUP.MAIN,
  };
}

function buildRuleProviders() {
  const base = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/";
  return {
    private_domain: provider("domain", "private.mrs", base + "geosite/private.mrs"),
    ads_domain: provider("domain", "category-ads-all.mrs", base + "geosite/category-ads-all.mrs"),
    ai_domain: provider("domain", "category-ai-!cn.mrs", base + "geosite/category-ai-!cn.mrs"),
    gemini_domain: provider("domain", "google-gemini.mrs", base + "geosite/google-gemini.mrs"),
    google_domain: provider("domain", "google.mrs", base + "geosite/google.mrs"),
    youtube_domain: provider("domain", "youtube.mrs", base + "geosite/youtube.mrs"),
    telegram_domain: provider("domain", "telegram.mrs", base + "geosite/telegram.mrs"),
    github_domain: provider("domain", "github.mrs", base + "geosite/github.mrs"),
    twitter_domain: provider("domain", "twitter.mrs", base + "geosite/twitter.mrs"),
    facebook_domain: provider("domain", "facebook.mrs", base + "geosite/facebook.mrs"),
    instagram_domain: provider("domain", "instagram.mrs", base + "geosite/instagram.mrs"),
    netflix_domain: provider("domain", "netflix.mrs", base + "geosite/netflix.mrs"),
    spotify_domain: provider("domain", "spotify.mrs", base + "geosite/spotify.mrs"),
    proxymedia_domain: provider("domain", "proxymedia.mrs", base + "geosite/proxymedia.mrs"),
    apple_domain: provider("domain", "apple.mrs", base + "geosite/apple.mrs"),
    microsoft_domain: provider("domain", "microsoft.mrs", base + "geosite/microsoft.mrs"),
    geolocation_non_cn: provider("domain", "geolocation-!cn.mrs", base + "geosite/geolocation-!cn.mrs"),
    cn_domain: provider("domain", "cn.mrs", base + "geosite/cn.mrs"),
    private_ip: provider("ipcidr", "private-ip.mrs", base + "geoip/private.mrs"),
    telegram_ip: provider("ipcidr", "telegram-ip.mrs", base + "geoip/telegram.mrs"),
    cn_ip: provider("ipcidr", "cn-ip.mrs", base + "geoip/cn.mrs"),
  };
}

function buildGroups() {
  const auto = urlTestGroup(GROUP.AUTO, null);

  const usAuto = urlTestGroup(GROUP.US_AUTO, REGION.US, null, null, "DIRECT", US_EXCLUDE);
  const sgAuto = urlTestGroup(GROUP.SG_AUTO, REGION.SG);
  const jpAuto = urlTestGroup(GROUP.JP_AUTO, REGION.JP);
  const hkAuto = urlTestGroup(GROUP.HK_AUTO, REGION.HK);
  const twAuto = urlTestGroup(GROUP.TW_AUTO, REGION.TW);
  const krAuto = urlTestGroup(GROUP.KR_AUTO, REGION.KR);

  // 候选组：节点名像美国 + Gemini 实站可达，但不声称真实出口一定在美国。
  const usCandidateStable = fallbackGroup(
    GROUP.US_CANDIDATE_STABLE,
    REGION.US,
    SETTINGS.GEMINI_TEST_URL,
    "200-399",
    "REJECT",
    US_EXCLUDE
  );
  const usCandidateAuto = urlTestGroup(
    GROUP.US_CANDIDATE_AUTO,
    REGION.US,
    SETTINGS.GEMINI_TEST_URL,
    "200-399",
    "REJECT",
    US_EXCLUDE
  );

  const groups = [
    auto, usAuto, sgAuto, jpAuto, hkAuto, twAuto, krAuto,
    usCandidateStable, usCandidateAuto,
  ];

  const chromeOptions = [];
  const geminiOptions = [];

  // 人工白名单：只在设置了正则时生成，避免“已验证”名不副实。
  if (SETTINGS.VERIFIED_US_FILTER) {
    const verified = manualRegionGroup(
      GROUP.US_VERIFIED,
      SETTINGS.VERIFIED_US_FILTER,
      null,
      INFO_FILTER
    );
    groups.push(verified);
    chromeOptions.push(GROUP.US_VERIFIED);
    geminiOptions.push(GROUP.US_VERIFIED);
  }

  // 真正自动的来源国家检查：只有配置了专用检测端点才生成。
  if (SETTINGS.US_GEO_TEST_URL) {
    const usTrueStable = fallbackGroup(
      GROUP.US_TRUE_STABLE,
      REGION.US,
      SETTINGS.US_GEO_TEST_URL,
      "204",
      "REJECT",
      US_EXCLUDE
    );
    const usTrueAuto = urlTestGroup(
      GROUP.US_TRUE_AUTO,
      REGION.US,
      SETTINGS.US_GEO_TEST_URL,
      "204",
      "REJECT",
      US_EXCLUDE
    );
    groups.push(usTrueStable, usTrueAuto);
    chromeOptions.push(GROUP.US_TRUE_STABLE, GROUP.US_TRUE_AUTO);
    geminiOptions.push(GROUP.US_TRUE_STABLE, GROUP.US_TRUE_AUTO);
  }

  chromeOptions.push(
    GROUP.US_CANDIDATE_STABLE,
    GROUP.US_CANDIDATE_AUTO,
    GROUP.US,
    GROUP.US_AUTO
  );
  geminiOptions.push(
    GROUP.CHROME_GEMINI,
    GROUP.US_CANDIDATE_STABLE,
    GROUP.US_CANDIDATE_AUTO,
    GROUP.US,
    GROUP.US_AUTO,
    GROUP.SG_AUTO,
    GROUP.JP_AUTO
  );

  const us = manualRegionGroup(GROUP.US, REGION.US, GROUP.US_AUTO, US_EXCLUDE);
  const sg = manualRegionGroup(GROUP.SG, REGION.SG, GROUP.SG_AUTO);
  const jp = manualRegionGroup(GROUP.JP, REGION.JP, GROUP.JP_AUTO);
  const hk = manualRegionGroup(GROUP.HK, REGION.HK, GROUP.HK_AUTO);
  const tw = manualRegionGroup(GROUP.TW, REGION.TW, GROUP.TW_AUTO);
  const kr = manualRegionGroup(GROUP.KR, REGION.KR, GROUP.KR_AUTO);

  const other = manualRegionGroup(
    GROUP.OTHER,
    ".*",
    null,
    combineExclude(INFO_FILTER, ALL_REGION_FILTER)
  );

  const allNodes = {
    name: GROUP.ALL,
    type: "select",
    "include-all": true,
    "exclude-filter": INFO_FILTER,
    "exclude-type": "direct",
    "empty-fallback": "DIRECT",
  };

  groups.push(us, sg, jp, hk, tw, kr, other, allNodes);

  const main = selectGroup(GROUP.MAIN, [
    GROUP.AUTO,
    GROUP.CHROME_GEMINI,
    GROUP.US_AUTO,
    GROUP.SG_AUTO,
    GROUP.JP_AUTO,
    GROUP.HK_AUTO,
    GROUP.TW_AUTO,
    GROUP.KR_AUTO,
    GROUP.US,
    GROUP.SG,
    GROUP.JP,
    GROUP.HK,
    GROUP.TW,
    GROUP.KR,
    GROUP.OTHER,
    GROUP.ALL,
    "DIRECT",
  ]);

  const chromeGemini = selectGroup(GROUP.CHROME_GEMINI, chromeOptions);
  const gemini = selectGroup(GROUP.GEMINI, geminiOptions);

  return [
    main,
    ...groups,
    chromeGemini,
    gemini,

    selectGroup(GROUP.AI, [
      GROUP.US_AUTO,
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.US,
      GROUP.SG,
      GROUP.JP,
      GROUP.AUTO,
      GROUP.MAIN,
    ]),

    // Google 默认跟随 Chrome Gemini，尽量让 Search / AI Mode / Gemini 使用同一出口。
    selectGroup(GROUP.GOOGLE, [
      GROUP.CHROME_GEMINI,
      GROUP.MAIN,
      GROUP.US_AUTO,
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.HK_AUTO,
      GROUP.US,
      GROUP.SG,
      GROUP.JP,
      GROUP.HK,
    ]),

    selectGroup(GROUP.YOUTUBE, [
      GROUP.MAIN,
      GROUP.HK_AUTO,
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.US_AUTO,
      GROUP.HK,
      GROUP.SG,
      GROUP.JP,
      GROUP.US,
    ]),

    selectGroup(GROUP.TELEGRAM, [
      GROUP.MAIN,
      GROUP.SG_AUTO,
      GROUP.HK_AUTO,
      GROUP.JP_AUTO,
      GROUP.US_AUTO,
      GROUP.SG,
      GROUP.HK,
      GROUP.JP,
      GROUP.US,
    ]),

    selectGroup(GROUP.GITHUB, [
      GROUP.MAIN,
      GROUP.AUTO,
      GROUP.US_AUTO,
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.US,
      GROUP.SG,
      GROUP.JP,
    ]),

    selectGroup(GROUP.SOCIAL, [
      GROUP.MAIN,
      GROUP.SG_AUTO,
      GROUP.HK_AUTO,
      GROUP.JP_AUTO,
      GROUP.US_AUTO,
      GROUP.SG,
      GROUP.HK,
      GROUP.JP,
      GROUP.US,
    ]),

    selectGroup(GROUP.STREAMING, [
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.US_AUTO,
      GROUP.HK_AUTO,
      GROUP.SG,
      GROUP.JP,
      GROUP.US,
      GROUP.HK,
      GROUP.MAIN,
    ]),

    selectGroup(GROUP.APPLE, [
      "DIRECT", GROUP.MAIN, GROUP.HK_AUTO, GROUP.US_AUTO, GROUP.HK, GROUP.US,
    ]),
    selectGroup(GROUP.MICROSOFT, [
      "DIRECT", GROUP.MAIN, GROUP.US_AUTO, GROUP.SG_AUTO, GROUP.US, GROUP.SG,
    ]),
    selectGroup(GROUP.ADS, ["REJECT", "DIRECT"]),
    selectGroup(GROUP.DIRECT, ["DIRECT", GROUP.MAIN]),
    selectGroup(GROUP.FINAL, [GROUP.MAIN, GROUP.AUTO, "DIRECT"]),
  ];
}

function buildRules() {
  const rules = [
    "RULE-SET,private_domain,DIRECT",
    "RULE-SET,private_ip,DIRECT,no-resolve",
    "RULE-SET,ads_domain," + GROUP.ADS,

    "DOMAIN-SUFFIX,ip.sb," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ipinfo.io," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ipify.org," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ifconfig.me," + GROUP.MAIN,
    "DOMAIN-SUFFIX,icanhazip.com," + GROUP.MAIN,
    "DOMAIN-SUFFIX,whatismyipaddress.com," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ip-api.com," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ipapi.co," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ipleak.net," + GROUP.MAIN,
    "DOMAIN-SUFFIX,browserleaks.com," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ping0.cc," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ip111.cn," + GROUP.MAIN,

    // Gemini 必须在通用 AI / Google 之前。
    "RULE-SET,gemini_domain," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,gemini.google.com," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,bard.google.com," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,aistudio.google.com," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,makersuite.google.com," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,ai.google.dev," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,generativelanguage.googleapis.com," + GROUP.GEMINI,

    "RULE-SET,ai_domain," + GROUP.AI,
    "DOMAIN-SUFFIX,openai.com," + GROUP.AI,
    "DOMAIN-SUFFIX,chatgpt.com," + GROUP.AI,
    "DOMAIN-SUFFIX,oaistatic.com," + GROUP.AI,
    "DOMAIN-SUFFIX,oaiusercontent.com," + GROUP.AI,
    "DOMAIN-SUFFIX,anthropic.com," + GROUP.AI,
    "DOMAIN-SUFFIX,claude.ai," + GROUP.AI,
    "DOMAIN-SUFFIX,perplexity.ai," + GROUP.AI,
    "DOMAIN-SUFFIX,x.ai," + GROUP.AI,
    "DOMAIN-SUFFIX,grok.com," + GROUP.AI,

    "RULE-SET,github_domain," + GROUP.GITHUB,
    "RULE-SET,telegram_domain," + GROUP.TELEGRAM,
    "RULE-SET,telegram_ip," + GROUP.TELEGRAM + ",no-resolve",

    "RULE-SET,youtube_domain," + GROUP.YOUTUBE,
    "RULE-SET,google_domain," + GROUP.GOOGLE,

    "RULE-SET,twitter_domain," + GROUP.SOCIAL,
    "RULE-SET,facebook_domain," + GROUP.SOCIAL,
    "RULE-SET,instagram_domain," + GROUP.SOCIAL,

    "RULE-SET,netflix_domain," + GROUP.STREAMING,
    "RULE-SET,spotify_domain," + GROUP.STREAMING,
    "RULE-SET,proxymedia_domain," + GROUP.STREAMING,

    "RULE-SET,apple_domain," + GROUP.APPLE,
    "RULE-SET,microsoft_domain," + GROUP.MICROSOFT,

    "RULE-SET,geolocation_non_cn," + GROUP.MAIN,
    "RULE-SET,cn_domain," + GROUP.DIRECT,
    "RULE-SET,cn_ip," + GROUP.DIRECT + ",no-resolve",
  ];

  if (SETTINGS.BLOCK_QUIC) {
    rules.push("AND,((NETWORK,udp),(DST-PORT,443)),REJECT");
  }

  rules.push("MATCH," + GROUP.FINAL);
  return rules;
}

function buildDns() {
  const cnDoh = [
    "https://223.5.5.5/dns-query",
    "https://1.12.12.12/dns-query",
  ];

  const globalDoh = [
    "https://1.1.1.1/dns-query#" + GROUP.MAIN,
    "https://8.8.8.8/dns-query#" + GROUP.MAIN,
  ];

  return {
    enable: true,
    listen: "0.0.0.0:1053",
    ipv6: false,
    "cache-algorithm": "arc",
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter-mode": "blacklist",
    "fake-ip-filter": [
      "*.lan",
      "*.local",
      "localhost",
      "+.localdomain",
      "time.*",
      "ntp.*",
      "stun.*",
      "+.msftconnecttest.com",
      "+.msftncsi.com",
    ],
    "use-hosts": true,
    "use-system-hosts": false,
    "prefer-h3": false,
    "respect-rules": true,

    "default-nameserver": ["223.5.5.5", "119.29.29.29"],
    nameserver: globalDoh,
    "proxy-server-nameserver": cnDoh,
    "direct-nameserver": cnDoh,
    "direct-nameserver-follow-policy": true,

    "nameserver-policy": {
      "rule-set:private_domain": cnDoh,
      "rule-set:cn_domain": cnDoh,
      "rule-set:gemini_domain": globalDoh,
      "rule-set:ai_domain": globalDoh,
      "rule-set:google_domain": globalDoh,
      "rule-set:youtube_domain": globalDoh,
      "rule-set:telegram_domain": globalDoh,
      "rule-set:github_domain": globalDoh,
      "rule-set:twitter_domain": globalDoh,
      "rule-set:facebook_domain": globalDoh,
      "rule-set:instagram_domain": globalDoh,
      "rule-set:netflix_domain": globalDoh,
      "rule-set:spotify_domain": globalDoh,
      "rule-set:proxymedia_domain": globalDoh,
      "rule-set:geolocation_non_cn": globalDoh,
    },
  };
}

function main(config) {
  if (!config || typeof config !== "object") config = {};

  config["proxy-groups"] = buildGroups();
  config["rule-providers"] = buildRuleProviders();
  config.rules = buildRules();
  config.dns = buildDns();

  config.ipv6 = false;
  config["unified-delay"] = true;
  config["tcp-concurrent"] = true;
  config["keep-alive-interval"] = 30;
  config["find-process-mode"] = "off";
  config["log-level"] = "warning";

  config.profile = Object.assign({}, config.profile || {}, {
    "store-selected": true,
    "store-fake-ip": true,
  });

  return config;
}
