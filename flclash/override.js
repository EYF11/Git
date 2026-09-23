/**
 * FlClash 中文完整版覆写 v1.2
 * 适用：FlClash + Mihomo 内核
 * 目标：中文策略组、地区节点手动可选、AI 独立分流、国内直连、广告拦截、Fake-IP + DoH、防 DNS 泄漏取向。
 *
 * 重要：
 * 1) FlClash「设置 → 网络 → 覆写 DNS」请关闭。
 * 2) FlClash「追加系统 DNS」请关闭。
 * 3) 出站模式请使用「规则」；Android 推荐 TUN 模式。
 * 4) 本脚本降低 DNS 泄漏风险，但不能隐藏 TLS SNI、目标 IP 等所有网络元数据。
 */

const SETTINGS = {
  // 节点测速
  TEST_URL: "https://www.gstatic.com/generate_204",
  TEST_INTERVAL: 600,
  TEST_TOLERANCE: 80,

  // 默认关闭：在 UDP 质量很差的网络里可改为 true，强制 HTTPS 回落 TCP。
  // 开启可能降低 YouTube/Google 等服务速度，所以默认不建议。
  BLOCK_QUIC: false,
};

const GROUP = {
  MAIN: "🚀 节点选择",
  AUTO: "♻️ 自动选择",
  AI: "🤖 AI 服务",
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
  US_AUTO: "🇺🇸 美国自动",
};

// 常见机场信息/到期/流量节点，不纳入测速池。
const INFO_FILTER =
  "(?i)(流量|剩余|到期|套餐|官网|客服|更新|订阅|使用说明|公告|traffic|expire|expiry|官网|网址|联系|邮箱|email)";

const REGION = {
  HK: "(?i)(香港|港|🇭🇰|Hong[ ._-]*Kong|(^|[^A-Za-z])HK([^A-Za-z]|$))",
  TW: "(?i)(台湾|臺灣|台灣|🇹🇼|Taiwan|(^|[^A-Za-z])TW([^A-Za-z]|$))",
  JP: "(?i)(日本|🇯🇵|Japan|Tokyo|Osaka|(^|[^A-Za-z])JP([^A-Za-z]|$))",
  SG: "(?i)(新加坡|狮城|獅城|🇸🇬|Singapore|(^|[^A-Za-z])SG([^A-Za-z]|$))",
  US: "(?i)(美国|美國|🇺🇸|United[ ._-]*States|America|Los[ ._-]*Angeles|San[ ._-]*Jose|Seattle|Dallas|New[ ._-]*York|(^|[^A-Za-z])US(A)?([^A-Za-z]|$))",
  KR: "(?i)(韩国|韓國|🇰🇷|Korea|Seoul|(^|[^A-Za-z])KR([^A-Za-z]|$))",
};

const ALL_REGION_FILTER = [REGION.HK, REGION.TW, REGION.JP, REGION.SG, REGION.US, REGION.KR]
  .map(function (x) { return "(?:" + x.replace(/^\(\?i\)/, "") + ")"; })
  .join("|");

function urlTestGroup(name, filter, fallback) {
  const group = {
    name: name,
    type: "url-test",
    "include-all": true,
    url: SETTINGS.TEST_URL,
    interval: SETTINGS.TEST_INTERVAL,
    tolerance: SETTINGS.TEST_TOLERANCE,
    lazy: true,
    "exclude-filter": INFO_FILTER,
  };
  if (filter) group.filter = filter;
  // Mihomo 的 empty-fallback 只允许“代理节点”，不能写策略组名；DIRECT 是内置代理。
  group["empty-fallback"] = "DIRECT";
  return group;
}

function selectGroup(name, proxies) {
  return { name: name, type: "select", proxies: proxies };
}

// 地区组改为 select：进入“美国节点/香港节点”等组后可以明确选择具体节点。
// 注意：地区匹配仍然依据“节点名称”，不是实时检测出口 IP。
function manualRegionGroup(name, filter, excludeFilter) {
  const group = {
    name: name,
    type: "select",
    "include-all": true,
    filter: filter,
    "exclude-filter": excludeFilter || INFO_FILTER,
    "exclude-type": "direct",
    "empty-fallback": "DIRECT",
  };
  return group;
}

function provider(name, behavior, path, url) {
  return {
    type: "http",
    behavior: behavior,
    format: "mrs",
    path: "./ruleset/" + path,
    url: url,
    interval: 86400,
    // 规则集通过代理更新，减少 GitHub Raw 在直连网络下不稳定的问题。
    proxy: GROUP.MAIN,
  };
}

function buildRuleProviders() {
  const base = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/";
  return {
    private_domain: provider("private_domain", "domain", "private.mrs", base + "geosite/private.mrs"),
    ads_domain: provider("ads_domain", "domain", "category-ads-all.mrs", base + "geosite/category-ads-all.mrs"),
    ai_domain: provider("ai_domain", "domain", "category-ai-!cn.mrs", base + "geosite/category-ai-!cn.mrs"),
    google_domain: provider("google_domain", "domain", "google.mrs", base + "geosite/google.mrs"),
    youtube_domain: provider("youtube_domain", "domain", "youtube.mrs", base + "geosite/youtube.mrs"),
    telegram_domain: provider("telegram_domain", "domain", "telegram.mrs", base + "geosite/telegram.mrs"),
    github_domain: provider("github_domain", "domain", "github.mrs", base + "geosite/github.mrs"),
    twitter_domain: provider("twitter_domain", "domain", "twitter.mrs", base + "geosite/twitter.mrs"),
    facebook_domain: provider("facebook_domain", "domain", "facebook.mrs", base + "geosite/facebook.mrs"),
    instagram_domain: provider("instagram_domain", "domain", "instagram.mrs", base + "geosite/instagram.mrs"),
    netflix_domain: provider("netflix_domain", "domain", "netflix.mrs", base + "geosite/netflix.mrs"),
    spotify_domain: provider("spotify_domain", "domain", "spotify.mrs", base + "geosite/spotify.mrs"),
    proxymedia_domain: provider("proxymedia_domain", "domain", "proxymedia.mrs", base + "geosite/proxymedia.mrs"),
    apple_domain: provider("apple_domain", "domain", "apple.mrs", base + "geosite/apple.mrs"),
    microsoft_domain: provider("microsoft_domain", "domain", "microsoft.mrs", base + "geosite/microsoft.mrs"),
    geolocation_non_cn: provider("geolocation_non_cn", "domain", "geolocation-!cn.mrs", base + "geosite/geolocation-!cn.mrs"),
    cn_domain: provider("cn_domain", "domain", "cn.mrs", base + "geosite/cn.mrs"),
    private_ip: provider("private_ip", "ipcidr", "private-ip.mrs", base + "geoip/private.mrs"),
    telegram_ip: provider("telegram_ip", "ipcidr", "telegram-ip.mrs", base + "geoip/telegram.mrs"),
    cn_ip: provider("cn_ip", "ipcidr", "cn-ip.mrs", base + "geoip/cn.mrs"),
  };
}

function buildGroups() {
  const auto = urlTestGroup(GROUP.AUTO, null, "DIRECT");

  // GPT/AI 专用美国自动测速组
  const usAuto = urlTestGroup(GROUP.US_AUTO, REGION.US, "DIRECT");

  // 地区组改为手动 select，不再让 url-test 在组内自动替你切换。
  const hk = manualRegionGroup(GROUP.HK, REGION.HK);
  const tw = manualRegionGroup(GROUP.TW, REGION.TW);
  const jp = manualRegionGroup(GROUP.JP, REGION.JP);
  const sg = manualRegionGroup(GROUP.SG, REGION.SG);
  const us = manualRegionGroup(GROUP.US, REGION.US);
  const kr = manualRegionGroup(GROUP.KR, REGION.KR);

  const other = manualRegionGroup(
    GROUP.OTHER,
    ".*",
    "(?i)(" + INFO_FILTER.replace(/^\(\?i\)/, "") + "|" + ALL_REGION_FILTER + ")"
  );

  const allNodes = {
    name: GROUP.ALL,
    type: "select",
    "include-all": true,
    "exclude-filter": INFO_FILTER,
    "exclude-type": "direct",
    "empty-fallback": "DIRECT",
  };

  return [
    selectGroup(GROUP.MAIN, [
      GROUP.AUTO,
      GROUP.US,
      GROUP.US_AUTO,
      GROUP.SG,
      GROUP.JP,
      GROUP.HK,
      GROUP.TW,
      GROUP.KR,
      GROUP.OTHER,
      GROUP.ALL,
      "DIRECT",
    ]),

    auto,
    usAuto,
    us,
    sg,
    jp,
    hk,
    tw,
    kr,
    other,
    allNodes,

    // AI 默认美国自动；也可进入“美国节点”手动钉死某一个具体节点。
    selectGroup(GROUP.AI, [GROUP.US_AUTO, GROUP.US, GROUP.SG, GROUP.JP, GROUP.AUTO, GROUP.MAIN]),
    selectGroup(GROUP.GOOGLE, [GROUP.MAIN, GROUP.US, GROUP.US_AUTO, GROUP.SG, GROUP.JP, GROUP.HK]),
    selectGroup(GROUP.YOUTUBE, [GROUP.MAIN, GROUP.HK, GROUP.SG, GROUP.JP, GROUP.US]),
    selectGroup(GROUP.TELEGRAM, [GROUP.MAIN, GROUP.SG, GROUP.HK, GROUP.JP, GROUP.US]),
    selectGroup(GROUP.GITHUB, [GROUP.MAIN, GROUP.AUTO, GROUP.US, GROUP.SG, GROUP.JP]),
    selectGroup(GROUP.SOCIAL, [GROUP.MAIN, GROUP.SG, GROUP.HK, GROUP.JP, GROUP.US]),
    selectGroup(GROUP.STREAMING, [GROUP.SG, GROUP.JP, GROUP.US, GROUP.HK, GROUP.MAIN]),
    selectGroup(GROUP.APPLE, ["DIRECT", GROUP.MAIN, GROUP.HK, GROUP.US]),
    selectGroup(GROUP.MICROSOFT, ["DIRECT", GROUP.MAIN, GROUP.US, GROUP.SG]),
    selectGroup(GROUP.ADS, ["REJECT", "DIRECT"]),
    selectGroup(GROUP.DIRECT, ["DIRECT", GROUP.MAIN]),
    selectGroup(GROUP.FINAL, [GROUP.MAIN, GROUP.AUTO, "DIRECT"]),
  ];
}

function buildRules() {
  const rules = [
    // 局域网与广告优先
    "RULE-SET,private_domain,DIRECT",
    "RULE-SET,private_ip,DIRECT,no-resolve",
    "RULE-SET,ads_domain," + GROUP.ADS,

    // IP 检测站固定走主代理，避免被 CN 规则误判成直连。
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

    // AI / 开发 / 通讯
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

    // Google / YouTube
    "RULE-SET,youtube_domain," + GROUP.YOUTUBE,
    "RULE-SET,google_domain," + GROUP.GOOGLE,

    // 海外社交
    "RULE-SET,twitter_domain," + GROUP.SOCIAL,
    "RULE-SET,facebook_domain," + GROUP.SOCIAL,
    "RULE-SET,instagram_domain," + GROUP.SOCIAL,

    // 流媒体
    "RULE-SET,netflix_domain," + GROUP.STREAMING,
    "RULE-SET,spotify_domain," + GROUP.STREAMING,
    "RULE-SET,proxymedia_domain," + GROUP.STREAMING,

    // 厂商服务（默认可直连，可在策略组手动切换）
    "RULE-SET,apple_domain," + GROUP.APPLE,
    "RULE-SET,microsoft_domain," + GROUP.MICROSOFT,

    // 国际域名 / 中国域名
    "RULE-SET,geolocation_non_cn," + GROUP.MAIN,
    "RULE-SET,cn_domain," + GROUP.DIRECT,
    "RULE-SET,cn_ip," + GROUP.DIRECT + ",no-resolve",
  ];

  if (SETTINGS.BLOCK_QUIC) {
    // 可选：阻断 QUIC，迫使 HTTPS 使用 TCP/TLS；仅在 UDP 很差时尝试。
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

  // 明确通过主策略组访问国际 DoH，避免境外域名查询直接落到本地 DNS。
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

    // 用于解析 DoH 服务器自身域名；这里使用 IP，避免启动阶段依赖系统 DNS。
    "default-nameserver": ["223.5.5.5", "119.29.29.29"],

    // 默认国际 DoH 通过代理；国内域名由 policy 指向国内 DoH。
    nameserver: globalDoh,
    "proxy-server-nameserver": cnDoh,
    "direct-nameserver": cnDoh,
    "direct-nameserver-follow-policy": true,

    "nameserver-policy": {
      "rule-set:private_domain": cnDoh,
      "rule-set:cn_domain": cnDoh,
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

  // 不动机场的 proxies / proxy-providers，只重建策略组、规则、规则集和 DNS。
  config["proxy-groups"] = buildGroups();
  config["rule-providers"] = buildRuleProviders();
  config.rules = buildRules();
  config.dns = buildDns();

  // 一些温和的连接参数；FlClash 若有同名 App 设置，最终以 App 为准。
  config["unified-delay"] = true;
  config["tcp-concurrent"] = true;
  config["keep-alive-interval"] = 30;
  config["find-process-mode"] = "off";
  config["log-level"] = "warning";

  return config;
}
